// deno-lint-ignore-file no-explicit-any

import { extractFromText } from "../extract.ts";
import type { MarketChain, TokenCandidate } from "./types.ts";
import { ROBINHOOD_CHAIN_ID } from "../robinhood_chain.ts";
import { searchBlockscoutTokens } from "./blockscout.ts";
import { getDexSearchDiscovery } from "./dexscreener.ts";
import { searchMoralisTokens } from "./moralis.ts";
import {
  extractMarketAddresses,
  inferMarketChainFromText,
  normalizeMarketAddress,
} from "./chains.ts";

export type MarketTokenResolution =
  | { ok: true; mint: string; chain: MarketChain; reason: string; candidates?: never }
  | { ok: false; reason: "ambiguous" | "not_found"; candidates: TokenCandidate[] };

export async function resolveMarketToken(
  admin: any,
  args: {
    text: string;
    thread: any;
    extraction: any;
  },
): Promise<MarketTokenResolution> {
  const extraction = args.extraction ?? {};
  const textDeterministic = extractFromText(args.text ?? "");
  const chainHint = inferChainHint(args.text, args.thread, extraction);
  const exactMint =
    normalizeCandidateAddress(extraction.token_address) ??
    normalizeCandidateAddress(extraction.token_mint) ??
    singleAddressString(extraction.token_candidates, chainHint);

  const textAddresses = extractMarketAddresses(args.text ?? "").filter((item) =>
    chainHint ? item.chain === chainHint : true,
  );
  if (textAddresses.length === 1) {
    return {
      ok: true,
      mint: textAddresses[0].address,
      chain: textAddresses[0].chain,
      reason: "text_mint",
    };
  }
  if (textAddresses.length > 1) {
    if (exactMint && textAddresses.some((item) => sameCandidate(item, exactMint))) {
      return resolvedCandidate(exactMint, "exact_text_mint");
    }
    return {
      ok: false,
      reason: "ambiguous",
      candidates: textAddresses
        .slice(0, 5)
        .map((item) => ({ mint: item.address, chain: item.chain, source: "text" })),
    };
  }

  if (exactMint) return resolvedCandidate(exactMint, "exact_mint");

  const threadMint = singleAddressString(args.thread?.detected_mints, chainHint);
  if (threadMint) return resolvedCandidate(threadMint, "thread_mint");
  if (Array.isArray(args.thread?.detected_mints) && args.thread.detected_mints.length > 1) {
    const candidates = args.thread.detected_mints
      .map((mint: string) => normalizeCandidateAddress(mint))
      .filter((item: NormalizedCandidate | null): item is NormalizedCandidate =>
        Boolean(item && (!chainHint || item.chain === chainHint)),
      );
    if (candidates.length === 1) return resolvedCandidate(candidates[0], "thread_mint");
    return {
      ok: false,
      reason: "ambiguous",
      candidates: candidates.slice(0, 5).map((item: NormalizedCandidate) => ({
        mint: item.address,
        chain: item.chain,
        source: "thread",
      })),
    };
  }

  const deterministic = extractFromText(
    [args.text, args.thread?.flattened_context, ...(args.thread?.detected_urls ?? [])]
      .filter(Boolean)
      .join("\n"),
  );
  const deterministicAddresses = extractMarketAddresses(
    [args.text, args.thread?.flattened_context, ...(args.thread?.detected_urls ?? [])]
      .filter(Boolean)
      .join("\n"),
  ).filter((item) => (chainHint ? item.chain === chainHint : true));
  if (deterministicAddresses.length === 1) {
    return {
      ok: true,
      mint: deterministicAddresses[0].address,
      chain: deterministicAddresses[0].chain,
      reason: "deterministic_extract",
    };
  }
  if (deterministicAddresses.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates: deterministicAddresses
        .slice(0, 5)
        .map((item) => ({ mint: item.address, chain: item.chain, source: "text" })),
    };
  }

  const symbol = stringOrNull(extraction.token_symbol) ?? singleString(deterministic.symbols);
  const name = stringOrNull(extraction.token_name);
  const query = symbol ?? name;
  if (!query) return { ok: false, reason: "not_found", candidates: [] };

  const registryCandidates = await searchRegistry(admin, query, chainHint);
  if (registryCandidates.length === 1) {
    return {
      ok: true,
      mint: registryCandidates[0].mint,
      chain: registryCandidates[0].chain ?? "robinhood",
      reason: "registry",
    };
  }
  if (registryCandidates.length > 1) {
    return { ok: false, reason: "ambiguous", candidates: registryCandidates.slice(0, 5) };
  }

  const aliasCandidates = await searchAliases(admin, query, chainHint);
  if (aliasCandidates.length === 1) {
    return {
      ok: true,
      mint: aliasCandidates[0].mint,
      chain: aliasCandidates[0].chain ?? "robinhood",
      reason: "alias",
    };
  }
  if (aliasCandidates.length > 1) {
    return { ok: false, reason: "ambiguous", candidates: aliasCandidates.slice(0, 5) };
  }

  const blockscout =
    chainHint === "solana"
      ? []
      : await searchBlockscoutTokens(admin, {
          query,
          limit: 5,
          sortBy: "liquidityDesc",
        });
  const blockscoutCandidates = blockscout
    .map((item) => ({
      ...candidateFields(item.tokenAddress ?? item.mint),
      symbol: stringOrNull(item.symbol),
      name: stringOrNull(item.name),
      source: "blockscout",
    }))
    .filter((candidate) => candidate.mint);
  if (blockscoutCandidates.length === 1) {
    await upsertAlias(admin, query, blockscoutCandidates[0]);
    return {
      ok: true,
      mint: blockscoutCandidates[0].mint,
      chain: blockscoutCandidates[0].chain ?? "robinhood",
      reason: "blockscout_search",
    };
  }
  if (blockscoutCandidates.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates: blockscoutCandidates.slice(0, 5),
    };
  }

  const moralis = await searchMoralisTokens(admin, {
    query,
    limit: 5,
    sortBy: "liquidityDesc",
  });
  const moralisCandidates = moralis
    .map((token: any) => ({
      ...candidateFields(token?.tokenAddress ?? token?.address ?? token?.mint),
      symbol: stringOrNull(token?.symbol),
      name: stringOrNull(token?.name),
      source: "moralis",
    }))
    .filter((candidate) => candidate.mint);
  if (moralisCandidates.length === 1) {
    await upsertAlias(admin, query, moralisCandidates[0]);
    return {
      ok: true,
      mint: moralisCandidates[0].mint,
      chain: moralisCandidates[0].chain ?? "robinhood",
      reason: "moralis_search",
    };
  }
  if (moralisCandidates.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates: moralisCandidates.slice(0, 5),
    };
  }

  const dexChains: MarketChain[] = chainHint ? [chainHint] : ["robinhood", "solana"];
  const dex = (
    await Promise.all(
      dexChains.map((chain) => getDexSearchDiscovery(admin, `${query} ${chain}`, "search", chain)),
    )
  ).flat();
  const dexCandidates = dex
    .map((item) => ({
      ...candidateFields(item.tokenAddress ?? item.mint),
      symbol: item.symbol ?? null,
      name: item.name ?? null,
      source: "dexscreener",
    }))
    .filter((candidate) => candidate.mint);
  if (dexCandidates.length === 1) {
    await upsertAlias(admin, query, dexCandidates[0]);
    return {
      ok: true,
      mint: dexCandidates[0].mint,
      chain: dexCandidates[0].chain ?? "robinhood",
      reason: "dexscreener_search",
    };
  }
  if (dexCandidates.length > 1) {
    return { ok: false, reason: "ambiguous", candidates: dexCandidates.slice(0, 5) };
  }

  return { ok: false, reason: "not_found", candidates: [] };
}

type NormalizedCandidate = { address: string; chain: MarketChain };

async function searchRegistry(
  admin: any,
  query: string,
  chainHint: MarketChain | null,
): Promise<TokenCandidate[]> {
  if (!admin) return [];
  const normalized = query.replace(/^\$/, "").trim();
  if (!normalized) return [];
  let db = admin
    .from("token_registry")
    .select("mint,token_address,symbol,name,chain,chain_id")
    .or(`symbol.ilike.${escapeLike(normalized)},name.ilike.${escapeLike(normalized)}`);
  if (chainHint) db = db.eq("chain", chainHint);
  else db = db.in("chain", ["robinhood", "solana"]);
  if (chainHint === "robinhood") db = db.eq("chain_id", ROBINHOOD_CHAIN_ID);
  const { data } = await db.limit(5);
  return (data ?? [])
    .map((row: any) => ({
      ...candidateFields(row.token_address ?? row.mint),
      symbol: row.symbol ?? null,
      name: row.name ?? null,
      source: "token_registry",
    }))
    .filter((candidate: TokenCandidate) => candidate.mint);
}

async function searchAliases(
  admin: any,
  query: string,
  chainHint: MarketChain | null,
): Promise<TokenCandidate[]> {
  if (!admin) return [];
  const normalized = query.replace(/^\$/, "").trim();
  if (!normalized) return [];
  let db = admin
    .from("token_resolution_aliases")
    .select("mint,symbol,name,source,chain")
    .or(`symbol.ilike.${escapeLike(normalized)},name.ilike.${escapeLike(normalized)}`);
  if (chainHint) db = db.eq("chain", chainHint);
  else db = db.in("chain", ["robinhood", "solana"]);
  const { data } = await db.order("confidence", { ascending: false }).limit(5);
  return (data ?? [])
    .map((row: any) => ({
      ...candidateFields(row.mint),
      symbol: row.symbol ?? null,
      name: row.name ?? null,
      source: row.source ?? "alias",
    }))
    .filter((candidate: TokenCandidate) => candidate.mint);
}

async function upsertAlias(admin: any, query: string, candidate: TokenCandidate) {
  const normalized = normalizeCandidateAddress(candidate.mint);
  const mint = normalized?.address;
  if (!admin || !mint) return;
  try {
    await admin.from("token_resolution_aliases").upsert({
      chain: normalized.chain,
      symbol: candidate.symbol ?? query.replace(/^\$/, "").toUpperCase(),
      name: candidate.name ?? null,
      mint,
      source: candidate.source,
      confidence: 0.8,
      raw_json: {},
      updated_at: new Date().toISOString(),
    });
  } catch (_) {
    // Alias writes are best-effort.
  }
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function singleString(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  return stringOrNull(value[0]);
}

function singleAddressString(
  value: unknown,
  chainHint: MarketChain | null,
): NormalizedCandidate | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const candidate = normalizeCandidateAddress(value[0]);
  if (!candidate || (chainHint && candidate.chain !== chainHint)) return null;
  return candidate;
}

function normalizeCandidateAddress(value: unknown): NormalizedCandidate | null {
  const normalized = normalizeMarketAddress(value);
  return normalized ? { address: normalized.address, chain: normalized.chain } : null;
}

function candidateFields(value: unknown): Pick<TokenCandidate, "mint" | "chain"> {
  const normalized = normalizeCandidateAddress(value);
  return {
    mint: normalized?.address ?? "",
    chain: normalized?.chain,
  };
}

function sameCandidate(left: NormalizedCandidate, right: NormalizedCandidate): boolean {
  return left.chain === right.chain && left.address.toLowerCase() === right.address.toLowerCase();
}

function resolvedCandidate(
  candidate: NormalizedCandidate,
  reason: string,
): Extract<MarketTokenResolution, { ok: true }> {
  return { ok: true, mint: candidate.address, chain: candidate.chain, reason };
}

function inferChainHint(text: string, thread: any, extraction: any): MarketChain | null {
  return (
    normalizeMarketAddress(extraction?.token_address)?.chain ??
    normalizeMarketAddress(extraction?.token_mint)?.chain ??
    inferMarketChainFromText(text) ??
    inferMarketChainFromText(thread?.flattened_context) ??
    null
  );
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, "");
}
