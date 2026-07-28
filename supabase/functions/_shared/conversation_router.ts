import {
  detectConversationShortcut,
  isThreadReference,
  looksLikeExplicitCommand,
} from "./conversation.ts";
import { decideLinkrEngagement } from "./linkr_engagement_gate.ts";
import { isScheduleCapabilityQuestion } from "./linkr_schedule_language.ts";
import {
  type LinkrRouteDecision,
  normalizeRouteDecision,
} from "./linkr_route_decision.ts";

export function routeLinkrTurnDeterministic(args: {
  text: string;
  is_follow_up?: boolean;
  ingest_source?: string | null;
  ingest_reason?: string | null;
  parent_reply_tweet_id?: string | null;
  has_media?: boolean;
  has_history?: boolean;
  engagement_gate_enabled?: boolean;
}): LinkrRouteDecision {
  const text = String(args.text ?? "");
  const normalized = normalizeForRoute(text);

  if (
    /\b(private key|seed phrase|recovery phrase|export my key|show my key)\b/
      .test(normalized)
  ) {
    return normalizeRouteDecision({
      route: "safe_refusal",
      intent: "safe_refusal",
      confidence: 0.99,
      reason: "private key or seed phrase request",
    });
  }

  if (
    /\b(guarantee|guaranteed|risk free|sure profit|10x guaranteed)\b/.test(
      normalized,
    )
  ) {
    return normalizeRouteDecision({
      route: "safe_refusal",
      intent: "financial_guarantee_refusal",
      confidence: 0.95,
      reason: "financial guarantee request",
    });
  }

  if (isXSearchRequest(normalized)) {
    return normalizeRouteDecision({
      route: "x_search",
      intent: "x_search",
      confidence: 0.84,
      reason: "live public X search request",
      allowed_tools: ["x.search"],
    });
  }

  if (args.engagement_gate_enabled !== false) {
    const engagement = decideLinkrEngagement({
      text,
      is_follow_up: args.is_follow_up,
      ingest_source: args.ingest_source,
      ingest_reason: args.ingest_reason,
      parent_reply_tweet_id: args.parent_reply_tweet_id,
      has_media: args.has_media,
      has_history: args.has_history,
    });
    if (engagement.action === "ignore") {
      return normalizeRouteDecision({
        route: "ambient_ignore",
        intent: engagement.reason,
        confidence: engagement.confidence,
        reason: engagement.reason,
        requires_reply: false,
      });
    }
  }

  if (/\b(who (are|r) you|what are you)\b/.test(normalized)) {
    return normalizeRouteDecision({
      route: "identity",
      intent: "identity_who",
      confidence: 0.96,
      reason: "identity question",
    });
  }

  if (/\b(who built you|who made you|builder|creator)\b/.test(normalized)) {
    return normalizeRouteDecision({
      route: "identity",
      intent: "identity_builder",
      confidence: 0.96,
      reason: "builder question",
    });
  }

  if (/\b(what model|which model|what engine|lnkr)\b/.test(normalized)) {
    return normalizeRouteDecision({
      route: "identity",
      intent: "identity_model",
      confidence: 0.94,
      reason: "model identity question",
    });
  }

  if (isChainCapabilityQuestion(normalized)) {
    return normalizeRouteDecision({
      route: "capability_help",
      intent: "chain_capability",
      confidence: 0.97,
      reason: "chain capability question",
    });
  }

  if (isScheduleCapabilityQuestion(text)) {
    return normalizeRouteDecision({
      route: "capability_help",
      intent: "schedule_capability",
      confidence: 0.99,
      reason: "schedule capability question",
      allowed_tools: ["action.prepare_schedule"],
    });
  }

  const shortcut = detectConversationShortcut(text);
  if (shortcut?.kind === "capability_help") {
    return normalizeRouteDecision({
      route: "capability_help",
      intent: "capability_help",
      confidence: 0.94,
      reason: "capability question",
    });
  }
  if (shortcut && !looksLikeExplicitCommand(text)) {
    return normalizeRouteDecision({
      route: "small_talk",
      intent: shortcut.kind,
      confidence: 0.9,
      reason: "deterministic small talk",
    });
  }

  if (
    /\b(explain|make sense of|summarize|what does this mean|what is this)\b/
      .test(normalized) &&
    (args.is_follow_up || isThreadReference(text) || args.has_media)
  ) {
    return normalizeRouteDecision({
      route: "post_explanation",
      intent: "post_explanation",
      confidence: 0.82,
      reason: "post or thread explanation request",
      allowed_tools: ["post.explain"],
    });
  }

  if (
    /\b(my .*lp|lp positions|liquidity positions|my pools|show .*liquidity)\b/
      .test(normalized)
  ) {
    return normalizeRouteDecision({
      route: "liquidity_positions",
      intent: "liquidity_positions",
      confidence: 0.88,
      reason: "self liquidity position query",
      allowed_tools: ["liquidity.position_query"],
    });
  }

  if (/\b(pending action|draft|what.*pending|what action)\b/.test(normalized)) {
    return normalizeRouteDecision({
      route: "data_query",
      intent: "pending_action_query",
      confidence: 0.85,
      reason: "current user pending action query",
      allowed_tools: ["draft.status_query"],
    });
  }

  if (
    /\b(biggest buy|recent buys|recent sells|what did i launch|what .*i .*week|my history|recent activity)\b/
      .test(
        normalized,
      )
  ) {
    return normalizeRouteDecision({
      route: "data_query",
      intent: "user_history_query",
      confidence: 0.82,
      reason: "current user history query",
      allowed_tools: ["transaction.query", "launch.query", "activity.query"],
    });
  }

  if (
    /\$[a-z0-9_]{2,12}\b/i.test(text) &&
    /\b(price|liquidity|volume|market cap|chart|what about|token)\b/.test(
      normalized,
    )
  ) {
    return normalizeRouteDecision({
      route: "coin_inquiry",
      intent: "coin_inquiry",
      confidence: 0.78,
      reason: "cashtag market inquiry",
      allowed_tools: ["cashtag.resolve", "market.resolve"],
    });
  }

  if (
    /\b(send|transfer)\b/.test(normalized) &&
    /\b(them|him|her|@\w+)\b/.test(text)
  ) {
    return normalizeRouteDecision({
      route: "transfer_draft",
      intent: "transfer",
      confidence: 0.74,
      reason: "transfer with recipient reference",
      requires_confirmation: true,
      value_moving: true,
      allowed_tools: ["public.user_lookup", "draft.write"],
      missing_fields: /\b(them|him|her)\b/i.test(text) ? ["recipient"] : [],
    });
  }

  return normalizeRouteDecision({
    route: "normal_classifier",
    intent: "normal_classifier",
    confidence: 0.5,
    reason: "legacy classifier adapter",
  });
}

function normalizeForRoute(text: string): string {
  return String(text ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9_$' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isXSearchRequest(normalized: string): boolean {
  return (
    /\b(what are people saying|what people are saying|people saying about|ct saying)\b/
      .test(
        normalized,
      ) ||
    /\b(what are people on (x|twitter) saying|what people on (x|twitter) are saying)\b/
      .test(
        normalized,
      ) ||
    /\b(what is (x|twitter) saying|what (is|are) (x|twitter) people saying)\b/
      .test(
        normalized,
      ) ||
    /\b((x|twitter) sentiment|search (x|twitter)|look on (x|twitter)|check (x|twitter))\b/
      .test(
        normalized,
      ) ||
    /\b(check|search|look up|look for|scan)\b.*\b(x|twitter|ct)\b/.test(
      normalized,
    ) ||
    /\b(x|twitter|ct)\b.*\b(saying|sentiment|posts?|chatter|talking about|mentions?)\b/
      .test(
        normalized,
      )
  );
}

function isChainCapabilityQuestion(normalized: string): boolean {
  return (
    /\b(what|which).*\b(chains?|networks?)\b.*\b(operate|support|work|trade|use|on)\b/
      .test(
        normalized,
      ) ||
    /\b(chains?|networks?)\b.*\b(can you|do you|supported|operate|support|work|trade)\b/
      .test(
        normalized,
      ) ||
    /\b(can you|do you).*\b(operate|support|work|trade).*\b(chains?|networks?|solana|robinhood|evm)\b/
      .test(
        normalized,
      )
  );
}
