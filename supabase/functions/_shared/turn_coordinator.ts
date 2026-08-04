import { buildConversationTranscript } from "./conversation.ts";
import {
  capabilityPromptSummary,
  chainCapabilityReply,
} from "./linkr_capabilities.ts";
import { routeLinkrTurnDeterministic } from "./conversation_router.ts";
import {
  insertAgentRunOnce,
  queueReplyOnce,
  stableIdempotencyKey,
  upsertConversationState,
} from "./linkr_idempotency.ts";
import { linkrIdentityReply, smallTalkReply } from "./linkr_persona.ts";
import { scheduleCapabilityReply } from "./linkr_schedule_language.ts";
import { getRouteResourceBundle } from "./linkr_route_resources.ts";
import { buildLinkrWorkingFrame } from "./linkr_working_frame.ts";
import { loadLinkrWorldState } from "./world_state.ts";
import type { LinkrReplyPlan, LinkrTurnOutcome } from "./linkr_types.ts";
import { composeReplyPlanText } from "./linkr_reply_composer.ts";
import { searchPublicX } from "./x_search_tool.ts";
import { isLinkrBotHandle } from "./x_bot_identity.ts";

export interface ProcessLinkrTurnArgs {
  admin: any;
  tw: Record<string, unknown>;
  profile: Record<string, unknown>;
  wallet: Record<string, unknown>;
  user_context: Record<string, unknown>;
  thread_context: Record<string, unknown> | null;
  engagement_gate_enabled?: boolean;
}

export async function processLinkrTurn(
  args: ProcessLinkrTurnArgs,
): Promise<LinkrTurnOutcome> {
  const world = await loadLinkrWorldState(args);
  const frame = buildLinkrWorkingFrame(world);
  const decision = routeLinkrTurnDeterministic({
    text: String(args.tw.text ?? ""),
    is_follow_up: Boolean(args.tw.is_follow_up),
    ingest_source: String(args.tw.ingest_source ?? "") || null,
    ingest_reason: String(args.tw.ingest_reason ?? "") || null,
    parent_reply_tweet_id: String(args.tw.parent_reply_tweet_id ?? "") || null,
    has_media: Boolean(args.tw.has_media),
    has_history: world.conversation.total_count > 0,
    engagement_gate_enabled: args.engagement_gate_enabled,
  });
  frame.selected_route = decision.route;
  const bundle = getRouteResourceBundle(decision.route);

  if (decision.route === "normal_classifier") {
    await traceRun(args, {
      status: "delegated",
      route: decision.route,
      telemetry: { route_decision: decision, route_resources: bundle },
    });
    return {
      status: "delegated",
      route: decision.route,
      telemetry: { route_decision: decision, working_frame: frame },
    };
  }
  if (decision.route === "ambient_ignore") {
    const outcome: LinkrTurnOutcome = {
      status: "ignored",
      route: decision.route,
      telemetry: {
        route_decision: decision,
        working_frame: frame,
        route_resources: bundle,
      },
      error: decision.reason,
    };
    frame.outcome = outcome;
    await traceRun(args, outcome);
    return outcome;
  }
  if (decision.route === "x_search") {
    return await executeXSearchTurn(args, decision, frame, bundle);
  }

  const replyPlan = buildDeterministicReplyPlan(
    args,
    decision.intent,
    decision.route,
    frame,
  );
  const composed = composeReplyPlanText(replyPlan);
  replyPlan.text = composed.text;
  const queued = await queueReplyOnce(args.admin, {
    tweet_id: String(args.tw.tweet_id ?? ""),
    reply_text: composed.text,
    idempotency_key: replyPlan.idempotency_key,
    conversation_id: String(args.tw.conversation_id ?? "") || null,
    author_twitter_id: String(args.tw.author_twitter_id ?? "") || null,
    reply_kind: replyPlan.reply_kind ?? decision.route,
    lint_result: composed.lint as unknown as Record<string, unknown>,
  });

  const outcome: LinkrTurnOutcome = {
    status: "completed",
    route: decision.route,
    reply_plan: replyPlan,
    telemetry: {
      route_decision: decision,
      route_resources: bundle,
      working_frame: frame,
      queued_reply_id: queued.data?.id ?? null,
      reply_used_fallback: composed.used_fallback,
    },
  };
  frame.outcome = outcome;
  await traceRun(args, outcome);
  await upsertState(
    args,
    decision.route,
    frame,
    queued.data?.reply_tweet_id ?? null,
  );
  return outcome;
}

async function executeXSearchTurn(
  args: ProcessLinkrTurnArgs,
  decision: any,
  frame: ReturnType<typeof buildLinkrWorkingFrame>,
  bundle: ReturnType<typeof getRouteResourceBundle>,
): Promise<LinkrTurnOutcome> {
  const search = buildXSearchRequest(args);
  const [recent, relevant] = await Promise.all([
    searchPublicX({
      query: search.query,
      max_results: 10,
      sort_order: "recency",
    }),
    searchPublicX({
      query: search.query,
      max_results: 10,
      sort_order: "relevancy",
    }),
  ]);
  const replyText = buildXSearchReply({
    topic: search.topic,
    query: search.query,
    recentPosts: recent.facts.posts,
    relevantPosts: relevant.facts.posts,
    recentOk: recent.ok,
    relevantOk: relevant.ok,
    error: recent.error ?? relevant.error ?? null,
  });
  const fallback =
    "I could not get a clean X read right now. Send the cashtag, CA, mint, or profile handle and I will try a narrower public search.";
  const idempotencyKey = stableIdempotencyKey(
    "reply",
    String(args.tw.tweet_id ?? ""),
    "x_search",
  );
  const replyPlan = plan(
    "x_search",
    decision.intent,
    replyText,
    idempotencyKey,
    fallback,
  );
  replyPlan.facts = [
    {
      id: stableIdempotencyKey(
        "fact",
        String(args.tw.tweet_id ?? ""),
        "x_search",
      ),
      source: "x_search",
      privacy: "external_untrusted",
      summary: `Searched public X for ${search.topic}`,
      value: {
        query: search.query,
        recent_count: recent.facts.posts.length,
        relevant_count: relevant.facts.posts.length,
        recent_ok: recent.ok,
        relevant_ok: relevant.ok,
        errors: [recent.error, relevant.error].filter(Boolean),
      },
      confidence: recent.answerable || relevant.answerable ? 0.75 : 0.25,
      freshness: "current",
      evidence: null,
    },
  ];
  const composed = composeReplyPlanText(replyPlan);
  replyPlan.text = composed.text;

  const queued = await queueReplyOnce(args.admin, {
    tweet_id: String(args.tw.tweet_id ?? ""),
    reply_text: composed.text,
    idempotency_key: replyPlan.idempotency_key,
    conversation_id: String(args.tw.conversation_id ?? "") || null,
    author_twitter_id: String(args.tw.author_twitter_id ?? "") || null,
    reply_kind: "x_search",
    lint_result: composed.lint as unknown as Record<string, unknown>,
  });

  const outcome: LinkrTurnOutcome = {
    status: "completed",
    route: decision.route,
    reply_plan: replyPlan,
    telemetry: {
      route_decision: decision,
      route_resources: bundle,
      working_frame: frame,
      queued_reply_id: queued.data?.id ?? null,
      reply_used_fallback: composed.used_fallback,
      tool_results: {
        query: search.query,
        topic: search.topic,
        recent,
        relevant,
      },
    },
  };
  frame.outcome = outcome;
  await traceRun(args, outcome);
  await upsertState(
    args,
    decision.route,
    frame,
    queued.data?.reply_tweet_id ?? null,
  );
  return outcome;
}

function buildDeterministicReplyPlan(
  args: ProcessLinkrTurnArgs,
  intent: string,
  route: string,
  frame: ReturnType<typeof buildLinkrWorkingFrame>,
): LinkrReplyPlan {
  const text = String(args.tw.text ?? "");
  const idempotencyKey = stableIdempotencyKey(
    "reply",
    args.tw.tweet_id as string,
    route,
  );
  const fallback =
    "I can help, but I need one clearer detail before I touch anything.";
  if (route === "identity") {
    const kind = intent === "identity_builder"
      ? "builder"
      : intent === "identity_model"
      ? "model"
      : "who";
    return plan(
      route,
      intent,
      linkrIdentityReply(kind),
      idempotencyKey,
      fallback,
    );
  }
  if (route === "capability_help") {
    const reply = intent === "chain_capability"
      ? chainCapabilityReply()
      : intent === "schedule_capability"
      ? scheduleCapabilityReply()
      : capabilityPromptSummary();
    return plan(route, intent, reply, idempotencyKey, fallback);
  }
  if (route === "small_talk") {
    return plan(
      route,
      intent,
      smallTalkReply(text),
      idempotencyKey,
      "Hey. What should I help with?",
    );
  }
  if (route === "safe_refusal") {
    const refusal = /key|seed/i.test(text)
      ? "I cannot export or reveal private keys or seed phrases. Use the Linkr app wallet controls for safe account actions."
      : "I cannot guarantee returns or call something risk-free. I can help read the data, but you should DYOR before acting.";
    return plan(route, intent, refusal, idempotencyKey, refusal, "refusal");
  }
  if (route === "post_explanation") {
    const context = String(args.thread_context?.flattened_context ?? "").trim();
    const reply = context
      ? `That post is about ${context.replace(/\s+/g, " ").slice(0, 180)}`
      : "I cannot see enough of the parent post yet. Reply with the post text, chart, or contract address and I will break it down.";
    return plan(route, intent, reply, idempotencyKey, fallback);
  }
  if (route === "x_search") {
    return plan(
      route,
      intent,
      "I can search live public X when the search tool is enabled. For now, send the ticker or topic and I will use the available market/thread context.",
      idempotencyKey,
      fallback,
    );
  }
  if (route === "coin_inquiry") {
    return plan(
      route,
      intent,
      "I can look up that token, but I need the contract address or mint if the ticker is ambiguous. Reply with the CA for the exact one.",
      idempotencyKey,
      "Reply with the token contract address or mint and I will check it.",
      "clarification",
    );
  }
  if (route === "liquidity_positions") {
    return plan(
      route,
      intent,
      "I can show your Linkr LP positions, but private wallet details stay scoped to you. Use the app for full position IDs and balances.",
      idempotencyKey,
      fallback,
    );
  }
  if (route === "data_query") {
    return plan(
      route,
      intent,
      "I can answer from your Linkr history without exposing raw records. If you want a specific slice, ask by action, token, amount, or date.",
      idempotencyKey,
      fallback,
    );
  }
  if (route === "transfer_draft") {
    return plan(
      route,
      intent,
      "Who should receive it? Reply with an X handle, ETH address, or SOL address. No TX created yet.",
      idempotencyKey,
      "Reply with the recipient handle or address. No TX created yet.",
      "clarification",
    );
  }
  return plan(route, intent, fallback, idempotencyKey, fallback);
}

function plan(
  route: string,
  intent: string,
  text: string,
  idempotencyKey: string,
  fallback: string,
  mode: LinkrReplyPlan["mode"] = "deterministic",
): LinkrReplyPlan {
  return {
    mode,
    intent,
    text,
    facts: [],
    privacy: ["public"],
    fallback_text: fallback,
    idempotency_key: idempotencyKey,
    reply_kind: route,
  };
}

export function buildXSearchRequest(
  args: ProcessLinkrTurnArgs,
): { query: string; topic: string } {
  const tweetText = String(args.tw.text ?? "");
  const thread = args.thread_context ?? {};
  const parentTexts = Array.isArray((thread as any).parent_chain)
    ? (thread as any).parent_chain.map((item: any) => String(item?.text ?? ""))
    : [];
  const flattened = String((thread as any).flattened_context ?? "");
  const detectedMints = Array.isArray((thread as any).detected_mints)
    ? (thread as any).detected_mints.map((item: any) =>
      String(item ?? "").trim()
    ).filter(Boolean)
    : [];
  const handle = extractProfileHandle(tweetText);
  if (handle) {
    return {
      topic: `@${handle}`,
      query: truncateQuery(`from:${handle} -is:retweet`),
    };
  }

  const symbol = firstCashtag(tweetText) ??
    firstCashtag(parentTexts.join("\n")) ??
    firstCashtag(flattened) ??
    firstTokenSymbol(tweetText) ??
    firstTokenSymbol(parentTexts.join("\n")) ??
    firstTokenSymbol(flattened);
  const mint = detectedMints[0] ?? null;
  if (symbol) {
    const clean = symbol.toUpperCase();
    const terms = [`$${clean}`, clean];
    if (mint) terms.push(mint);
    return {
      topic: clean,
      query: truncateQuery(terms.join(" OR ") + " -is:retweet"),
    };
  }
  if (mint) {
    return {
      topic: shortTopic(mint),
      query: truncateQuery(`${mint} -is:retweet`),
    };
  }

  const cleaned = tweetText
    .replace(/@\w+/g, " ")
    .replace(
      /\b(search|twitter|x|sentiment|people|saying|about|what|are|is|on)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return {
    topic: cleaned ? truncate(cleaned, 32) : "that topic",
    query: truncateQuery(
      (cleaned || tweetText.replace(/@\w+/g, " ")).trim() + " -is:retweet",
    ),
  };
}

export function buildXSearchReply(args: {
  topic: string;
  query: string;
  recentPosts: Array<Record<string, unknown>>;
  relevantPosts: Array<Record<string, unknown>>;
  recentOk: boolean;
  relevantOk: boolean;
  error?: string | null;
}): string {
  if (!args.recentOk && !args.relevantOk) {
    return args.error === "missing_query_or_bearer"
      ? "Live X search is not configured right now. Send the CA, mint, or cashtag and I can still use market data for a read."
      : `I could not get a clean public X read for ${args.topic} right now. Try the cashtag, CA, mint, or profile handle again.`;
  }

  const posts = dedupePosts([...args.relevantPosts, ...args.recentPosts]);
  if (posts.length === 0) {
    return `I searched public X for ${args.topic} and found little recent chatter. That is a weak social signal; lean on chart, liquidity, and volume too. DYOR`;
  }

  const scored = scorePosts(posts);
  const sentiment = scored.score >= 2
    ? "bullish"
    : scored.score <= -2
    ? "cautious"
    : scored.positive > 0 && scored.negative > 0
    ? "mixed"
    : "neutral/mixed";
  const theme = scored.negative > scored.positive
    ? "risk and downside talk stand out"
    : scored.positive > scored.negative
    ? "hype and interest stand out"
    : "no strong consensus stands out";
  return truncate(
    `${args.topic} X read: ${sentiment}. Checked ${posts.length} public posts across top/new search; ${theme}. Treat it as noisy social signal, not a buy/sell call. DYOR`,
    260,
  );
}

function extractProfileHandle(text: string): string | null {
  if (
    !/\b(profile|posts|posted|saying|say|look through|recent)\b/i.test(text)
  ) return null;
  const handles = [...String(text ?? "").matchAll(/@([A-Za-z0-9_]{1,15})/g)]
    .map((match) => match[1])
    .filter((handle) => !isLinkrBotHandle(handle));
  return handles[0] ?? null;
}

function firstCashtag(text: string): string | null {
  const match = String(text ?? "").match(/\$([A-Za-z][A-Za-z0-9_]{1,15})/);
  return match?.[1]?.toUpperCase() ?? null;
}

function firstTokenSymbol(text: string): string | null {
  const blocked = new Set([
    "API",
    "CA",
    "DYOR",
    "ETH",
    "EVM",
    "FDV",
    "LP",
    "MC",
    "SOL",
    "TX",
    "USD",
    "X",
  ]);
  const matches = [...String(text ?? "").matchAll(/\b[A-Z][A-Z0-9_]{2,15}\b/g)];
  for (const match of matches) {
    const symbol = match[0].toUpperCase();
    if (!blocked.has(symbol) && !/^\d+$/.test(symbol)) return symbol;
  }
  return null;
}

function dedupePosts(
  posts: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const deduped: Array<Record<string, unknown>> = [];
  for (const post of posts) {
    const id = String(post?.id ?? "");
    const text = String(post?.text ?? "");
    const key = id || text.slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(post);
  }
  return deduped.slice(0, 20);
}

function scorePosts(posts: Array<Record<string, unknown>>): {
  score: number;
  positive: number;
  negative: number;
} {
  const positiveWords =
    /\b(bullish|send|sending|moon|mooning|pump|pumping|based|strong|accumulate|buying|gem|sendor|winner|green|breakout|reversal)\b/i;
  const negativeWords =
    /\b(bearish|dump|dumping|rug|scam|dead|avoid|sell|selling|red|weak|down|rekt|risk|caution|careful|exit)\b/i;
  let positive = 0;
  let negative = 0;
  for (const post of posts) {
    const text = String(post?.text ?? "");
    if (positiveWords.test(text)) positive += 1;
    if (negativeWords.test(text)) negative += 1;
  }
  return { score: positive - negative, positive, negative };
}

function truncateQuery(value: string): string {
  return truncate(value.replace(/\s+/g, " ").trim(), 240);
}

function truncate(value: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function shortTopic(value: string): string {
  const text = String(value ?? "").trim();
  if (text.length <= 14) return text;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

async function traceRun(args: ProcessLinkrTurnArgs, outcome: LinkrTurnOutcome) {
  const inserted = await insertAgentRunOnce(args.admin, {
    tweet_id: args.tw.tweet_id,
    user_id: args.profile.user_id,
    intent: outcome.route,
    status: outcome.status === "delegated" ? "completed" : outcome.status,
    idempotency_key: stableIdempotencyKey(
      "coordinator",
      args.tw.tweet_id as string,
      outcome.route,
    ),
    route_decision: outcome.telemetry && "route_decision" in outcome.telemetry
      ? outcome.telemetry.route_decision
      : null,
    working_frame: outcome.telemetry && "working_frame" in outcome.telemetry
      ? outcome.telemetry.working_frame
      : null,
    reply_plan: outcome.reply_plan ?? null,
    route_resources: outcome.telemetry && "route_resources" in outcome.telemetry
      ? outcome.telemetry.route_resources
      : null,
    outcome,
    completed_at: new Date().toISOString(),
  });
  if (inserted.error) throw inserted.error;
  if (!inserted.data?.id) {
    throw new Error("agent_run_trace_insert_returned_no_id");
  }
}

async function upsertState(
  args: ProcessLinkrTurnArgs,
  route: string,
  frame: ReturnType<typeof buildLinkrWorkingFrame>,
  replyTweetId: string | null,
) {
  await upsertConversationState(args.admin, {
    conversation_id: args.tw.conversation_id,
    participant_twitter_id: args.tw.author_twitter_id,
    user_id: args.profile.user_id,
    active_topic: frame.resolved_references[0] ?? frame.entity_ledger[0] ??
      null,
    active_entities: frame.entity_ledger.slice(0, 12),
    last_route: route,
    last_reply_tweet_id: replyTweetId,
    anti_repetition: { last_reply_kind: route },
  });
}

export function conversationTranscriptForTelemetry(worldConversation: {
  messages: Array<Record<string, unknown>>;
  total_count: number;
  conversation_id: string | null;
}) {
  return buildConversationTranscript({
    messages: worldConversation.messages as never,
    total_count: worldConversation.total_count,
    conversation_id: worldConversation.conversation_id,
  });
}
