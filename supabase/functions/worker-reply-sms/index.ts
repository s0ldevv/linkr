// deno-lint-ignore-file no-explicit-any
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import { sendTwilioMessage } from "../_shared/twilio.ts";

const VERSION = "worker-reply-sms-v1";

Deno.serve((req) =>
  runStageWorker(req, {
    stages: ["reply_sms_high", "reply_sms_normal"],
    functionName: "worker-reply-sms",
    consumerVersion: VERSION,
    visibilitySeconds: 120,
    process: async (claim, admin) => {
      const inboundSid = String(
        claim.work_item.source_event_id ??
          claim.work_item.payload?.message_sid ?? "",
      ).trim();
      if (!inboundSid) {
        return { kind: "dead_letter", reasonCode: "sms_inbound_sid_missing" };
      }
      const row = await admin.from("sms_outbound_messages").select("*").eq(
        "inbound_message_sid",
        inboundSid,
      ).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (row.error) {
        throw row.error;
      }
      if (!row.data) {
        return {
          kind: "retry",
          errorCode: "sms_outbound_not_ready",
          delaySeconds: 15,
        };
      }
      if (
        ["sent", "delivered"].includes(row.data.status) ||
        row.data.twilio_message_sid
      ) {
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `sms:${row.data.twilio_message_sid ?? row.data.id}`,
        };
      }
      if (["failed", "undelivered", "ambiguous"].includes(row.data.status)) {
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `sms:${row.data.id}:${row.data.status}`,
        };
      }
      const claimed = await admin.from("sms_outbound_messages").update({
        status: "sending",
        attempt_count: Number(row.data.attempt_count ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      }).eq("id", row.data.id).in("status", ["pending", "sending"]).is(
        "twilio_message_sid",
        null,
      ).select("id").maybeSingle();
      if (claimed.error) throw claimed.error;
      if (!claimed.data) {
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `sms:${row.data.id}:claimed`,
        };
      }
      try {
        const sent = await sendTwilioMessage({
          to: row.data.to_phone_e164,
          body: row.data.body,
          from: row.data.from_phone_e164,
          messagingServiceSid: row.data.messaging_service_sid,
        });
        const now = new Date().toISOString();
        const update = await admin.from("sms_outbound_messages").update({
          status: sent.status === "delivered" ? "delivered" : "sent",
          twilio_message_sid: sent.sid,
          twilio_status: sent.status,
          payload: sent.payload,
          sent_at: now,
          delivered_at: sent.status === "delivered" ? now : null,
        }).eq("id", row.data.id).is("twilio_message_sid", null);
        if (update.error) throw update.error;
        if (row.data.terminal_conversation_id) {
          const conversation = await admin.from("sms_conversations").update({
            last_outbound_message_sid: sent.sid,
          }).eq("terminal_conversation_id", row.data.terminal_conversation_id);
          if (conversation.error) throw conversation.error;
        }
        const account = await admin.from("sms_accounts").update({
          last_outbound_at: now,
        }).eq("phone_hash", row.data.to_phone_hash);
        if (account.error) throw account.error;
        console.info("sms_reply_sent", {
          outbound_id: row.data.id,
          twilio_message_sid: sent.sid,
          phone_hash: row.data.to_phone_hash,
        });
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `sms:${sent.sid}`,
        };
      } catch (error) {
        const status = Number((error as any)?.status ?? 0);
        const message = String(error instanceof Error ? error.message : error)
          .slice(0, 1000);
        if (status === 429 || status >= 500) {
          const delay = retryDelay(
            row.data.attempt_count,
            (error as any)?.retryAfter,
          );
          await admin.from("sms_outbound_messages").update({
            status: "pending",
            error_code: status ? `twilio_http_${status}` : "twilio_retryable",
            error_message: message,
            next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
          }).eq("id", row.data.id);
          console.warn("sms_reply_failed", {
            outbound_id: row.data.id,
            retryable: true,
            status,
          });
          return {
            kind: "retry",
            errorCode: status === 429
              ? "twilio_rate_limited"
              : "twilio_server_error",
            delaySeconds: delay,
          };
        }
        if (status >= 400 && status < 500) {
          await admin.from("sms_outbound_messages").update({
            status: "failed",
            failed_at: new Date().toISOString(),
            error_code: `twilio_http_${status}`,
            error_message: message,
          }).eq("id", row.data.id);
          console.error("sms_reply_failed", {
            outbound_id: row.data.id,
            retryable: false,
            status,
          });
          return {
            kind: "complete",
            state: "rejected",
            resultRef: `sms:${row.data.id}:failed`,
          };
        }
        // A network failure can occur after Twilio accepted the message. Blindly retrying
        // could double-send, so quarantine it for operator reconciliation.
        await admin.from("sms_outbound_messages").update({
          status: "ambiguous",
          error_code: "twilio_network_ambiguous",
          error_message: message,
        }).eq("id", row.data.id);
        console.error("sms_reply_failed", {
          outbound_id: row.data.id,
          ambiguous: true,
        });
        return { kind: "dead_letter", reasonCode: "twilio_send_ambiguous" };
      }
    },
  })
);

function retryDelay(attempt: number, retryAfter: unknown): number {
  const header = Number.parseInt(String(retryAfter ?? ""), 10);
  if (Number.isFinite(header) && header > 0) return Math.min(900, header);
  return Math.min(
    900,
    15 * (2 ** Math.min(5, Math.max(0, Number(attempt ?? 0)))),
  );
}
