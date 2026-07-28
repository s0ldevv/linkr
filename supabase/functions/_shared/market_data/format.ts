import { maxPromptBytes } from "./env.ts";
import type { MarketDataBundle, MarketDiscoveryItem } from "./types.ts";
import { chainIdFor, chainLabel, tokenExplorerUrl } from "./chains.ts";

export function buildPublicMarketFacts(bundle: MarketDataBundle): Record<string, unknown> {
  const tokenAddress = bundle.tokenAddress ?? bundle.mint ?? null;
  const facts = {
    chain: chainLabel(bundle.chain),
    chain_id: bundle.chainId ?? chainIdFor(bundle.chain),
    mint: bundle.mint,
    token_address: tokenAddress,
    explorer_url:
      bundle.explorerUrl ?? (tokenAddress ? tokenExplorerUrl(bundle.chain, tokenAddress) : null),
    blockscout_url: bundle.chain === "robinhood" ? bundle.explorerUrl : null,
    symbol: bundle.symbol ?? null,
    name: bundle.name ?? null,
    pair: bundle.primaryPair
      ? {
          address: bundle.primaryPair.pairAddress,
          dex: bundle.primaryPair.dexId ?? null,
          url: bundle.primaryPair.url ?? null,
          created_at: bundle.primaryPair.createdAt ?? null,
          labels: bundle.primaryPair.labels ?? [],
        }
      : null,
    price_usd: cleanNumber(bundle.price?.usd),
    price_native: bundle.price?.native ?? null,
    price_change_5m: cleanNumber(bundle.price?.change5m),
    price_change_1h: cleanNumber(bundle.price?.change1h),
    price_change_6h: cleanNumber(bundle.price?.change6h),
    price_change_24h: cleanNumber(bundle.price?.change24h),
    liquidity_usd: cleanNumber(bundle.liquidity?.usd),
    liquidity_base: cleanNumber(bundle.liquidity?.base),
    liquidity_quote: cleanNumber(bundle.liquidity?.quote),
    volume_5m_usd: cleanNumber(bundle.volume?.m5),
    volume_1h_usd: cleanNumber(bundle.volume?.h1),
    volume_6h_usd: cleanNumber(bundle.volume?.h6),
    volume_24h_usd: cleanNumber(bundle.volume?.h24),
    txns_5m: cleanNumber(bundle.txns?.m5),
    txns_1h: cleanNumber(bundle.txns?.h1),
    txns_6h: cleanNumber(bundle.txns?.h6),
    txns_24h: cleanNumber(bundle.txns?.h24),
    market_cap_usd: cleanNumber(bundle.valuation?.marketCapUsd),
    fdv_usd: cleanNumber(bundle.valuation?.fdvUsd),
    buys_5m: cleanNumber(bundle.flow?.buys5m),
    sells_5m: cleanNumber(bundle.flow?.sells5m),
    buys_1h: cleanNumber(bundle.flow?.buys1h),
    sells_1h: cleanNumber(bundle.flow?.sells1h),
    buys_6h: cleanNumber(bundle.flow?.buys6h),
    sells_6h: cleanNumber(bundle.flow?.sells6h),
    buys_24h: cleanNumber(bundle.flow?.buys24h),
    sells_24h: cleanNumber(bundle.flow?.sells24h),
    buyers_24h: cleanNumber(bundle.flow?.buyers24h),
    sellers_24h: cleanNumber(bundle.flow?.sellers24h),
    buy_volume_24h_usd: cleanNumber(bundle.flow?.buyVolume24h),
    sell_volume_24h_usd: cleanNumber(bundle.flow?.sellVolume24h),
    holders_count: cleanNumber(bundle.holders?.count),
    transfers_count: cleanNumber(bundle.txns?.transfers),
    logo_url: bundle.metadata?.logoUrl ?? null,
    decimals: cleanNumber(bundle.metadata?.decimals),
    token_type: bundle.metadata?.tokenType ?? null,
    possible_spam: bundle.metadata?.possibleSpam ?? null,
    verified: bundle.metadata?.verified ?? null,
    boosted: bundle.discovery?.boosted ?? null,
    freshness: freshnessLabel(bundle.freshness.fetchedAt),
    boost_amount: cleanNumber(bundle.discovery?.boostAmount),
    boost_total_amount: cleanNumber(bundle.discovery?.boostTotalAmount),
    warnings: bundle.warnings,
  };
  return capPromptObject(dropNullish(facts));
}

export function buildPublicDiscoveryFacts(
  items: MarketDiscoveryItem[],
  warnings: string[] = [],
): Record<string, unknown> {
  const chain = items[0]?.chain ?? "robinhood";
  const facts = {
    kind: "market_discovery",
    chain: chainLabel(chain),
    chain_id: chainIdFor(chain),
    items: items.slice(0, 8).map((item) =>
      dropNullish({
        rank: item.rank,
        list_kind: item.listKind,
        mint: item.mint ?? null,
        token_address: item.tokenAddress ?? item.mint ?? null,
        explorer_url:
          item.explorerUrl ??
          (item.tokenAddress ? tokenExplorerUrl(item.chain, item.tokenAddress) : null),
        blockscout_url: item.chain === "robinhood" ? item.explorerUrl : null,
        pair_address: item.pairAddress ?? null,
        symbol: item.symbol ?? null,
        name: item.name ?? null,
        price_usd: cleanNumber(item.priceUsd),
        market_cap_usd: cleanNumber(item.marketCapUsd),
        fdv_usd: cleanNumber(item.fdvUsd),
        liquidity_usd: cleanNumber(item.liquidityUsd),
        volume_24h_usd: cleanNumber(item.volume24hUsd),
        price_change_24h: cleanNumber(item.priceChange24h),
        holders_count: cleanNumber(item.holdersCount),
        token_type: item.tokenType ?? null,
      }),
    ),
    freshness: "fresh",
    warnings,
  };
  return capPromptObject(facts);
}

export function formatCompactUsd(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return "$" + trim(value / 1_000_000_000) + "B";
  if (abs >= 1_000_000) return "$" + trim(value / 1_000_000) + "M";
  if (abs >= 1_000) return "$" + trim(value / 1_000) + "K";
  if (abs >= 1) return "$" + trim(value);
  if (abs > 0) return "$" + value.toPrecision(3);
  return "$0";
}

export function formatPercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${trim(value)}%`;
}

export function capPromptObject<T extends Record<string, unknown>>(value: T): T {
  const maxBytes = maxPromptBytes();
  let copy: Record<string, unknown> = value;
  while (JSON.stringify(copy).length > maxBytes && Array.isArray(copy.items)) {
    copy = { ...copy, items: copy.items.slice(0, Math.max(1, copy.items.length - 1)) };
  }
  if (JSON.stringify(copy).length > maxBytes) {
    copy = { summary: "market data available but too large to include fully" };
  }
  return copy as T;
}

function cleanNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dropNullish(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry == null) return false;
      if (Array.isArray(entry)) return entry.length > 0;
      if (typeof entry === "object")
        return Object.keys(entry as Record<string, unknown>).length > 0;
      return true;
    }),
  );
}

function freshnessLabel(fetchedAt: string): "fresh" | "recent" | "stale" {
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "fresh";
  if (ageMs < 2 * 60 * 1000) return "fresh";
  if (ageMs < 10 * 60 * 1000) return "recent";
  return "stale";
}

function trim(value: number): string {
  return Number(value.toFixed(2)).toString();
}
