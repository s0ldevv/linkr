// deno-lint-ignore-file no-explicit-any

import {
  discoveryTtlSeconds,
  dexscreenerChainSlug,
  dexscreenerEnabled,
  tokenDataTtlSeconds,
} from "./env.ts";
import { fetchJsonWithTimeout } from "./http.ts";
import type { MarketDiscoveryItem } from "./types.ts";
import type { MarketChain } from "./types.ts";
import { discoveryFromDexPair, normalizeDexPair, selectPrimaryDexPair } from "./normalize.ts";
import { writeDiscoverySnapshot, writeTokenSnapshot, getFreshDiscoverySnapshot } from "./cache.ts";
import { chainIdFor, tokenExplorerUrl } from "./chains.ts";

const DEX_BASE = "https://api.dexscreener.com";

export async function getDexTokenPairs(
  admin: any,
  mint: string,
  chain: MarketChain = "robinhood",
): Promise<any[]> {
  const chainSlug = dexscreenerChainSlug(chain);
  if (!dexscreenerEnabled() || !chainSlug || !mint) return [];
  const url = `${DEX_BASE}/token-pairs/v1/${encodeURIComponent(chainSlug)}/${encodeURIComponent(mint)}`;
  const result = await fetchJsonWithTimeout({
    provider: "dexscreener",
    endpoint: "token-pairs",
    url,
    admin,
  });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : (result.data?.pairs ?? []);
}

export async function getDexTokenBatch(admin: any, mints: string[]): Promise<any[]> {
  const chain = dexscreenerChainSlug();
  if (!dexscreenerEnabled() || !chain) return [];
  const unique = [...new Set(mints.filter(Boolean))].slice(0, 30);
  if (unique.length === 0) return [];
  const url = `${DEX_BASE}/tokens/v1/${encodeURIComponent(chain)}/${encodeURIComponent(unique.join(","))}`;
  const result = await fetchJsonWithTimeout({
    provider: "dexscreener",
    endpoint: "tokens-batch",
    url,
    admin,
  });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : (result.data?.pairs ?? []);
}

export async function searchDexPairs(admin: any, query: string): Promise<any[]> {
  if (!dexscreenerEnabled() || !query.trim()) return [];
  const url = `${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`;
  const result = await fetchJsonWithTimeout({
    provider: "dexscreener",
    endpoint: "search",
    url,
    admin,
  });
  if (!result.ok) return [];
  return Array.isArray(result.data?.pairs) ? result.data.pairs : [];
}

export async function getDexPair(admin: any, pairAddress: string): Promise<any | null> {
  const chain = dexscreenerChainSlug();
  if (!dexscreenerEnabled() || !chain || !pairAddress) return null;
  const url = `${DEX_BASE}/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress)}`;
  const result = await fetchJsonWithTimeout({
    provider: "dexscreener",
    endpoint: "pair",
    url,
    admin,
  });
  if (!result.ok) return null;
  return result.data?.pair ?? result.data?.pairs?.[0] ?? null;
}

export async function getDexTokenProfilesLatest(admin: any): Promise<any[]> {
  return getDexArray(admin, "token-profiles-latest", "/token-profiles/latest/v1");
}

export async function getDexTokenProfilesRecent(admin: any): Promise<any[]> {
  return getDexArray(admin, "token-profiles-recent", "/token-profiles/recent-updates/v1");
}

export async function getDexBoostsLatest(admin: any): Promise<any[]> {
  return getDexArray(admin, "token-boosts-latest", "/token-boosts/latest/v1");
}

export async function getDexBoostsTop(admin: any): Promise<any[]> {
  return getDexArray(admin, "token-boosts-top", "/token-boosts/top/v1");
}

export async function getDexOrders(admin: any, mint: string): Promise<any[]> {
  const chain = dexscreenerChainSlug();
  if (!dexscreenerEnabled() || !chain || !mint) return [];
  const result = await fetchJsonWithTimeout({
    provider: "dexscreener",
    endpoint: "orders",
    url: `${DEX_BASE}/orders/v1/${encodeURIComponent(chain)}/${encodeURIComponent(mint)}`,
    admin,
  });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : [];
}

export async function getDexTrendingMetasRaw(admin: any): Promise<any[]> {
  return getDexArray(admin, "metas-trending", "/metas/trending/v1");
}

export async function getDexMeta(admin: any, slug: string): Promise<any | null> {
  if (!dexscreenerEnabled() || !slug) return null;
  const result = await fetchJsonWithTimeout({
    provider: "dexscreener",
    endpoint: "meta",
    url: `${DEX_BASE}/metas/meta/v1/${encodeURIComponent(slug)}`,
    admin,
  });
  return result.ok ? result.data : null;
}

export async function getDexBestTokenBundle(
  admin: any,
  mint: string,
  chain: MarketChain = "robinhood",
) {
  const chainSlug = dexscreenerChainSlug(chain);
  const pairs = (await getDexTokenPairs(admin, mint, chain)).filter(
    (pair) => pair?.chainId === chainSlug,
  );
  const pair = selectPrimaryDexPair(pairs, mint);
  if (!pair) return null;
  const bundle = normalizeDexPair(pair, mint);
  await writeTokenSnapshot(admin, {
    chain,
    mint,
    pairAddress: pair.pairAddress ?? null,
    source: "dexscreener",
    bundle,
    rawJson: pair,
    ttlSeconds: tokenDataTtlSeconds(),
  });
  return bundle;
}

export async function getDexBoostedDiscovery(
  admin: any,
  kind: "latest" | "top",
  chain: MarketChain = "robinhood",
): Promise<MarketDiscoveryItem[]> {
  const cached = await getFreshDiscoverySnapshot(admin, {
    source: "dexscreener",
    listKind: `boosts_${kind}`,
    chain,
  });
  if (cached) return cached;

  const boosts = kind === "latest" ? await getDexBoostsLatest(admin) : await getDexBoostsTop(admin);
  const chainSlug = dexscreenerChainSlug(chain);
  const items: MarketDiscoveryItem[] = boosts
    .filter((item) => item?.chainId === chainSlug)
    .slice(0, 20)
    .flatMap((item, index): MarketDiscoveryItem[] => {
      const tokenAddress = String(item?.tokenAddress ?? "").trim() || null;
      if (!tokenAddress) return [];
      return [
        {
          chain,
          chainId: chainIdFor(chain),
          mint: tokenAddress,
          tokenAddress,
          explorerUrl: tokenExplorerUrl(chain, tokenAddress),
          pairAddress: null,
          symbol: item.symbol ?? null,
          name: item.name ?? null,
          source: "dexscreener" as const,
          listKind: `boosts_${kind}`,
          rank: index + 1,
          priceUsd: null,
          marketCapUsd: null,
          fdvUsd: null,
          liquidityUsd: null,
          volume24hUsd: null,
          priceChange24h: null,
          url: item.url ?? null,
          raw: item,
        },
      ];
    });

  await writeDiscoverySnapshot(admin, {
    source: "dexscreener",
    listKind: `boosts_${kind}`,
    chain,
    items,
    rawJson: boosts,
    ttlSeconds: discoveryTtlSeconds(),
  });
  return items;
}

export async function getDexTrendingMetas(admin: any): Promise<MarketDiscoveryItem[]> {
  // Dexscreener metas are not reliably chain-scoped. Keep this disabled so
  // Robinhood Chain discovery never falls back to cross-chain trending data.
  void admin;
  return [];
}

export async function getDexSearchDiscovery(
  admin: any,
  query: string,
  listKind = "search",
  chain: MarketChain = "robinhood",
): Promise<MarketDiscoveryItem[]> {
  const pairs = await searchDexPairs(admin, query);
  const chainSlug = dexscreenerChainSlug(chain);
  return pairs
    .filter((pair) => pair?.chainId === chainSlug)
    .slice(0, 10)
    .map((pair, index) => discoveryFromDexPair(pair, index + 1, listKind));
}

async function getDexArray(admin: any, endpoint: string, path: string): Promise<any[]> {
  if (!dexscreenerEnabled()) return [];
  const result = await fetchJsonWithTimeout({
    provider: "dexscreener",
    endpoint,
    url: `${DEX_BASE}${path}`,
    admin,
  });
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : [];
}
