// deno-lint-ignore-file no-explicit-any

import type { MarketChain, MarketDataBundle, MarketDiscoveryItem, MarketSortBy } from "./types.ts";
import { marketDataEnabled } from "./env.ts";
import {
  getFreshTokenSnapshot,
  writeTokenSnapshot,
  getFreshDiscoverySnapshot,
  writeDiscoverySnapshot,
} from "./cache.ts";
import {
  getBlockscoutTokenBundle,
  getBlockscoutTokenList,
  searchBlockscoutTokens,
} from "./blockscout.ts";
import {
  getDexBestTokenBundle,
  getDexBoostedDiscovery,
  getDexSearchDiscovery,
  getDexTrendingMetas,
} from "./dexscreener.ts";
import { getMoralisBundleParts, getMoralisTrendingTokens, searchMoralisTokens } from "./moralis.ts";
import { discoveryFromMoralisToken, emptyMarketBundle, mergeMarketBundles } from "./normalize.ts";
import { buildPublicDiscoveryFacts, buildPublicMarketFacts } from "./format.ts";
import { resolveMarketToken } from "./resolve.ts";
import { normalizeMarketAddress } from "./chains.ts";

export {
  buildPublicDiscoveryFacts,
  buildPublicMarketFacts,
  getBlockscoutTokenList as getBlockscoutTrendingTokens,
  getDexBoostedDiscovery as getDexscreenerBoostedTokens,
  getDexTrendingMetas as getDexscreenerTrendingMetas,
  getMoralisTrendingTokens,
  resolveMarketToken,
};

export async function getMarketDataBundle(
  admin: any,
  args: {
    mint: string;
    includeBlockscout?: boolean;
    includeDexscreener?: boolean;
    includeMoralis?: boolean;
    includeAnalytics?: boolean;
    chain?: MarketChain;
  },
): Promise<MarketDataBundle> {
  const rawMint = String(args.mint ?? "").trim();
  const normalized = normalizeMarketAddress(rawMint);
  const chain = args.chain ?? normalized?.chain ?? "robinhood";
  const mint = normalized?.chain === chain ? normalized.address : rawMint;
  if (!mint || !marketDataEnabled()) {
    return {
      ...emptyMarketBundle(mint, chain),
      warnings: mint ? ["market_data_disabled"] : ["missing_mint"],
    };
  }
  if (!normalized || normalized.chain !== chain) {
    return {
      ...emptyMarketBundle(rawMint, chain),
      warnings: ["invalid_token_address"],
    };
  }

  const parts: Array<Partial<MarketDataBundle>> = [];
  const cachedMerged = await getFreshTokenSnapshot(admin, {
    chain,
    mint,
    source: "merged",
  });
  if (cachedMerged) return cachedMerged;

  const cachedBlockscout =
    chain === "robinhood" && args.includeBlockscout !== false
      ? await getFreshTokenSnapshot(admin, {
          chain: "robinhood",
          mint,
          source: "blockscout",
        })
      : null;
  const cachedDex =
    args.includeDexscreener !== false
      ? await getFreshTokenSnapshot(admin, {
          chain,
          mint,
          source: "dexscreener",
        })
      : null;
  const cachedMoralis =
    args.includeMoralis !== false
      ? await getFreshTokenSnapshot(admin, {
          chain,
          mint,
          source: "moralis",
        })
      : null;

  if (cachedBlockscout) parts.push(cachedBlockscout);
  else if (args.includeBlockscout !== false) {
    const blockscout = chain === "robinhood" ? await getBlockscoutTokenBundle(admin, mint) : null;
    if (blockscout) parts.push(blockscout);
  }

  if (cachedDex) parts.push(cachedDex);
  else if (args.includeDexscreener !== false) {
    const dex = await getDexBestTokenBundle(admin, mint, chain);
    if (dex) parts.push(dex);
  }

  if (cachedMoralis) parts.push(cachedMoralis);
  else if (args.includeMoralis !== false) {
    const moralisParts = await getMoralisBundleParts(admin, mint);
    parts.push(...moralisParts);
  }

  if (parts.length === 0) {
    return {
      ...emptyMarketBundle(mint, chain),
      warnings: ["no_market_data_available"],
    };
  }

  const merged = mergeMarketBundles(mint, parts, chain);
  await writeTokenSnapshot(admin, {
    chain,
    mint,
    source: "merged",
    bundle: merged,
    rawJson: {},
    ttlSeconds: merged.freshness.ttlSeconds,
  });
  return merged;
}

export async function searchMarketTokens(
  admin: any,
  args: {
    query: string;
    limit?: number;
    sortBy?: MarketSortBy;
    chain?: MarketChain;
  },
): Promise<MarketDiscoveryItem[]> {
  const query = String(args.query ?? "").trim();
  const chain = args.chain ?? "robinhood";
  if (!query || !marketDataEnabled()) return [];
  const cached = await getFreshDiscoverySnapshot(admin, {
    source: "merged",
    listKind: "token_search",
    chain,
    query,
    sortBy: args.sortBy ?? "volume24hDesc",
  });
  if (cached) return cached;

  const [blockscout, moralis, dex] = await Promise.all([
    chain === "robinhood"
      ? searchBlockscoutTokens(admin, {
          query,
          limit: args.limit ?? 10,
          sortBy: args.sortBy ?? "volume24hDesc",
        })
      : Promise.resolve([]),
    searchMoralisTokens(admin, {
      query,
      limit: args.limit ?? 10,
      sortBy: args.sortBy ?? "volume24hDesc",
    }),
    getDexSearchDiscovery(admin, `${query} ${chain}`, "token_search", chain),
  ]);

  const items = dedupeDiscovery([
    ...blockscout,
    ...moralis.map((token, index) => discoveryFromMoralisToken(token, index + 1, "token_search")),
    ...dex,
  ])
    .slice(0, args.limit ?? 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  await writeDiscoverySnapshot(admin, {
    source: "merged",
    listKind: "token_search",
    chain,
    query,
    sortBy: args.sortBy ?? "volume24hDesc",
    items,
    rawJson: {},
    ttlSeconds: 180,
  });
  return items;
}

function dedupeDiscovery(items: MarketDiscoveryItem[]): MarketDiscoveryItem[] {
  const seen = new Set<string>();
  const out: MarketDiscoveryItem[] = [];
  for (const item of items) {
    const key = String(
      item.tokenAddress ??
        item.mint ??
        item.pairAddress ??
        `${item.source}:${item.name}:${item.symbol}`,
    ).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
