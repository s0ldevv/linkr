// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isCronAuthorized, unauthorizedCronResponse } from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { internalErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();

  const startedAt = Date.now();
  const admin = serviceClient();
  const locked = await withCronLock(
    admin,
    { name: "cron-expire-pending-actions", ttlSeconds: 120, allowWithoutRpc: true },
    async () => {
      try {
        const { data, error } = await admin
          .from("pending_actions")
          .update({ status: "expired" })
          .lt("expires_at", new Date().toISOString())
          .eq("status", "pending")
          .select("id");

        if (error) {
          await recordHealthEvent(admin, "cron-expire-pending-actions", "down", startedAt, {
            error: error.message,
          });
          return internalErrorResponse(error, { function: "cron-expire-pending-actions" });
        }
        const body = { expired: data?.length ?? 0 };
        await recordHealthEvent(admin, "cron-expire-pending-actions", "ok", startedAt, body);
        return jsonResponse(body);
      } catch (error) {
        await recordHealthEvent(admin, "cron-expire-pending-actions", "down", startedAt, {
          error: String(error),
        });
        return internalErrorResponse(error, { function: "cron-expire-pending-actions" });
      }
    },
  );

  if (locked.locked) {
    const body = { skipped: "locked", owner: locked.owner };
    await recordHealthEvent(admin, "cron-expire-pending-actions", "ok", startedAt, body);
    return jsonResponse(body);
  }

  return locked.result;
});
