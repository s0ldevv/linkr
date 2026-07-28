// deno-lint-ignore-file no-explicit-any
// Public X turn context for Linkr. Keep this bounded and public-safe.

import {
  buildConversationTranscript,
  type ConversationThread,
  loadConversationThread,
} from "./conversation.ts";
import {
  resolveEntitiesFromText,
  resolvePronounReference,
} from "./linkr_entities.ts";
import {
  LINKR_BUILDER_HANDLE,
  LINKR_ENGINE_NAME,
  LINKR_HANDLE,
  LINKR_PERSONA_KERNEL,
} from "./linkr_persona.ts";
import type {
  LinkrEntityRef,
  LinkrFact,
  LinkrPrivacyClass,
} from "./linkr_types.ts";
import {
  extractMarketAddresses,
  inferMarketChainFromText,
  type NormalizedMarketAddress,
  normalizeMarketAddress,
} from "./market_data/chains.ts";
import type { MarketChain } from "./market_data/types.ts";

export interface LinkrPublicPersonaFacts {
  handle: string;
  builder: string;
  engine: string;
  role: string;
  capabilities: string[];
  safety_rules: string[];
  voice_rules: string[];
}

export interface PublicMarketCandidate {
  target: NormalizedMarketAddress;
  source:
    | "current_tweet"
    | "parent_post"
    | "parent_linkr_reply"
    | "thread_context"
    | "conversation_state"
    | "conversation_transcript"
    | "agent_run"
    | "tool_cache";
  confidence: number;
  label?: string | null;
}

export interface PublicMarketResolution {
  target: PublicMarketCandidate | null;
  ambiguous: PublicMarketCandidate[];
  reason: string;
}

export interface LinkrPublicTurnContext {
  tweet: Record<string, unknown>;
  work_item: unknown | null;
  conversation: ConversationThread;
  transcript: string;
  thread_context: Record<string, unknown> | null;
  parent_inbox_tweet: Record<string, unknown> | null;
  parent_linkr_reply: Record<string, unknown> | null;
  active_state: Record<string, unknown> | null;
  persona: LinkrPublicPersonaFacts;
  entities: LinkrEntityRef[];
  facts: LinkrFact[];
  resolved_references: LinkrEntityRef[];
  market_candidates: PublicMarketCandidate[];
  constraints: {
    public_reply: true;
    max_reply_chars: number;
    value_moving_requires_confirmation: true;
    no_private_cross_user_data: true;
  };
}

const MAX_CONTEXT_ROWS = 12;

export async function buildLinkrPublicTurnContext(
  admin: any,
  tweet: Record<string, unknown>,
  workItem: unknown | null = null,
): Promise<LinkrPublicTurnContext> {
  const conversationId = stringOrNull(tweet.conversation_id);
  const participantTwitterId = stringOrNull(tweet.author_twitter_id);
  const [
    conversation,
    threadContext,
    parentInboxTweet,
    parentLinkrReply,
    activeState,
  ] = await Promise.all([
    loadConversationThread(admin, conversationId, MAX_CONTEXT_ROWS),
    loadThreadContext(admin, tweet),
    loadParentInboxTweet(admin, tweet),
    loadParentLinkrReply(admin, tweet),
    loadConversationState(admin, conversationId, participantTwitterId),
  ]);

  const base: LinkrPublicTurnContext = {
    tweet,
    work_item: workItem,
    conversation,
    transcript: buildConversationTranscript(conversation),
    thread_context: threadContext,
    parent_inbox_tweet: parentInboxTweet,
    parent_linkr_reply: parentLinkrReply,
    active_state: activeState,
    persona: linkrPublicPersonaFacts(),
    entities: [],
    facts: [],
    resolved_references: [],
    market_candidates: [],
    constraints: {
      public_reply: true,
      max_reply_chars: 260,
      value_moving_requires_confirmation: true,
      no_private_cross_user_data: true,
    },
  };

  return { ...base, ...resolvePublicReferences(base) };
}

export function linkrPublicPersonaFacts(): LinkrPublicPersonaFacts {
  return {
    handle: LINKR_HANDLE,
    builder: LINKR_BUILDER_HANDLE,
    engine: LINKR_ENGINE_NAME,
    role: "X-native AI wallet and markets agent for Linkr",
    capabilities: [
      "normal public conversation",
      "token questions and balanced market reads",
      "public X search and post/thread explanations when configured",
      "supported wallet, swap, transfer, launch, rewards, and liquidity workflows",
      "Robinhood Chain EVM/ETH and Solana SOL/Pump.fun/PumpSwap flows",
    ],
    safety_rules: [...LINKR_PERSONA_KERNEL.safety_rules],
    voice_rules: [...LINKR_PERSONA_KERNEL.voice_rules],
  };
}

export function resolvePublicReferences(
  context: Pick<
    LinkrPublicTurnContext,
    | "tweet"
    | "thread_context"
    | "parent_inbox_tweet"
    | "parent_linkr_reply"
    | "active_state"
    | "transcript"
  >,
): Pick<
  LinkrPublicTurnContext,
  "entities" | "facts" | "resolved_references" | "market_candidates"
> {
  const current = entitiesFromText(
    String(context.tweet.text ?? ""),
    "current_tweet",
    "public",
  );
  const thread = entitiesFromText(
    String(context.thread_context?.flattened_context ?? ""),
    "thread_context",
    "public",
  );
  const parentPost = entitiesFromText(
    String(context.parent_inbox_tweet?.text ?? ""),
    "parent_post",
    "public",
  );
  const parentReply = entitiesFromText(
    String(context.parent_linkr_reply?.reply_text ?? ""),
    "conversation_memory",
    "public",
  );
  const transcript = entitiesFromText(
    String(context.transcript ?? ""),
    "conversation_memory",
    "public",
  );
  const priorEntities = readPriorEntities(context.active_state);
  const entities = dedupeEntities([
    ...current.entities,
    ...parentPost.entities,
    ...parentReply.entities,
    ...thread.entities,
    ...priorEntities,
    ...transcript.entities,
  ]);
  const facts = dedupeFacts([
    ...current.facts,
    ...parentPost.facts,
    ...parentReply.facts,
    ...thread.facts,
    ...transcript.facts,
  ]);
  const pronoun = resolvePronounReference(
    String(context.tweet.text ?? ""),
    entities,
  );
  return {
    entities,
    facts,
    resolved_references: pronoun ? [pronoun] : [],
    market_candidates: collectMarketCandidates(context, entities),
  };
}

export function resolveMarketTargetForTurn(
  context: Pick<LinkrPublicTurnContext, "tweet" | "market_candidates">,
  kind: string | null,
): PublicMarketResolution {
  const current = uniqueMarketCandidates(
    context.market_candidates.filter((candidate) =>
      candidate.source === "current_tweet"
    ),
  );
  if (current.length === 1) {
    return { target: current[0], ambiguous: [], reason: "current_tweet" };
  }
  if (current.length > 1) {
    return {
      target: null,
      ambiguous: current,
      reason: "ambiguous_current_tweet",
    };
  }

  if (
    !shouldUseContextualMarketTarget(String(context.tweet.text ?? ""), kind)
  ) {
    return { target: null, ambiguous: [], reason: "not_market_relevant" };
  }

  const contextualSources: PublicMarketCandidate["source"][] = [
    "parent_post",
    "thread_context",
    "conversation_state",
    "parent_linkr_reply",
    "agent_run",
    "tool_cache",
    "conversation_transcript",
  ];
  for (const source of contextualSources) {
    const scoped = uniqueMarketCandidates(
      context.market_candidates.filter((candidate) =>
        candidate.source === source
      ),
    );
    if (scoped.length === 1) {
      return { target: scoped[0], ambiguous: [], reason: source };
    }
    if (scoped.length > 1) {
      return { target: null, ambiguous: scoped, reason: `ambiguous_${source}` };
    }
  }

  return { target: null, ambiguous: [], reason: "not_found" };
}

export function publicMarketEntity(
  candidate: PublicMarketCandidate,
  facts: Record<string, unknown> | null = null,
): LinkrEntityRef {
  const symbol = stringOrNull(facts?.symbol) ??
    stringOrNull(facts?.token_symbol) ??
    candidate.label ?? null;
  const label = symbol ?? shortAddress(candidate.target.address);
  return {
    id:
      `token:${candidate.target.chain}:${candidate.target.address.toLowerCase()}`,
    kind: "token",
    label,
    value: {
      chain: candidate.target.chain,
      address: candidate.target.address,
      symbol,
      facts_digest: digestMarketFacts(facts),
    },
    source: candidate.source === "conversation_state"
      ? "conversation_memory"
      : "market_resolver",
    confidence: candidate.confidence,
    freshness: "current",
    privacy: "public",
    evidence_fact_ids: [],
  };
}

function shouldUseContextualMarketTarget(
  text: string,
  kind: string | null,
): boolean {
  if (kind === "coin_inquiry" || kind === "trade_advice") return true;
  return /\b(it|this|that|same one|coin|token|ticker|ca|contract|mint|chart|buy|sell|hold|entry|exit|risk|liquidity|volume|market cap|price|holders?)\b/i
    .test(text);
}

function collectMarketCandidates(
  context: Pick<
    LinkrPublicTurnContext,
    | "tweet"
    | "thread_context"
    | "parent_inbox_tweet"
    | "parent_linkr_reply"
    | "active_state"
    | "transcript"
  >,
  entities: LinkrEntityRef[],
): PublicMarketCandidate[] {
  const candidates: PublicMarketCandidate[] = [];
  pushTextCandidates(
    candidates,
    String(context.tweet.text ?? ""),
    "current_tweet",
    1,
  );
  pushThreadDetectedMints(candidates, context.thread_context, 0.84);
  pushTextCandidates(
    candidates,
    String(context.thread_context?.flattened_context ?? ""),
    "thread_context",
    0.78,
  );
  pushTextCandidates(
    candidates,
    String(context.parent_inbox_tweet?.text ?? ""),
    "parent_post",
    0.9,
  );
  pushTextCandidates(
    candidates,
    String(context.parent_linkr_reply?.reply_text ?? ""),
    "parent_linkr_reply",
    0.68,
  );
  pushActiveStateCandidates(candidates, context.active_state, 0.88);
  pushTextCandidates(
    candidates,
    String(context.transcript ?? ""),
    "conversation_transcript",
    0.65,
  );
  for (const entity of entities) {
    pushEntityCandidate(candidates, entity, 0.72);
  }
  return uniqueMarketCandidates(candidates);
}

function pushTextCandidates(
  out: PublicMarketCandidate[],
  text: string,
  source: PublicMarketCandidate["source"],
  confidence: number,
) {
  for (const target of extractMarketAddresses(text)) {
    out.push({ target, source, confidence });
  }
}

function pushThreadDetectedMints(
  out: PublicMarketCandidate[],
  thread: Record<string, unknown> | null,
  confidence: number,
) {
  const chainHint = inferMarketChainFromText(thread?.flattened_context);
  const mints = Array.isArray(thread?.detected_mints)
    ? thread.detected_mints
    : [];
  for (const mint of mints) {
    const target = normalizeCandidateForChain(mint, chainHint);
    if (target) out.push({ target, source: "thread_context", confidence });
  }
}

function pushActiveStateCandidates(
  out: PublicMarketCandidate[],
  activeState: Record<string, unknown> | null,
  confidence: number,
) {
  const entities = readPriorEntities(activeState);
  for (const entity of entities) {
    pushEntityCandidate(out, entity, confidence);
  }
}

function pushEntityCandidate(
  out: PublicMarketCandidate[],
  entity: LinkrEntityRef,
  fallbackConfidence: number,
) {
  if (entity.kind !== "token") return;
  const target = marketTargetFromEntity(entity);
  if (!target) return;
  out.push({
    target,
    source: entity.source === "conversation_memory"
      ? "conversation_state"
      : entity.source === "thread_context"
      ? "thread_context"
      : entity.source === "parent_post"
      ? "parent_post"
      : "conversation_transcript",
    confidence: Math.max(entity.confidence ?? 0, fallbackConfidence),
    label: entity.label,
  });
}

function marketTargetFromEntity(
  entity: LinkrEntityRef,
): NormalizedMarketAddress | null {
  if (entity.value && typeof entity.value === "object") {
    const value = entity.value as Record<string, unknown>;
    const address = stringOrNull(value.address) ?? stringOrNull(value.mint) ??
      stringOrNull(value.token_address);
    const chain = normalizeChain(value.chain);
    const normalized = normalizeMarketAddress(address);
    if (normalized && (!chain || normalized.chain === chain)) return normalized;
  }
  const normalized = normalizeMarketAddress(entity.value);
  if (!normalized) return null;
  const idChain = entity.id.match(/^token:(solana|robinhood):/i)?.[1] as
    | MarketChain
    | undefined;
  if (idChain && normalized.chain !== idChain) {
    return { ...normalized, chain: idChain };
  }
  return normalized;
}

function normalizeCandidateForChain(
  value: unknown,
  chainHint: MarketChain | null,
): NormalizedMarketAddress | null {
  const normalized = normalizeMarketAddress(value);
  if (!normalized || (chainHint && normalized.chain !== chainHint)) return null;
  return normalized;
}

function uniqueMarketCandidates(
  candidates: PublicMarketCandidate[],
): PublicMarketCandidate[] {
  const byKey = new Map<string, PublicMarketCandidate>();
  for (const candidate of candidates) {
    const key =
      `${candidate.target.chain}:${candidate.target.address.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

function entitiesFromText(
  text: string,
  source: LinkrEntityRef["source"],
  privacy: LinkrPrivacyClass,
) {
  return text.trim()
    ? resolveEntitiesFromText({ text, source, privacy })
    : { entities: [], facts: [] };
}

function readPriorEntities(
  activeState: Record<string, unknown> | null,
): LinkrEntityRef[] {
  const raw = activeState?.active_entities;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) =>
    item && typeof item === "object"
  ) as LinkrEntityRef[];
}

function dedupeEntities(entities: LinkrEntityRef[]): LinkrEntityRef[] {
  const seen = new Set<string>();
  const out: LinkrEntityRef[] = [];
  for (const entity of entities) {
    const key = entity.id ||
      `${entity.kind}:${String(entity.value).toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entity);
  }
  return out.slice(0, 24);
}

function dedupeFacts(facts: LinkrFact[]): LinkrFact[] {
  const seen = new Set<string>();
  const out: LinkrFact[] = [];
  for (const fact of facts) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    out.push(fact);
  }
  return out.slice(0, 24);
}

function digestMarketFacts(
  facts: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!facts) return null;
  const keys = [
    "symbol",
    "name",
    "chain",
    "token_address",
    "price_usd",
    "liquidity_usd",
    "volume_24h_usd",
    "market_cap_usd",
    "fdv_usd",
    "warnings",
  ];
  const digest: Record<string, unknown> = {};
  for (const key of keys) {
    if (facts[key] !== undefined && facts[key] !== null) {
      digest[key] = facts[key];
    }
  }
  return Object.keys(digest).length ? digest : null;
}

async function loadThreadContext(admin: any, tweet: Record<string, unknown>) {
  const ids = uniqueStrings([
    tweet.tweet_id,
    tweet.parent_inbox_tweet_id,
    tweet.referenced_tweet_id,
    tweet.parent_tweet_id,
    tweet.root_tweet_id,
  ]);
  if (ids.length === 0) return null;
  const { data } = await admin
    .from("tweet_thread_contexts")
    .select("*")
    .in("tweet_id", ids)
    .order("created_at", { ascending: false })
    .limit(ids.length);
  const rows = data ?? [];
  for (const id of ids) {
    const row = rows.find((item: any) => item?.tweet_id === id);
    if (row) return row;
  }
  return rows[0] ?? null;
}

async function loadParentInboxTweet(
  admin: any,
  tweet: Record<string, unknown>,
) {
  const id = stringOrNull(tweet.parent_inbox_tweet_id);
  if (!id) return null;
  const { data } = await admin
    .from("tweets_inbox")
    .select(
      "tweet_id,conversation_id,author_twitter_id,author_username,text,created_at",
    )
    .eq("tweet_id", id)
    .maybeSingle();
  return data ?? null;
}

async function loadParentLinkrReply(
  admin: any,
  tweet: Record<string, unknown>,
) {
  const id = stringOrNull(tweet.parent_reply_tweet_id);
  if (!id) return null;
  const { data } = await admin
    .from("twitter_replies")
    .select(
      "id,tweet_id,reply_tweet_id,conversation_id,author_twitter_id,reply_text,reply_kind,created_at,posted_at",
    )
    .eq("reply_tweet_id", id)
    .maybeSingle();
  return data ?? null;
}

async function loadConversationState(
  admin: any,
  conversationId: string | null,
  participantTwitterId: string | null,
) {
  if (!conversationId || !participantTwitterId) return null;
  const { data } = await admin
    .from("linkr_conversation_state")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("participant_twitter_id", participantTwitterId)
    .maybeSingle();
  return data ?? null;
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values.map(stringOrNull).filter((value): value is string => !!value),
    ),
  ];
}

function normalizeChain(value: unknown): MarketChain | null {
  return value === "solana" || value === "robinhood" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function shortAddress(value: string): string {
  return value.length > 12
    ? `${value.slice(0, 4)}...${value.slice(-4)}`
    : value;
}
