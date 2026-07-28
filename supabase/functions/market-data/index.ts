// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  buildPublicDiscoveryFacts,
  buildPublicMarketFacts,
  getBlockscoutTrendingTokens,
  getDexscreenerBoostedTokens,
  getDexscreenerTrendingMetas,
  getMarketDataBundle,
  getMoralisTrendingTokens,
  searchMarketTokens,
} from "../_shared/market_data/index.ts";
import type { MarketChain, MarketSortBy } from "../_shared/market_data/types.ts";
import { inferMarketChainFromText, normalizeMarketAddress } from "../_shared/market_data/chains.ts";
import { internalErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });

  const admin = serviceClient();
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    if (
      path.endsWith("/token") ||
      url.searchParams.has("token_address") ||
      url.searchParams.has("mint")
    ) {
      const rawTokenAddress =
        url.searchParams.get("token_address")?.trim() ?? url.searchParams.get("mint")?.trim();
      if (!rawTokenAddress)
        return jsonResponse({ error: "missing_token_address" }, { status: 400 });
      const normalized = normalizeMarketAddress(rawTokenAddress);
      if (!normalized) {
        return jsonResponse({ error: "invalid_token_address" }, { status: 400 });
      }
      const bundle = await getMarketDataBundle(admin, {
        mint: normalized.address,
        chain: normalized.chain,
        includeBlockscout: normalized.chain === "robinhood",
        includeDexscreener: true,
        includeMoralis: normalized.chain === "robinhood",
        includeAnalytics: url.searchParams.get("analytics") !== "false",
      });
      return jsonResponse(buildPublicMarketFacts(bundle));
    }

    if (path.endsWith("/search") || url.searchParams.has("q")) {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return jsonResponse({ error: "missing_query" }, { status: 400 });
      const items = await searchMarketTokens(admin, {
        query,
        limit: numberParam(url, "limit", 10),
        sortBy: sortByParam(url.searchParams.get("sortBy") ?? url.searchParams.get("sort_by")),
        chain: chainParam(url),
      });
      return jsonResponse(buildPublicDiscoveryFacts(items));
    }

    if (path.endsWith("/boosted")) {
      const kind = url.searchParams.get("kind") === "latest" ? "latest" : "top";
      const items = await getDexscreenerBoostedTokens(admin, kind, chainParam(url));
      return jsonResponse(buildPublicDiscoveryFacts(items));
    }

    if (path.endsWith("/trending")) {
      const source = url.searchParams.get("source") ?? "merged";
      const chain = chainParam(url);
      const limit = numberParam(url, "limit", 10);
      const sortBy = sortByParam(url.searchParams.get("sortBy") ?? url.searchParams.get("sort_by"));
      const items =
        source === "blockscout"
          ? chain === "robinhood"
            ? await getBlockscoutTrendingTokens(admin, {
                limit,
                sortBy,
                listKind: "trending_tokens",
              })
            : []
          : source === "dexscreener"
            ? await getDexscreenerTrendingMetas(admin)
            : source === "moralis"
              ? await getMoralisTrendingTokens(admin, {
                  limit,
                  sortBy,
                })
              : [
                  ...(chain === "robinhood"
                    ? await getBlockscoutTrendingTokens(admin, {
                        limit: Math.min(5, limit),
                        sortBy,
                        listKind: "trending_tokens",
                      })
                    : []),
                  ...(chain === "robinhood"
                    ? await getMoralisTrendingTokens(admin, {
                        limit: Math.min(5, limit),
                        sortBy,
                      })
                    : []),
                  ...(chain === "solana"
                    ? await searchMarketTokens(admin, {
                        query: "solana",
                        limit: Math.min(8, limit),
                        sortBy,
                        chain,
                      })
                    : await getDexscreenerTrendingMetas(admin)),
                ];
      return jsonResponse(
        buildPublicDiscoveryFacts(
          items.slice(0, limit),
          source === "moralis" && items.length === 0 ? ["moralis_unavailable"] : [],
        ),
      );
    }

    return jsonResponse({
      routes: [
        "/market-data/token?token_address=<0x...|solana-mint>",
        "/market-data/token?mint=<0x...|solana-mint>",
        "/market-data/search?q=<query>",
        "/market-data/trending?chain=robinhood|solana&source=blockscout|dexscreener|moralis|merged",
        "/market-data/boosted?chain=robinhood|solana&kind=latest|top",
      ],
    });
  } catch (error) {
    return internalErrorResponse(error, { function: "market-data" });
  }
});

function numberParam(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(25, Math.floor(value));
}

function chainParam(url: URL): MarketChain {
  const explicit = inferMarketChainFromText(url.searchParams.get("chain"));
  return explicit ?? "robinhood";
}

function sortByParam(value: string | null): MarketSortBy {
  if (value === "volume1hDesc") return "volume1hDesc";
  if (value === "liquidityDesc") return "liquidityDesc";
  if (value === "marketCapDesc") return "marketCapDesc";
  return "volume24hDesc";
}
