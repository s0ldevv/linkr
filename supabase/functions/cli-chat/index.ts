// deno-lint-ignore-file no-explicit-any

import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { processLinkrAgentTurn } from "../_shared/linkr_agent_runtime.ts";
import type {
  LinkrTurnInput,
  LinkrTurnOutputSink,
} from "../_shared/linkr_agent_runtime_types.ts";
import {
  consumeRateLimit,
  internalErrorResponse,
  rateLimitResponse,
  serializeUnknownError,
} from "../_shared/http.ts";
import {
  AgentApiError,
  agentErrorResponse,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { acceptShadowWork } from "../_shared/shadow_queue.ts";
import { validateMediaUrl } from "../_shared/bounded_media.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return agentErrorResponse(new AgentApiError("method_not_allowed", 405));
  }

  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "chat:write");
  } catch (error) {
    await recordAgentRequest(admin, {}, req, (error as any)?.status ?? 401, error).catch(() => {});
    return agentErrorResponse(error);
  }

  const perMinuteLimit = positiveIntegerEnv("LINKR_CLI_CHAT_REQUESTS_PER_MINUTE", 30);
  try {
    const limit = await consumeRateLimit(admin, {
      subjectType: "cli_chat_user",
      subjectId: ctx.userId,
      windowSeconds: 60,
      limit: perMinuteLimit,
    });
    if (!limit.allowed) {
      await recordAgentRequest(admin, ctx, req, 429).catch(() => {});
      return rateLimitResponse(limit.resetAt);
    }
  } catch (error) {
    await recordAgentRequest(admin, ctx, req, 500, error).catch(() => {});
    return internalErrorResponse(error, {
      function: "cli-chat",
      phase: "rate_limit",
    });
  }

  const body = ctx.body ?? {};
  const rawMessage = String(body?.message ?? "");
  const text = rawMessage.trim() ? rawMessage.trim() : rawMessage;
  let attachments: NormalizedTerminalAttachment[];
  try {
    attachments = normalizeTerminalAttachments(body?.attachments);
  } catch {
    await recordAgentRequest(admin, ctx, req, 400, new AgentApiError("invalid_attachment", 400))
      .catch(() => {});
    return agentErrorResponse(new AgentApiError("invalid_attachment", 400));
  }
  if (!text && attachments.length === 0) {
    await recordAgentRequest(admin, ctx, req, 400, new AgentApiError("empty_message", 400))
      .catch(() => {});
    return agentErrorResponse(new AgentApiError("empty_message", 400));
  }
  if (text.length > 8000) {
    await recordAgentRequest(admin, ctx, req, 413, new AgentApiError("message_too_long", 413))
      .catch(() => {});
    return agentErrorResponse(new AgentApiError("message_too_long", 413));
  }

  const prepared = await prepareTurn(admin, ctx.userId, body, text, attachments).catch((
    error,
  ) => ({ error }));
  if ((prepared as any).error) {
    const prepareError = (prepared as any).error;
    const status = /conversation_not_found/.test(String(prepareError?.message ?? prepareError))
      ? 404
      : 500;
    await recordAgentRequest(admin, ctx, req, status, prepareError).catch(() => {});
    if (status === 404) return agentErrorResponse(new AgentApiError("conversation_not_found", 404));
    return internalErrorResponse(prepareError, {
      function: "cli-chat",
      phase: "prepare",
    });
  }

  await recordAgentRequest(admin, ctx, req, 200).catch(() => {});

  await acceptShadowWork(admin, {
    p_idempotency_key: `shadow:cli:${(prepared as PreparedTurn).run.id}`,
    p_source_surface: "cli",
    p_source_event_id: (prepared as PreparedTurn).run.id,
    p_user_id: ctx.userId,
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
    console.error("cli_shadow_accept_failed", serializeUnknownError(error));
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
          conversation_id: turn.conversation.id,
          user_message_id: turn.userMessage.id,
          assistant_message_id: turn.assistantMessage.id,
          run_id: turn.run.id,
        });
        if (turn.replayed) {
          emitReplayedTurn(emitRaw, turn);
          return;
        }
        await sink.setStatus("typing", { label: "Linkr is reading context" });
        const result = await processLinkrAgentTurn(
          admin,
          buildTurnInput(ctx.userId, text, body, turn, attachments),
          sink,
        );
        await sink.emit("complete", result as unknown as Record<string, unknown>);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const safeMessage = userSafeError(message);
        console.error("cli_turn_failed", serializeUnknownError(error));
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
          // Client disconnected after durable state was written.
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

type NormalizedTerminalAttachment = {
  kind: "image";
  source_url: string;
  storage_path?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  byte_length?: number;
};

async function prepareTurn(
  admin: any,
  userId: string,
  body: any,
  text: string,
  attachments: NormalizedTerminalAttachment[],
): Promise<PreparedTurn> {
  const conversation = await loadOrCreateConversation(admin, userId, body?.conversation_id, text);
  const clientMessageId = String(body?.client_message_id ?? crypto.randomUUID()).trim();
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
        source_surface: "cli",
      },
      idempotency_key: `cli-user:${userId}:${clientMessageId}`,
    },
    "idempotency_key",
    `cli-user:${userId}:${clientMessageId}`,
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
      metadata: { source_surface: "cli" },
      idempotency_key: `cli-assistant:${userMessage.data.id}`,
    },
    "idempotency_key",
    `cli-assistant:${userMessage.data.id}`,
    userId,
  );
  if (assistantMessage.error) throw assistantMessage.error;

  const run = await insertOrSelect(
    admin,
    "linkr_agent_runs",
    {
      user_id: userId,
      surface: "cli",
      source_surface: "cli",
      surface_conversation_id: conversation.id,
      terminal_conversation_id: conversation.id,
      user_message_id: userMessage.data.id,
      assistant_message_id: assistantMessage.data.id,
      status: "running",
      started_at: new Date().toISOString(),
      idempotency_key: `cli-run:${userMessage.data.id}`,
    },
    "idempotency_key",
    `cli-run:${userMessage.data.id}`,
    userId,
  );
  if (run.error || !run.data?.id) {
    const error = run.error ?? new Error("cli run insert returned no id");
    await failPreparedTurn(admin, userId, assistantMessage.data.id, null, error);
    throw error;
  }

  try {
    if (userMessage.inserted) {
      await incrementConversationMessageCount(admin, conversation.id, userId, 1, text, "user");
    }
    if (assistantMessage.inserted) {
      await incrementConversationMessageCount(admin, conversation.id, userId, 1, null, null);
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
    await failPreparedTurn(admin, userId, assistantMessage.data.id, run.data.id, error);
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
      source: "cli",
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
    surface: "cli",
    surface_conversation_id: prepared.conversation.id,
    source_message_id: prepared.userMessage.id,
    user_id: userId,
    text,
    actor: { kind: "authenticated_user", user_id: userId },
    transport: {
      kind: "cli_sse",
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

function normalizeTerminalAttachments(raw: unknown): NormalizedTerminalAttachment[] {
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
    if (typeof item.byte_length === "number" && Number.isFinite(item.byte_length)) {
      attachment.byte_length = item.byte_length;
    }
    output.push(attachment);
  }
  return output;
}

async function failPreparedTurn(
  admin: any,
  userId: string,
  assistantMessageId: string,
  runId: string | null,
  error: unknown,
) {
  console.error("cli_prepare_failed", serializeUnknownError(error));
  await admin
    .from("linkr_terminal_messages")
    .update({
      content: "I couldn't start that request. Please try again.",
      status: "failed",
      metadata: {
        failure_phase: "prepare",
        error_code: "cli_prepare_failed",
      },
    })
    .eq("id", assistantMessageId)
    .eq("user_id", userId);
  if (runId) {
    await admin
      .from("linkr_agent_runs")
      .update({
        status: "failed",
        error: "cli_prepare_failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);
  }
}

async function failRunningTurn(admin: any, prepared: PreparedTurn, safeMessage: string) {
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
          error_code: "cli_execution_failed",
        },
      })
      .eq("id", prepared.assistantMessage.id)
      .eq("user_id", prepared.conversation.user_id)
      .in("status", ["typing", "sending"]),
    admin
      .from("linkr_agent_runs")
      .update({
        status: "failed",
        error: "cli_execution_failed",
        completed_at: completedAt,
      })
      .eq("id", prepared.run.id)
      .eq("user_id", prepared.conversation.user_id)
      .eq("status", "running"),
  ]);
  if (messageUpdate.error) throw messageUpdate.error;
  if (runUpdate.error) throw runUpdate.error;
}

async function insertOrSelect(
  admin: any,
  table: string,
  row: Record<string, unknown>,
  keyColumn: string,
  keyValue: string,
  userId = String(row.user_id ?? ""),
) {
  const inserted = await admin.from(table).insert(row).select("*").maybeSingle();
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

function titleFromText(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 54 ? clean.slice(0, 51) + "..." : clean || "New conversation";
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Math.floor(Number(Deno.env.get(name) ?? fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function userSafeError(message: string) {
  if (/conversation_run_locked/.test(message)) {
    return "Linkr is still finishing the previous turn. Try again in a moment.";
  }
  return "Linkr hit an error before finishing this turn.";
}
