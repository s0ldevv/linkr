import {
  detectConversationShortcut,
  isThreadReference,
  looksLikeExplicitCommand,
  normalizeConversationText,
} from "./conversation.ts";
import { extractFromText } from "./extract.ts";

export type LinkrEngagementAction = "process" | "reply_social" | "ignore";

export type LinkrEngagementReason =
  | "empty_comment"
  | "explicit_command"
  | "explicit_question"
  | "capability_or_small_talk"
  | "gratitude_to_known_linkr_reply"
  | "ambiguous_gratitude"
  | "token_or_chain_reference"
  | "post_or_thread_request"
  | "media_request"
  | "ambient_acknowledgement"
  | "ambient_remark"
  | "unaddressed_comment";

export interface LinkrEngagementGateArgs {
  text: string;
  ingest_source?: string | null;
  ingest_reason?: string | null;
  is_follow_up?: boolean;
  parent_reply_tweet_id?: string | null;
  has_media?: boolean;
  has_history?: boolean;
}

export interface LinkrEngagementDecision {
  action: LinkrEngagementAction;
  reason: LinkrEngagementReason;
  confidence: number;
  addressed_to_linkr: boolean;
  known_linkr_reply_context: boolean;
}

const BOT_HANDLE_PATTERN = /(^|\s)@?linkrcash\b/i;
const QUESTION_PATTERN =
  /\?|(?:^|\s)(who|what|when|where|why|how|can|could|would|should|do|does|did|is|are|was|were|will|which)\b/i;
const CHAIN_OR_TOKEN_WORD_PATTERN =
  /\b(chain|chains|network|networks|robinhood|evm|eth|weth|solana|sol|pump\.fun|pumpfun|pumpswap|token|coin|ca|contract|mint|chart|price|liquidity|volume|market cap|fdv)\b/i;
const POST_REQUEST_PATTERN =
  /\b(thoughts|check this|look at this|look this up|explain|summarize|make sense of|analyze|review|what about this|what is this|what's this)\b/i;
const AMBIENT_ACK_PATTERN =
  /^(ok|okay|k|cool|nice|lol|lmao|haha|wild|crazy|based|fire|interesting|wow|damn|sheesh|yep|yeah|true|same|agreed|bet|alright|word)$/i;

export function decideLinkrEngagement(args: LinkrEngagementGateArgs): LinkrEngagementDecision {
  const rawText = String(args.text ?? "");
  const normalized = normalizeConversationText(rawText);
  const knownReply = isKnownLinkrReplyContext(args);
  const addressed = isAddressedToLinkr(rawText, args, knownReply);

  if (!normalized) {
    return decision(args.has_media && addressed ? "process" : "ignore", args.has_media ? "media_request" : "empty_comment", addressed, knownReply, args.has_media ? 0.72 : 0.98);
  }

  if (!addressed) {
    return decision("ignore", "unaddressed_comment", addressed, knownReply, 0.94);
  }

  if (looksLikeExplicitCommand(rawText)) {
    return decision("process", "explicit_command", addressed, knownReply, 0.98);
  }

  const shortcut = detectConversationShortcut(rawText);
  if (shortcut?.kind === "thanks") {
    return knownReply
      ? decision("reply_social", "gratitude_to_known_linkr_reply", addressed, knownReply, 0.99)
      : decision("ignore", "ambiguous_gratitude", addressed, knownReply, 0.9);
  }

  if (shortcut && shortcut.kind !== "acknowledgement") {
    return decision("process", "capability_or_small_talk", addressed, knownReply, 0.94);
  }

  if (QUESTION_PATTERN.test(normalized)) {
    return decision("process", "explicit_question", addressed, knownReply, 0.9);
  }

  if (isThreadReference(rawText) || POST_REQUEST_PATTERN.test(normalized)) {
    return decision("process", "post_or_thread_request", addressed, knownReply, 0.86);
  }

  if (hasTokenOrChainReference(rawText)) {
    return decision("process", "token_or_chain_reference", addressed, knownReply, 0.82);
  }

  if (args.has_media && knownReply) {
    return decision("process", "media_request", addressed, knownReply, 0.72);
  }

  if (AMBIENT_ACK_PATTERN.test(normalized)) {
    return decision("ignore", "ambient_acknowledgement", addressed, knownReply, 0.9);
  }

  return decision("ignore", "ambient_remark", addressed, knownReply, knownReply || args.has_history ? 0.78 : 0.88);
}

function isKnownLinkrReplyContext(args: LinkrEngagementGateArgs): boolean {
  return Boolean(
    args.is_follow_up ||
      args.ingest_reason === "reply_to_known_linkr_reply" ||
      String(args.parent_reply_tweet_id ?? "").trim(),
  );
}

function isAddressedToLinkr(
  text: string,
  args: LinkrEngagementGateArgs,
  knownReply: boolean,
): boolean {
  return Boolean(
    knownReply ||
      /@linkrcash\b/i.test(text) ||
      args.ingest_source === "mention" ||
      args.ingest_source === "reply_to_bot" ||
      BOT_HANDLE_PATTERN.test(text),
  );
}

function hasTokenOrChainReference(text: string): boolean {
  const extracted = extractFromText(text);
  return (
    extracted.mints.length > 0 ||
    extracted.symbols.length > 0 ||
    extracted.urls.some((url) => /dexscreener|blockscout|pump\.fun|solscan/i.test(url)) ||
    CHAIN_OR_TOKEN_WORD_PATTERN.test(text)
  );
}

function decision(
  action: LinkrEngagementAction,
  reason: LinkrEngagementReason,
  addressedToLinkr: boolean,
  knownLinkrReplyContext: boolean,
  confidence: number,
): LinkrEngagementDecision {
  return {
    action,
    reason,
    confidence,
    addressed_to_linkr: addressedToLinkr,
    known_linkr_reply_context: knownLinkrReplyContext,
  };
}
