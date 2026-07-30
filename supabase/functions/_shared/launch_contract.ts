/**
 * The single source of truth for what a user must supply to launch a token.
 *
 * The product contract is deliberately narrow: a user only has to say **what the
 * token is called** and **which chain it launches on**. Everything else —
 * ticker, description, image, dev buy, mayhem mode, reward mode — is decided by
 * Linkr and shown back on the confirmation card, which is where the user
 * corrects it. Asking for an auto-filled slot is a bug, not a safety feature.
 *
 * `chain` is the one slot that is never inferred. That rule is independently
 * enforced at the database boundary
 * (`explicit_launch_chain_provenance_required`) and must stay that way.
 *
 * Before this module existed the contract was written out four separate times
 * (`x_launch_command.ts`, `linkr_agent_runtime.ts`, `linkr_tool_registry.ts`,
 * and `upsert_linkr_launch_draft_v2`), and they drifted: the conversational
 * runtime demanded four fields while the database demanded two. Every consumer
 * now reads the contract from here.
 */

export type LaunchChain = "solana" | "robinhood";

export interface LaunchFields {
  name?: string;
  symbol?: string;
  description?: string;
  image_url?: string;
  original_image_url?: string;
  image_prompt?: string;
  image_negative_prompt?: string;
  chain?: LaunchChain;
  chain_ambiguous?: boolean;
  dev_buy_amount?: string;
  mayhem_mode?: boolean;
  cashback_mode?: boolean;
}

/** Slots the user must provide. Nothing else may block a launch. */
export const LAUNCH_REQUIRED_SLOTS = ["name", "chain"] as const;

/** Slots Linkr fills in when the user stays silent. Never ask for these. */
export const LAUNCH_AUTOFILL_SLOTS = [
  "symbol",
  "description",
  "image_prompt",
  "image_url",
  "dev_buy_amount",
  "mayhem_mode",
  "cashback_mode",
] as const;

/**
 * Slots that, once the user has set them, may not be silently overwritten by a
 * later model patch. Overwriting these needs explicit edit intent.
 */
export const LAUNCH_PROTECTED_SLOTS = [
  "name",
  "symbol",
  "chain",
  "dev_buy_amount",
] as const;

export type LaunchRequiredSlot = (typeof LAUNCH_REQUIRED_SLOTS)[number];
export type LaunchAutofillSlot = (typeof LAUNCH_AUTOFILL_SLOTS)[number];

const REQUIRED_SET: ReadonlySet<string> = new Set(LAUNCH_REQUIRED_SLOTS);
const AUTOFILL_SET: ReadonlySet<string> = new Set(LAUNCH_AUTOFILL_SLOTS);
const PROTECTED_SET: ReadonlySet<string> = new Set(LAUNCH_PROTECTED_SLOTS);

export function isRequiredLaunchSlot(slot: string): boolean {
  return REQUIRED_SET.has(slot);
}

export function isAutofillLaunchSlot(slot: string): boolean {
  return AUTOFILL_SET.has(slot);
}

export function isProtectedLaunchSlot(slot: string): boolean {
  return PROTECTED_SET.has(slot);
}

/**
 * Which required slots are still outstanding.
 *
 * `chain` counts as missing when it is absent, ambiguous, or — when provenance
 * is supplied — when it did not come from the user. Guessed chains are treated
 * as no chain at all, which is what keeps the runtime honest with the database
 * constraint.
 */
export function missingLaunchSlots(
  fields: LaunchFields | Record<string, unknown> | null | undefined,
  provenance: Record<string, unknown> | null | undefined = null,
): string[] {
  const source = (fields ?? {}) as Record<string, unknown>;
  const missing: string[] = [];

  if (!String(source.name ?? "").trim()) missing.push("name");

  const chain = String(source.chain ?? "").trim().toLowerCase();
  const chainKnown = chain === "solana" || chain === "robinhood";
  const chainAmbiguous = source.chain_ambiguous === true;
  const chainFromUser = provenance === null ||
    isUserChainProvenance(provenance.chain);
  if (!chainKnown || chainAmbiguous || !chainFromUser) missing.push("chain");

  return missing;
}

/**
 * Provenance values the database accepts for `chain`. Anything else — an AI
 * guess, a wallet-history default — is not a user-selected chain.
 */
function isUserChainProvenance(value: unknown): boolean {
  const direct = typeof value === "string" ? value : null;
  const nested = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).source
    : null;
  const source = String(direct ?? nested ?? "");
  return source === "user_text" || source === "thread_context";
}

/**
 * A short, human summary of everything already captured.
 *
 * Every clarification reply leads with this. A user who has answered four
 * questions and is being asked a fifth needs to see that their answers were
 * kept — the absence of this echo is what made the bot feel like it was
 * resetting.
 */
export function launchStateSummary(
  fields: LaunchFields | Record<string, unknown> | null | undefined,
): string {
  const source = (fields ?? {}) as Record<string, unknown>;
  const parts: string[] = [];

  const name = String(source.name ?? "").trim();
  if (name) parts.push(`name ${name}`);

  const symbol = String(source.symbol ?? "").trim();
  if (symbol) parts.push(`ticker ${symbol.toUpperCase()}`);

  const chain = String(source.chain ?? "").trim().toLowerCase();
  if (chain === "solana") parts.push("Solana");
  if (chain === "robinhood") parts.push("Robinhood Chain");

  if (String(source.image_url ?? "").trim()) parts.push("your image");
  else if (String(source.image_prompt ?? "").trim()) parts.push("your image brief");

  const devBuy = String(source.dev_buy_amount ?? "").trim();
  if (devBuy) parts.push(`dev buy ${devBuy}`);

  if (source.mayhem_mode === true) parts.push("mayhem mode");
  if (source.cashback_mode === true) parts.push("cashback mode");

  return parts.length > 0 ? `Saved so far: ${parts.join(" · ")}.` : "";
}

/**
 * Prefix a clarification question with the saved state, so a follow-up question
 * never reads as though the conversation restarted.
 */
export function withLaunchStateEcho(
  fields: LaunchFields | Record<string, unknown> | null | undefined,
  question: string,
): string {
  const summary = launchStateSummary(fields);
  const text = String(question ?? "").trim();
  if (!summary) return text;
  if (!text) return summary;
  return `${summary} ${text}`;
}
