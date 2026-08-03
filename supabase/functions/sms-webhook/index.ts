// deno-lint-ignore-file no-explicit-any
import { acceptWork } from "../_shared/admission_control.ts";
import { consumeRateLimit } from "../_shared/http.ts";
import {
  isLinkrFastHandoffEnabled,
  scheduleBackgroundTask,
  wakeAndDispatchStage,
} from "../_shared/internal_pipeline.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  createSmsLoginLink,
  emptyMessagingResponse,
  getLinkedSmsAccount,
  hashPhone,
  messageResponse,
  normalizeTwilioInbound,
  parseTwilioForm,
  smsWorkAcceptanceInput,
  unlinkSmsAccount,
  upsertSmsAccount,
  verifyTwilioSignature,
} from "../_shared/twilio.ts";

const MAX_BODY_BYTES = 256 * 1024;
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "END", "QUIT"]);
const START = new Set(["START", "UNSTOP"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method_not_allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  if (
    !req.headers.get("content-type")?.toLowerCase().startsWith(
      "application/x-www-form-urlencoded",
    )
  ) {
    return new Response("unsupported_media_type", { status: 415 });
  }
  const length = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return new Response("payload_too_large", { status: 413 });
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return new Response("payload_too_large", { status: 413 });
  }
  const params = parseTwilioForm(raw);
  const publicUrl = Deno.env.get("TWILIO_WEBHOOK_PUBLIC_URL")?.trim() ||
    req.url;
  if (
    !(await verifyTwilioSignature({
      signature: req.headers.get("X-Twilio-Signature"),
      url: publicUrl,
      params,
    }))
  ) {
    return new Response("unauthorized", { status: 401 });
  }

  let inbound;
  try {
    inbound = normalizeTwilioInbound(params);
  } catch (error) {
    console.warn("sms_webhook_malformed", { error: safeError(error) });
    return emptyMessagingResponse();
  }
  if (inbound.account_sid !== Deno.env.get("TWILIO_ACCOUNT_SID")?.trim()) {
    return new Response("unauthorized", { status: 401 });
  }
  const admin = serviceClient();
  const phoneHash = await hashPhone(inbound.from);
  const toHash = inbound.to ? await hashPhone(inbound.to) : null;

  const existing = await admin.from("sms_inbound_messages").select(
    "message_sid,status",
  ).eq("message_sid", inbound.message_sid).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    console.info("sms_webhook_duplicate", {
      message_sid: inbound.message_sid,
      phone_hash: phoneHash,
    });
    // A prior invocation may have durably written the provider ledger and then
    // failed before queue admission. Let accepted/failed rows resume from that
    // durable checkpoint; all later states are already safely handled.
    if (!["accepted", "failed"].includes(existing.data.status)) {
      return emptyMessagingResponse();
    }
  }

  const account = await upsertSmsAccount(admin, inbound.from, phoneHash);
  const command = inbound.body.trim().toUpperCase();
  const linked = await getLinkedSmsAccount(admin, phoneHash);
  const isCompliance = STOP.has(command) || START.has(command) ||
    command === "HELP";
  const limit = await consumeRateLimit(admin, {
    subjectType: linked ? "sms_linked" : "sms_unlinked",
    subjectId: phoneHash,
    windowSeconds: linked ? 60 : 600,
    limit: linked ? configuredLimit() : 5,
  });

  if (!existing.data) {
    const ledger = await admin.from("sms_inbound_messages").insert({
      message_sid: inbound.message_sid,
      account_sid: inbound.account_sid,
      messaging_service_sid: inbound.messaging_service_sid,
      from_phone_e164: inbound.from,
      from_phone_hash: phoneHash,
      to_phone_e164: inbound.to,
      to_phone_hash: toHash,
      body: inbound.body,
      num_media: inbound.num_media,
      media: inbound.media,
      status: "accepted",
      user_id: linked?.user_id ?? null,
      payload: Object.fromEntries(params.entries()),
    });
    if (ledger.error) throw ledger.error;
    console.info("sms_webhook_accepted", {
      message_sid: inbound.message_sid,
      phone_hash: phoneHash,
      media_count: inbound.num_media,
    });
  }

  if (!limit.allowed && !isCompliance) {
    await markInbound(
      admin,
      inbound.message_sid,
      "ignored",
      "rate_limit_exceeded",
    );
    return messageResponse(
      "Too many messages right now. Please wait a few minutes and try again.",
    );
  }
  if (STOP.has(command) || (command === "CANCEL" && !linked)) {
    await unlinkSmsAccount(admin, phoneHash, true);
    await recordOptEvent(admin, phoneHash, inbound, "stop");
    await markInbound(admin, inbound.message_sid, "ignored");
    return messageResponse(
      "You have been unsubscribed from Linkr texts. Reply START to opt back in.",
    );
  }
  if (START.has(command)) {
    const update = await admin.from("sms_accounts").update({
      opted_out_at: null,
      opt_in_status: account.user_id ? "linked" : "implicit_inbound",
    }).eq("phone_hash", phoneHash);
    if (update.error) throw update.error;
    await recordOptEvent(admin, phoneHash, inbound, "start");
    await markInbound(admin, inbound.message_sid, "ignored");
    return messageResponse(
      "Linkr texts are enabled again. Reply LOGIN to connect your account or HELP for commands.",
    );
  }
  if (command === "HELP" || command === "/HELP") {
    await recordOptEvent(admin, phoneHash, inbound, "help");
    await markInbound(admin, inbound.message_sid, "ignored");
    return messageResponse(
      "Linkr SMS help: LOGIN connects your account, STATUS checks it, LOGOUT disconnects it, and STOP opts out. Support: https://linkr.cash",
    );
  }
  if (["LOGOUT", "/LOGOUT", "DISCONNECT"].includes(command)) {
    await unlinkSmsAccount(admin, phoneHash, false);
    await recordOptEvent(admin, phoneHash, inbound, "unlink");
    await markInbound(admin, inbound.message_sid, "ignored");
    return messageResponse(
      "This phone is disconnected from Linkr. Your Linkr account and wallets were not changed. Reply LOGIN to reconnect.",
    );
  }
  if (command === "STATUS" || command === "/STATUS") {
    await markInbound(admin, inbound.message_sid, "ignored");
    return messageResponse(
      linked
        ? "This phone is connected to Linkr."
        : "This phone is not connected. Reply LOGIN to connect it.",
    );
  }

  if (!linked || ["LOGIN", "/LOGIN", "CONNECT"].includes(command)) {
    const loginLimit = await consumeRateLimit(admin, {
      subjectType: "sms_login",
      subjectId: phoneHash,
      windowSeconds: 900,
      limit: 3,
    });
    await markInbound(
      admin,
      inbound.message_sid,
      "ignored",
      loginLimit.allowed ? null : "login_rate_limit_exceeded",
    );
    if (!loginLimit.allowed) {
      return messageResponse(
        "Too many login links requested. Please wait 15 minutes and try again.",
      );
    }
    const login = await createSmsLoginLink(admin, {
      phoneE164: inbound.from,
      phoneHash,
      source: "sms_webhook",
    });
    await recordOptEvent(admin, phoneHash, inbound, "link_started");
    console.info("sms_link_created", {
      message_sid: inbound.message_sid,
      phone_hash: phoneHash,
    });
    return messageResponse(
      `Connect Linkr here: ${login.url}\nThis link expires in 10 minutes.`,
    );
  }

  // The branch above returns for every unlinked account. Keep this explicit so
  // queue admission cannot receive a nullable user identifier if that flow is
  // changed later.
  if (!linked.user_id) throw new Error("linked_sms_account_missing_user_id");

  const surfaceConversationId = inbound.messaging_service_sid
    ? `sms:mg:${inbound.messaging_service_sid}:${phoneHash.slice(0, 12)}`
    : `sms:number:${(toHash ?? "unknown").slice(0, 12)}:${
      phoneHash.slice(0, 12)
    }`;
  const accepted = await acceptWork(
    admin,
    smsWorkAcceptanceInput({
      messageSid: inbound.message_sid,
      userId: linked.user_id,
      surfaceConversationId,
    }),
  );
  await markInbound(admin, inbound.message_sid, "queued");
  if (isLinkrFastHandoffEnabled() && accepted.enqueued) {
    const handoff = wakeAndDispatchStage(
      admin,
      "sms_turns_high",
      "worker-sms-turn",
    );
    if (!scheduleBackgroundTask(handoff)) await handoff;
  }
  return emptyMessagingResponse();
});

async function markInbound(
  admin: any,
  sid: string,
  status: string,
  error: string | null = null,
) {
  const result = await admin.from("sms_inbound_messages").update({
    status,
    error,
    processed_at: status === "ignored" ? new Date().toISOString() : null,
  }).eq("message_sid", sid);
  if (result.error) throw result.error;
}
async function recordOptEvent(
  admin: any,
  phoneHash: string,
  inbound: any,
  eventType: string,
) {
  const result = await admin.from("sms_opt_events").insert({
    phone_hash: phoneHash,
    from_phone_e164: inbound.from,
    event_type: eventType,
    source_message_sid: inbound.message_sid,
    raw_body: inbound.body,
  });
  if (result.error) throw result.error;
}
function configuredLimit(): number {
  const n = Number.parseInt(
    Deno.env.get("LINKR_SMS_REQUESTS_PER_MINUTE") ?? "10",
    10,
  );
  return Number.isFinite(n) ? Math.max(1, Math.min(60, n)) : 10;
}
function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 200);
}
