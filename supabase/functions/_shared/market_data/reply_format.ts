import { sanitizePublicReply } from "../reply_lint.ts";
import { formatCompactUsd, formatPercent } from "./format.ts";

const SOURCE_NOISE_PATTERNS = [
  /\bfresh data\b/i,
  /\bdata from\b/i,
  /\bsource:\b/i,
  /\bsources:\b/i,
  /\bDEX Screener\b/i,
  /\bMoralis\b/i,
  /\bnot financial advice\b/i,
  /\bBuys\/Sells\b/i,
  /\bno market data\b/i,
  /\bmarket data (?:is )?(?:unavailable|available for it right now)\b/i,
  /\bshare the ticker\b/i,
  /\bup\/down data not provided\b/i,
  /\bnot provided\b/i,
];

export function shouldRepairCoinInquiryReply(
  text: string,
  fallbackText: string | null = null,
): boolean {
  const value = String(text ?? "");
  if (fallbackText && replyNeedsMarketCapRepair(value, fallbackText)) return true;
  return SOURCE_NOISE_PATTERNS.some((pattern) => pattern.test(value));
}

export function buildMarketInfoReply(tokenData: any): string | null {
  if (!tokenData || typeof tokenData !== "object") return null;

  if (Array.isArray(tokenData.items) && tokenData.items.length > 0) {
    const labels = tokenData.items
      .slice(0, 3)
      .map((item: any) => (item.symbol ? `$${item.symbol}` : (item.name ?? shortMint(item.mint))))
      .filter(Boolean);
    if (labels.length > 0) {
      return sanitizePublicReply(
        `I found ${labels.join(", ")}. Pick one and send the contract address for a cleaner read. DYOR.`,
      );
    }
  }

  if (tokenData.resolution || tokenData.disabled) return null;

  const title = buildTokenTitle(tokenData);
  if (!title) return null;

  const price = formatCompactUsd(tokenData.price_usd);
  const change24h = formatPercent(tokenData.price_change_24h);
  const liquidity = formatCompactUsd(tokenData.liquidity_usd);
  const volume24h = formatCompactUsd(tokenData.volume_24h_usd);
  const marketCap = formatCompactUsd(tokenData.market_cap_usd);
  const fdv = formatCompactUsd(tokenData.fdv_usd);
  const flowLine = buildFlowLine(tokenData);

  const priceLine = ["Price: " + (price ?? "n/a"), change24h ? `24h ${change24h}` : null]
    .filter(Boolean)
    .join(" | ");
  const marketLine = [
    marketCap ? `Market cap: ${marketCap}` : fdv ? `FDV: ${fdv}` : null,
    liquidity ? `Liq: ${liquidity}` : null,
    volume24h ? `Vol: ${volume24h}` : null,
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");

  const lines = [
    title,
    priceLine,
    marketLine || "Market data is limited right now.",
    flowLine,
    `Read: ${buildMarketRead(tokenData)} DYOR.`,
  ].filter((line): line is string => Boolean(line));

  return fitReply(lines);
}

function buildTokenTitle(tokenData: any): string | null {
  const symbol = cleanTokenText(tokenData.symbol);
  const name = cleanTokenText(tokenData.name);
  const mint = shortMint(tokenData.mint);
  const pairDex = formatDexName(tokenData.pair?.dex);

  const label = symbol ? `$${symbol}` : name || mint;
  if (!label) return null;

  const namePart =
    name && symbol && name.toLowerCase() !== symbol.toLowerCase() ? ` (${truncate(name, 36)})` : "";
  const dexPart = pairDex ? ` on ${pairDex}` : "";
  return `${label}${namePart}${dexPart}`;
}

function buildMarketRead(tokenData: any): string {
  const change24h = numberOrNull(tokenData.price_change_24h);
  const liquidity = numberOrNull(tokenData.liquidity_usd);
  const volume24h = numberOrNull(tokenData.volume_24h_usd);
  const buys24h = numberOrNull(tokenData.buys_24h);
  const sells24h = numberOrNull(tokenData.sells_24h);

  const reads: string[] = [];
  if (change24h != null) {
    if (change24h >= 25) reads.push("strong momentum");
    else if (change24h >= 5) reads.push("positive momentum");
    else if (change24h <= -25) reads.push("sharp selloff");
    else if (change24h <= -5) reads.push("weak short-term trend");
    else reads.push("mixed trend");
  }

  if (liquidity != null && liquidity < 50_000) {
    reads.push("thin liquidity");
  } else if (volume24h != null && liquidity != null && volume24h > liquidity * 5) {
    reads.push("very active flow");
  } else if (volume24h != null && volume24h >= 1_000_000) {
    reads.push("solid activity");
  } else if (liquidity != null && liquidity >= 1_000_000) {
    reads.push("decent liquidity");
  }

  if (buys24h != null && sells24h != null && buys24h + sells24h >= 100) {
    if (buys24h > sells24h * 1.2) reads.push("buyer skew");
    else if (sells24h > buys24h * 1.2) reads.push("seller skew");
    else reads.push("balanced buys/sells");
  }

  if (reads.length === 0) return "limited public market signal";
  const unique = [...new Set(reads)].slice(0, 2);
  const caution = unique.some((item) => item.includes("strong") || item.includes("active"))
    ? ", but chasing strength is risky"
    : "";
  return unique.join(" with ") + caution + ".";
}

function fitReply(lines: string[]): string {
  let reply = sanitizePublicReply(lines.join("\n"));
  if (reply.length <= 260) return reply;

  const title = lines[0];
  const priceLine = lines[1];
  const marketLine = lines[2];
  const flowLine = lines.length > 4 ? lines[3] : null;
  const readLine = lines[lines.length - 1];

  reply = sanitizePublicReply(
    [truncate(title, 52), priceLine, marketLine, flowLine, readLine].filter(Boolean).join("\n"),
  );
  if (reply.length <= 260) return reply;

  reply = sanitizePublicReply([truncate(title, 52), priceLine, marketLine, readLine].join("\n"));
  if (reply.length <= 260) return reply;

  return sanitizePublicReply([truncate(title, 48), priceLine, marketLine].join("\n"));
}

function replyNeedsMarketCapRepair(text: string, fallbackText: string): boolean {
  if (!/\bMarket cap\s*:/i.test(fallbackText)) return false;
  return !/\b(?:market\s*cap|mcap|mc)\b/i.test(text);
}

function buildFlowLine(tokenData: any): string | null {
  const buys24h = numberOrNull(tokenData.buys_24h);
  const sells24h = numberOrNull(tokenData.sells_24h);
  const txns24h = numberOrNull(tokenData.txns_24h);

  if (buys24h != null && sells24h != null) {
    return `24h flow: ${formatCompactCount(buys24h)} buys / ${formatCompactCount(sells24h)} sells`;
  }
  if (txns24h != null) return `24h flow: ${formatCompactCount(txns24h)} txns`;
  return null;
}

function cleanTokenText(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function formatDexName(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (normalized === "blockscout") return null;
  return normalized
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shortMint(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length <= 12) return text;
  return text.slice(0, 4) + "..." + text.slice(-4);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function formatCompactCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}K`;
  return trim(value);
}

function trim(value: number): string {
  return Number(value.toFixed(2)).toString();
}
