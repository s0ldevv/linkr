// deno-lint-ignore-file no-explicit-any
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  loadXBotPostAuthMode,
  xPostingAuthorization,
} from "../_shared/x_posting_auth.ts";
import {
  isDefinitiveReplyTargetFailure,
  isRetryableXPostFailure,
  isCryptoAddressBlockedFailure,
  stripCryptoAddresses,
} from "../_shared/x_reply_delivery.ts";

const VERSION = "worker-reply-x-v3";
const X_POST = "https://api.x.com/2/tweets";
const STAGES = ["reply_x_high", "reply_x_normal"] as const;

Deno.serve((req) =>
  runStageWorker(req, {
    stages: STAGES,
    functionName: "worker-reply-x",
    consumerVersion: VERSION,
    visibilitySeconds: 120,
    process: async (claim, admin) => {
      const replyResult = await admin.from("twitter_replies").select("*")
        .eq("work_item_id", claim.work_item.id).eq("delivery_lane", "queue")
        .maybeSingle();
      if (replyResult.error) throw replyResult.error;
      const reply = replyResult.data;
      if (!reply) {
        return { kind: "dead_letter", reasonCode: "x_reply_not_found" };
      }
      if (reply.status === "posted" && reply.reply_tweet_id) {
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `x-reply:${reply.reply_tweet_id}`,
        };
      }
      if (reply.status === "failed") {
        await updateDelivery(admin, claim.work_item.id, {
          state: "failed",
          last_error_code: String(reply.error ?? "x_reply_failed").slice(
            0,
            240,
          ),
        });
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `x-reply-failed:${reply.id}`,
        };
      }
      if (reply.status === "posting" || reply.status === "ambiguous") {
        await updateDelivery(admin, claim.work_item.id, {
          state: "ambiguous",
          ambiguous_at: new Date().toISOString(),
        });
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "reconciliation",
          resultRef: `x-reply-ambiguous:${reply.id}`,
        };
      }

      const claimedReply = await admin.from("twitter_replies").update({
        status: "posting",
        attempt_count: Number(reply.attempt_count ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        next_attempt_at: null,
        error: null,
      }).eq("id", reply.id).eq("status", "pending").select("*").maybeSingle();
      if (claimedReply.error) throw claimedReply.error;
      if (!claimedReply.data) {
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "reconciliation",
          resultRef: `x-reply-claim-race:${reply.id}`,
        };
      }
      await updateDelivery(admin, claim.work_item.id, {
        state: "sending",
        attempt_count: Number(claimedReply.data.attempt_count ?? 1),
        last_error_code: null,
      });

      let response: Response;
      try {
        const mode = loadXBotPostAuthMode();
        const auth = await xPostingAuthorization(admin, {
          method: "POST",
          url: X_POST,
        }, { mode });
        response = await fetchWithTimeout(X_POST, {
          method: "POST",
          headers: {
            Authorization: auth.authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            text: claimedReply.data.reply_text,
            reply: { in_reply_to_tweet_id: claimedReply.data.tweet_id },
          }),
        }, 15_000);
      } catch (error) {
        await markAmbiguous(admin, claim.work_item.id, reply.id, error);
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "reconciliation",
          resultRef: `x-reply-ambiguous:${reply.id}`,
        };
      }

      const payload = await readBoundedJson(response, 64 * 1024);
      if (response.ok && payload?.data?.id) {
        const replyTweetId = String(payload.data.id);
        const posted = await admin.from("twitter_replies").update({
          status: "posted",
          reply_tweet_id: replyTweetId,
          posted_at: new Date().toISOString(),
          last_status_code: response.status,
          next_attempt_at: null,
          error: null,
          error_details: {
            x_reply_tweet_id: replyTweetId,
            worker_version: VERSION,
          },
        }).eq("id", reply.id).eq("status", "posting");
        if (posted.error) throw posted.error;
        await updateDelivery(admin, claim.work_item.id, {
          state: "sent",
          provider_message_id: replyTweetId,
          sent_at: new Date().toISOString(),
          last_error_code: null,
        });
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `x-reply:${replyTweetId}`,
        };
      }

      const definitiveTargetFailure = response.status === 403 &&
        isDefinitiveReplyTargetFailure(payload);
      const cryptoBlocked = response.status === 403 &&
        isCryptoAddressBlockedFailure(payload);
      const retryable = isRetryableXPostFailure(response.status, payload);
      if (retryable) {
        const delay = retryDelaySeconds(
          response,
          Number(reply.attempt_count ?? 0) + 1,
        );
        const pending = await admin.from("twitter_replies").update({
          status: "pending",
          last_status_code: response.status,
          next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
          error: `x_post_${response.status}`,
          error_details: {
            status: response.status,
            body: payload,
            worker_version: VERSION,
          },
        }).eq("id", reply.id).eq("status", "posting");
        if (pending.error) throw pending.error;
        await updateDelivery(admin, claim.work_item.id, {
          state: "retryable",
          last_error_code: response.status === 429
            ? "x_rate_limited"
            : `x_post_${response.status}`,
        });
        if (response.status === 401 || response.status === 403) {
          await createAuthIncident(admin, response.status, payload);
        }
        return {
          kind: "retry",
          errorCode: response.status === 429
            ? "x_rate_limited"
            : "x_post_retryable",
          delaySeconds: delay,
        };
      }

      const failureCode = cryptoBlocked
        ? "x_crypto_address_blocked"
        : `x_post_${response.status}`;
      const failed = await admin.from("twitter_replies").update({
        status: "failed",
        last_status_code: response.status,
        error: failureCode,
        error_details: { body: payload, worker_version: VERSION },
      }).eq("id", reply.id);
      if (failed.error) throw failed.error;
      await updateDelivery(admin, claim.work_item.id, {
        state: "failed",
        last_error_code: failureCode,
      });
      if (cryptoBlocked) {
        await emitAddressFreeFallback(admin, claim.work_item, claimedReply.data);
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `x-reply-crypto-blocked:${reply.id}`,
        };
      }
      return definitiveTargetFailure
        ? {
          kind: "complete",
          state: "rejected",
          resultRef: `x-reply-target-unavailable:${reply.id}`,
        }
        : { kind: "dead_letter", reasonCode: `x_post_${response.status}` };
    },
  }),
);

async function emitAddressFreeFallback(
  admin: any,
  parentWorkItem: any,
  originalReply: any,
) {
  try {
    const sanitized = stripCryptoAddresses(String(originalReply?.reply_text ?? ""));
    const fallback = sanitized && sanitized.length > 6
      ? sanitized
      : "Done ✅ Check your dashboard on solmate.live for details.";
    const kind = String(originalReply?.kind ?? "reply") + "_no_address";
    // Idempotent: don't re-emit if a sibling fallback already exists for this parent.
    const existing = await admin.from("twitter_replies").select("id")
      .eq("work_item_id", parentWorkItem.id).eq("kind", kind).maybeSingle();
    if (existing.data) return;
    const result = await admin.rpc("enqueue_linkr_x_reply_v1", {
      p_parent_work_item_id: parentWorkItem.id,
      p_reply_text: fallback.slice(0, 270),
      p_kind: kind.slice(0, 60),
      p_version: 1,
      p_priority: 40,
    });
    if (result.error) throw result.error;
  } catch (error) {
    console.error("x-reply-fallback-failed", String((error as Error)?.message ?? error));
  }
}

function retryDelaySeconds(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(21_600, Math.ceil(retryAfter));
  }
  const base = response.status === 429 ? 900 : 60;
  return Math.min(21_600, base * 2 ** Math.min(6, Math.max(0, attempt - 1)));
}

async function markAmbiguous(
  admin: any,
  workItemId: string,
  replyId: string,
  error: unknown,
) {
  const code = error instanceof Error
    ? error.message.slice(0, 240)
    : String(error).slice(0, 240);
  const updated = await admin.from("twitter_replies").update({
    status: "ambiguous",
    error: code,
    error_details: {
      ambiguous_after_post_attempt: true,
      worker_version: VERSION,
    },
  }).eq("id", replyId).eq("status", "posting");
  if (updated.error) throw updated.error;
  await updateDelivery(admin, workItemId, {
    state: "ambiguous",
    ambiguous_at: new Date().toISOString(),
    last_error_code: code,
  });
}

async function updateDelivery(
  admin: any,
  workItemId: string,
  values: Record<string, unknown>,
) {
  const result = await admin.from("linkr_notification_deliveries").update({
    ...values,
    updated_at: new Date().toISOString(),
  }).eq("work_item_id", workItemId).eq("channel", "x");
  if (result.error) throw result.error;
}

async function createAuthIncident(
  admin: any,
  status: number,
  payload: unknown,
) {
  const result = await admin.rpc("record_linkr_platform_incident_v1", {
    p_fingerprint: "x-reply-auth",
    p_severity: "critical",
    p_title: "X reply posting authorization failed",
    p_details: { status, payload, worker_version: VERSION },
  });
  if (result.error) throw result.error;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<any> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("x_response_too_large").catch(() => {});
        return { error: "x_response_too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
