import type { LinkrToolResult } from "./linkr_types.ts";

type MarketChain = "robinhood" | "solana";
const ALLOWED_CHAINS = new Set(["solana", "robinhood"]);
const DEX_BASE = "https://api.dexscreener.com";

export async function resolveCashtag(args: {
  admin: any;
  cashtag: string;
  chains?: MarketChain[];
}): Promise<LinkrToolResult<{ candidates: Array<Record<string, unknown>>; needs_disambiguation: boolean }>> {
  const symbol = String(args.cashtag ?? "").replace(/^\$/, "").toUpperCase();
  if (!symbol) return result(false, [], false, "No cashtag supplied");
  const pairs = await searchDexPairsDirect(symbol);
  const requested = new Set((args.chains ?? ["robinhood", "solana"]).map(String));
  const candidates = pairs
    .filter((pair) => {
      const chain = normalizeDexChain(pair?.chainId);
      return chain && requested.has(chain) && ALLOWED_CHAINS.has(chain);
    })
    .filter((pair) => String(pair?.baseToken?.symbol ?? "").toUpperCase() === symbol)
    .map((pair) => ({
      chain: normalizeDexChain(pair?.chainId),
      symbol,
      name: pair?.baseToken?.name ?? null,
      token_address: pair?.baseToken?.address ?? null,
      pair_address: pair?.pairAddress ?? null,
      liquidity_usd: Number(pair?.liquidity?.usd ?? 0),
      volume_24h_usd: Number(pair?.volume?.h24 ?? 0),
      market_cap_usd: Number(pair?.marketCap ?? pair?.fdv ?? 0),
    }))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 5);
  const needs = candidates.length > 1 && score(candidates[0]) < score(candidates[1]) * 3;
  return result(true, candidates, needs, needs ? "Multiple credible cashtag matches" : "Cashtag resolved");
}

async function searchDexPairsDirect(query: string): Promise<any[]> {
  const response = await fetch(`${DEX_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return [];
  const json = await response.json();
  return Array.isArray(json?.pairs) ? json.pairs : [];
}

function normalizeDexChain(chainId: unknown): MarketChain | null {
  const chain = String(chainId ?? "").toLowerCase();
  if (chain === "solana") return "solana";
  if (chain === "robinhood" || chain === "robinhoodchain") return "robinhood";
  return null;
}

function score(candidate: Record<string, unknown>): number {
  return Number(candidate.liquidity_usd ?? 0) * 2 + Number(candidate.volume_24h_usd ?? 0) + Number(candidate.market_cap_usd ?? 0) * 0.1;
}

function result(
  ok: boolean,
  candidates: Array<Record<string, unknown>>,
  needs_disambiguation: boolean,
  summary: string,
): LinkrToolResult<{ candidates: Array<Record<string, unknown>>; needs_disambiguation: boolean }> {
  return {
    tool: "cashtag.resolve",
    ok,
    facts: { candidates, needs_disambiguation },
    summary,
    freshness: "live",
    confidence: candidates.length ? 0.8 : 0.1,
    privacy: "external_untrusted",
    redactions: [],
    answerable: ok && candidates.length > 0,
  };
}
