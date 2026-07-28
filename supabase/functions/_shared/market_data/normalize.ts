// deno-lint-ignore-file no-explicit-any

import type {
  MarketChain,
  MarketDataBundle,
  MarketDiscoveryItem,
  MarketProvider,
} from "./types.ts";
import { tokenDataTtlSeconds } from "./env.ts";
import {
  chainIdFor,
  defaultDexscreenerChainSlug,
  normalizeMarketAddress,
  normalizeMarketAddressForChain,
  tokenExplorerUrl,
} from "./chains.ts";
import { ROBINHOOD_CHAIN_ID } from "../robinhood_chain.ts";

export function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function integerOrNull(value: unknown): number | null {
  const number = numberOrNull(value);
  return number == null ? null : Math.floor(number);
}

export function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function boolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|1|yes)$/i.test(value)) return true;
    if (/^(false|0|no)$/i.test(value)) return false;
  }
  return null;
}

export function emptyMarketBundle(mint: string, chain?: MarketChain): MarketDataBundle {
  const normalized = normalizeMarketAddress(mint);
  const resolvedChain = chain ?? normalized?.chain ?? "robinhood";
  const tokenAddress = normalized?.chain === resolvedChain ? normalized.address : null;
  return {
    chain: resolvedChain,
    chainId: chainIdFor(resolvedChain),
    mint,
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl(resolvedChain, tokenAddress) : null,
    primaryPair: null,
    price: {},
    liquidity: {},
    volume: {},
    txns: {},
    flow: {},
    holders: {},
    valuation: {},
    metadata: {},
    discovery: {},
    sources: [],
    freshness: {
      fetchedAt: new Date().toISOString(),
      ttlSeconds: tokenDataTtlSeconds(),
    },
    warnings: [],
  };
}

export function normalizeDexPair(pair: any, mint?: string | null): Partial<MarketDataBundle> {
  const chain = chainFromDexPair(pair, mint);
  const base = pair?.baseToken ?? {};
  const quote = pair?.quoteToken ?? {};
  const token =
    mint && sameAddress(quote?.address, mint) && !sameAddress(base?.address, mint)
      ? quote
      : mint && sameAddress(base?.address, mint)
        ? base
        : base;
  const resolvedMint =
    normalizeTokenAddress(token?.address, chain) ?? normalizeTokenAddress(mint, chain) ?? "";
  const txns = pair?.txns ?? {};
  const info = pair?.info ?? {};

  return {
    chain,
    chainId: chainIdFor(chain),
    mint: resolvedMint,
    tokenAddress: resolvedMint || null,
    explorerUrl: resolvedMint ? tokenExplorerUrl(chain, resolvedMint) : null,
    symbol: stringOrNull(token?.symbol),
    name: stringOrNull(token?.name),
    primaryPair: pair?.pairAddress
      ? {
          pairAddress: String(pair.pairAddress),
          dexId: stringOrNull(pair.dexId),
          url: stringOrNull(pair.url),
          createdAt: pair.pairCreatedAt ? new Date(Number(pair.pairCreatedAt)).toISOString() : null,
          labels: Array.isArray(pair.labels)
            ? pair.labels
                .map((label: unknown) => stringOrNull(label))
                .filter((label: string | null): label is string => Boolean(label))
            : [],
        }
      : null,
    price: {
      usd: numberOrNull(pair?.priceUsd),
      native: stringOrNull(pair?.priceNative),
      change5m: numberOrNull(pair?.priceChange?.m5),
      change1h: numberOrNull(pair?.priceChange?.h1),
      change6h: numberOrNull(pair?.priceChange?.h6),
      change24h: numberOrNull(pair?.priceChange?.h24),
    },
    liquidity: {
      usd: numberOrNull(pair?.liquidity?.usd),
      base: numberOrNull(pair?.liquidity?.base),
      quote: numberOrNull(pair?.liquidity?.quote),
    },
    volume: {
      m5: numberOrNull(pair?.volume?.m5),
      h1: numberOrNull(pair?.volume?.h1),
      h6: numberOrNull(pair?.volume?.h6),
      h24: numberOrNull(pair?.volume?.h24),
    },
    txns: {
      m5: sumTxn(txns?.m5),
      h1: sumTxn(txns?.h1),
      h6: sumTxn(txns?.h6),
      h24: sumTxn(txns?.h24),
    },
    flow: {
      buys5m: integerOrNull(txns?.m5?.buys),
      sells5m: integerOrNull(txns?.m5?.sells),
      buys1h: integerOrNull(txns?.h1?.buys),
      sells1h: integerOrNull(txns?.h1?.sells),
      buys6h: integerOrNull(txns?.h6?.buys),
      sells6h: integerOrNull(txns?.h6?.sells),
      buys24h: integerOrNull(txns?.h24?.buys),
      sells24h: integerOrNull(txns?.h24?.sells),
    },
    valuation: {
      fdvUsd: numberOrNull(pair?.fdv),
      marketCapUsd: numberOrNull(pair?.marketCap),
    },
    metadata: {
      logoUrl: stringOrNull(info?.imageUrl),
      websites: (info?.websites ?? []).map((site: any) => stringOrNull(site?.url)).filter(Boolean),
      socials: (info?.socials ?? [])
        .map((social: any) => ({
          platform: String(social?.platform ?? "").toLowerCase(),
          handle: stringOrNull(social?.handle),
          url: stringOrNull(social?.url),
        }))
        .filter((social: any) => social.platform || social.handle || social.url),
    },
    discovery: {
      boosted: integerOrNull(pair?.boosts?.active) != null ? true : undefined,
      boostAmount: integerOrNull(pair?.boosts?.active),
    },
    sources: ["dexscreener"],
    freshness: {
      fetchedAt: new Date().toISOString(),
      ttlSeconds: tokenDataTtlSeconds(),
    },
  };
}

export function normalizeMoralisPrice(price: any, mint?: string | null): Partial<MarketDataBundle> {
  const chain = chainFromAddress(price?.tokenAddress ?? price?.address ?? mint);
  const tokenAddress = normalizeTokenAddress(price?.tokenAddress ?? price?.address ?? mint, chain);
  return {
    chain,
    chainId: chainIdFor(chain),
    mint: tokenAddress ?? "",
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl(chain, tokenAddress) : null,
    symbol: stringOrNull(price?.symbol),
    name: stringOrNull(price?.name),
    primaryPair: price?.pairAddress
      ? {
          pairAddress: String(price.pairAddress),
          dexId: stringOrNull(price.exchangeName) ?? stringOrNull(price.exchangeAddress),
          url: null,
          createdAt: null,
        }
      : null,
    price: {
      usd:
        numberOrNull(price?.usdPrice) ??
        numberOrNull(price?.priceUsd) ??
        numberOrNull(price?.usd_price),
      native: stringOrNull(price?.nativePrice?.value) ?? stringOrNull(price?.nativePrice),
      change24h:
        numberOrNull(price?.usdPrice24hrPercentChange) ??
        numberOrNull(price?.["24hrPercentChange"]) ??
        numberOrNull(price?.priceChange24h),
    },
    liquidity: {
      usd: numberOrNull(price?.pairTotalLiquidityUsd) ?? numberOrNull(price?.liquidityUsd),
    },
    sources: ["moralis"],
    freshness: {
      fetchedAt: new Date().toISOString(),
      ttlSeconds: tokenDataTtlSeconds(),
    },
  };
}

export function normalizeMoralisMetadata(
  metadata: any,
  mint?: string | null,
): Partial<MarketDataBundle> {
  const address =
    metadata?.mint ??
    metadata?.address ??
    metadata?.tokenAddress ??
    metadata?.contractAddress ??
    mint;
  const chain = chainFromAddress(address);
  const tokenAddress = normalizeTokenAddress(address, chain);
  return {
    chain,
    chainId: chainIdFor(chain),
    mint: tokenAddress ?? "",
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl(chain, tokenAddress) : null,
    symbol: stringOrNull(metadata?.symbol ?? metadata?.standard?.symbol),
    name: stringOrNull(metadata?.name ?? metadata?.standard?.name),
    metadata: {
      logoUrl: stringOrNull(metadata?.logo ?? metadata?.logoURI ?? metadata?.metadata?.image),
      possibleSpam: boolOrNull(metadata?.possible_spam ?? metadata?.possibleSpam),
      verified: boolOrNull(metadata?.verified_contract ?? metadata?.isVerifiedContract),
    },
    sources: ["moralis"],
    freshness: {
      fetchedAt: new Date().toISOString(),
      ttlSeconds: tokenDataTtlSeconds(),
    },
  };
}

export function normalizeMoralisAnalytics(
  item: any,
  mint?: string | null,
): Partial<MarketDataBundle> {
  const analytics = item?.analytics ?? item;
  const address = item?.tokenAddress ?? item?.address ?? item?.token?.address ?? mint;
  const chain = chainFromAddress(address);
  const tokenAddress = normalizeTokenAddress(address, chain);

  return {
    chain,
    chainId: chainIdFor(chain),
    mint: tokenAddress ?? "",
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl(chain, tokenAddress) : null,
    volume: {
      h24:
        numberOrNull(analytics?.totalVolumeUsd) ??
        numberOrNull(analytics?.totalVolume) ??
        numberOrNull(analytics?.volume24h) ??
        numberOrNull(analytics?.volume?.h24),
    },
    txns: {
      h24:
        integerOrNull(analytics?.totalTransactions) ??
        integerOrNull(analytics?.transactions24h) ??
        integerOrNull(analytics?.txns24h),
    },
    flow: {
      buys24h:
        integerOrNull(analytics?.totalBuys) ??
        integerOrNull(analytics?.buys24h) ??
        integerOrNull(analytics?.buys),
      sells24h:
        integerOrNull(analytics?.totalSells) ??
        integerOrNull(analytics?.sells24h) ??
        integerOrNull(analytics?.sells),
      buyers24h:
        integerOrNull(analytics?.totalBuyers) ??
        integerOrNull(analytics?.buyers24h) ??
        integerOrNull(analytics?.buyers),
      sellers24h:
        integerOrNull(analytics?.totalSellers) ??
        integerOrNull(analytics?.sellers24h) ??
        integerOrNull(analytics?.sellers),
      buyVolume24h:
        numberOrNull(analytics?.totalBuyVolumeUsd) ??
        numberOrNull(analytics?.buyVolume24h) ??
        numberOrNull(analytics?.buyVolume),
      sellVolume24h:
        numberOrNull(analytics?.totalSellVolumeUsd) ??
        numberOrNull(analytics?.sellVolume24h) ??
        numberOrNull(analytics?.sellVolume),
    },
    sources: ["moralis"],
    freshness: {
      fetchedAt: new Date().toISOString(),
      ttlSeconds: tokenDataTtlSeconds(),
    },
  };
}

export function normalizeBlockscoutToken(
  token: any,
  counters?: any,
  transfers?: any[],
): Partial<MarketDataBundle> {
  const tokenAddress = normalizeTokenAddress(
    token?.address_hash ?? token?.addressHash,
    "robinhood",
  );
  const holdersCount =
    integerOrNull(counters?.token_holders_count) ?? integerOrNull(token?.holders_count);
  const transfersCount =
    integerOrNull(counters?.transfers_count) ??
    (Array.isArray(transfers) ? transfers.length : null);

  return {
    chain: "robinhood",
    chainId: ROBINHOOD_CHAIN_ID,
    mint: tokenAddress ?? "",
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl("robinhood", tokenAddress) : null,
    symbol: stringOrNull(token?.symbol),
    name: stringOrNull(token?.name),
    primaryPair: tokenAddress
      ? {
          pairAddress: tokenAddress,
          dexId: "Blockscout",
          url: tokenExplorerUrl("robinhood", tokenAddress),
          createdAt: null,
        }
      : null,
    price: {
      usd: numberOrNull(token?.exchange_rate),
    },
    volume: {
      h24: numberOrNull(token?.volume_24h),
    },
    txns: {
      transfers: transfersCount,
    },
    holders: {
      count: holdersCount,
    },
    valuation: {
      marketCapUsd: numberOrNull(token?.circulating_market_cap),
    },
    metadata: {
      logoUrl: stringOrNull(token?.icon_url),
      decimals: integerOrNull(token?.decimals),
      tokenType: stringOrNull(token?.type),
      reputation: stringOrNull(token?.reputation),
      possibleSpam: String(token?.reputation ?? "").toLowerCase() === "scam" ? true : null,
      verified: String(token?.reputation ?? "").toLowerCase() === "ok" ? true : null,
    },
    sources: ["blockscout"],
    freshness: {
      fetchedAt: new Date().toISOString(),
      ttlSeconds: tokenDataTtlSeconds(),
    },
  };
}

export function mergeMarketBundles(
  mint: string,
  bundles: Array<Partial<MarketDataBundle> | null | undefined>,
  chain?: MarketChain,
): MarketDataBundle {
  const merged = emptyMarketBundle(mint, chain ?? firstBundleChain(bundles));
  for (const bundle of bundles) {
    if (!bundle) continue;
    merged.chain = bundle.chain ?? merged.chain;
    merged.chainId = merged.chainId ?? bundle.chainId ?? chainIdFor(merged.chain);
    merged.tokenAddress = merged.tokenAddress ?? bundle.tokenAddress ?? null;
    merged.explorerUrl = merged.explorerUrl ?? bundle.explorerUrl ?? null;
    merged.symbol = merged.symbol ?? bundle.symbol ?? null;
    merged.name = merged.name ?? bundle.name ?? null;
    if (shouldUsePrimaryPair(merged.primaryPair, bundle.primaryPair)) {
      merged.primaryPair = bundle.primaryPair ?? null;
    }
    merged.price = mergeObject(merged.price, bundle.price);
    merged.liquidity = mergeObject(merged.liquidity, bundle.liquidity);
    merged.volume = mergeObject(merged.volume, bundle.volume);
    merged.txns = mergeObject(merged.txns, bundle.txns);
    merged.flow = mergeObject(merged.flow, bundle.flow);
    merged.holders = mergeObject(merged.holders, bundle.holders);
    merged.valuation = mergeObject(merged.valuation, bundle.valuation);
    merged.metadata = mergeObject(merged.metadata, bundle.metadata);
    merged.discovery = mergeObject(merged.discovery, bundle.discovery);
    for (const source of bundle.sources ?? []) {
      if (!merged.sources.includes(source as MarketProvider)) {
        merged.sources.push(source as MarketProvider);
      }
    }
    if (bundle.freshness?.fetchedAt) {
      merged.freshness.fetchedAt = newestIso(
        merged.freshness.fetchedAt,
        bundle.freshness.fetchedAt,
      );
    }
    if (bundle.freshness?.ttlSeconds) {
      merged.freshness.ttlSeconds = Math.min(
        merged.freshness.ttlSeconds,
        bundle.freshness.ttlSeconds,
      );
    }
    merged.warnings.push(...(bundle.warnings ?? []));
  }
  return merged;
}

export function selectPrimaryDexPair(pairs: any[], mint: string): any | null {
  const chainPairs = pairs ?? [];
  if (chainPairs.length === 0) return null;
  return [...chainPairs].sort((a, b) => scoreDexPair(b, mint) - scoreDexPair(a, mint))[0] ?? null;
}

export function discoveryFromDexPair(
  pair: any,
  rank: number,
  listKind: string,
): MarketDiscoveryItem {
  const chain = chainFromDexPair(pair);
  const tokenAddress = normalizeTokenAddress(pair?.baseToken?.address, chain);
  return {
    chain,
    chainId: chainIdFor(chain),
    mint: tokenAddress,
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl(chain, tokenAddress) : null,
    pairAddress: stringOrNull(pair?.pairAddress),
    symbol: stringOrNull(pair?.baseToken?.symbol),
    name: stringOrNull(pair?.baseToken?.name),
    source: "dexscreener",
    listKind,
    rank,
    priceUsd: numberOrNull(pair?.priceUsd),
    marketCapUsd: numberOrNull(pair?.marketCap),
    fdvUsd: numberOrNull(pair?.fdv),
    liquidityUsd: numberOrNull(pair?.liquidity?.usd),
    volume24hUsd: numberOrNull(pair?.volume?.h24),
    priceChange24h: numberOrNull(pair?.priceChange?.h24),
    url: stringOrNull(pair?.url),
    raw: pair,
  };
}

export function discoveryFromMoralisToken(
  token: any,
  rank: number,
  listKind: string,
): MarketDiscoveryItem {
  const chain = chainFromAddress(token?.tokenAddress ?? token?.address ?? token?.mint);
  const tokenAddress = normalizeTokenAddress(
    token?.tokenAddress ?? token?.address ?? token?.mint,
    chain,
  );
  return {
    chain,
    chainId: chainIdFor(chain),
    mint: tokenAddress,
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl(chain, tokenAddress) : null,
    pairAddress: stringOrNull(token?.pairAddress),
    symbol: stringOrNull(token?.symbol),
    name: stringOrNull(token?.name),
    source: "moralis",
    listKind,
    rank,
    priceUsd: numberOrNull(token?.usdPrice ?? token?.priceUsd),
    marketCapUsd: numberOrNull(token?.marketCap ?? token?.marketCapUsd),
    fdvUsd: numberOrNull(token?.fullyDilutedValuation ?? token?.fdv),
    liquidityUsd: numberOrNull(token?.liquidityUsd ?? token?.liquidity),
    volume24hUsd: numberOrNull(token?.volume24hUsd ?? token?.volume24h),
    priceChange24h: numberOrNull(token?.usdPrice24hrPercentChange ?? token?.priceChange24h),
    url: stringOrNull(token?.url),
    raw: token,
  };
}

export function discoveryFromBlockscoutToken(
  token: any,
  rank: number,
  listKind: string,
): MarketDiscoveryItem {
  const tokenAddress = normalizeTokenAddress(
    token?.address_hash ?? token?.addressHash,
    "robinhood",
  );
  return {
    chain: "robinhood",
    chainId: ROBINHOOD_CHAIN_ID,
    mint: tokenAddress,
    tokenAddress,
    explorerUrl: tokenAddress ? tokenExplorerUrl("robinhood", tokenAddress) : null,
    pairAddress: null,
    symbol: stringOrNull(token?.symbol),
    name: stringOrNull(token?.name),
    source: "blockscout",
    listKind,
    rank,
    priceUsd: numberOrNull(token?.exchange_rate),
    marketCapUsd: numberOrNull(token?.circulating_market_cap),
    fdvUsd: null,
    liquidityUsd: null,
    volume24hUsd: numberOrNull(token?.volume_24h),
    priceChange24h: null,
    holdersCount: integerOrNull(token?.holders_count),
    tokenType: stringOrNull(token?.type ?? token?.token_type),
    url: tokenAddress
      ? tokenExplorerUrl("robinhood", tokenAddress)
      : stringOrNull(token?.token_url),
    raw: token,
  };
}

function scoreDexPair(pair: any, mint: string): number {
  const baseMatch = sameAddress(pair?.baseToken?.address, mint) ? 1_000_000_000 : 0;
  const quoteMatch = sameAddress(pair?.quoteToken?.address, mint) ? 100_000_000 : 0;
  const liquidity = numberOrNull(pair?.liquidity?.usd) ?? 0;
  const volume = numberOrNull(pair?.volume?.h24) ?? 0;
  const hasPrice = numberOrNull(pair?.priceUsd) ? 1_000 : 0;
  return baseMatch + quoteMatch + liquidity * 100 + volume + hasPrice;
}

function shouldUsePrimaryPair(
  current: MarketDataBundle["primaryPair"],
  incoming: MarketDataBundle["primaryPair"],
): boolean {
  if (!incoming) return false;
  if (!current) return true;

  const currentDex = String(current.dexId ?? "").toLowerCase();
  const incomingDex = String(incoming.dexId ?? "").toLowerCase();
  if (currentDex === "blockscout" && incomingDex && incomingDex !== "blockscout") return true;
  return false;
}

function sumTxn(value: any): number | null {
  const buys = integerOrNull(value?.buys);
  const sells = integerOrNull(value?.sells);
  if (buys == null && sells == null) return null;
  return (buys ?? 0) + (sells ?? 0);
}

function mergeObject<T extends Record<string, any> | undefined>(left: T, right: T): NonNullable<T> {
  const out = { ...(left ?? {}) } as Record<string, any>;
  for (const [key, value] of Object.entries(right ?? {})) {
    if (value == null) continue;
    const existing = out[key];
    if (Array.isArray(value)) {
      out[key] = value.length > 0 ? value : existing;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      out[key] = mergeObject(existing, value);
    } else if (existing == null || existing === "") {
      out[key] = value;
    }
  }
  return out as NonNullable<T>;
}

function newestIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function normalizeTokenAddress(value: unknown, chain: MarketChain): string | null {
  return normalizeMarketAddressForChain(value, chain)?.address ?? null;
}

function chainFromDexPair(pair: any, mint?: string | null): MarketChain {
  const chainId = String(pair?.chainId ?? "").toLowerCase();
  if (chainId === defaultDexscreenerChainSlug("solana")) return "solana";
  if (chainId === defaultDexscreenerChainSlug("robinhood")) return "robinhood";
  return chainFromAddress(pair?.baseToken?.address ?? pair?.quoteToken?.address ?? mint);
}

function chainFromAddress(value: unknown): MarketChain {
  return normalizeMarketAddress(value)?.chain ?? "robinhood";
}

function firstBundleChain(
  bundles: Array<Partial<MarketDataBundle> | null | undefined>,
): MarketChain | undefined {
  return bundles.find((bundle) => bundle?.chain)?.chain;
}

function sameAddress(left: unknown, right: unknown): boolean {
  const a = String(left ?? "")
    .trim()
    .toLowerCase();
  const b = String(right ?? "")
    .trim()
    .toLowerCase();
  return !!a && !!b && a === b;
}
