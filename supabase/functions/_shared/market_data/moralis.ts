// deno-lint-ignore-file no-explicit-any

import type { MarketDiscoveryItem, MarketSortBy } from "./types.ts";

export function hasMoralisKey(): boolean {
  return false;
}

export async function getMoralisTokenPrice(_admin: any, _mint: string): Promise<any | null> {
  return null;
}

export async function getMoralisTokenMetadata(_admin: any, _mint: string): Promise<any | null> {
  return null;
}

export async function getMoralisTokenAnalyticsBatch(_admin: any, _mints: string[]): Promise<any[]> {
  return [];
}

export async function searchMoralisTokens(
  _admin: any,
  _args: {
    query: string;
    limit?: number;
    sortBy?: MarketSortBy;
  },
): Promise<any[]> {
  return [];
}

export async function getMoralisBundleParts(_admin: any, _mint: string) {
  return [];
}

export async function getMoralisTrendingTokens(
  _admin: any,
  _args: { limit?: number; sortBy?: MarketSortBy } = {},
): Promise<MarketDiscoveryItem[]> {
  return [];
}
