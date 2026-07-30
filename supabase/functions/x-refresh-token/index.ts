// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isCronAuthorized } from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { readJsonBody } from "../_shared/http.ts";
import { refreshXToken } from "../_shared/x_tokens.ts";

const ACCOUNT_KEY = "linkrbot";
const HOURLY_REFRESH_WINDOW_MS = 75 * 60 * 1000;

function needsReauthorization(message: string): boolean {
  const value = message.toLowerCase();
  return (
    value.includes("invalid_request") ||
    value.includes("token was invalid") ||
    value.includes("invalid refresh") ||
    value.includes("revoked") ||
    value.includes("complete first login")
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
  const admin = serviceClient();

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  if (!isCronAuthorized(req)) {
    await recordHealthEvent(admin, "x-refresh-token", "degraded", startedAt, {
      error: "unauthorized",
    });
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const locked = await withCronLock(
    admin,
    { name: "x-refresh-token", ttlSeconds: 180, allowWithoutRpc: true },
    async () => {
      try {
        const body = await readJsonBody(req, 16 * 1024) as any;
        const result = await refreshXToken(admin, {
          accountKey: typeof body.account_key === "string" ? body.account_key : ACCOUNT_KEY,
          force: body.force === true,
          refreshWithinMs: HOURLY_REFRESH_WINDOW_MS,
        });

        await recordHealthEvent(admin, "x-refresh-token", "ok", startedAt, {
          refreshed: result.refreshed,
          skipped: result.skipped ?? null,
          expires_at: result.expiresAt,
        });

        return jsonResponse({
          success: true,
          account_key: result.accountKey,
          bot_handle: result.botHandle,
          x_user_id: result.xUserId,
          expires_at: result.expiresAt,
          refreshed: result.refreshed,
          skipped: result.skipped ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const needsReauth = needsReauthorization(message);
        await recordHealthEvent(admin, "x-refresh-token", "down", startedAt, {
          error: message,
          needs_reauth: needsReauth,
        });
        return jsonResponse(
          {
            success: false,
            error: needsReauth ? message : "token_refresh_failed",
            needs_reauth: needsReauth,
          },
          { status: needsReauth ? 409 : 500 },
        );
      }
    },
  );

  if (locked.locked) {
    const body = { success: true, skipped: "locked", owner: locked.owner };
    await recordHealthEvent(admin, "x-refresh-token", "ok", startedAt, body);
    return jsonResponse(body);
  }

  return locked.result;
});
