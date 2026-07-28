// deno-lint-ignore-file no-explicit-any
// Posts queued replies back to X as replies to the original mention tweet.
// Uses an explicit, rollback-safe X posting auth mode. OAuth 1.0a is the stable
// production target; OAuth 2.0 remains available only during migration rollback.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  isCronAuthorized,
  unauthorizedCronResponse,
} from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { internalErrorResponse } from "../_shared/http.ts";
import {
  loadXBotPostAuthMode,
  refreshOAuth2PostingAuthorization,
  type XBotPostAuthMode,
  xPostingAuthorization,
} from "../_shared/x_posting_auth.ts";

const X_POST = "https://api.x.com/2/tweets";
const BATCH = 10;
const MAX_ATTEMPTS = envInt("X_REPLY_POST_MAX_ATTEMPTS", 6, 1, 20);
const STALE_POSTING_MS = 10 * 60 * 1000;
const FAILED_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUTH_RETRY_MS = 15 * 60 * 1000;

interface XPostResult {
  ok: boolean;
  status: number;
  body: any;
  retryAfterMs: number | null;
  authMode: XBotPostAuthMode;
}

interface FailureDecision {
  error: string;
  retryable: boolean;
  needsReauth: boolean;
  nextAttemptAt: string | null;
  details: Record<string, unknown>;
}

function envInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name);
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function parseXResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return { raw: text };
  }
}

function shortXError(status: number, body: any): string {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return `x post ${status}: ${raw.slice(0, 1000)}`;
}

function shortMessage(value: unknown, max = 1000): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw.length > max ? raw.slice(0, max) : raw;
}

function addMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function retryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs) && dateMs > Date.now()) {
      return dateMs - Date.now();
    }
  }

  const reset = Number(headers.get("x-rate-limit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const resetMs = reset * 1000 - Date.now();
    if (resetMs > 0) return resetMs + 5000;
  }

  return null;
}

async function postReply(
  admin: any,
  row: any,
  authMode: XBotPostAuthMode,
): Promise<XPostResult> {
  // OAuth 1.0a nonces must never be reused. Generate the authorization header
  // immediately before every fetch, including retries.
  const auth = await xPostingAuthorization(
    admin,
    { method: "POST", url: X_POST },
    { mode: authMode },
  );
  const res = await fetch(X_POST, {
    method: "POST",
    headers: {
      Authorization: auth.authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: row.reply_text,
      reply: { in_reply_to_tweet_id: row.tweet_id },
    }),
  });
  const body = await parseXResponse(res);
  return {
    ok: res.ok,
    status: res.status,
    body,
    retryAfterMs: retryAfterMs(res.headers),
    authMode: auth.mode,
  };
}

function responseText(body: any): string {
  const parts: string[] = [];
  if (typeof body?.title === "string") parts.push(body.title);
  if (typeof body?.detail === "string") parts.push(body.detail);
  if (typeof body?.error === "string") parts.push(body.error);
  if (typeof body?.error_description === "string") {
    parts.push(body.error_description);
  }
  if (Array.isArray(body?.errors)) {
    for (const item of body.errors) {
      if (typeof item?.message === "string") parts.push(item.message);
      if (typeof item?.detail === "string") parts.push(item.detail);
    }
  }
  return parts.join(" ").toLowerCase();
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 520 ||
    status === 522 ||
    status === 524 ||
    status === 529 ||
    status >= 500
  );
}

function isLikelyAuthProblem(status: number, body: any): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  const text = responseText(body);
  return (
    text.includes("auth") ||
    text.includes("oauth") ||
    text.includes("token") ||
    text.includes("permission") ||
    text.includes("scope") ||
    text.includes("credential")
  );
}

function backoffMs(
  status: number,
  attemptCount: number,
  headerRetryAfterMs: number | null,
): number {
  if (
    headerRetryAfterMs && Number.isFinite(headerRetryAfterMs) &&
    headerRetryAfterMs > 0
  ) {
    return Math.min(headerRetryAfterMs, 6 * 60 * 60 * 1000);
  }

  const base = status === 429 ? 15 * 60 * 1000 : 60 * 1000;
  const exponent = Math.max(0, Math.min(attemptCount - 1, 6));
  const jitter = Math.floor(Math.random() * 15_000);
  return Math.min(base * 2 ** exponent + jitter, 6 * 60 * 60 * 1000);
}

function classifyFailure(
  result: XPostResult,
  attemptCount: number,
): FailureDecision {
  const error = shortXError(result.status, result.body);
  const needsReauth = isLikelyAuthProblem(result.status, result.body);
  const retryable = needsReauth ||
    (attemptCount < MAX_ATTEMPTS && isRetryableStatus(result.status));
  const waitMs = needsReauth
    ? AUTH_RETRY_MS
    : backoffMs(result.status, attemptCount, result.retryAfterMs);

  return {
    error,
    retryable,
    needsReauth,
    nextAttemptAt: retryable ? addMs(waitMs) : null,
    details: {
      status: result.status,
      auth_mode: result.authMode,
      retry_after_ms: result.retryAfterMs,
      attempt_count: attemptCount,
      max_attempts: MAX_ATTEMPTS,
      needs_reauth: needsReauth,
      body: result.body,
    },
  };
}

function isTokenReauthError(error: unknown): boolean {
  const message = shortMessage(error).toLowerCase();
  return (
    message.includes("invalid_request") ||
    message.includes("invalid refresh") ||
    message.includes("token was invalid") ||
    message.includes("complete first login") ||
    message.includes("stored x access token") ||
    message.includes("expired") ||
    message.includes("x_oauth1_") ||
    message.includes("x_bot_post_auth_mode") ||
    message.includes("oauth 1.0a")
  );
}

function isRetryableErrorText(error: unknown): boolean {
  const text = shortMessage(error).toLowerCase();
  return (
    text.includes("x post 408") ||
    text.includes("x post 409") ||
    text.includes("x post 425") ||
    text.includes("x post 429") ||
    text.includes("x post 500") ||
    text.includes("x post 502") ||
    text.includes("x post 503") ||
    text.includes("x post 504") ||
    text.includes("x post 520") ||
    text.includes("x post 522") ||
    text.includes("x post 524") ||
    text.includes("x post 529") ||
    text.includes("network") ||
    text.includes("fetch")
  );
}

async function recoverStalePosting(admin: any): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_POSTING_MS).toISOString();
  const { data, error } = await admin
    .from("twitter_replies")
    .update({
      status: "pending",
      error: "Recovered stale posting claim",
      next_attempt_at: new Date().toISOString(),
      error_details: {
        recovered_stale_posting: true,
        recovered_at: new Date().toISOString(),
      },
    })
    .eq("status", "posting")
    .eq("delivery_lane", "legacy")
    .or(`last_attempt_at.is.null,last_attempt_at.lt.${cutoff}`)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

async function recoverRetryableFailedReplies(admin: any): Promise<number> {
  const cutoff = new Date(Date.now() - FAILED_RECOVERY_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("twitter_replies")
    .select("id,error,attempt_count")
    .eq("status", "failed")
    .eq("delivery_lane", "legacy")
    .gte("created_at", cutoff)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) throw error;

  let recovered = 0;
  for (const row of data ?? []) {
    if (!isRetryableErrorText(row.error)) continue;
    const { error: updateError } = await admin
      .from("twitter_replies")
      .update({
        status: "pending",
        next_attempt_at: new Date().toISOString(),
        error_details: {
          recovered_retryable_failed_reply: true,
          previous_error: row.error ?? null,
          recovered_at: new Date().toISOString(),
        },
      })
      .eq("id", row.id)
      .eq("status", "failed");
    if (updateError) throw updateError;
    recovered++;
  }

  return recovered;
}

async function claimReply(admin: any, row: any): Promise<any | null> {
  const now = new Date().toISOString();
  const attemptCount = Number(row.attempt_count ?? 0) + 1;
  const { data, error } = await admin
    .from("twitter_replies")
    .update({
      status: "posting",
      attempt_count: attemptCount,
      last_attempt_at: now,
      next_attempt_at: null,
      error: null,
      error_details: {},
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();
  const startedAt = Date.now();
  const admin = serviceClient();
  const locked = await withCronLock(
    admin,
    { name: "cron-post-replies", ttlSeconds: 300, allowWithoutRpc: true },
    async () => {
      try {
        const recoveredStalePosting = await recoverStalePosting(admin);
        const recoveredFailed = await recoverRetryableFailedReplies(admin);
        const now = new Date().toISOString();
        const { data: queue, error: queueError } = await admin
          .from("twitter_replies")
          .select("*")
          .eq("status", "pending")
          .eq("delivery_lane", "legacy")
          .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
          .order("created_at", { ascending: true })
          .limit(BATCH);
        if (queueError) throw queueError;

        if (!queue || queue.length === 0) {
          let configuredAuthMode: XBotPostAuthMode | "unknown" = "unknown";
          try {
            configuredAuthMode = loadXBotPostAuthMode();
          } catch (_) {
            // Idle queue runs remain successful while exposing invalid configuration.
          }
          const body = {
            posted: 0,
            auth_mode: configuredAuthMode,
            recovered_stale_posting: recoveredStalePosting,
            recovered_failed: recoveredFailed,
          };
          await recordHealthEvent(
            admin,
            "cron-post-replies",
            "ok",
            startedAt,
            body,
          );
          return jsonResponse(body);
        }

        let authMode: XBotPostAuthMode;
        try {
          authMode = loadXBotPostAuthMode();
          // Fail before claiming a queue row if credentials are unavailable.
          await xPostingAuthorization(admin, { method: "POST", url: X_POST }, {
            mode: authMode,
          });
        } catch (error) {
          const body = {
            posted: 0,
            pending: queue.length,
            needs_reauth: isTokenReauthError(error),
            error: shortMessage(error),
            auth_mode: (() => {
              try {
                return loadXBotPostAuthMode();
              } catch (_) {
                return "unknown";
              }
            })(),
            recovered_stale_posting: recoveredStalePosting,
            recovered_failed: recoveredFailed,
          };
          await recordHealthEvent(
            admin,
            "cron-post-replies",
            "down",
            startedAt,
            body,
          );
          return jsonResponse(body, { status: 503 });
        }

        let posted = 0;
        let failed = 0;
        let retryScheduled = 0;
        let rateLimited = 0;
        let authBlocked = 0;
        let skippedClaimed = 0;
        let missingReplyTweetIds = 0;
        for (const row of queue) {
          const claimed = await claimReply(admin, row);
          if (!claimed) {
            skippedClaimed++;
            continue;
          }

          try {
            let rowForPost = claimed;
            if (
              (!claimed.conversation_id || !claimed.author_twitter_id) &&
              claimed.tweet_id
            ) {
              const { data: tweetMeta } = await admin
                .from("tweets_inbox")
                .select("conversation_id,author_twitter_id")
                .eq("tweet_id", claimed.tweet_id)
                .maybeSingle();
              if (tweetMeta) {
                rowForPost = {
                  ...claimed,
                  conversation_id: claimed.conversation_id ??
                    tweetMeta.conversation_id ?? null,
                  author_twitter_id: claimed.author_twitter_id ??
                    tweetMeta.author_twitter_id ?? null,
                };
              }
            }

            let result = await postReply(admin, rowForPost, authMode);

            if (!result.ok && result.status === 401 && authMode === "oauth2") {
              try {
                await refreshOAuth2PostingAuthorization(admin);
                result = await postReply(admin, rowForPost, authMode);
              } catch (error) {
                authBlocked++;
                await admin
                  .from("twitter_replies")
                  .update({
                    status: "pending",
                    error: `Bot X OAuth reauthorization required: ${
                      shortMessage(error)
                    }`,
                    next_attempt_at: addMs(AUTH_RETRY_MS),
                    error_details: {
                      needs_reauth: true,
                      token_refresh_error: shortMessage(error),
                      attempt_count: claimed.attempt_count,
                      auth_mode: authMode,
                    },
                  })
                  .eq("id", claimed.id);
                continue;
              }
            }

            if (!result.ok) {
              const decision = classifyFailure(
                result,
                Number(claimed.attempt_count ?? 1),
              );
              if (decision.needsReauth) authBlocked++;
              if (result.status === 429) rateLimited++;

              if (decision.retryable) {
                retryScheduled++;
                await admin
                  .from("twitter_replies")
                  .update({
                    status: "pending",
                    error: decision.error,
                    last_status_code: result.status,
                    next_attempt_at: decision.nextAttemptAt,
                    error_details: decision.details,
                  })
                  .eq("id", claimed.id);
                continue;
              }

              failed++;
              await admin
                .from("twitter_replies")
                .update({
                  status: "failed",
                  error: decision.error,
                  last_status_code: result.status,
                  next_attempt_at: null,
                  error_details: decision.details,
                })
                .eq("id", claimed.id);
              continue;
            }

            const j = result.body;
            const replyTweetId = j?.data?.id ?? null;
            if (!replyTweetId) missingReplyTweetIds++;
            await admin
              .from("twitter_replies")
              .update({
                status: "posted",
                reply_tweet_id: replyTweetId,
                conversation_id: rowForPost.conversation_id ?? null,
                author_twitter_id: rowForPost.author_twitter_id ?? null,
                posted_at: new Date().toISOString(),
                last_status_code: result.status,
                next_attempt_at: null,
                error: null,
                error_details: {
                  x_reply_tweet_id: replyTweetId,
                  auth_mode: authMode,
                },
              })
              .eq("id", claimed.id);
            posted++;
          } catch (e) {
            const message = shortMessage(e);
            const retryable = isRetryableErrorText(message) &&
              Number(claimed.attempt_count ?? 1) < MAX_ATTEMPTS;
            if (retryable) {
              retryScheduled++;
            } else {
              failed++;
            }
            await admin
              .from("twitter_replies")
              .update({
                status: retryable ? "pending" : "failed",
                error: message,
                next_attempt_at: retryable
                  ? addMs(
                    backoffMs(500, Number(claimed.attempt_count ?? 1), null),
                  )
                  : null,
                error_details: {
                  unexpected_error: true,
                  auth_mode: authMode,
                  attempt_count: claimed.attempt_count,
                  max_attempts: MAX_ATTEMPTS,
                },
              })
              .eq("id", claimed.id);
          }
        }
        const body = {
          posted,
          failed,
          retry_scheduled: retryScheduled,
          rate_limited: rateLimited,
          auth_blocked: authBlocked,
          skipped_claimed: skippedClaimed,
          missing_reply_tweet_ids: missingReplyTweetIds,
          auth_mode: authMode,
          recovered_stale_posting: recoveredStalePosting,
          recovered_failed: recoveredFailed,
        };
        await recordHealthEvent(
          admin,
          "cron-post-replies",
          authBlocked > 0
            ? "down"
            : failed > 0 && posted === 0
            ? "degraded"
            : missingReplyTweetIds > 0 || retryScheduled > 0
            ? "degraded"
            : "ok",
          startedAt,
          body,
        );
        return jsonResponse(body);
      } catch (error) {
        await recordHealthEvent(admin, "cron-post-replies", "down", startedAt, {
          error: String(error),
        });
        return internalErrorResponse(error, { function: "cron-post-replies" });
      }
    },
  );

  if (locked.locked) {
    const body = { skipped: "locked", owner: locked.owner };
    await recordHealthEvent(admin, "cron-post-replies", "ok", startedAt, body);
    return jsonResponse(body);
  }

  return locked.result;
});
