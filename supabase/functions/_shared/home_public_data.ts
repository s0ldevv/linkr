// deno-lint-ignore-file no-explicit-any

import { getMarketDataBundle } from "./market_data/index.ts";

export async function loadPublicHomeData(admin: any) {
  const [
    liveFeedResult,
    topTradersResult,
    launchesResult,
    achievementsResult,
    topWalletsResult,
    systemStatusResult,
  ] = await Promise.all([
    admin
      .from("public_activity_feed")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(12),
    admin.rpc("get_home_top_traders_30d", { limit_count: 5 }),
    admin
      .from("coin_launches")
      .select(
        "id,name,symbol,description,image_url,mint,token_address,tx_signature,dev_buy_eth,dev_buy_sol,dev_buy_usd,status,created_at,chain,launch_platform",
      )
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("public_achievements")
      .select("id,kind,title,detail,metric_value,threshold,achieved_at,metadata")
      .order("achieved_at", { ascending: false })
      .limit(6),
    safe(() => admin.rpc("get_home_top_wallets_30d", { limit_count: 5 }), { data: null }),
    safe(() => admin.rpc("get_home_system_status"), { data: null }),
  ]);

  throwIfSupabaseError(liveFeedResult.error);
  throwIfSupabaseError(topTradersResult.error);
  throwIfSupabaseError(launchesResult.error);
  throwIfSupabaseError(achievementsResult.error);

  const topLaunchedTokens = await Promise.all(
    (launchesResult.data ?? []).map(async (launch: any) => {
      const marketAddress = launch.token_address ?? launch.mint;
      const market = marketAddress
        ? await safe(
            () =>
              getMarketDataBundle(admin, {
                mint: marketAddress,
                chain: launch.chain === "solana" ? "solana" : "robinhood",
                includeDexscreener: true,
                includeMoralis: true,
                includeAnalytics: false,
              }),
            null,
          )
        : null;
      return {
        id: launch.id,
        name: launch.name,
        symbol: launch.symbol,
        description: launch.description,
        imageUrl: launch.image_url,
        mint: marketAddress,
        tokenAddress: marketAddress,
        chain: launch.chain ?? "robinhood",
        launchPlatform: launch.launch_platform ?? null,
        txSignature: launch.tx_signature,
        devBuyEth: numberOrNull(launch.dev_buy_eth),
        devBuySol: numberOrNull(launch.dev_buy_sol),
        devBuyUsd: numberOrNull(launch.dev_buy_usd),
        status: launch.status,
        createdAt: launch.created_at,
        marketCapUsd: numberOrNull(market?.valuation?.marketCapUsd ?? market?.valuation?.fdvUsd),
        liquidityUsd: numberOrNull(market?.liquidity?.usd),
        priceChange24h: numberOrNull(market?.price?.change24h),
        pairUrl: market?.primaryPair?.url ?? null,
      };
    }),
  );

  const liveFeed = (liveFeedResult.data ?? []).map((row: any) => ({
    ...row,
    amount_eth: numberOrNull(row.amount_eth),
    amount_sol: numberOrNull(row.amount_sol),
    tx_hash: row.tx_hash ?? row.tx_signature ?? null,
  }));
  const topTraders = (topTradersResult.data ?? []).map((row: any) => ({
    ...row,
    amount_eth: numberOrNull(row.amount_eth),
  }));
  const topWalletRows = (topWalletsResult as any)?.data;
  const topWallets = Array.isArray(topWalletRows)
    ? topWalletRows.map((row: any) => ({
        ...row,
        amount_eth: numberOrNull(row.amount_eth),
      }))
    : [];

  return {
    liveFeed,
    topTraders30d: topTraders,
    topLaunchedTokens,
    recentAchievements: achievementsResult.data ?? [],
    topWallets30d: topWallets,
    systemStatus: Array.isArray(systemStatusResult?.data) ? systemStatusResult.data : [],
  };
}

export async function readPublicHomeCache(
  admin: any,
  options: { allowStale?: boolean } = {},
): Promise<any | null> {
  const now = new Date().toISOString();
  let query = admin
    .from("home_metrics_cache")
    .select("data,generated_at,expires_at,build_status,error")
    .eq("cache_key", "public_home_v1")
    .order("generated_at", { ascending: false })
    .limit(1);

  if (!options.allowStale) query = query.gt("expires_at", now);

  const { data, error } = await query.maybeSingle();
  if (error || !data?.data) return null;
  return {
    ...data.data,
    cacheMeta: {
      generatedAt: data.generated_at,
      expiresAt: data.expires_at,
      stale: data.expires_at <= now,
      buildStatus: data.build_status,
      error: data.error ?? null,
    },
  };
}

export async function writePublicHomeCache(
  admin: any,
  data: any,
  options: {
    ttlSeconds?: number;
    status?: "ok" | "degraded" | "failed";
    error?: string | null;
  } = {},
) {
  const ttlSeconds = Math.max(30, Math.min(options.ttlSeconds ?? 300, 3600));
  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + ttlSeconds * 1000);
  const { error } = await admin.from("home_metrics_cache").upsert(
    {
      cache_key: "public_home_v1",
      data,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      build_status: options.status ?? "ok",
      error: options.error ?? null,
      updated_at: generatedAt.toISOString(),
    },
    { onConflict: "cache_key" },
  );
  if (error) throw error;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function throwIfSupabaseError(error: unknown) {
  if (error) throw error;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}
