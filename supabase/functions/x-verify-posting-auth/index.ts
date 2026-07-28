import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isCronAuthorized } from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  verifyXPostingCredentials,
  XPostingVerificationError,
} from "../_shared/x_posting_verifier.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const startedAt = Date.now();
  const admin = serviceClient();

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!isCronAuthorized(req)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const locked = await withCronLock(
    admin,
    { name: "x-verify-posting-auth", ttlSeconds: 60, allowWithoutRpc: true },
    async () => {
      try {
        const result = await verifyXPostingCredentials();
        const details = {
          auth_mode: result.authMode,
          x_user_id: result.xUserId,
          bot_handle: result.botHandle,
          verified_at: result.verifiedAt,
          deployment_id: Deno.env.get("DENO_DEPLOYMENT_ID") ?? null,
        };
        await recordHealthEvent(admin, "x-post-auth", "ok", startedAt, details);
        return jsonResponse({
          success: true,
          ...details,
        });
      } catch (error) {
        const known = error instanceof XPostingVerificationError;
        const code = known ? error.code : "x_auth_check_failed";
        const message = error instanceof Error ? error.message : String(error);
        const status = known ? error.status : 500;
        await recordHealthEvent(admin, "x-post-auth", "down", startedAt, {
          error: code,
          message,
          deployment_id: Deno.env.get("DENO_DEPLOYMENT_ID") ?? null,
        });
        return jsonResponse(
          { success: false, error: code, message, needs_reauth: true },
          { status },
        );
      }
    },
  );

  if (locked.locked) {
    const body = { success: true, skipped: "locked", owner: locked.owner };
    await recordHealthEvent(admin, "x-post-auth", "ok", startedAt, body);
    return jsonResponse(body);
  }
  return locked.result;
});
