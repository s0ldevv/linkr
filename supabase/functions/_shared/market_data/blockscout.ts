// deno-lint-ignore-file no-explicit-any

import {
  ROBINHOOD_EXPLORER_BASE_URL,
  isEvmAddress,
  normalizeEvmAddress,
} from "../robinhood_chain.ts";
import { blockscoutEnabled, discoveryTtlSeconds, tokenDataTtlSeconds } from "./env.ts";
import { fetchJsonWithTimeout } from "./http.ts";
import {
  discoveryFromBlockscoutToken,
  normalizeBlockscoutToken,
  numberOrNull,
} from "./normalize.ts";
import { getFreshDiscoverySnapshot, writeDiscoverySnapshot, writeTokenSnapshot } from "./cache.ts";
import type { MarketDiscoveryItem, MarketSortBy } from "./types.ts";

export const ROBINHOOD_BLOCKSCOUT_API_BASE_URL = "https://robinhoodchain.blockscout.com/api/v2";

export function blockscoutApiUrl(path: string, params?: Record<string, string | number | null>) {
  const url = new URL(
    path.startsWith("/")
      ? `${ROBINHOOD_BLOCKSCOUT_API_BASE_URL}${path}`
      : `${ROBINHOOD_BLOCKSCOUT_API_BASE_URL}/${path}`,
  );
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function tokenExplorerUrl(tokenAddress: string): string {
  return `${ROBINHOOD_EXPLORER_BASE_URL}/token/${normalizeEvmAddress(tokenAddress)}`;
}

export async function getBlockscoutToken(admin: any, tokenAddress: string): Promise<any | null> {
  if (!blockscoutEnabled() || !isEvmAddress(tokenAddress)) return null;
  const address = normalizeEvmAddress(tokenAddress);
  const result = await fetchJsonWithTimeout({
    provider: "blockscout",
    endpoint: "token",
    url: blockscoutApiUrl(`/tokens/${address}`),
    admin,
  });
  return result.ok && result.data && typeof result.data === "object" ? result.data : null;
}

export async function getBlockscoutTokenCounters(
  admin: any,
  tokenAddress: string,
): Promise<any | null> {
  if (!blockscoutEnabled() || !isEvmAddress(tokenAddress)) return null;
  const address = normalizeEvmAddress(tokenAddress);
  const result = await fetchJsonWithTimeout({
    provider: "blockscout",
    endpoint: "token-counters",
    url: blockscoutApiUrl(`/tokens/${address}/counters`),
    admin,
  });
  return result.ok && result.data && typeof result.data === "object" ? result.data : null;
}

export async function getBlockscoutTokenHolders(
  admin: any,
  tokenAddress: string,
  limit = 10,
): Promise<any[]> {
  if (!blockscoutEnabled() || !isEvmAddress(tokenAddress)) return [];
  const address = normalizeEvmAddress(tokenAddress);
  const result = await fetchJsonWithTimeout({
    provider: "blockscout",
    endpoint: "token-holders",
    url: blockscoutApiUrl(`/tokens/${address}/holders`),
    admin,
  });
  if (!result.ok) return [];
  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  return items.slice(0, Math.max(0, Math.min(50, Math.floor(limit))));
}

export async function getBlockscoutTokenTransfers(
  admin: any,
  tokenAddress: string,
  limit = 50,
): Promise<any[]> {
  if (!blockscoutEnabled() || !isEvmAddress(tokenAddress)) return [];
  const address = normalizeEvmAddress(tokenAddress);
  const result = await fetchJsonWithTimeout({
    provider: "blockscout",
    endpoint: "token-transfers",
    url: blockscoutApiUrl(`/tokens/${address}/transfers`),
    admin,
  });
  if (!result.ok) return [];
  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  return items.slice(0, Math.max(0, Math.min(100, Math.floor(limit))));
}

export async function getBlockscoutTokenBundle(admin: any, tokenAddress: string) {
  if (!blockscoutEnabled() || !isEvmAddress(tokenAddress)) return null;
  const address = normalizeEvmAddress(tokenAddress);
  const [token, counters, transfers] = await Promise.all([
    getBlockscoutToken(admin, address),
    getBlockscoutTokenCounters(admin, address),
    getBlockscoutTokenTransfers(admin, address, 50),
  ]);
  if (!token) return null;

  const bundle = normalizeBlockscoutToken(token, counters, transfers);
  await writeTokenSnapshot(admin, {
    chain: "robinhood",
    mint: address,
    pairAddress: null,
    source: "blockscout",
    bundle,
    rawJson: { token, counters, transfer_sample_size: transfers.length },
    ttlSeconds: tokenDataTtlSeconds(),
  });
  return bundle;
}

export async function searchBlockscoutTokens(
  admin: any,
  args: { query: string; limit?: number; sortBy?: MarketSortBy },
): Promise<MarketDiscoveryItem[]> {
  const query = String(args.query ?? "").trim();
  if (!blockscoutEnabled() || !query) return [];
  const result = await fetchJsonWithTimeout({
    provider: "blockscout",
    endpoint: "search",
    url: blockscoutApiUrl("/search", { q: query }),
    admin,
  });
  if (!result.ok) return [];
  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  return sortDiscovery(
    items
      .filter((item: any) => item?.type === "token" && item?.token_type === "ERC-20")
      .map((item: any, index: number) =>
        discoveryFromBlockscoutToken(
          {
            address_hash: item.address_hash,
            symbol: item.symbol,
            name: item.name,
            type: item.token_type,
            icon_url: item.icon_url,
            reputation: item.reputation,
            exchange_rate: item.exchange_rate,
            circulating_market_cap: item.circulating_market_cap,
            holders_count: item.holder_count ?? item.holders_count,
            total_supply: item.total_supply,
          },
          index + 1,
          "token_search",
        ),
      )
      .filter((item: MarketDiscoveryItem) => item.tokenAddress),
    args.sortBy,
  )
    .slice(0, args.limit ?? 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function getBlockscoutTokenList(
  admin: any,
  args: { limit?: number; sortBy?: MarketSortBy; listKind?: string } = {},
): Promise<MarketDiscoveryItem[]> {
  const listKind = args.listKind ?? "blockscout_tokens";
  const cached = await getFreshDiscoverySnapshot(admin, {
    source: "blockscout",
    listKind,
    sortBy: args.sortBy ?? "volume24hDesc",
  });
  if (cached) return cached;
  if (!blockscoutEnabled()) return [];

  const result = await fetchJsonWithTimeout({
    provider: "blockscout",
    endpoint: "tokens",
    url: blockscoutApiUrl("/tokens"),
    admin,
  });
  if (!result.ok) return [];
  const rawItems = Array.isArray(result.data?.items) ? result.data.items : [];
  const items = sortDiscovery(
    rawItems
      .filter((item: any) => item?.type === "ERC-20")
      .map((item: any, index: number) => discoveryFromBlockscoutToken(item, index + 1, listKind))
      .filter((item: MarketDiscoveryItem) => item.tokenAddress),
    args.sortBy,
  )
    .slice(0, args.limit ?? 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  await writeDiscoverySnapshot(admin, {
    source: "blockscout",
    listKind,
    sortBy: args.sortBy ?? "volume24hDesc",
    items,
    rawJson: { item_count: rawItems.length },
    ttlSeconds: discoveryTtlSeconds(),
  });
  return items;
}

function sortDiscovery(items: MarketDiscoveryItem[], sortBy?: MarketSortBy): MarketDiscoveryItem[] {
  const key = sortBy ?? "volume24hDesc";
  return [...items].sort((a, b) => scoreDiscovery(b, key) - scoreDiscovery(a, key));
}

function scoreDiscovery(item: MarketDiscoveryItem, sortBy: MarketSortBy): number {
  if (sortBy === "liquidityDesc") return numberOrNull(item.liquidityUsd) ?? 0;
  if (sortBy === "marketCapDesc") return numberOrNull(item.marketCapUsd) ?? 0;
  if (sortBy === "volume1hDesc") return numberOrNull(item.volume24hUsd) ?? 0;
  return numberOrNull(item.volume24hUsd) ?? numberOrNull(item.marketCapUsd) ?? 0;
}
