// Deterministic parser for X trade / transfer commands.
// Returns a normalized command or null. Never guesses chain when it is unclear;
// never invents amounts or recipients.

export type TradeChain = "solana" | "robinhood";
export type TradeKind = "buy" | "sell" | "transfer";

export interface XTradeCommand {
  kind: TradeKind;
  chain: TradeChain;
  // For buy: amount of native (SOL or ETH) to spend.
  // For sell: percent of holdings (1..100).
  // For transfer: amount of native to send.
  amount: number;
  // The token the user is buying / selling. Not used for transfer.
  token_address?: string;
  // Native recipient address (transfer only).
  recipient?: string;
}

const AMOUNT = String.raw`(\d+(?:\.\d+)?)`;
// Optional address wrappers: `(...)`, backticks, cashtag $ prefix, trailing punctuation.
const ADDR = String.raw`([A-Za-z0-9]{25,64}|0x[a-fA-F0-9]{40})`;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function stripAddress(value: string): string {
  return value.replace(/^[\s`"'(<$]+|[\s`"')>.,;:!?]+$/g, "");
}

function normalizeAddress(candidate: string): { chain: TradeChain; address: string } | null {
  const cleaned = stripAddress(candidate);
  if (isEvmAddress(cleaned)) {
    return { chain: "robinhood", address: cleaned };
  }
  const mint = normalizeSolanaAddress(cleaned);
  return mint ? { chain: "solana", address: mint } : null;
}

function isEvmAddress(value: string | null | undefined): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? "").trim());
}

function normalizeSolanaAddress(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return null;
  if (/^Mint1+$/.test(text)) return null;
  return base58DecodedLength(text) === 32 ? text : null;
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

function normalizedText(text: string): string {
  // Strip zero-width chars + collapse whitespace; leave case for address parsing.
  return String(text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickChain(explicit: TradeChain | null, addressChain: TradeChain | null): TradeChain | null {
  if (explicit && addressChain && explicit !== addressChain) return null;
  return explicit ?? addressChain;
}

function explicitChainFromUnit(unit: string): TradeChain {
  return /sol/i.test(unit) ? "solana" : "robinhood";
}

// Buy: "buy 0.05 SOL (worth of| of| worth) <addr>" or "buy 0.05 <addr>" (chain inferred).
// Also accepts optional bot handle prefix stripped by caller.
export function parseBuy(text: string): XTradeCommand | null {
  const t = normalizedText(text);
  // With explicit unit
  const withUnit = new RegExp(
    String.raw`\bbuy\s+${AMOUNT}\s*(sol|eth)\b(?:\s+(?:worth\s+of|worth|of|in|into))?\s+${ADDR}\b`,
    "i",
  ).exec(t);
  if (withUnit) {
    const amount = Number(withUnit[1]);
    const unit = withUnit[2];
    const addr = normalizeAddress(withUnit[3]);
    const chain = pickChain(explicitChainFromUnit(unit), addr?.chain ?? null);
    if (!addr || !chain || !Number.isFinite(amount) || amount <= 0) return null;
    return { kind: "buy", chain, amount, token_address: addr.address };
  }
  // Without explicit unit — chain fully inferred from address.
  const bare = new RegExp(
    String.raw`\bbuy\s+${AMOUNT}\s+(?:worth\s+of\s+|of\s+|in\s+|into\s+)?${ADDR}\b`,
    "i",
  ).exec(t);
  if (bare) {
    const amount = Number(bare[1]);
    const addr = normalizeAddress(bare[2]);
    if (!addr || !Number.isFinite(amount) || amount <= 0) return null;
    return { kind: "buy", chain: addr.chain, amount, token_address: addr.address };
  }
  return null;
}

// Sell: "sell 25% of <addr>", "sell all <addr>", "sell 100% <addr>".
export function parseSell(text: string): XTradeCommand | null {
  const t = normalizedText(text);
  // Locate the sell verb, then look for a percent / "all" quantifier and an
  // address anywhere in the trailing text. This tolerates natural phrasings
  // like "sell 100% of what I have in <addr>", "sell all of my <addr>",
  // "sell 50% of my holdings in <addr>", or plain "sell <addr>".
  const sellIdx = t.search(/\bsell\b/i);
  if (sellIdx < 0) return null;
  const rest = t.slice(sellIdx);

  let percent: number | null = null;
  const pctMatch = /(\d{1,3})\s*%/i.exec(rest);
  if (pctMatch) {
    percent = Number(pctMatch[1]);
  } else if (/\ball\b/i.test(rest)) {
    percent = 100;
  }

  // Find the first valid address after the sell verb.
  const addrRe = new RegExp(ADDR, "g");
  let addr: { chain: TradeChain; address: string } | null = null;
  for (const m of rest.matchAll(addrRe)) {
    const cand = normalizeAddress(m[1]);
    if (cand) {
      addr = cand;
      break;
    }
  }
  if (!addr) return null;
  if (percent === null) percent = 100; // "sell <addr>" defaults to 100%
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return { kind: "sell", chain: addr.chain, amount: percent, token_address: addr.address };
}

// Transfer: "send 0.1 SOL to <addr>" / "transfer 0.05 ETH to <addr>".
export function parseTransfer(text: string): XTradeCommand | null {
  const t = normalizedText(text);
  const m = new RegExp(
    String.raw`\b(?:send|transfer)\s+${AMOUNT}\s*(sol|eth)\s+to\s+${ADDR}\b`,
    "i",
  ).exec(t);
  if (!m) return null;
  const amount = Number(m[1]);
  const unit = m[2];
  const addr = normalizeAddress(m[3]);
  const chain = pickChain(explicitChainFromUnit(unit), addr?.chain ?? null);
  if (!addr || !chain || !Number.isFinite(amount) || amount <= 0) return null;
  return { kind: "transfer", chain, amount, recipient: addr.address };
}

// Returns @handle references so we can politely refuse handle-based transfers.
export function containsHandleRecipient(text: string): boolean {
  return /\b(?:send|transfer)\s+\d+(?:\.\d+)?\s*(?:sol|eth)\s+to\s+@\w+/i.test(text);
}

export function parseXTradeCommand(text: string): XTradeCommand | null {
  return parseBuy(text) ?? parseSell(text) ?? parseTransfer(text);
}

export function tradeRouteKind(cmd: XTradeCommand): string {
  return `${cmd.kind}_${cmd.chain}`;
}