// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isCronAuthorized, unauthorizedCronResponse } from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { loadPublicHomeData, writePublicHomeCache } from "../_shared/home_public_data.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { internalErrorResponse } from "../_shared/http.ts";

function readPositiveInt(name: string, fallback: number) {
  const raw = Number(Deno.env.get(name));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();

  const startedAt = Date.now();
  const admin = serviceClient();

  const locked = await withCronLock(
    admin,
    { name: "cron-refresh-home-cache", ttlSeconds: 180, allowWithoutRpc: true },
    async () => {
      try {
        const ttlSeconds = readPositiveInt("LINKR_HOME_CACHE_TTL_SECONDS", 300);
        const publicData = await loadPublicHomeData(admin);
        await writePublicHomeCache(admin, publicData, { ttlSeconds });
        const body = {
          refreshed: true,
          ttl_seconds: ttlSeconds,
          live_feed: publicData.liveFeed?.length ?? 0,
          top_traders: publicData.topTraders30d?.length ?? 0,
          top_wallets: publicData.topWallets30d?.length ?? 0,
          launched_tokens: publicData.topLaunchedTokens?.length ?? 0,
        };
        await recordHealthEvent(admin, "cron-refresh-home-cache", "ok", startedAt, body);
        return jsonResponse(body);
      } catch (error) {
        await recordHealthEvent(admin, "cron-refresh-home-cache", "down", startedAt, {
          error: String(error),
        });
        return internalErrorResponse(error, { function: "cron-refresh-home-cache" });
      }
    },
  );

  if (locked.locked) {
    const body = { skipped: "locked", owner: locked.owner };
    await recordHealthEvent(admin, "cron-refresh-home-cache", "ok", startedAt, body);
    return jsonResponse(body);
  }

  return locked.result;
});
