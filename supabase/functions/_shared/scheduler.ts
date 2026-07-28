// deno-lint-ignore-file no-explicit-any

import type { MarketDataBundle } from "./market_data/types.ts";

export type ScheduledActionType =
  | "buy"
  | "sell"
  | "transfer"
  | "launch_coin"
  | "claim_creator_rewards"
  | "add_liquidity"
  | "remove_liquidity"
  | "collect_liquidity_fees";
export type ScheduleKind =
  | "one_time"
  | "condition"
  | "interval"
  | "daily"
  | "weekly";
export type SchedulerTrigger =
  | {
    trigger_type: "time";
    scheduled_for: string;
    delay_seconds: number | null;
  }
  | {
    trigger_type: "market_cap";
    trigger_metric: "market_cap_usd";
    trigger_direction: "below" | "above";
    trigger_value_usd: number;
    next_check_at: string;
    check_interval_seconds: number;
  };

export const SCHEDULER_CONFIRMATION_PHRASE = "confirm schedule";
export const SCHEDULER_MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;
export const SCHEDULER_MIN_DELAY_SECONDS = 60;
export const SCHEDULER_MARKET_CHECK_INTERVAL_SECONDS = 60;
export const SCHEDULER_MIN_INTERVAL_SECONDS = 60;
export const SCHEDULER_MAX_INTERVAL_SECONDS = 30 * 24 * 60 * 60;

export function parseScheduleTrigger(args: {
  tweetText: string;
  extraction?: any;
  now?: Date;
}): SchedulerTrigger | null {
  const now = args.now ?? new Date();
  const text = String(args.tweetText ?? "");
  const market = parseMarketCapTrigger(text, args.extraction, now);
  if (market) return market;
  return parseTimeTrigger(text, args.extraction, now);
}

export function isMarketCapTrigger(trigger: SchedulerTrigger | null): boolean {
  return trigger?.trigger_type === "market_cap";
}

export function normalizeScheduleKind(
  value: unknown,
  triggerType: SchedulerTrigger["trigger_type"] | string,
): ScheduleKind {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["interval", "every", "recurring"].includes(raw)) return "interval";
  if (raw === "daily") return "daily";
  if (raw === "weekly") return "weekly";
  if (["condition", "market_cap", "marketcap"].includes(raw)) {
    return "condition";
  }
  if (["one_time", "once", "time", "timed", ""].includes(raw)) {
    return triggerType === "market_cap" ? "condition" : "one_time";
  }
  throw new Error("invalid_schedule_kind");
}

export function normalizeIntervalSeconds(
  kind: ScheduleKind,
  value: unknown,
): number | null {
  if (kind === "daily") return 24 * 60 * 60;
  if (kind === "weekly") return 7 * 24 * 60 * 60;
  if (kind !== "interval") return null;
  const seconds = Math.floor(Number(value));
  if (!Number.isFinite(seconds)) throw new Error("invalid_interval_seconds");
  if (seconds < SCHEDULER_MIN_INTERVAL_SECONDS) {
    throw new Error("interval_too_short");
  }
  if (seconds > SCHEDULER_MAX_INTERVAL_SECONDS) {
    throw new Error("interval_too_long");
  }
  return seconds;
}

export function isRecurringScheduleKind(kind: unknown): boolean {
  return ["interval", "daily", "weekly"].includes(String(kind ?? ""));
}

export function occurrenceKeyForDueAt(dueAt: unknown): string {
  const due = new Date(String(dueAt ?? ""));
  const millis = Number.isFinite(due.getTime()) ? due.getTime() : Date.now();
  return `due:${new Date(millis).toISOString()}`;
}

export function nextRecurringDueAt(
  row: any,
  now: Date = new Date(),
): string | null {
  if (!isRecurringScheduleKind(row?.schedule_kind)) return null;
  const intervalSeconds = Math.floor(Number(row?.interval_seconds ?? 0));
  if (
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < SCHEDULER_MIN_INTERVAL_SECONDS ||
    intervalSeconds > SCHEDULER_MAX_INTERVAL_SECONDS
  ) {
    return null;
  }
  const maxOccurrences = Number(row?.max_occurrences ?? 0);
  if (
    Number.isFinite(maxOccurrences) &&
    maxOccurrences > 0 &&
    Number(row?.occurrence_count ?? 0) >= maxOccurrences
  ) {
    return null;
  }

  const base = new Date(
    String(
      row?.last_due_at ?? row?.scheduled_for ?? row?.next_check_at ??
        now.toISOString(),
    ),
  );
  if (!Number.isFinite(base.getTime())) return null;
  let nextMs = base.getTime() + intervalSeconds * 1000;
  while (nextMs <= now.getTime()) nextMs += intervalSeconds * 1000;

  const endsAt = row?.ends_at ? new Date(String(row.ends_at)) : null;
  if (
    endsAt && Number.isFinite(endsAt.getTime()) && nextMs > endsAt.getTime()
  ) {
    return null;
  }
  return new Date(nextMs).toISOString();
}

export function marketCapFromBundle(
  bundle: MarketDataBundle | null | undefined,
): number | null {
  const candidates = [
    bundle?.valuation?.marketCapUsd,
    bundle?.valuation?.fdvUsd,
    (bundle as any)?.marketCapUsd,
    (bundle as any)?.fdvUsd,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function marketTriggerSatisfied(
  trigger: Extract<SchedulerTrigger, { trigger_type: "market_cap" }> | any,
  valueUsd: number,
): boolean {
  const threshold = Number(trigger?.trigger_value_usd);
  if (
    !Number.isFinite(valueUsd) || valueUsd <= 0 || !Number.isFinite(threshold)
  ) return false;
  return trigger.trigger_direction === "below"
    ? valueUsd <= threshold
    : valueUsd >= threshold;
}

export function formatTrigger(trigger: SchedulerTrigger | any): string {
  if (!trigger) return "later";
  if (trigger.trigger_type === "time") {
    const when = new Date(trigger.scheduled_for);
    return Number.isFinite(when.getTime())
      ? `at ${when.toUTCString()}`
      : "at the scheduled time";
  }
  if (trigger.trigger_type === "market_cap") {
    return `when market cap is ${trigger.trigger_direction} ${
      formatUsdCompact(
        Number(trigger.trigger_value_usd),
      )
    }`;
  }
  return "later";
}

export function formatScheduleConfirmReply(args: {
  actionType: ScheduledActionType;
  chain: "robinhood" | "solana";
  action: any;
  trigger: SchedulerTrigger;
}) {
  const chain = args.chain === "solana" ? "Solana" : "Robinhood Chain";
  return `I found this scheduled action:\n\n${
    formatActionSummary(
      args.actionType,
      args.action,
    )
  }\nNetwork: ${chain}\nTrigger: ${
    formatTrigger(args.trigger)
  }\n\nReply "confirm schedule" within 15 minutes to schedule it.\n\nNo TX created yet.`;
}

export function formatScheduledQueuedReply(args: {
  actionType: ScheduledActionType;
  chain: "robinhood" | "solana";
  trigger: SchedulerTrigger | any;
}) {
  const action = scheduledActionLabel(args.actionType);
  const chain = args.chain === "solana" ? "Solana" : "Robinhood Chain";
  return `Scheduled ${action} on ${chain}. I will run it ${
    formatTrigger(
      args.trigger,
    )
  } and reply when it executes.`;
}

export function formatScheduledExecutedReply(args: {
  actionType: ScheduledActionType;
  chain: "robinhood" | "solana";
  txHash?: string | null;
}) {
  const action = scheduledActionLabel(args.actionType);
  const chain = args.chain === "solana" ? "Solana" : "Robinhood Chain";
  const tx = String(args.txHash ?? "").trim();
  return tx
    ? `Scheduled ${action} executed on ${chain}.\n\nView full history in Linkr.\n\nTX: ${tx}`
    : `Scheduled ${action} was accepted on ${chain}.\n\nView full history in Linkr for the final receipt.`;
}

export function formatScheduledFailedReply(args: {
  actionType: ScheduledActionType;
  chain: "robinhood" | "solana";
}) {
  const action = scheduledActionLabel(args.actionType);
  const chain = args.chain === "solana" ? "Solana" : "Robinhood Chain";
  return `Scheduled ${action} on ${chain} failed before confirmation. No confirmed TX was created.`;
}

export function schedulerNeedsExplicitTokenReply() {
  return "Scheduled swaps need the full contract address or Solana mint in the command itself. Try again with the full address, amount, and trigger.";
}

export function marketCapTransferUnsupportedReply() {
  return "Market-cap triggers only work for buys and sells. Timed transfers are supported, like: send 0.1 SOL to <address> in 2 hours.";
}

function parseTimeTrigger(
  text: string,
  extraction: any,
  now: Date,
): SchedulerTrigger | null {
  const aiDelaySeconds = positiveNumber(extraction?.schedule_delay_seconds);
  if (aiDelaySeconds != null) return buildTimeTrigger(now, aiDelaySeconds);

  const runAt = parseFutureDate(extraction?.schedule_run_at, now);
  if (runAt) {
    const delaySeconds = Math.ceil((runAt.getTime() - now.getTime()) / 1000);
    return buildTimeTrigger(now, delaySeconds);
  }

  const delay = parseRelativeDelaySeconds(text);
  if (delay != null) return buildTimeTrigger(now, delay);

  if (/\btomorrow\b/i.test(text)) return buildTimeTrigger(now, 24 * 60 * 60);
  return null;
}

function buildTimeTrigger(
  now: Date,
  rawDelaySeconds: number,
): SchedulerTrigger | null {
  if (!Number.isFinite(rawDelaySeconds) || rawDelaySeconds <= 0) return null;
  const delaySeconds = Math.max(
    SCHEDULER_MIN_DELAY_SECONDS,
    Math.min(Math.round(rawDelaySeconds), SCHEDULER_MAX_DELAY_SECONDS),
  );
  return {
    trigger_type: "time",
    scheduled_for: new Date(now.getTime() + delaySeconds * 1000).toISOString(),
    delay_seconds: delaySeconds,
  };
}

function parseMarketCapTrigger(
  text: string,
  extraction: any,
  now: Date,
): SchedulerTrigger | null {
  const aiValue = positiveNumber(extraction?.trigger_market_cap_usd);
  const aiDirection = normalizeDirection(extraction?.trigger_direction);
  if (aiValue != null && aiDirection) {
    return buildMarketCapTrigger(aiDirection, aiValue, now);
  }

  const normalized = text.toLowerCase();
  if (
    !/\b(if|when|below|under|above|over|market\s*cap|mcap|mc|fdv|price)\b/i
      .test(normalized)
  ) {
    return null;
  }

  const below = matchThreshold(normalized, [
    "below",
    "under",
    "less than",
    "lower than",
    "drops below",
    "drop below",
    "gets below",
    "get below",
    "<=",
  ]);
  if (below != null) return buildMarketCapTrigger("below", below, now);

  const above = matchThreshold(normalized, [
    "above",
    "over",
    "greater than",
    "higher than",
    "goes above",
    "go above",
    "gets above",
    "get above",
    ">=",
  ]);
  if (above != null) return buildMarketCapTrigger("above", above, now);

  return null;
}

function buildMarketCapTrigger(
  triggerDirection: "below" | "above",
  triggerValueUsd: number,
  now: Date,
): SchedulerTrigger | null {
  if (!Number.isFinite(triggerValueUsd) || triggerValueUsd <= 0) return null;
  return {
    trigger_type: "market_cap",
    trigger_metric: "market_cap_usd",
    trigger_direction: triggerDirection,
    trigger_value_usd: triggerValueUsd,
    next_check_at: now.toISOString(),
    check_interval_seconds: SCHEDULER_MARKET_CHECK_INTERVAL_SECONDS,
  };
}

function parseRelativeDelaySeconds(text: string): number | null {
  const matches = String(text ?? "").matchAll(
    /\bin\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/gi,
  );
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = String(match[2] ?? "").toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (["second", "seconds", "sec", "secs", "s"].includes(unit)) return amount;
    if (["minute", "minutes", "min", "mins", "m"].includes(unit)) {
      return amount * 60;
    }
    if (["hour", "hours", "hr", "hrs", "h"].includes(unit)) {
      return amount * 60 * 60;
    }
    if (["day", "days", "d"].includes(unit)) return amount * 24 * 60 * 60;
  }
  return null;
}

function matchThreshold(text: string, phrases: string[]): number | null {
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(
      /\s+/g,
      "\\s+",
    );
    const re = new RegExp(
      `${escaped}\\s*\\$?\\s*([0-9]+(?:\\.[0-9]+)?\\s*[kmb]?)`,
      "i",
    );
    const match = text.match(re);
    if (!match) continue;
    const parsed = parseCompactUsd(match[1]);
    if (parsed != null) return parsed;
  }
  return null;
}

function parseCompactUsd(value: unknown): number | null {
  const raw = String(value ?? "")
    .trim()
    .replace(/[$,\s_]/g, "")
    .toLowerCase();
  const match = raw.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const multiplier = match[2] === "b"
    ? 1_000_000_000
    : match[2] === "m"
    ? 1_000_000
    : match[2] === "k"
    ? 1_000
    : 1;
  return base * multiplier;
}

function positiveNumber(value: unknown): number | null {
  const parsed = parseCompactUsd(value);
  if (parsed != null) return parsed;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFutureDate(value: unknown, now: Date): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (parsed.getTime() <= now.getTime()) return null;
  if (parsed.getTime() - now.getTime() > SCHEDULER_MAX_DELAY_SECONDS * 1000) {
    return null;
  }
  return parsed;
}

function normalizeDirection(value: unknown): "below" | "above" | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["below", "under", "less_than", "less than", "lte", "<="].includes(raw)) {
    return "below";
  }
  if (
    ["above", "over", "greater_than", "greater than", "gte", ">="].includes(raw)
  ) {
    return "above";
  }
  return null;
}

function formatActionSummary(
  actionType: ScheduledActionType,
  action: any,
): string {
  const token = action?.output_mint ?? action?.input_mint ??
    action?.token_address ?? "";
  const tokenLabel = token ? shortAddress(token) : "the token";
  if (actionType === "buy") {
    return `Buy ${formatAmount(action)} of ${tokenLabel}`;
  }
  if (actionType === "sell") {
    const amount = action?.amount_all
      ? "100%"
      : action?.amount_pct != null
      ? `${action.amount_pct}%`
      : "the requested amount";
    return `Sell ${amount} of ${tokenLabel}`;
  }
  if (actionType === "launch_coin") {
    const symbol = action?.symbol
      ? `$${String(action.symbol).toUpperCase()}`
      : "coin";
    return `Launch ${symbol}`;
  }
  if (actionType === "claim_creator_rewards") {
    const token = action?.token ?? action?.token_address ?? action?.mint ??
      action?.symbol ?? "launch";
    return `Claim creator rewards for ${shortAddress(String(token))}`;
  }
  if (actionType === "add_liquidity") {
    const token = action?.token ?? action?.token_address ?? "the pool";
    return `Add liquidity to ${shortAddress(String(token))}`;
  }
  if (actionType === "remove_liquidity") {
    const token = action?.token ?? action?.token_address ??
      action?.position_id ?? "the pool";
    const amount = action?.percent ?? action?.requested_percent ?? null;
    return `Remove ${amount == null ? "" : `${amount}% `}liquidity from ${
      shortAddress(String(token))
    }`;
  }
  if (actionType === "collect_liquidity_fees") {
    const token = action?.token ?? action?.token_address ??
      action?.position_id ?? "the pool";
    return `Collect liquidity fees from ${shortAddress(String(token))}`;
  }
  const recipient = action?.recipient
    ? shortAddress(action.recipient)
    : "the recipient";
  return `Send ${formatAmount(action)} to ${recipient}`;
}

function scheduledActionLabel(actionType: ScheduledActionType): string {
  if (actionType === "launch_coin") return "launch";
  if (actionType === "claim_creator_rewards") return "creator rewards claim";
  if (actionType === "add_liquidity") return "add-liquidity action";
  if (actionType === "remove_liquidity") return "remove-liquidity action";
  if (actionType === "collect_liquidity_fees") return "collect-fees action";
  if (actionType === "buy") return "buy";
  if (actionType === "sell") return "sell";
  return "transfer";
}

function formatAmount(action: any): string {
  if (action?.amount_original != null && action?.amount_original_unit) {
    const unit = String(action.amount_original_unit).toUpperCase();
    return unit === "USD"
      ? `$${Number(action.amount_original).toFixed(2)}`
      : `${Number(action.amount_original)} ${unit}`;
  }
  if (action?.amount_eth != null) {
    return `${Number(action.amount_eth).toFixed(4)} ETH`;
  }
  if (action?.amount_sol != null) {
    return `${Number(action.amount_sol).toFixed(4)} SOL`;
  }
  if (action?.amount_usd != null) {
    return `$${Number(action.amount_usd).toFixed(2)}`;
  }
  return "the requested amount";
}

function shortAddress(value: string): string {
  const raw = String(value ?? "");
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return "$?";
  if (value >= 1_000_000_000) return `$${trimDecimal(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `$${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `$${trimDecimal(value / 1_000)}K`;
  return `$${trimDecimal(value)}`;
}

function trimDecimal(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/\.?0+$/, "");
}
