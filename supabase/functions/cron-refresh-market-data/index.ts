// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isCronAuthorized } from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { internalErrorResponse } from "../_shared/http.ts";
import { readMarketBoolean } from "../_shared/market_data/env.ts";
import {
  getDexTokenProfilesLatest,
  getDexTokenProfilesRecent,
} from "../_shared/market_data/dexscreener.ts";
import {
  getBlockscoutTrendingTokens,
  getDexscreenerBoostedTokens,
  getDexscreenerTrendingMetas,
  getMarketDataBundle,
  getMoralisTrendingTokens,
} from "../_shared/market_data/index.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
  const admin = serviceClient();

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!isCronAuthorized(req)) {
    await recordHealthEvent(admin, "cron-refresh-market-data", "degraded", startedAt, {
      error: "unauthorized",
    });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }
  if (!readMarketBoolean("LINKR_MARKET_DATA_WARMER_ENABLED", true)) {
    const body = { skipped: "warmer_disabled" };
    await recordHealthEvent(admin, "cron-refresh-market-data", "ok", startedAt, body);
    return jsonResponse(body);
  }

  const locked = await withCronLock(
    admin,
    { name: "cron-refresh-market-data", ttlSeconds: 600, allowWithoutRpc: true },
    async () => {
      const errors: string[] = [];
      let blockscoutTokensRefreshed = 0;
      let dexBoostedRefreshed = 0;
      let dexMetasRefreshed = 0;
      let moralisSearchListsRefreshed = 0;
      let recentTokensRefreshed = 0;

      try {
        try {
          const sorts = ["volume24hDesc", "liquidityDesc", "marketCapDesc"] as const;
          for (const sortBy of sorts) {
            blockscoutTokensRefreshed += (
              await getBlockscoutTrendingTokens(admin, {
                limit: 20,
                sortBy,
                listKind: "trending_tokens",
              })
            ).length;
          }
        } catch (error) {
          errors.push("blockscout_tokens: " + String(error));
        }

        try {
          dexBoostedRefreshed += (await getDexscreenerBoostedTokens(admin, "top")).length;
          dexBoostedRefreshed += (await getDexscreenerBoostedTokens(admin, "latest")).length;
          await getDexTokenProfilesLatest(admin);
          await getDexTokenProfilesRecent(admin);
        } catch (error) {
          errors.push("dex_boosts_profiles: " + String(error));
        }

        try {
          dexMetasRefreshed = (await getDexscreenerTrendingMetas(admin)).length;
        } catch (error) {
          errors.push("dex_metas: " + String(error));
        }

        try {
          const sorts = [
            "volume1hDesc",
            "volume24hDesc",
            "liquidityDesc",
            "marketCapDesc",
          ] as const;
          for (const sortBy of sorts) {
            const items = await getMoralisTrendingTokens(admin, { limit: 10, sortBy });
            if (items.length > 0) moralisSearchListsRefreshed++;
          }
        } catch (error) {
          errors.push("moralis_search: " + String(error));
        }

        try {
          const recentMints = await loadRecentMentionedMints(admin);
          for (const mint of recentMints.slice(0, 20)) {
            await getMarketDataBundle(admin, {
              mint,
              includeDexscreener: true,
              includeMoralis: true,
              includeAnalytics: false,
            });
            recentTokensRefreshed++;
          }
        } catch (error) {
          errors.push("recent_tokens: " + String(error));
        }

        const body = {
          blockscout_tokens_refreshed: blockscoutTokensRefreshed,
          dex_boosted_refreshed: dexBoostedRefreshed,
          dex_metas_refreshed: dexMetasRefreshed,
          moralis_search_lists_refreshed: moralisSearchListsRefreshed,
          recent_tokens_refreshed: recentTokensRefreshed,
          errors: errors.slice(0, 5),
        };
        await recordHealthEvent(
          admin,
          "cron-refresh-market-data",
          errors.length > 0 ? "degraded" : "ok",
          startedAt,
          body,
        );
        return jsonResponse(body);
      } catch (error) {
        await recordHealthEvent(admin, "cron-refresh-market-data", "down", startedAt, {
          error: String(error),
        });
        return internalErrorResponse(error, { function: "cron-refresh-market-data" });
      }
    },
  );

  if (locked.locked) {
    const body = { skipped: "locked", owner: locked.owner };
    await recordHealthEvent(admin, "cron-refresh-market-data", "ok", startedAt, body);
    return jsonResponse(body);
  }

  return locked.result;
});

async function loadRecentMentionedMints(admin: any): Promise<string[]> {
  const { data } = await admin
    .from("tweet_thread_contexts")
    .select("detected_mints,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const out = new Set<string>();
  for (const row of data ?? []) {
    for (const mint of row.detected_mints ?? []) {
      if (typeof mint === "string" && mint.trim()) out.add(mint.trim());
    }
  }
  return [...out];
}
