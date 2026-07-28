// deno-lint-ignore-file no-explicit-any

import type { MarketDataBundle, MarketDiscoveryItem } from "./types.ts";
import { emptyMarketBundle, numberOrNull, integerOrNull, stringOrNull } from "./normalize.ts";
import type { MarketChain } from "./types.ts";
import { chainIdFor, tokenExplorerUrl } from "./chains.ts";
import { ROBINHOOD_CHAIN_ID } from "../robinhood_chain.ts";

export async function getFreshTokenSnapshot(
  admin: any,
  args: {
    chain: MarketChain;
    mint?: string | null;
    pairAddress?: string | null;
    source: string;
  },
): Promise<MarketDataBundle | null> {
  if (!admin) return null;
  let query = admin
    .from("market_token_snapshots")
    .select("*")
    .eq("chain", args.chain)
    .eq("source", args.source)
    .gt("expires_at", new Date().toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1);

  if (args.mint) query = query.eq("mint", args.mint);
  if (args.pairAddress) query = query.eq("pair_address", args.pairAddress);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return snapshotRowToBundle(data);
}

export async function writeTokenSnapshot(
  admin: any,
  snapshot: {
    chain: MarketChain;
    mint?: string | null;
    pairAddress?: string | null;
    source: string;
    bundle: Partial<MarketDataBundle>;
    rawJson: any;
    ttlSeconds: number;
  },
): Promise<void> {
  if (!admin) return;
  const expiresAt = new Date(Date.now() + snapshot.ttlSeconds * 1000).toISOString();
  const bundle = snapshot.bundle;
  try {
    await admin.from("market_token_snapshots").insert({
      chain: snapshot.chain,
      chain_id: bundle.chainId ?? chainIdFor(snapshot.chain),
      mint: snapshot.mint ?? bundle.mint ?? null,
      token_address: bundle.tokenAddress ?? snapshot.mint ?? bundle.mint ?? null,
      explorer_url: bundle.explorerUrl ?? null,
      pair_address: snapshot.pairAddress ?? bundle.primaryPair?.pairAddress ?? null,
      pair_dex_id: bundle.primaryPair?.dexId ?? null,
      pair_created_at: bundle.primaryPair?.createdAt ?? null,
      source: snapshot.source,
      symbol: bundle.symbol ?? null,
      name: bundle.name ?? null,
      logo_url: bundle.metadata?.logoUrl ?? null,
      price_usd: bundle.price?.usd ?? null,
      price_native: bundle.price?.native ?? null,
      market_cap_usd: bundle.valuation?.marketCapUsd ?? null,
      fdv_usd: bundle.valuation?.fdvUsd ?? null,
      liquidity_usd: bundle.liquidity?.usd ?? null,
      liquidity_base: bundle.liquidity?.base ?? null,
      liquidity_quote: bundle.liquidity?.quote ?? null,
      volume_5m_usd: bundle.volume?.m5 ?? null,
      volume_1h_usd: bundle.volume?.h1 ?? null,
      volume_6h_usd: bundle.volume?.h6 ?? null,
      volume_24h_usd: bundle.volume?.h24 ?? null,
      price_change_5m: bundle.price?.change5m ?? null,
      price_change_1h: bundle.price?.change1h ?? null,
      price_change_6h: bundle.price?.change6h ?? null,
      price_change_24h: bundle.price?.change24h ?? null,
      txns_5m: bundle.txns?.m5 ?? null,
      txns_1h: bundle.txns?.h1 ?? null,
      txns_6h: bundle.txns?.h6 ?? null,
      buys_24h: bundle.flow?.buys24h ?? null,
      sells_24h: bundle.flow?.sells24h ?? null,
      buys_5m: bundle.flow?.buys5m ?? null,
      sells_5m: bundle.flow?.sells5m ?? null,
      buys_1h: bundle.flow?.buys1h ?? null,
      sells_1h: bundle.flow?.sells1h ?? null,
      buys_6h: bundle.flow?.buys6h ?? null,
      sells_6h: bundle.flow?.sells6h ?? null,
      buyers_24h: bundle.flow?.buyers24h ?? null,
      sellers_24h: bundle.flow?.sellers24h ?? null,
      txns_24h: bundle.txns?.h24 ?? null,
      holders_count: bundle.holders?.count ?? null,
      transfers_count: bundle.txns?.transfers ?? null,
      boosts_active: bundle.discovery?.boostAmount ?? null,
      score: bundle.metadata?.score ?? null,
      possible_spam: bundle.metadata?.possibleSpam ?? null,
      is_verified: bundle.metadata?.verified ?? null,
      pair_url: bundle.primaryPair?.url ?? null,
      raw_json: snapshot.rawJson ?? {},
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
  } catch (_) {
    // Cache writes are best-effort.
  }
}

export async function getFreshDiscoverySnapshot(
  admin: any,
  args: {
    source: string;
    listKind: string;
    chain?: MarketChain;
    query?: string | null;
    sortBy?: string | null;
  },
): Promise<MarketDiscoveryItem[] | null> {
  if (!admin) return null;
  let db = admin
    .from("market_discovery_snapshots")
    .select("*")
    .eq("source", args.source)
    .eq("list_kind", args.listKind)
    .eq("chain", args.chain ?? "robinhood")
    .gt("expires_at", new Date().toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1);

  if (args.query) db = db.eq("query", args.query);
  else db = db.is("query", null);
  if (args.sortBy) db = db.eq("sort_by", args.sortBy);
  else db = db.is("sort_by", null);

  const { data, error } = await db.maybeSingle();
  if (error || !data) return null;
  return Array.isArray(data.items) ? data.items : [];
}

export async function writeDiscoverySnapshot(
  admin: any,
  args: {
    source: string;
    listKind: string;
    chain?: MarketChain;
    query?: string | null;
    sortBy?: string | null;
    items: MarketDiscoveryItem[];
    rawJson: any;
    ttlSeconds: number;
  },
): Promise<void> {
  if (!admin) return;
  try {
    await admin.from("market_discovery_snapshots").insert({
      source: args.source,
      list_kind: args.listKind,
      chain: args.chain ?? "robinhood",
      query: args.query ?? null,
      sort_by: args.sortBy ?? null,
      items: args.items,
      raw_json: args.rawJson ?? {},
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + args.ttlSeconds * 1000).toISOString(),
    });
  } catch (_) {
    // Cache writes are best-effort.
  }
}

export function snapshotRowToBundle(row: any): MarketDataBundle {
  const mint = String(row?.mint ?? "");
  const chain = String(row?.chain ?? "robinhood") === "solana" ? "solana" : "robinhood";
  const bundle = emptyMarketBundle(mint, chain);
  bundle.chainId = integerOrNull(row?.chain_id) ?? chainIdFor(chain);
  bundle.tokenAddress = stringOrNull(row?.token_address) ?? stringOrNull(row?.mint);
  bundle.explorerUrl =
    stringOrNull(row?.explorer_url) ??
    (bundle.tokenAddress ? tokenExplorerUrl(chain, bundle.tokenAddress) : null);
  bundle.symbol = stringOrNull(row?.symbol);
  bundle.name = stringOrNull(row?.name);
  bundle.primaryPair = row?.pair_address
    ? {
        pairAddress: String(row.pair_address),
        dexId: stringOrNull(row?.pair_dex_id),
        url: stringOrNull(row?.pair_url),
        createdAt: stringOrNull(row?.pair_created_at),
      }
    : null;
  bundle.price = {
    usd: numberOrNull(row?.price_usd),
    native: stringOrNull(row?.price_native),
    change5m: numberOrNull(row?.price_change_5m),
    change1h: numberOrNull(row?.price_change_1h),
    change6h: numberOrNull(row?.price_change_6h),
    change24h: numberOrNull(row?.price_change_24h),
  };
  bundle.liquidity = {
    usd: numberOrNull(row?.liquidity_usd),
    base: numberOrNull(row?.liquidity_base),
    quote: numberOrNull(row?.liquidity_quote),
  };
  bundle.volume = {
    m5: numberOrNull(row?.volume_5m_usd),
    h1: numberOrNull(row?.volume_1h_usd),
    h6: numberOrNull(row?.volume_6h_usd),
    h24: numberOrNull(row?.volume_24h_usd),
  };
  bundle.txns = {
    m5: integerOrNull(row?.txns_5m),
    h1: integerOrNull(row?.txns_1h),
    h6: integerOrNull(row?.txns_6h),
    h24: integerOrNull(row?.txns_24h),
    transfers: integerOrNull(row?.transfers_count),
  };
  bundle.flow = {
    buys5m: integerOrNull(row?.buys_5m),
    sells5m: integerOrNull(row?.sells_5m),
    buys1h: integerOrNull(row?.buys_1h),
    sells1h: integerOrNull(row?.sells_1h),
    buys6h: integerOrNull(row?.buys_6h),
    sells6h: integerOrNull(row?.sells_6h),
    buys24h: integerOrNull(row?.buys_24h),
    sells24h: integerOrNull(row?.sells_24h),
    buyers24h: integerOrNull(row?.buyers_24h),
    sellers24h: integerOrNull(row?.sellers_24h),
  };
  bundle.holders = { count: integerOrNull(row?.holders_count) };
  bundle.valuation = {
    marketCapUsd: numberOrNull(row?.market_cap_usd),
    fdvUsd: numberOrNull(row?.fdv_usd),
  };
  bundle.metadata = {
    logoUrl: stringOrNull(row?.logo_url),
    possibleSpam: row?.possible_spam ?? null,
    verified: row?.is_verified ?? null,
    score: numberOrNull(row?.score),
  };
  bundle.discovery = {
    boosted: integerOrNull(row?.boosts_active) != null ? true : undefined,
    boostAmount: integerOrNull(row?.boosts_active),
  };
  bundle.sources = ["cache"];
  bundle.freshness = {
    fetchedAt: row?.fetched_at ?? new Date().toISOString(),
    ttlSeconds: 0,
  };
  return bundle;
}
