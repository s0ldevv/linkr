export function isScheduleCapabilityQuestion(text: string): boolean {
  const normalized = normalizeScheduleText(text);
  if (!normalized) return false;

  const asksAbility =
    /\b(can|could|do|does|able|support|supports|possible|allow|allows)\b/.test(
      normalized,
    ) ||
    /\bis it possible\b/.test(normalized);
  if (!asksAbility) return false;

  const mentionsSchedule =
    /\b(schedule|schedules|scheduled|scheduling|later|trigger|triggers|order|orders)\b/
      .test(normalized) ||
    /\bmarket\s*cap\b|\bmarketcap\b|\bmcap\b/.test(normalized);
  const mentionsAction =
    /\b(buy|buys|buying|sell|sells|selling|trade|trades|trading|swap|swaps|transfer|transfers|send|sends|launch|launches|claim|claims|rewards|liquidity|fees)\b/
      .test(normalized);

  if (!mentionsSchedule || !mentionsAction) return false;
  if (looksLikeConcreteScheduleCommand(normalized)) return false;
  return true;
}

export function scheduleCapabilityReply(): string {
  return "Yes. I can schedule buys, sells, transfers, launches, creator-reward claims, and supported liquidity actions by time, and I can set up buy/sell market-cap triggers when supported. Send the exact action details plus when to run it or what market cap to watch. I will draft it first and ask you to confirm before anything moves.";
}

export function scheduleClarificationReply(): string {
  return "I can schedule that, but I need the details first: the action, chain, required token/launch/recipient/position fields, any amount or percent, and either a time or a supported market-cap trigger. For example: buy 0.1 SOL of <mint> in 2 hours, claim my latest creator rewards every day, or sell 50% of <contract> when market cap is above $5M. Once I have that, I will draft it and ask you to confirm before anything moves.";
}

function normalizeScheduleText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function looksLikeConcreteScheduleCommand(normalized: string): boolean {
  return hasAddressLikeValue(normalized) &&
    (hasAmountLikeValue(normalized) || hasTriggerLikeValue(normalized));
}

function hasAddressLikeValue(normalized: string): boolean {
  return /\b0x[a-f0-9]{20,}\b/i.test(normalized) ||
    /\b[1-9a-hj-np-za-km-z]{32,44}\b/i.test(normalized) ||
    /<\s*(contract|address|mint|recipient|position)\s*>/.test(normalized) ||
    /\b(latest|last)\s+launch\b/.test(normalized);
}

function hasAmountLikeValue(normalized: string): boolean {
  return /\b\d+(?:\.\d+)?\s*(eth|sol|%)\b/.test(normalized) ||
    /\b(half|all)\b/.test(normalized);
}

function hasTriggerLikeValue(normalized: string): boolean {
  return /\b(in|after)\s+\d+\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)\b/
    .test(normalized) ||
    /\b(tomorrow|tonight|today)\b/.test(normalized) ||
    /\b(above|below|over|under)\s+\$?\d/.test(normalized);
}
