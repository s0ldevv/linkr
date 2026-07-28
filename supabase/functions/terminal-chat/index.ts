// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { processLinkrAgentTurn } from "../_shared/linkr_agent_runtime.ts";
import type {
  LinkrTurnInput,
  LinkrTurnOutputSink,
} from "../_shared/linkr_agent_runtime_types.ts";
import {
  consumeRateLimit,
  internalErrorResponse,
  rateLimitResponse,
  readJsonBody,
  requestBodyErrorResponse,
  serializeUnknownError,
} from "../_shared/http.ts";
import { acceptShadowWork } from "../_shared/shadow_queue.ts";
import { validateMediaUrl } from "../_shared/bounded_media.ts";
import { getActiveBanForAuthUser } from "../_shared/x_bans.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  const userId = await getCallerUserId(req);
  if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

  const admin = serviceClient();
  const activeBan = (await getActiveBanForAuthUser(admin, userId)).ban;
  if (activeBan) {
    return jsonResponse(
      {
        error: "banned_x_user",
        message: "This X account is banned from Linkr.",
      },
      { status: 403 },
    );
  }

  const perMinuteLimit = positiveIntegerEnv(
    "LINKR_TERMINAL_REQUESTS_PER_MINUTE",
    30,
  );
  try {
    const limit = await consumeRateLimit(admin, {
      subjectType: "terminal_chat",
      subjectId: userId,
      windowSeconds: 60,
      limit: perMinuteLimit,
    });
    if (!limit.allowed) return rateLimitResponse(limit.resetAt);
  } catch (error) {
    return internalErrorResponse(error, {
      function: "terminal-chat",
      phase: "rate_limit",
    });
  }

  let body: any = {};
  try {
    body = await readJsonBody(req, 64 * 1024);
  } catch (error) {
    return (
      requestBodyErrorResponse(error) ??
        internalErrorResponse(error, {
          function: "terminal-chat",
          phase: "parse_body",
        })
    );
  }

  const rawMessage = String(body?.message ?? "");
  const text = rawMessage.trim()
    ? String(rawMessage).trim()
    : String(rawMessage);
  let attachments: NormalizedTerminalAttachment[];
  try {
    attachments = normalizeTerminalAttachments(body?.attachments);
  } catch {
    return jsonResponse({ error: "invalid_attachment" }, { status: 400 });
  }
  if (!text && attachments.length === 0) {
    return jsonResponse({ error: "empty_message" }, { status: 400 });
  }
  if (text.length > 8000) {
    return jsonResponse({ error: "message_too_long" }, { status: 413 });
  }

  const prepared = await prepareTurn(admin, userId, body, text, attachments)
    .catch((
      error,
    ) => ({ error }));
  if ((prepared as any).error) {
    const prepareError = (prepared as any).error;
    const message = prepareError instanceof Error
      ? prepareError.message
      : String(prepareError);
    if (/conversation_not_found/.test(message)) {
      return jsonResponse({ error: "conversation_not_found" }, { status: 404 });
    }
    return internalErrorResponse(prepareError, {
      function: "terminal-chat",
      phase: "prepare",
    });
  }

  await acceptShadowWork(admin, {
    p_idempotency_key: `shadow:terminal:${(prepared as PreparedTurn).run.id}`,
    p_source_surface: "terminal",
    p_source_event_id: (prepared as PreparedTurn).run.id,
    p_user_id: userId,
    p_conversation_id: (prepared as PreparedTurn).conversation.id,
    p_request_type: "conversation_turn",
    p_route: "conversation.turn",
    p_priority: 50,
    p_resource_type: "conversation",
    p_resource_key: `terminal:${(prepared as PreparedTurn).conversation.id}`,
    p_payload: {
      run_id: (prepared as PreparedTurn).run.id,
      user_message_id: (prepared as PreparedTurn).userMessage.id,
    },
    p_payload_ref: null,
    p_payload_hash: null,
  }).catch((error) => {
    console.error(
      "terminal_shadow_accept_failed",
      serializeUnknownError(error),
    );
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let clientOpen = true;
      const enqueue = (value: string) => {
        if (!clientOpen) return;
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          clientOpen = false;
        }
      };
      const emitRaw = (event: string, payload: Record<string, unknown>) => {
        enqueue(`event: ${event}\n`);
        enqueue(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const heartbeat = setInterval(() => enqueue(": keepalive\n\n"), 15_000);
      const turn = prepared as PreparedTurn;
      const sink = createTerminalSink(admin, turn, emitRaw);
      try {
        await sink.emit("ack", {
          conversation_id: (prepared as PreparedTurn).conversation.id,
          user_message_id: (prepared as PreparedTurn).userMessage.id,
          assistant_message_id: (prepared as PreparedTurn).assistantMessage.id,
          run_id: (prepared as PreparedTurn).run.id,
        });
        if ((prepared as PreparedTurn).replayed) {
          emitReplayedTurn(emitRaw, prepared as PreparedTurn);
          return;
        }
        await sink.setStatus("typing", { label: "Linkr is reading context" });
        const result = await processLinkrAgentTurn(
          admin,
          buildTurnInput(
            userId,
            text,
            body,
            prepared as PreparedTurn,
            attachments,
          ),
          sink,
        );
        await sink.emit(
          "complete",
          result as unknown as Record<string, unknown>,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const safeMessage = userSafeError(message);
        console.error("terminal_turn_failed", serializeUnknownError(error));
        await failRunningTurn(admin, turn, safeMessage).catch(() => {});
        emitRaw("message_update", {
          message_id: turn.assistantMessage.id,
          content: safeMessage,
          parts: [],
          status: "failed",
        });
        await sink.emit("error", { message: safeMessage }).catch(() => {});
      } finally {
        clearInterval(heartbeat);
        clientOpen = false;
        try {
          controller.close();
        } catch {
          // The client disconnected; durable state was still finalized above.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

type PreparedTurn = {
  conversation: any;
  userMessage: any;
  assistantMessage: any;
  run: any;
  replayed: boolean;
};

async function prepareTurn(
  admin: any,
  userId: string,
  body: any,
  text: string,
  attachments: NormalizedTerminalAttachment[],
): Promise<PreparedTurn> {
  const conversation = await loadOrCreateConversation(
    admin,
    userId,
    body?.conversation_id,
    text,
  );
  const clientMessageId = String(body?.client_message_id ?? crypto.randomUUID())
    .trim();
  const userMessage = await insertOrSelect(
    admin,
    "linkr_terminal_messages",
    {
      conversation_id: conversation.id,
      user_id: userId,
      role: "user",
      content: text,
      parts: [],
      status: "completed",
      client_message_id: clientMessageId,
      source_refs: [],
      metadata: {
        client_context: body?.client_context ?? null,
        attachments,
      },
      idempotency_key: `terminal-user:${userId}:${clientMessageId}`,
    },
    "idempotency_key",
    `terminal-user:${userId}:${clientMessageId}`,
  );
  if (userMessage.error) throw userMessage.error;

  const assistantMessage = await insertOrSelect(
    admin,
    "linkr_terminal_messages",
    {
      conversation_id: conversation.id,
      user_id: userId,
      role: "assistant",
      content: "",
      parts: [],
      status: "typing",
      metadata: {},
      idempotency_key: `terminal-assistant:${userMessage.data.id}`,
    },
    "idempotency_key",
    `terminal-assistant:${userMessage.data.id}`,
    userId,
  );
  if (assistantMessage.error) throw assistantMessage.error;

  const run = await insertOrSelect(
    admin,
    "linkr_agent_runs",
    {
      user_id: userId,
      surface: "terminal",
      source_surface: "terminal",
      surface_conversation_id: conversation.id,
      terminal_conversation_id: conversation.id,
      user_message_id: userMessage.data.id,
      assistant_message_id: assistantMessage.data.id,
      status: "running",
      started_at: new Date().toISOString(),
      idempotency_key: `terminal-run:${userMessage.data.id}`,
    },
    "idempotency_key",
    `terminal-run:${userMessage.data.id}`,
    userId,
  );
  if (run.error || !run.data?.id) {
    const error = run.error ?? new Error("terminal run insert returned no id");
    await failPreparedTurn(
      admin,
      userId,
      assistantMessage.data.id,
      null,
      error,
    );
    throw error;
  }

  try {
    if (userMessage.inserted) {
      await incrementConversationMessageCount(
        admin,
        conversation.id,
        userId,
        1,
        text,
        "user",
      );
    }
    if (assistantMessage.inserted) {
      await incrementConversationMessageCount(
        admin,
        conversation.id,
        userId,
        1,
        null,
        null,
      );
    }
    if (!conversation.title) {
      const titleUpdate = await admin
        .from("linkr_terminal_conversations")
        .update({ title: titleFromText(text) })
        .eq("id", conversation.id)
        .eq("user_id", userId)
        .is("title", null);
      if (titleUpdate.error) throw titleUpdate.error;
    }
  } catch (error) {
    await failPreparedTurn(
      admin,
      userId,
      assistantMessage.data.id,
      run.data.id,
      error,
    );
    throw error;
  }

  return {
    conversation,
    userMessage: userMessage.data,
    assistantMessage: assistantMessage.data,
    run: run.data,
    replayed: !run.inserted,
  };
}

async function failPreparedTurn(
  admin: any,
  userId: string,
  assistantMessageId: string,
  runId: string | null,
  error: unknown,
) {
  const diagnostic = serializeUnknownError(error);
  console.error("terminal_prepare_failed", diagnostic);
  await admin
    .from("linkr_terminal_messages")
    .update({
      content: "I couldn't start that request. Please try again.",
      status: "failed",
      metadata: {
        failure_phase: "prepare",
        error_code: "terminal_prepare_failed",
      },
    })
    .eq("id", assistantMessageId)
    .eq("user_id", userId);
  if (runId) {
    await admin
      .from("linkr_agent_runs")
      .update({
        status: "failed",
        error: "terminal_prepare_failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);
  }
}

async function failRunningTurn(
  admin: any,
  prepared: PreparedTurn,
  safeMessage: string,
) {
  const completedAt = new Date().toISOString();
  const [messageUpdate, runUpdate] = await Promise.all([
    admin
      .from("linkr_terminal_messages")
      .update({
        content: safeMessage,
        parts: [],
        status: "failed",
        metadata: {
          failure_phase: "execution",
          error_code: "terminal_execution_failed",
        },
      })
      .eq("id", prepared.assistantMessage.id)
      .eq("user_id", prepared.conversation.user_id)
      .in("status", ["typing", "sending"]),
    admin
      .from("linkr_agent_runs")
      .update({
        status: "failed",
        error: "terminal_execution_failed",
        completed_at: completedAt,
      })
      .eq("id", prepared.run.id)
      .eq("user_id", prepared.conversation.user_id)
      .eq("status", "running"),
  ]);
  if (messageUpdate.error) throw messageUpdate.error;
  if (runUpdate.error) throw runUpdate.error;
}

type NormalizedTerminalAttachment = {
  kind: "image";
  source_url: string;
  storage_path?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  byte_length?: number;
};

function normalizeTerminalAttachments(
  raw: unknown,
): NormalizedTerminalAttachment[] {
  const source = Array.isArray(raw) ? raw : [];
  const output: NormalizedTerminalAttachment[] = [];
  for (const candidate of source.slice(0, 8)) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    if (String(item.kind ?? "image") !== "image") continue;
    const sourceUrl = String(item.source_url ?? "").trim();
    if (!sourceUrl) continue;
    const trustedSourceUrl = validateMediaUrl(sourceUrl);
    const attachment: NormalizedTerminalAttachment = {
      kind: "image",
      source_url: trustedSourceUrl,
    };
    if (typeof item.storage_path === "string" && item.storage_path.trim()) {
      attachment.storage_path = item.storage_path.trim();
    }
    if (typeof item.mime_type === "string" && item.mime_type.trim()) {
      attachment.mime_type = item.mime_type.trim();
    }
    if (typeof item.width === "number" && Number.isFinite(item.width)) {
      attachment.width = item.width;
    }
    if (typeof item.height === "number" && Number.isFinite(item.height)) {
      attachment.height = item.height;
    }
    if (
      typeof item.byte_length === "number" &&
      Number.isFinite(item.byte_length)
    ) {
      attachment.byte_length = item.byte_length;
    }
    output.push(attachment);
  }
  return output;
}

async function loadOrCreateConversation(
  admin: any,
  userId: string,
  conversationId: unknown,
  text: string,
) {
  const id = String(conversationId ?? "").trim();
  if (id) {
    const { data, error } = await admin
      .from("linkr_terminal_conversations")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("conversation_not_found");
    return data;
  }
  const { data, error } = await admin
    .from("linkr_terminal_conversations")
    .insert({
      user_id: userId,
      title: titleFromText(text),
      status: "active",
      source: "terminal",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

function buildTurnInput(
  userId: string,
  text: string,
  body: any,
  prepared: PreparedTurn,
  attachments: NormalizedTerminalAttachment[],
): LinkrTurnInput {
  return {
    surface: "terminal",
    surface_conversation_id: prepared.conversation.id,
    source_message_id: prepared.userMessage.id,
    user_id: userId,
    text,
    actor: { kind: "authenticated_user", user_id: userId },
    transport: {
      kind: "terminal_sse",
      public_output: false,
      supports_streaming: true,
    },
    conversation: {
      terminal_conversation_id: prepared.conversation.id,
      user_message_id: prepared.userMessage.id,
      assistant_message_id: prepared.assistantMessage.id,
      run_id: prepared.run.id,
    },
    attachments,
    source_refs: [],
    client_context: body?.client_context ?? {},
  };
}

function createTerminalSink(
  admin: any,
  prepared: PreparedTurn,
  emitRaw: (event: string, payload: Record<string, unknown>) => void,
): LinkrTurnOutputSink {
  let assistantText = "";
  let parts: unknown[] = [];
  return {
    async setStatus(status, metadata = {}) {
      emitRaw(status === "typing" ? "typing" : "execution_status", {
        status,
        ...metadata,
      });
      await admin.from("linkr_terminal_events").insert({
        run_id: prepared.run.id,
        conversation_id: prepared.conversation.id,
        user_id: prepared.conversation.user_id,
        type: status,
        payload: metadata,
      });
    },
    async emit(event, payload) {
      emitRaw(event, payload);
      if (!["delta", "ack"].includes(String(event))) {
        await admin.from("linkr_terminal_events").insert({
          run_id: prepared.run.id,
          conversation_id: prepared.conversation.id,
          user_id: prepared.conversation.user_id,
          type: String(event),
          payload,
        });
      }
    },
    async appendAssistantDelta(delta) {
      assistantText += delta;
      emitRaw("delta", { delta, content: assistantText });
    },
    async setAssistantMessage(args) {
      assistantText = args.content;
      parts = args.parts ?? parts;
      await admin
        .from("linkr_terminal_messages")
        .update({
          content: args.content,
          parts,
          status: args.status,
          metadata: args.metadata ?? {},
        })
        .eq("id", prepared.assistantMessage.id)
        .eq("user_id", prepared.conversation.user_id);
      await incrementConversationMessageCount(
        admin,
        prepared.conversation.id,
        prepared.conversation.user_id,
        0,
        args.content,
        "assistant",
      );
      emitRaw("message_update", {
        message_id: prepared.assistantMessage.id,
        content: args.content,
        parts,
        status: args.status,
      });
    },
    async addMessagePart(part) {
      parts = [...parts, part];
      await admin
        .from("linkr_terminal_messages")
        .update({ parts })
        .eq("id", prepared.assistantMessage.id)
        .eq("user_id", prepared.conversation.user_id);
    },
    async addSourceRef(sourceRef) {
      emitRaw("source_ref", sourceRef);
    },
    async createPendingActionCard(payload) {
      parts = [...parts, { type: "confirmation_card", ...payload }];
      emitRaw("action_required", payload);
    },
    async finalize(result) {
      emitRaw("complete", result as unknown as Record<string, unknown>);
    },
  };
}

async function insertOrSelect(
  admin: any,
  table: string,
  row: Record<string, unknown>,
  keyColumn: string,
  keyValue: string,
  userId = String(row.user_id ?? ""),
) {
  const inserted = await admin.from(table).insert(row).select("*")
    .maybeSingle();
  if (!inserted.error) return { ...inserted, inserted: true };
  const code = String(inserted.error?.code ?? "");
  const message = String(inserted.error?.message ?? "");
  if (code !== "23505" && !/duplicate key|unique/i.test(message)) {
    return { ...inserted, inserted: false };
  }
  let query = admin.from(table).select("*").eq(keyColumn, keyValue);
  if (userId) query = query.eq("user_id", userId);
  const selected = await query.maybeSingle();
  return { ...selected, inserted: false };
}

async function incrementConversationMessageCount(
  admin: any,
  conversationId: string,
  userId: string,
  delta: number,
  preview: string | null,
  role: string | null,
) {
  const result = await admin.rpc("increment_linkr_terminal_message_count", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_delta: delta,
    p_preview: preview,
    p_role: role,
  });
  if (result.error) throw result.error;
}

function emitReplayedTurn(
  emit: (event: string, payload: Record<string, unknown>) => void,
  prepared: PreparedTurn,
) {
  const status = String(prepared.run?.status ?? "running");
  if (["completed", "failed", "cancelled", "ignored"].includes(status)) {
    emit("message_update", {
      message_id: prepared.assistantMessage.id,
      content: prepared.assistantMessage.content ?? "",
      parts: prepared.assistantMessage.parts ?? [],
      status: prepared.assistantMessage.status ?? status,
      replayed: true,
    });
    emit("complete", {
      status,
      run_id: prepared.run.id,
      assistant_message_id: prepared.assistantMessage.id,
      replayed: true,
    });
    return;
  }
  emit("execution_status", {
    status: "running",
    run_id: prepared.run.id,
    replayed: true,
    message: "This turn is already being processed.",
  });
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Math.floor(Number(Deno.env.get(name) ?? fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function titleFromText(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 54
    ? clean.slice(0, 51) + "..."
    : clean || "New conversation";
}

function userSafeError(message: string) {
  if (/conversation_run_locked/.test(message)) {
    return "Linkr is still finishing the previous turn. Try again in a moment.";
  }
  return "Linkr hit an error before finishing this turn.";
}
