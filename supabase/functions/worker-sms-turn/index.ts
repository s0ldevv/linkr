// deno-lint-ignore-file no-explicit-any
import { serializeUnknownError } from "../_shared/http.ts";
import { processLinkrAgentTurn } from "../_shared/linkr_agent_runtime.ts";
import type {
  LinkrTurnInput,
  LinkrTurnOutputSink,
} from "../_shared/linkr_agent_runtime_types.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  configuredMaxReplyChars,
  downloadTwilioMediaForLaunch,
} from "../_shared/twilio.ts";
import { getActiveBanForAuthUser } from "../_shared/x_bans.ts";

const VERSION = "worker-sms-turn-v1";

Deno.serve((req) =>
  runStageWorker(req, {
    stages: ["sms_turns_high", "sms_turns_normal"],
    functionName: "worker-sms-turn",
    consumerVersion: VERSION,
    visibilitySeconds: 180,
    process: async (claim, admin) => {
      const messageSid = String(
        claim.work_item.source_event_id ??
          claim.work_item.payload?.message_sid ?? "",
      ).trim();
      if (!messageSid) {
        return { kind: "dead_letter", reasonCode: "sms_message_sid_missing" };
      }
      const inboundResult = await admin.from("sms_inbound_messages").select("*")
        .eq("message_sid", messageSid).maybeSingle();
      if (inboundResult.error) {
        throw inboundResult.error;
      }
      const inbound = inboundResult.data;
      if (!inbound) {
        return { kind: "dead_letter", reasonCode: "sms_inbound_not_found" };
      }
      const existingOutbound = await admin.from("sms_outbound_messages").select(
        "id,status",
      ).eq("inbound_message_sid", messageSid).maybeSingle();
      if (existingOutbound.error) throw existingOutbound.error;
      if (inbound.status === "processed" && existingOutbound.data) {
        return {
          kind: "complete",
          state: "processing",
          nextRoute: "reply.sms",
          resultRef: `sms-outbound:${existingOutbound.data.id}`,
        };
      }
      const accountResult = await admin.from("sms_accounts").select("*").eq(
        "phone_hash",
        inbound.from_phone_hash,
      ).maybeSingle();
      if (accountResult.error) throw accountResult.error;
      const account = accountResult.data;
      if (
        !account || account.opt_in_status === "opted_out" ||
        account.opted_out_at || account.opt_in_status === "blocked"
      ) {
        await markInbound(
          admin,
          messageSid,
          "ignored",
          "sms_sender_not_eligible",
        );
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `sms-inbound:${messageSid}:ignored`,
        };
      }
      const userId = String(account.user_id ?? claim.work_item.user_id ?? "")
        .trim();
      if (!userId) {
        await markInbound(admin, messageSid, "ignored", "sms_sender_unlinked");
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `sms-inbound:${messageSid}:unlinked`,
        };
      }
      const activeBan = (await getActiveBanForAuthUser(admin, userId)).ban;
      if (activeBan) {
        const outbound = await queueOutbound(admin, inbound, {
          userId,
          body: "This connected X account is currently banned from Linkr.",
          suffix: "banned",
        });
        await markInbound(
          admin,
          messageSid,
          "processed",
          "linked_account_banned",
        );
        return {
          kind: "complete",
          state: "processing",
          nextRoute: "reply.sms",
          resultRef: `sms-outbound:${outbound.id}`,
        };
      }
      const processing = await admin.from("sms_inbound_messages").update({
        status: "processing",
        attempt_count: Number(inbound.attempt_count ?? 0) + 1,
        lease_expires_at: new Date(Date.now() + 180_000).toISOString(),
      })
        .eq("message_sid", messageSid).in("status", [
          "accepted",
          "queued",
          "processing",
          "failed",
        ]).select("message_sid").maybeSingle();
      if (processing.error) throw processing.error;
      if (!processing.data && existingOutbound.data) {
        return {
          kind: "complete",
          state: "processing",
          nextRoute: "reply.sms",
          resultRef: `sms-outbound:${existingOutbound.data.id}`,
        };
      }

      let prepared: PreparedTurn | null = null;
      try {
        prepared = await prepareTurn(
          admin,
          userId,
          inbound,
          claim.work_item.payload?.surface_conversation_id,
        );
        const attachment = Array.isArray(inbound.media) && inbound.media[0]
          ? await downloadTwilioMediaForLaunch(admin, {
            url: String(inbound.media[0].url),
            contentType: String(inbound.media[0].content_type),
            phoneHash: inbound.from_phone_hash,
            messageSid,
            index: Number(inbound.media[0].index ?? 0),
          })
          : null;
        const sink = createSmsSink(admin, prepared);
        const result = await processLinkrAgentTurn(
          admin,
          buildInput(userId, inbound, prepared, attachment),
          sink,
        );
        await sink.finalize(result);
        const finalText = boundedReply(sink.finalText || "Done.");
        const outbound = await queueOutbound(admin, inbound, {
          userId,
          body: finalText,
          suffix: "assistant",
          terminalConversationId: prepared.conversation.id,
          runId: prepared.run.id,
          assistantMessageId: prepared.assistantMessage.id,
        });
        const update = await admin.from("sms_inbound_messages").update({
          status: "processed",
          processed_at: new Date().toISOString(),
          lease_expires_at: null,
          user_id: userId,
          terminal_conversation_id: prepared.conversation.id,
          agent_run_id: prepared.run.id,
          error: null,
        }).eq("message_sid", messageSid);
        if (update.error) throw update.error;
        console.info("sms_turn_processed", {
          message_sid: messageSid,
          run_id: prepared.run.id,
          outbound_id: outbound.id,
          phone_hash: inbound.from_phone_hash,
        });
        return {
          kind: "complete",
          state: "processing",
          nextRoute: "reply.sms",
          resultRef: `sms-outbound:${outbound.id}`,
        };
      } catch (error) {
        console.error("sms_turn_failed", {
          message_sid: messageSid,
          error: safeError(error),
          phone_hash: inbound.from_phone_hash,
        });
        if (prepared) await failPrepared(admin, prepared, error);
        const alreadyQueued = await admin.from("sms_outbound_messages")
          .select("*").eq("inbound_message_sid", messageSid)
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (alreadyQueued.error) throw alreadyQueued.error;
        const outbound = alreadyQueued.data ??
          await queueOutbound(admin, inbound, {
            userId,
            body: userSafeError(error),
            suffix: "runtime-error",
            terminalConversationId: prepared?.conversation.id,
            runId: prepared?.run.id,
            assistantMessageId: prepared?.assistantMessage.id,
          });
        await markInbound(admin, messageSid, "processed", safeError(error));
        return {
          kind: "complete",
          state: "processing",
          nextRoute: "reply.sms",
          resultRef: `sms-outbound:${outbound.id}`,
        };
      }
    },
  })
);

type PreparedTurn = {
  conversation: any;
  smsConversation: any;
  userMessage: any;
  assistantMessage: any;
  run: any;
};

async function prepareTurn(
  admin: any,
  userId: string,
  inbound: any,
  suppliedSurfaceId: unknown,
): Promise<PreparedTurn> {
  const surfaceId = String(suppliedSurfaceId ?? "").trim() ||
    (inbound.messaging_service_sid
      ? `sms:mg:${inbound.messaging_service_sid}:${
        inbound.from_phone_hash.slice(0, 12)
      }`
      : `sms:number:${
        String(inbound.to_phone_hash ?? "unknown").slice(0, 12)
      }:${inbound.from_phone_hash.slice(0, 12)}`);
  let smsConversationResult = await admin.from("sms_conversations").select("*")
    .eq("from_phone_hash", inbound.from_phone_hash)
    .eq(
      inbound.messaging_service_sid ? "messaging_service_sid" : "to_phone_hash",
      inbound.messaging_service_sid ?? inbound.to_phone_hash,
    ).maybeSingle();
  if (smsConversationResult.error) throw smsConversationResult.error;
  let conversation: any = null;
  if (smsConversationResult.data) {
    const found = await admin.from("linkr_terminal_conversations").select("*")
      .eq("id", smsConversationResult.data.terminal_conversation_id).eq(
        "user_id",
        userId,
      ).maybeSingle();
    if (found.error) throw found.error;
    conversation = found.data;
  }
  if (!conversation) {
    const created = await admin.from("linkr_terminal_conversations").insert({
      user_id: userId,
      title: titleFromText(inbound.body),
      status: "active",
      source: "sms",
      pinned_context: {
        sms_phone_hash: inbound.from_phone_hash,
        twilio_account_sid: inbound.account_sid,
        messaging_service_sid: inbound.messaging_service_sid,
      },
    }).select("*").single();
    if (created.error) throw created.error;
    conversation = created.data;
    const mapping = {
      from_phone_hash: inbound.from_phone_hash,
      from_phone_e164: inbound.from_phone_e164,
      to_phone_hash: inbound.to_phone_hash,
      to_phone_e164: inbound.to_phone_e164,
      messaging_service_sid: inbound.messaging_service_sid,
      user_id: userId,
      terminal_conversation_id: conversation.id,
      surface_conversation_id: surfaceId,
      last_inbound_message_sid: inbound.message_sid,
    };
    smsConversationResult = await admin.from("sms_conversations").upsert(
      mapping,
      { onConflict: "user_id,surface_conversation_id" },
    ).select("*").single();
    if (smsConversationResult.error) throw smsConversationResult.error;
  } else {
    const updated = await admin.from("sms_conversations").update({
      user_id: userId,
      last_inbound_message_sid: inbound.message_sid,
    }).eq("id", smsConversationResult.data.id).select("*").single();
    if (updated.error) throw updated.error;
    smsConversationResult = updated;
  }
  const userMessage = await insertOrSelect(admin, "linkr_terminal_messages", {
    conversation_id: conversation.id,
    user_id: userId,
    role: "user",
    content: inbound.body || (inbound.num_media ? "Image attached." : ""),
    parts: [],
    status: "completed",
    client_message_id: `sms:${inbound.message_sid}`,
    source_refs: [],
    metadata: {
      source_surface: "sms",
      twilio_message_sid: inbound.message_sid,
      media: inbound.media,
    },
    idempotency_key: `sms-user:${inbound.message_sid}`,
  }, "sms-user:" + inbound.message_sid);
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
      metadata: { source_surface: "sms" },
      idempotency_key: `sms-assistant:${userMessage.id}`,
    },
    `sms-assistant:${userMessage.id}`,
  );
  const run = await insertOrSelect(admin, "linkr_agent_runs", {
    user_id: userId,
    surface: "sms",
    source_surface: "sms",
    surface_conversation_id: surfaceId,
    terminal_conversation_id: conversation.id,
    user_message_id: userMessage.id,
    assistant_message_id: assistantMessage.id,
    status: "running",
    started_at: new Date().toISOString(),
    idempotency_key: `sms-run:${inbound.message_sid}`,
  }, `sms-run:${inbound.message_sid}`);
  const conversationUpdate = await admin.from("linkr_terminal_conversations")
    .update({
      last_message_preview: String(inbound.body).slice(0, 180),
      last_message_role: "user",
      last_message_at: new Date().toISOString(),
      message_count: Number(conversation.message_count ?? 0) + 1,
      title: conversation.title || titleFromText(inbound.body),
    }).eq("id", conversation.id).eq("user_id", userId);
  if (conversationUpdate.error) throw conversationUpdate.error;
  return {
    conversation,
    smsConversation: smsConversationResult.data,
    userMessage,
    assistantMessage,
    run,
  };
}

function buildInput(
  userId: string,
  inbound: any,
  prepared: PreparedTurn,
  attachment: any | null,
): LinkrTurnInput {
  const text = String(inbound.body ?? "").trim() ||
    (inbound.num_media ? "Image attached." : "");
  return {
    surface: "sms",
    surface_conversation_id: prepared.smsConversation.surface_conversation_id,
    source_message_id: inbound.message_sid,
    user_id: userId,
    text,
    actor: { kind: "sms_user", user_id: userId },
    transport: {
      kind: "sms_reply",
      public_output: false,
      supports_streaming: false,
      max_response_chars: configuredMaxReplyChars(),
    },
    conversation: {
      terminal_conversation_id: prepared.conversation.id,
      user_message_id: prepared.userMessage.id,
      assistant_message_id: prepared.assistantMessage.id,
      run_id: prepared.run.id,
    },
    attachments: attachment
      ? [{
        kind: "image",
        source_url: attachment.publicUrl,
        storage_path: attachment.path,
        mime_type: attachment.contentType,
        byte_length: attachment.byteLength,
      }]
      : [],
    source_refs: [],
    client_context: { route: "sms", selected_chain: "all" },
  };
}

type SmsSink = LinkrTurnOutputSink & { readonly finalText: string };
function createSmsSink(admin: any, prepared: PreparedTurn): SmsSink {
  let assistantText = "";
  let parts: unknown[] = [];
  let confirmation = "";
  return {
    get finalText() {
      return [assistantText.trim(), confirmation.trim()].filter(Boolean).join(
        "\n\n",
      );
    },
    async setStatus(status, metadata = {}) {
      const result = await admin.from("linkr_terminal_events").insert({
        run_id: prepared.run.id,
        conversation_id: prepared.conversation.id,
        user_id: prepared.conversation.user_id,
        type: status,
        payload: metadata,
      });
      if (result.error) throw result.error;
    },
    async emit(event, payload) {
      if (!["delta", "ack"].includes(String(event))) {
        const result = await admin.from("linkr_terminal_events").insert({
          run_id: prepared.run.id,
          conversation_id: prepared.conversation.id,
          user_id: prepared.conversation.user_id,
          type: String(event),
          payload,
        });
        if (result.error) throw result.error;
      }
    },
    appendAssistantDelta(delta) {
      assistantText += delta;
      return Promise.resolve();
    },
    async setAssistantMessage(args) {
      assistantText = args.content;
      parts = args.parts ?? parts;
      const message = await admin.from("linkr_terminal_messages").update({
        content: args.content,
        parts,
        status: args.status,
        metadata: args.metadata ?? {},
      }).eq("id", prepared.assistantMessage.id).eq(
        "user_id",
        prepared.conversation.user_id,
      );
      if (message.error) throw message.error;
      const conversation = await admin.from("linkr_terminal_conversations")
        .update({
          last_message_preview: args.content.slice(0, 180),
          last_message_role: "assistant",
          last_message_at: new Date().toISOString(),
          message_count: Number(prepared.conversation.message_count ?? 0) + 2,
        }).eq("id", prepared.conversation.id).eq(
          "user_id",
          prepared.conversation.user_id,
        );
      if (conversation.error) throw conversation.error;
    },
    async addMessagePart(part) {
      parts = [...parts, part];
      const result = await admin.from("linkr_terminal_messages").update({
        parts,
      }).eq("id", prepared.assistantMessage.id);
      if (result.error) throw result.error;
    },
    addSourceRef() {
      return Promise.resolve();
    },
    createPendingActionCard(payload) {
      parts = [...parts, { type: "confirmation_card", ...payload }];
      const phrase = String(
        payload.confirmation_phrase ?? payload.confirm_phrase ?? "confirm",
      ).trim();
      const expiry = String(payload.expires_at ?? "").trim();
      confirmation = `Reply exactly: ${phrase}\nOr reply: cancel${
        expiry ? `\nExpires: ${expiry}` : ""
      }`;
      return Promise.resolve();
    },
    async finalize(result) {
      const update = await admin.from("linkr_agent_runs").update({
        status: result.status === "failed" ? "failed" : "completed",
        outcome: result,
        completed_at: new Date().toISOString(),
      }).eq("id", prepared.run.id).eq("user_id", prepared.conversation.user_id);
      if (update.error) throw update.error;
    },
  };
}

async function queueOutbound(
  admin: any,
  inbound: any,
  args: {
    userId: string;
    body: string;
    suffix: string;
    terminalConversationId?: string;
    runId?: string;
    assistantMessageId?: string;
  },
) {
  const insert = await admin.from("sms_outbound_messages").upsert({
    idempotency_key: `sms-reply:${inbound.message_sid}:${args.suffix}`,
    user_id: args.userId,
    terminal_conversation_id: args.terminalConversationId ?? null,
    agent_run_id: args.runId ?? null,
    assistant_message_id: args.assistantMessageId ?? null,
    inbound_message_sid: inbound.message_sid,
    to_phone_e164: inbound.from_phone_e164,
    to_phone_hash: inbound.from_phone_hash,
    from_phone_e164: inbound.messaging_service_sid
      ? null
      : inbound.to_phone_e164,
    messaging_service_sid: inbound.messaging_service_sid,
    body: boundedReply(args.body),
    status: "pending",
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("*")
    .maybeSingle();
  if (insert.error) throw insert.error;
  if (insert.data) return insert.data;
  const existing = await admin.from("sms_outbound_messages").select("*").eq(
    "idempotency_key",
    `sms-reply:${inbound.message_sid}:${args.suffix}`,
  ).single();
  if (existing.error) throw existing.error;
  return existing.data;
}

async function insertOrSelect(
  admin: any,
  table: string,
  row: any,
  key: string,
) {
  const inserted = await admin.from(table).upsert(row, {
    onConflict: "idempotency_key",
    ignoreDuplicates: true,
  }).select("*").maybeSingle();
  if (inserted.error) throw inserted.error;
  if (inserted.data) return inserted.data;
  const existing = await admin.from(table).select("*").eq(
    "idempotency_key",
    key,
  ).single();
  if (existing.error) throw existing.error;
  return existing.data;
}
async function markInbound(
  admin: any,
  sid: string,
  status: string,
  error: string | null,
) {
  const update = await admin.from("sms_inbound_messages").update({
    status,
    error,
    processed_at: ["processed", "ignored"].includes(status)
      ? new Date().toISOString()
      : null,
    lease_expires_at: null,
  }).eq("message_sid", sid);
  if (update.error) throw update.error;
}
async function failPrepared(
  admin: any,
  prepared: PreparedTurn,
  error: unknown,
) {
  const diagnostic = serializeUnknownError(error);
  await admin.from("linkr_terminal_messages").update({
    content: userSafeError(error),
    status: "failed",
    metadata: { failure_phase: "runtime", error: diagnostic },
  }).eq("id", prepared.assistantMessage.id);
  await admin.from("linkr_agent_runs").update({
    status: "failed",
    error: JSON.stringify(diagnostic),
    completed_at: new Date().toISOString(),
  }).eq("id", prepared.run.id);
}
function boundedReply(value: string): string {
  const clean = String(value ?? "").trim() || "Done.";
  const max = configuredMaxReplyChars();
  return clean.length <= max
    ? clean
    : `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
function titleFromText(text: string): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 54 ? `${clean.slice(0, 51)}...` : clean || "SMS chat";
}
function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 500);
}
function userSafeError(error: unknown): string {
  const message = safeError(error);
  if (/conversation_run_locked/.test(message)) {
    return "I am still finishing the previous turn. Try again in a moment.";
  }
  return "Linkr hit an error before finishing this turn. Please try again.";
}
