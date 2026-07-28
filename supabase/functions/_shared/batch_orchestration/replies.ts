import { sanitizePublicReply } from "../reply_lint.ts";
import { formatCompactUsd, formatPercent } from "../market_data/format.ts";
import type { LaunchBatchItem, MultiCoinInquiryData } from "./types.ts";

const MAX_REPLY_LENGTH = 260;

export function buildMultiMarketInfoReply(data: MultiCoinInquiryData): string | null {
  if (!data?.batch || !Array.isArray(data.items) || data.items.length === 0) return null;

  const lines = data.items.map((item) =>
    formatMarketItem(item.facts, item.target.chain, item.error),
  );
  const header =
    data.overflow_count > 0
      ? `Checked first ${data.items.length}; ${data.overflow_count} more not shown:`
      : `Checked ${data.items.length} tokens:`;
  const read = data.items.some((item) => item.error)
    ? "Some data was limited. DYOR."
    : "Mixed-chain read. DYOR.";

  return fitReply([header, ...lines, read]);
}

export function confirmBatchLaunchReply(items: LaunchBatchItem[]): string {
  const lines = [
    `I found ${items.length} launches:`,
    "",
    ...items.map((item, index) => {
      const platform = item.chain === "solana" ? "Pump.fun on Solana" : "Robinhood Chain";
      const dev =
        item.chain === "solana"
          ? `${formatFixed(item.dev_buy_sol ?? 0)} SOL`
          : `${formatFixed(item.dev_buy_eth ?? 0)} ETH`;
      return `${index + 1}. $${item.symbol} - ${item.name} | ${platform} | dev ${dev}`;
    }),
    "",
    'Reply "confirm launch" within 15 minutes to deploy all. No TX created yet.',
  ];
  return fitReply(lines);
}

export function batchLaunchQueuedReply(args: {
  queued: Array<{ chain: "robinhood" | "solana"; symbol?: string | null }>;
  failed?: Array<{ chain: "robinhood" | "solana"; error: string }>;
}): string {
  const queued = args.queued ?? [];
  const failed = args.failed ?? [];
  if (queued.length > 0 && failed.length === 0) {
    return fitReply([
      `${queued.length} launches queued.`,
      chainSummary(queued.map((item) => item.chain)),
      "I will reply with TXs once they confirm.",
    ]);
  }
  if (queued.length > 0) {
    return fitReply([
      `${queued.length} launch queued; ${failed.length} failed.`,
      `${chainSummary(queued.map((item) => item.chain))} queued.`,
      `${chainSummary(failed.map((item) => item.chain))} not queued. No TX created for failed items.`,
    ]);
  }
  return fitReply(["No batch launches were queued.", "No TX was created."]);
}

function formatMarketItem(
  facts: Record<string, unknown> | null,
  chain: string,
  error: string | null,
) {
  const chainText = chain === "solana" ? "S" : "RH";
  if (!facts || error) return `${chainText}: market data limited`;
  const symbol = clean(facts.symbol)
    ? `$${clean(facts.symbol)}`
    : shortAddress(facts.token_address ?? facts.mint);
  const price = formatCompactUsd(numberOrNull(facts.price_usd));
  const change = formatPercent(numberOrNull(facts.price_change_24h));
  const market =
    formatCompactUsd(numberOrNull(facts.market_cap_usd)) ??
    formatCompactUsd(numberOrNull(facts.fdv_usd)) ??
    formatCompactUsd(numberOrNull(facts.liquidity_usd));
  const marketLabel = facts.market_cap_usd != null ? "MC" : facts.fdv_usd != null ? "FDV" : "Liq";
  return [
    symbol,
    chainText + ":",
    price,
    change ? `24h ${change}` : null,
    market ? `${marketLabel} ${market}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function fitReply(lines: string[]): string {
  let text = sanitizePublicReply(lines.filter(Boolean).join("\n"));
  if (text.length <= MAX_REPLY_LENGTH) return text;
  text = sanitizePublicReply(lines.filter(Boolean).slice(0, -1).join("\n"));
  if (text.length <= MAX_REPLY_LENGTH) return text;
  const compact = lines
    .filter(Boolean)
    .map((line, index) => (index === 0 ? line : truncate(line, 52)))
    .join("\n");
  text = sanitizePublicReply(compact);
  if (text.length <= MAX_REPLY_LENGTH) return text;
  return sanitizePublicReply(truncate(text.replace(/\s+/g, " "), MAX_REPLY_LENGTH));
}

function chainSummary(chains: Array<"robinhood" | "solana">): string {
  const unique = [...new Set(chains)];
  if (unique.length === 2) return "Robinhood Chain + Solana";
  if (unique[0] === "solana") return "Solana";
  return "Robinhood Chain";
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function shortAddress(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "Token";
  if (text.length <= 12) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function formatFixed(value: unknown): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0.0000";
  return number.toFixed(4);
}
