import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_BASE_URL,
  isEvmAddress,
  normalizeEvmAddress,
} from "../robinhood_chain.ts";
import type { MarketChain } from "./types.ts";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SOLANA_ADDRESS_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

export const SOLANA_EXPLORER_BASE_URL = "https://solscan.io/token";

export type NormalizedMarketAddress = {
  chain: MarketChain;
  address: string;
};

export function chainLabel(chain: MarketChain): string {
  return chain === "solana" ? "Solana" : "Robinhood Chain";
}

export function chainIdFor(chain: MarketChain): number | null {
  return chain === "robinhood" ? ROBINHOOD_CHAIN_ID : null;
}

export function defaultDexscreenerChainSlug(chain: MarketChain): string {
  return chain === "solana" ? "solana" : "robinhood";
}

export function tokenExplorerUrl(chain: MarketChain, address: string): string | null {
  if (chain === "robinhood")
    return `${ROBINHOOD_EXPLORER_BASE_URL}/token/${normalizeEvmAddress(address)}`;
  const mint = normalizeSolanaAddress(address);
  return mint ? `${SOLANA_EXPLORER_BASE_URL}/${mint}` : null;
}

export function normalizeMarketAddress(value: unknown): NormalizedMarketAddress | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (isEvmAddress(text)) {
    return { chain: "robinhood", address: normalizeEvmAddress(text) };
  }
  const solana = normalizeSolanaAddress(text);
  return solana ? { chain: "solana", address: solana } : null;
}

export function normalizeMarketAddressForChain(
  value: unknown,
  chain: MarketChain,
): NormalizedMarketAddress | null {
  const normalized = normalizeMarketAddress(value);
  return normalized?.chain === chain ? normalized : null;
}

export function isSolanaAddress(value: unknown): boolean {
  return !!normalizeSolanaAddress(value);
}

export function normalizeSolanaAddress(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return null;
  // Reject the common prose/test placeholder while preserving all structurally
  // valid real public keys (including keys that happen to begin with "Mint").
  if (/^Mint1+$/.test(text)) return null;
  return base58DecodedLength(text) === 32 ? text : null;
}

export function extractMarketAddresses(text: string): NormalizedMarketAddress[] {
  const seen = new Set<string>();
  const addresses: NormalizedMarketAddress[] = [];
  const push = (candidate: NormalizedMarketAddress | null) => {
    if (!candidate) return;
    const key = `${candidate.chain}:${candidate.address.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    addresses.push(candidate);
  };

  for (const match of String(text ?? "").matchAll(/\b0x[a-fA-F0-9]{40}\b/g)) {
    push(normalizeMarketAddress(match[0]));
  }
  for (const match of String(text ?? "").matchAll(SOLANA_ADDRESS_REGEX)) {
    push(normalizeMarketAddress(match[0]));
  }
  return addresses;
}

export function inferMarketChainFromText(text: unknown): MarketChain | null {
  const value = String(text ?? "").toLowerCase();
  if (/\b(sol|solana|pump\.fun|pumpfun|birdeye|raydium|jupiter)\b/.test(value)) return "solana";
  if (/\b(robinhood|rhood|blockscout|evm|eth|weth)\b/.test(value)) return "robinhood";
  return null;
}

function base58DecodedLength(value: string): number | null {
  const bytes: number[] = [0];
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    let carry = digit;
    for (let i = 0; i < bytes.length; i++) {
      const next = bytes[i] * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return bytes.length;
}
