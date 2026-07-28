// deno-lint-ignore-file no-explicit-any
// Compatibility wrapper for Linkr market data. Existing callers import from
// this file; new code should prefer _shared/market_data/index.ts.

import { getDexTokenPairs } from "./market_data/dexscreener.ts";
import { getMoralisTokenMetadata } from "./market_data/moralis.ts";
import { getMarketDataBundle } from "./market_data/index.ts";
import { normalizeDexPair, selectPrimaryDexPair } from "./market_data/normalize.ts";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_BASE_URL,
  isEvmAddress,
  normalizeEvmAddress,
} from "./robinhood_chain.ts";

export interface CoinData {
  symbol?: string | null;
  name?: string | null;
  price_usd?: number | null;
  fdv?: number | null;
  liquidity_usd?: number | null;
  volume_24h?: number | null;
  price_change_24h?: number | null;
  pair_url?: string | null;
  source: "dexscreener" | "moralis" | "cache" | "none";
}

export interface TokenMeta {
  mint: string;
  token_address?: string | null;
  explorer_url?: string | null;
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  logo_url?: string | null;
  possible_spam?: boolean | null;
}

export async function fetchDexscreener(mint: string): Promise<CoinData | null> {
  const tokenAddress = normalizeTokenAddress(mint);
  if (!tokenAddress) return null;
  const pairs = await getDexTokenPairs(null, tokenAddress);
  const pair = selectPrimaryDexPair(pairs, tokenAddress);
  if (!pair) return null;
  const bundle = normalizeDexPair(pair, tokenAddress);
  return {
    symbol: bundle.symbol ?? null,
    name: bundle.name ?? null,
    price_usd: bundle.price?.usd ?? null,
    fdv: bundle.valuation?.fdvUsd ?? null,
    liquidity_usd: bundle.liquidity?.usd ?? null,
    volume_24h: bundle.volume?.h24 ?? null,
    price_change_24h: bundle.price?.change24h ?? null,
    pair_url: bundle.primaryPair?.url ?? null,
    source: "dexscreener",
  };
}

export async function fetchMoralisMetadata(mint: string): Promise<any | null> {
  const tokenAddress = normalizeTokenAddress(mint);
  if (!tokenAddress) return null;
  return await getMoralisTokenMetadata(null, tokenAddress);
}

export async function resolveTokenMeta(admin: any, mint: string): Promise<TokenMeta> {
  const tokenAddress = normalizeTokenAddress(mint);
  if (!tokenAddress) {
    return { mint, possible_spam: true };
  }
  const { data: row } = await admin
    .from("token_registry")
    .select("*")
    .eq("chain", "robinhood")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .or(`mint.ilike.${tokenAddress},token_address.ilike.${tokenAddress}`)
    .maybeSingle();
  if (row && row.symbol) {
    return {
      mint: tokenAddress,
      token_address: row.token_address ?? tokenAddress,
      explorer_url: row.explorer_url ?? tokenExplorerUrl(tokenAddress),
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
      logo_url: row.logo_url,
      possible_spam: row.possible_spam,
    };
  }

  const bundle = await getMarketDataBundle(admin, {
    mint: tokenAddress,
    includeDexscreener: true,
    includeMoralis: true,
    includeAnalytics: false,
  });
  const meta: TokenMeta = {
    mint: tokenAddress,
    token_address: bundle.tokenAddress ?? tokenAddress,
    explorer_url: bundle.explorerUrl ?? tokenExplorerUrl(tokenAddress),
    symbol: bundle.symbol ?? undefined,
    name: bundle.name ?? undefined,
    decimals: bundle.metadata?.decimals ?? undefined,
    logo_url: bundle.metadata?.logoUrl ?? undefined,
    possible_spam: bundle.metadata?.possibleSpam ?? false,
  };

  if (meta.symbol || meta.name) {
    await admin.from("token_registry").upsert(
      {
        mint: tokenAddress,
        chain: "robinhood",
        chain_id: ROBINHOOD_CHAIN_ID,
        token_address: tokenAddress,
        explorer_url: meta.explorer_url,
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        logo_url: meta.logo_url,
        possible_spam: meta.possible_spam ?? false,
        source: bundle.sources.join("+") || "market_data",
        raw_metadata: {
          sources: bundle.sources,
          pair: bundle.primaryPair,
          freshness: bundle.freshness,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "mint" },
    );
  }

  return meta;
}

export async function resolveTokenMetas(
  admin: any,
  mints: string[],
): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  const unique = [...new Set(mints.map(normalizeTokenAddress).filter(Boolean) as string[])].slice(
    0,
    25,
  );
  if (unique.length) {
    const { data: rows } = await admin
      .from("token_registry")
      .select("*")
      .eq("chain", "robinhood")
      .eq("chain_id", ROBINHOOD_CHAIN_ID)
      .in("token_address", unique);
    for (const row of rows ?? []) {
      const tokenAddress = row.token_address ?? row.mint;
      out.set(tokenAddress, {
        mint: tokenAddress,
        token_address: tokenAddress,
        explorer_url: row.explorer_url ?? tokenExplorerUrl(tokenAddress),
        symbol: row.symbol,
        name: row.name,
        decimals: row.decimals,
        logo_url: row.logo_url,
        possible_spam: row.possible_spam,
      });
    }
  }
  for (const mint of unique) {
    if (out.get(mint)?.symbol) continue;
    out.set(mint, await resolveTokenMeta(admin, mint));
  }
  return out;
}

function normalizeTokenAddress(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!isEvmAddress(text)) return null;
  return normalizeEvmAddress(text);
}

function tokenExplorerUrl(tokenAddress: string): string {
  return `${ROBINHOOD_EXPLORER_BASE_URL}/token/${normalizeEvmAddress(tokenAddress)}`;
}
