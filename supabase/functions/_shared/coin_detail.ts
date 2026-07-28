// deno-lint-ignore-file no-explicit-any
import { buildPublicMarketFacts, getMarketDataBundle } from "./market_data/index.ts";
import { getAddressExplorerUrl } from "./robinhood_chain.ts";
import { chainLabel, normalizeMarketAddress, tokenExplorerUrl } from "./market_data/chains.ts";
import type { MarketChain } from "./market_data/types.ts";

export async function buildAgentCoinDetail(
  admin: any,
  tokenAddressInput: string,
  options: { analytics?: boolean; chain?: MarketChain } = {},
) {
  const normalized = normalizeMarketAddress(tokenAddressInput);
  if (!normalized) throw new Error("invalid_token_address");
  const chain = options.chain ?? normalized.chain;
  const tokenAddress = normalized.address;
  const warnings: string[] = [];
  const launch = await readLaunch(admin, tokenAddress, chain);
  if (!launch) warnings.push("not_linkr_launched");

  const [marketBundle, creatorRewards, blockscout] = await Promise.all([
    getMarketDataBundle(admin, {
      mint: tokenAddress,
      chain,
      includeBlockscout: chain === "robinhood",
      includeDexscreener: true,
      includeMoralis: chain === "robinhood",
      includeAnalytics: options.analytics !== false,
    }).catch((error) => {
      warnings.push(
        `market_data_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }),
    readCreatorRewards(tokenAddress).catch((error) => {
      warnings.push(
        `creator_rewards_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }),
    chain === "robinhood"
      ? readBlockscoutToken(tokenAddress).catch(() => null)
      : Promise.resolve(null),
  ]);

  const market = marketBundle ? buildPublicMarketFacts(marketBundle) : null;
  return {
    chain,
    chain_label: chainLabel(chain),
    token_address: tokenAddress,
    mint: tokenAddress,
    launch: launch
      ? {
          id: launch.id,
          name: launch.name,
          symbol: launch.symbol,
          description: launch.description,
          image_url: launch.image_url,
          status: launch.status,
          created_at: launch.created_at,
          tx_hash: launch.tx_hash ?? launch.tx_signature,
          creator_user_id: launch.user_id,
          launch_method: launch.launch_method,
          launch_platform: launch.launch_platform,
          metadata_uri: launch.metadata_uri,
          pump_url: launch.pump_url ?? null,
          metadata_storage_provider: launch.metadata_storage_provider ?? null,
          ipfs_metadata_uri: launch.ipfs_metadata_uri ?? null,
          ipfs_metadata_gateway_url: launch.ipfs_metadata_gateway_url ?? null,
          initial_buy_eth: launch.effective_initial_buy_eth ?? launch.dev_buy_eth,
          initial_buy_wei: launch.effective_initial_buy_wei ?? launch.requested_initial_buy_wei,
          initial_buy_sol: launch.dev_buy_sol ?? null,
          initial_buy_lamports:
            launch.effective_initial_buy_lamports ?? launch.requested_initial_buy_lamports ?? null,
        }
      : null,
    market,
    creator_rewards: creatorRewards,
    pool: launch
      ? {
          pool_address: launch.pool,
          pool_fee: launch.pool_fee,
          position_id: launch.position_id,
          position_manager: launch.position_manager,
          paired_token: launch.paired_token ?? launch.pair_token,
          tick_lower: launch.lp_tick_lower,
          tick_upper: launch.lp_tick_upper,
          liquidity: launch.lp_liquidity,
          is_token0: launch.is_token0,
        }
      : null,
    metadata: {
      name: launch?.name ?? blockscout?.name ?? (market as any)?.name ?? null,
      symbol: launch?.symbol ?? blockscout?.symbol ?? (market as any)?.symbol ?? null,
      description: launch?.description ?? null,
      image_url: launch?.image_url ?? blockscout?.icon_url ?? (market as any)?.logo_url ?? null,
      metadata_uri: launch?.metadata_uri ?? null,
      metadata_storage_provider: launch?.metadata_storage_provider ?? null,
      ipfs_image_uri: launch?.ipfs_image_uri ?? null,
      ipfs_image_gateway_url: launch?.ipfs_image_gateway_url ?? null,
      ipfs_metadata_uri: launch?.ipfs_metadata_uri ?? null,
      ipfs_metadata_gateway_url: launch?.ipfs_metadata_gateway_url ?? null,
      filebase_image_object_key: launch?.filebase_image_object_key ?? null,
      filebase_metadata_object_key: launch?.filebase_metadata_object_key ?? null,
      website_url: launch?.metadata_website_url ?? null,
      twitter_url: launch?.metadata_twitter_url ?? launch?.source_tweet_url ?? null,
      telegram_url: launch?.metadata_telegram_url ?? null,
      blockscout,
    },
    links: {
      app: chain === "robinhood" ? `https://linkr.cash/coin/${tokenAddress}` : null,
      explorer:
        chain === "robinhood"
          ? getAddressExplorerUrl(tokenAddress)
          : tokenExplorerUrl(chain, tokenAddress),
      pair: (market as any)?.pair?.url ?? null,
    },
    warnings,
  };
}

async function readLaunch(admin: any, tokenAddress: string, chain: MarketChain) {
  let query = admin
    .from("coin_launches")
    .select("*")
    .or(`token_address.eq.${tokenAddress},mint.eq.${tokenAddress}`)
    .order("created_at", { ascending: false })
    .limit(1);
  query = chain === "solana" ? query.eq("chain", "solana") : query.eq("chain", "robinhood");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function readCreatorRewards(tokenAddress: string) {
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!base) throw new Error("missing_supabase_url");
  const res = await fetch(
    `${base}/functions/v1/creator-rewards-config?mint=${encodeURIComponent(tokenAddress)}`,
    {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    },
  );
  if (!res.ok) throw new Error(`creator_rewards_${res.status}`);
  return await res.json();
}

async function readBlockscoutToken(tokenAddress: string) {
  const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${tokenAddress}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  return await res.json();
}
