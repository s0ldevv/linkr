export interface ReplyLintResult {
  ok: boolean;
  blocked_phrases: string[];
  reason: string | null;
}

const FORBIDDEN_PHRASES = [
  "thread context",
  "token data",
  "provided context",
  "provided data",
  "internal system",
  "internal systems",
  "classification",
  "extraction",
  "prompt",
  "database",
  "api key",
  "tool",
  "retrieved history",
  "no token data",
  "token data is unavailable",
  "i can't identify any token",
  "i cannot identify any token",
  "the context is",
  "the thread is",
];

const TOKEN_MISSING_PATTERNS = [
  /\bno token\b/i,
  /\bmissing token\b/i,
  /\btoken data\b/i,
  /\bcan't identify (a |any |the )?token\b/i,
  /\bcannot identify (a |any |the )?token\b/i,
];

const DEFERRED_ACTION_PATTERNS = [
  /\bi['\u2019]?ll check\b/i,
  /\bi will check\b/i,
  /\blet me check\b/i,
  /\bi['\u2019]?ll look\b/i,
  /\bi will look\b/i,
  /\bchecking (it|this|now)\b/i,
  /\bget back to you\b/i,
];

const COIN_SOURCE_NOISE_PATTERNS = [
  /\bfresh data\b/i,
  /\bdata from\b/i,
  /\bsource:\b/i,
  /\bsources:\b/i,
  /\bDEX Screener\b/i,
  /\bMoralis\b/i,
  /\bnot financial advice\b/i,
  /\bBuys\/Sells\b/i,
];

const COIN_LEGACY_CHAIN_PATTERNS = [
  /\bSolana\b/i,
  /\bSOL\b/i,
  /\bSolscan\b/i,
  /\bSPL\b/,
  /\bJupiter\b/i,
  /\bpump\.fun\b/i,
  /\bPump\b/i,
  /\bRaydium\b/i,
  /\bMeteora\b/i,
  /\bOrca\b/i,
];

export function sanitizePublicReply(text: string): string {
  const cleaned = String(text ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.[^\s]+/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= 260) return cleaned;

  const truncated = cleaned.slice(0, 260);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace >= 180) return truncated.slice(0, lastSpace).trim() + "...";
  return truncated.slice(0, 257).trim() + "...";
}

export function lintPublicReply(text: string, mode: string): ReplyLintResult {
  const lower = String(text ?? "").toLowerCase();
  const blocked = FORBIDDEN_PHRASES.filter((phrase) => lower.includes(phrase));

  if (mode !== "coin_inquiry") {
    for (const pattern of TOKEN_MISSING_PATTERNS) {
      if (pattern.test(text)) {
        if (!blocked.includes("token-missing-language")) blocked.push("token-missing-language");
      }
    }
  }

  for (const pattern of DEFERRED_ACTION_PATTERNS) {
    if (pattern.test(text)) {
      if (!blocked.includes("deferred-action-language")) {
        blocked.push("deferred-action-language");
      }
    }
  }

  if (mode === "coin_inquiry") {
    for (const pattern of COIN_SOURCE_NOISE_PATTERNS) {
      if (pattern.test(text)) {
        if (!blocked.includes("coin-source-noise")) blocked.push("coin-source-noise");
      }
    }
    for (const pattern of COIN_LEGACY_CHAIN_PATTERNS) {
      if (pattern.test(text)) {
        if (!blocked.includes("legacy-chain-language")) blocked.push("legacy-chain-language");
      }
    }
  }

  return {
    ok: blocked.length === 0,
    blocked_phrases: blocked,
    reason:
      blocked.length > 0 ? "public reply contains internal or mode-inappropriate language" : null,
  };
}
