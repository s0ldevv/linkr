import { serviceClient } from "../_shared/supabase.ts";
import { parseTwilioForm, verifyTwilioSignature } from "../_shared/twilio.ts";

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
  ) return new Response("unsupported_media_type", { status: 415 });
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > 64 * 1024) {
    return new Response("payload_too_large", { status: 413 });
  }
  const params = parseTwilioForm(raw);
  const url = Deno.env.get("TWILIO_STATUS_CALLBACK_PUBLIC_URL")?.trim() ||
    req.url;
  if (
    !(await verifyTwilioSignature({
      signature: req.headers.get("X-Twilio-Signature"),
      url,
      params,
    }))
  ) return new Response("unauthorized", { status: 401 });
  const sid = params.get("MessageSid")?.trim() ?? "";
  if (
    params.get("AccountSid")?.trim() !==
      Deno.env.get("TWILIO_ACCOUNT_SID")?.trim()
  ) return new Response("unauthorized", { status: 401 });
  const twilioStatus = params.get("MessageStatus")?.trim().toLowerCase() ?? "";
  if (!/^SM[a-zA-Z0-9]{16,}$/.test(sid) || !twilioStatus) {
    return new Response("invalid_callback", { status: 400 });
  }
  const status = twilioStatus === "delivered"
    ? "delivered"
    : ["undelivered", "failed"].includes(twilioStatus)
    ? twilioStatus
    : "sent";
  const now = new Date().toISOString();
  const update = await serviceClient().from("sms_outbound_messages").update({
    status,
    twilio_status: twilioStatus,
    error_code: params.get("ErrorCode") || null,
    error_message: (params.get("ErrorMessage") || "").slice(0, 1000) || null,
    delivered_at: status === "delivered" ? now : null,
    failed_at: ["undelivered", "failed"].includes(status) ? now : null,
  }).eq("twilio_message_sid", sid).select("id").maybeSingle();
  if (update.error) throw update.error;
  console.info("sms_status_callback_received", {
    twilio_message_sid: sid,
    status: twilioStatus,
    matched: Boolean(update.data),
  });
  return new Response(null, { status: 204 });
});
