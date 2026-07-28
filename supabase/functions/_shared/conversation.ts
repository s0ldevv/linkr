// deno-lint-ignore-file no-explicit-any
// Conversation helpers shared by X mention ingestion and processing.

import { extractFromText } from "./extract.ts";
import { capabilityPromptSummary } from "./linkr_capabilities.ts";
import {
  isScheduleCapabilityQuestion,
  scheduleCapabilityReply,
} from "./linkr_schedule_language.ts";

export interface ConversationMessage {
  id: string;
  tweet_id: string | null;
  reply_tweet_id?: string | null;
  conversation_id: string | null;
  author_twitter_id: string | null;
  author_username?: string | null;
  text: string;
  role: "user" | "assistant";
  created_at: string;
}

export interface ConversationThread {
  messages: ConversationMessage[];
  total_count: number;
  conversation_id: string | null;
}

export interface FollowUpCheck {
  isFollowUp: boolean;
  parentInboxTweetId: string | null;
  parentReplyTweetId: string | null;
}

export interface TokenFollowUpFields {
  hasTokenReference: boolean;
  extraction: {
    token_symbol: string | null;
    token_name: null;
    token_address: string | null;
    token_mint: string | null;
    token_candidates: string[];
    dexscreener_url: string | null;
    blockscout_url: string | null;
    question: string | null;
    market_query_type:
      | "token_lookup"
      | "token_analytics"
      | "trending_tokens"
      | "boosted_tokens"
      | "pair_stats"
      | "token_search"
      | "comparison"
      | null;
    market_timeframe: "5m" | "1h" | "6h" | "24h" | "7d" | null;
    sort_by:
      | "volume"
      | "liquidity"
      | "market_cap"
      | "price_change"
      | "boosts"
      | null;
    ambiguity_detected: boolean;
    missing_fields: string[];
    reasoning_summary: string;
  };
}

export type ConversationShortcutKind =
  | "greeting"
  | "wellness_question"
  | "greeting_with_wellness"
  | "status_question"
  | "greeting_with_status"
  | "time_greeting"
  | "time_greeting_with_wellness"
  | "acknowledgement"
  | "thanks"
  | "capability_help";

export type ConversationShortcut = {
  kind: ConversationShortcutKind;
  reply: string;
} | null;

const THANKS_REPLY = "Anytime. What do you want to do next?";
const GREETING_REPLY = "Hi! How can I help?";
const WELLNESS_REPLY = "I'm good, thanks for asking. How can I help?";
const GREETING_WITH_WELLNESS_REPLY =
  "Hi! I'm good, thanks for asking. How can I help?";
const STATUS_REPLY = "Not much, ready to help. What do you want to do?";
const GREETING_WITH_STATUS_REPLY =
  "Hey! Not much, ready to help. What do you want to do?";
const WELLNESS_QUESTION_PATTERN =
  /^(how are you|how r you|how are u|how is it going|hows it going|how are things|how are ya|how you doing|how are you doing)$/;
const WELLNESS_QUESTION_FRAGMENT_PATTERN =
  /\b(how are you|how r you|how are u|how is it going|hows it going|how are things|how are ya|how you doing|how are you doing)\b/;
const STATUS_QUESTION_PATTERN = /^(what is up|whats up|sup)$/;

const GREETING_PATTERNS = [/^(hi|hello|hey|yo)( there)?$/];

const GREETING_WITH_WELLNESS_PATTERNS = [
  /^(hi|hello|hey|yo)( there)? (how are you|how r you|how are u|how is it going|hows it going|how are things|how are ya|how you doing|how are you doing)$/,
];

const GREETING_WITH_STATUS_PATTERNS = [
  /^(hi|hello|hey|yo)( there)? (what is up|whats up|sup)$/,
];

const TIME_GREETING_PATTERNS = [
  /^(good morning|good afternoon|good evening)$/,
  /^(gm|gn)$/,
];

const TIME_GREETING_WITH_WELLNESS_PATTERNS = [
  /^(good morning|good afternoon|good evening) (how are you|how is it going|hows it going|how are things|how are ya|how you doing|how are you doing)$/,
  /^(gm|gn) (how are you|how is it going|hows it going|how are things|how are ya|how you doing|how are you doing)$/,
];

const WELLNESS_REPLY_PATTERNS = [
  /\b(i am|i'm|im) (doing )?(good|well|fine|great|okay|ok)\b/i,
  /\bdoing (good|well|fine|great|okay|ok)\b/i,
  /\bthanks for asking\b/i,
];

const THANKS_PATTERNS = [
  /^(thanks|thank you|thx|ty)$/,
  /^(thanks|thank you|thx|ty) (bro|man|mate|linkr|linkrcash)?$/,
  /^(appreciate it|appreciated)$/,
];

const CAPABILITY_PATTERNS = [
  /^(help|commands|command list)$/,
  /^(what can you do|what do you do|how can you help|how does this work)$/,
  /^(show me commands|show commands|list commands)$/,
];

const DEXSCREENER_URL_PATTERN =
  /https?:\/\/(?:www\.)?dexscreener\.com\/[^/\s]+\/\S+/i;
const BLOCKSCOUT_URL_PATTERN =
  /https?:\/\/robinhoodchain\.blockscout\.com\/(?:token|address)\/\S+/i;

const THREAD_REFERENCE_PATTERNS = [
  /\bca above\b/,
  /\bcontract above\b/,
  /\baddress above\b/,
  /\bwhat is this\b/,
  /\bwhat's this\b/,
  /\bwhat is that\b/,
  /\bwhat's that\b/,
  /\bthis token\b/,
  /\bthat token\b/,
  /\bthis coin\b/,
  /\bthat coin\b/,
  /\bparent post\b/,
  /\broot post\b/,
  /\babove\b/,
  /\bthe thread\b/,
  /\bthat post\b/,
  /\bthis post\b/,
];

const EXPLICIT_COMMAND_PATTERNS = [
  /\b(confirm|cancel|never mind|stop)\b/,
  /\b(buy|sell|burn)\b/,
  /\b(send|transfer)\b/,
  /\b(launch|create|make|deploy|mint)\b/,
  /\b(balance|portfolio|holdings|deposit address|wallet)\b/,
  /\b(slippage)\b/,
];

export async function loadConversationThread(
  admin: any,
  conversationId: string | null | undefined,
  limit = 10,
): Promise<ConversationThread> {
  if (!conversationId) {
    return { messages: [], total_count: 0, conversation_id: null };
  }

  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
  const [mentionsResult, repliesResult] = await Promise.all([
    admin
      .from("tweets_inbox")
      .select(
        "tweet_id,conversation_id,author_twitter_id,author_username,text,created_at",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(50),
    admin
      .from("twitter_replies")
      .select(
        "id,tweet_id,reply_tweet_id,conversation_id,author_twitter_id,reply_text,created_at",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const mentionMessages: ConversationMessage[] = (mentionsResult.data ?? [])
    .map((row: any) => ({
      id: row.tweet_id,
      tweet_id: row.tweet_id,
      conversation_id: row.conversation_id ?? conversationId,
      author_twitter_id: row.author_twitter_id ?? null,
      author_username: row.author_username ?? null,
      text: row.text ?? "",
      role: "user",
      created_at: row.created_at,
    }));

  const replyMessages: ConversationMessage[] = (repliesResult.data ?? []).map((
    row: any,
  ) => ({
    id: row.id,
    tweet_id: row.tweet_id ?? null,
    reply_tweet_id: row.reply_tweet_id ?? null,
    conversation_id: row.conversation_id ?? conversationId,
    author_twitter_id: row.author_twitter_id ?? null,
    text: row.reply_text ?? "",
    role: "assistant",
    created_at: row.created_at,
  }));

  const allMessages = [...mentionMessages, ...replyMessages]
    .filter((message) => message.text.trim().length > 0)
    .sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  return {
    messages: allMessages.slice(-safeLimit),
    total_count: allMessages.length,
    conversation_id: conversationId,
  };
}

export function buildConversationTranscript(
  thread: ConversationThread,
): string {
  return thread.messages
    .map((message) => {
      if (message.role === "assistant") {
        return "Linkr: " + cleanTranscriptText(message.text);
      }
      const handle = message.author_username
        ? " @" + message.author_username
        : "";
      return "User" + handle + ": " + cleanTranscriptText(message.text);
    })
    .join("\n");
}

export async function checkIsFollowUp(
  admin: any,
  referencedTweets?: Array<{ type?: string; id?: string }>,
): Promise<FollowUpCheck> {
  const replyRef = referencedTweets?.find((tweet) =>
    tweet?.type === "replied_to"
  );
  const parentReplyTweetId = replyRef?.id ? String(replyRef.id) : null;
  if (!parentReplyTweetId) {
    return {
      isFollowUp: false,
      parentInboxTweetId: null,
      parentReplyTweetId: null,
    };
  }

  const { data } = await admin
    .from("twitter_replies")
    .select("tweet_id")
    .eq("reply_tweet_id", parentReplyTweetId)
    .maybeSingle();

  return {
    isFollowUp: !!data?.tweet_id,
    parentInboxTweetId: data?.tweet_id ?? null,
    parentReplyTweetId: data?.tweet_id ? parentReplyTweetId : null,
  };
}

export function conversationHasUsefulHistory(
  thread: ConversationThread,
): boolean {
  return thread.messages.length >= 2;
}

export function isThreadReference(text: string): boolean {
  const normalized = normalizeConversationText(text);
  return THREAD_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function detectConversationShortcut(text: string): ConversationShortcut {
  const normalized = normalizeConversationText(text);
  if (!normalized) return null;

  // Defense in depth for deployments where the turn coordinator is disabled.
  if (isScheduleCapabilityQuestion(text)) {
    return { kind: "capability_help", reply: scheduleCapabilityReply() };
  }

  if (CAPABILITY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { kind: "capability_help", reply: capabilityPromptSummary() };
  }

  if (THANKS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { kind: "thanks", reply: THANKS_REPLY };
  }

  if (
    GREETING_WITH_WELLNESS_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return {
      kind: "greeting_with_wellness",
      reply: GREETING_WITH_WELLNESS_REPLY,
    };
  }

  if (
    TIME_GREETING_WITH_WELLNESS_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  ) {
    return {
      kind: "time_greeting_with_wellness",
      reply: buildTimeGreetingReply(normalized, true),
    };
  }

  if (WELLNESS_QUESTION_PATTERN.test(normalized)) {
    return { kind: "wellness_question", reply: WELLNESS_REPLY };
  }

  if (
    GREETING_WITH_STATUS_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return { kind: "greeting_with_status", reply: GREETING_WITH_STATUS_REPLY };
  }

  if (STATUS_QUESTION_PATTERN.test(normalized)) {
    return { kind: "status_question", reply: STATUS_REPLY };
  }

  if (TIME_GREETING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: "time_greeting",
      reply: buildTimeGreetingReply(normalized, false),
    };
  }

  if (GREETING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { kind: "greeting", reply: GREETING_REPLY };
  }

  return null;
}

export function asksHowLinkrIs(text: string): boolean {
  const normalized = normalizeConversationText(text);
  return (
    WELLNESS_QUESTION_FRAGMENT_PATTERN.test(normalized) ||
    GREETING_WITH_WELLNESS_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    ) ||
    TIME_GREETING_WITH_WELLNESS_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  );
}

export function replyAnswersWellness(text: string): boolean {
  return WELLNESS_REPLY_PATTERNS.some((pattern) =>
    pattern.test(String(text ?? ""))
  );
}

export function shouldAvoidWellnessAnswer(
  userText: string,
  replyText: string,
): boolean {
  return !asksHowLinkrIs(userText) && replyAnswersWellness(replyText);
}

export function extractTokenFollowUpFields(text: string): TokenFollowUpFields {
  const rawText = String(text ?? "");
  const extracted = extractFromText(rawText);
  const uniqueMints = [...new Set(extracted.mints)];
  const uniqueSymbols = [...new Set(extracted.symbols)];
  const dexscreenerUrl = rawText.match(DEXSCREENER_URL_PATTERN)?.[0] ?? null;
  const blockscoutUrl = rawText.match(BLOCKSCOUT_URL_PATTERN)?.[0] ?? null;
  const hasTokenReference = uniqueMints.length > 0 ||
    uniqueSymbols.length > 0 || !!dexscreenerUrl || !!blockscoutUrl;

  return {
    hasTokenReference,
    extraction: {
      token_symbol: uniqueSymbols.length === 1 ? uniqueSymbols[0] : null,
      token_name: null,
      token_address: uniqueMints.length === 1 ? uniqueMints[0] : null,
      token_mint: uniqueMints.length === 1 ? uniqueMints[0] : null,
      token_candidates: uniqueMints,
      dexscreener_url: dexscreenerUrl,
      blockscout_url: blockscoutUrl,
      question: rawText.trim() || null,
      market_query_type: hasTokenReference
        ? inferMarketQueryType(rawText)
        : null,
      market_timeframe: inferMarketTimeframe(rawText),
      sort_by: inferMarketSort(rawText),
      ambiguity_detected: uniqueMints.length > 1 || uniqueSymbols.length > 1,
      missing_fields: [],
      reasoning_summary: hasTokenReference
        ? "token reference provided in conversation follow-up"
        : "conversation follow-up",
    },
  };
}

export function shouldTreatFollowUpAsCoinInquiry(
  parentIntent: string | null,
  text: string,
): boolean {
  if (parentIntent === "coin_inquiry") return true;
  return extractTokenFollowUpFields(text).hasTokenReference;
}

export function looksLikeExplicitCommand(text: string): boolean {
  const normalized = normalizeConversationText(text);
  return EXPLICIT_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeConversationText(text: string): string {
  return String(text ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(/\b(?:linkr|linkrcash)\b/gi, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .toLowerCase()
    .replace(/\bwhat's\b/g, "whats")
    .replace(/\bhow's\b/g, "hows")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTranscriptText(text: string): string {
  return String(text ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function buildTimeGreetingReply(
  normalized: string,
  includeWellness: boolean,
): string {
  const prefix = normalized.startsWith("good afternoon")
    ? "Good afternoon!"
    : normalized.startsWith("good evening") || normalized.startsWith("gn")
    ? "Good evening!"
    : "GM!";

  if (includeWellness) {
    return prefix + " I'm good, thanks for asking. How can I help?";
  }
  return prefix + " How can I help?";
}

function inferMarketQueryType(
  text: string,
): TokenFollowUpFields["extraction"]["market_query_type"] {
  const normalized = normalizeConversationText(text);
  if (
    /\b(buyer|buyers|seller|sellers|swap|swaps|analytics|buy volume|sell volume)\b/
      .test(normalized)
  ) {
    return "token_analytics";
  }
  if (/\b(pair|pool)\b/.test(normalized)) return "pair_stats";
  return "token_lookup";
}

function inferMarketTimeframe(
  text: string,
): TokenFollowUpFields["extraction"]["market_timeframe"] {
  const normalized = normalizeConversationText(text);
  if (/\b5m\b|\b5 min\b|\b5 minute\b/.test(normalized)) return "5m";
  if (/\b1h\b|\b1 hour\b/.test(normalized)) return "1h";
  if (/\b6h\b|\b6 hour\b/.test(normalized)) return "6h";
  if (/\b24h\b|\b24 hour\b|\btoday\b/.test(normalized)) return "24h";
  if (/\b7d\b|\b7 day\b|\bweek\b/.test(normalized)) return "7d";
  return null;
}

function inferMarketSort(
  text: string,
): TokenFollowUpFields["extraction"]["sort_by"] {
  const normalized = normalizeConversationText(text);
  if (/\bvolume\b/.test(normalized)) return "volume";
  if (/\bliquidity\b|\bliq\b/.test(normalized)) return "liquidity";
  if (/\bmarket cap\b|\bmc\b/.test(normalized)) return "market_cap";
  if (/\bprice change\b|\brally\b|\bgain\b|\bgainers\b/.test(normalized)) {
    return "price_change";
  }
  if (/\bboost\b|\bboosted\b/.test(normalized)) return "boosts";
  return null;
}
