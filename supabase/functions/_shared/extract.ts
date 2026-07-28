// Deterministic helpers used by both the listener and the processor.

import { normalizeSolanaAddress } from "./market_data/chains.ts";

export const EVM_ADDRESS_REGEX = /\b0x[a-fA-F0-9]{40}\b/g;
export const SOLANA_ADDRESS_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
export const DEXSCREENER_REGEX =
  /https?:\/\/(?:www\.)?dexscreener\.com\/[^/\s]+\/(0x[a-fA-F0-9]{40})/gi;
export const BLOCKSCOUT_REGEX =
  /https?:\/\/robinhoodchain\.blockscout\.com\/(?:token|address)\/(0x[a-fA-F0-9]{40})/gi;
export const TICKER_REGEX = /(?:^|\s)\$([A-Z][A-Z0-9]{1,9})\b/g;
export const URL_REGEX = /\bhttps?:\/\/[^\s]+/g;

export interface ExtractionResult {
  mints: string[];
  symbols: string[];
  urls: string[];
}

export function extractFromText(text: string): ExtractionResult {
  const out: ExtractionResult = { mints: [], symbols: [], urls: [] };
  if (!text) return out;

  const candidateAddresses = new Set<string>();
  for (const match of text.matchAll(EVM_ADDRESS_REGEX)) candidateAddresses.add(match[0]);
  for (const match of text.matchAll(SOLANA_ADDRESS_REGEX)) {
    const address = normalizeSolanaAddress(match[0]);
    if (address) candidateAddresses.add(address);
  }
  for (const match of text.matchAll(DEXSCREENER_REGEX)) candidateAddresses.add(match[1]);
  for (const match of text.matchAll(BLOCKSCOUT_REGEX)) candidateAddresses.add(match[1]);
  out.mints = [...candidateAddresses];

  const symbols = new Set<string>();
  for (const match of text.matchAll(TICKER_REGEX)) symbols.add(match[1]);
  out.symbols = [...symbols];

  const urls = new Set<string>();
  for (const match of text.matchAll(URL_REGEX)) urls.add(match[0]);
  out.urls = [...urls];

  return out;
}

export interface AmountParse {
  amount_original: number | null;
  amount_original_unit: "eth" | "sol" | "usd" | "token" | "percent" | "all" | null;
}

export function parseAmount(text: string): AmountParse {
  const t = text.toLowerCase();
  if (/\ball\b|\bdump\s+all\b/.test(t))
    return { amount_original: null, amount_original_unit: "all" };
  if (/\bhalf\b/.test(t)) return { amount_original: 50, amount_original_unit: "percent" };

  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { amount_original: Number(pct[1]), amount_original_unit: "percent" };

  const usd = t.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:usd|usdc|dollars?)/);
  if (usd) return { amount_original: Number(usd[1] ?? usd[2]), amount_original_unit: "usd" };

  const eth = t.match(/(\d+(?:\.\d+)?)\s*eth\b/);
  if (eth) return { amount_original: Number(eth[1]), amount_original_unit: "eth" };

  const sol = t.match(/(\d+(?:\.\d+)?)\s*sol\b/);
  if (sol) return { amount_original: Number(sol[1]), amount_original_unit: "sol" };

  return { amount_original: null, amount_original_unit: null };
}
