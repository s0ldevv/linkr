import { composeXAiReply, type XAiRoute } from "../_shared/x_ai_intake.ts";
import { type NormalizedMarketAddress } from "../_shared/market_data/chains.ts";
import {
  buildPublicMarketFacts,
  getMarketDataBundle,
} from "../_shared/market_data/index.ts";
import { routeLinkrTurnDeterministic } from "../_shared/conversation_router.ts";
import { chainCapabilityReply } from "../_shared/linkr_capabilities.ts";
import {
  insertAgentRunOnce,
  stableIdempotencyKey,
  upsertConversationState,
} from "../_shared/linkr_idempotency.ts";
import { linkrIdentityReply } from "../_shared/linkr_persona.ts";
import { scheduleCapabilityReply } from "../_shared/linkr_schedule_language.ts";
import {
  LINKR_STAGE_WORKER_FUNCTIONS,
  linkrQueueForRoute,
} from "../_shared/queue_contracts.ts";
import {
  isLinkrFastHandoffEnabled,
  scheduleBackgroundTask,
  wakeAndDispatchStage,
} from "../_shared/internal_pipeline.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import { lintPublicReply, sanitizePublicReply } from "../_shared/reply_lint.ts";
import {
  buildLinkrPublicTurnContext,
  type LinkrPublicTurnContext,
  publicMarketEntity,
  type PublicMarketResolution,
  resolveMarketTargetForTurn,
} from "../_shared/x_public_turn_context.ts";

const VERSION = "worker-conversation-turn-v1";
const STAGES = [
  "conversation_turns_high",
  "conversation_turns_normal",
] as const;

Deno.serve((req) =>
  runStageWorker(req, {
    stages: STAGES,
    functionName: "worker-conversation-turn",
    consumerVersion: VERSION,
    visibilitySeconds: 120,
    process: async (claim, admin) => {
      const tweetId = String(claim.work_item.source_event_id ?? "");
      const { data: tweet, error } = await admin.from("tweets_inbox").select(
        "*",
      )
        .eq("tweet_id", tweetId).maybeSingle();
      if (error) throw error;
      if (!tweet) {
        return { kind: "dead_letter", reasonCode: "x_tweet_not_found" };
      }
      const text = String(tweet.text ?? "");
      const userId = await resolveUserId(admin, claim.work_item.user_id, tweet);
      let context: LinkrPublicTurnContext;
      try {
        context = await buildLinkrPublicTurnContext(
          admin,
          tweet,
          claim.work_item,
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "x_public_turn_context_error",
            tweet_id: tweetId,
            message: String(error instanceof Error ? error.message : error)
              .slice(0, 300),
          }),
        );
        return {
          kind: "retry",
          errorCode: "x_public_turn_context_failed",
          delaySeconds: 60,
        };
      }

      const deterministic = deterministicPublicReply(tweet, context);
      if (deterministic) {
        const queued = await admin.rpc("enqueue_linkr_x_reply_v1", {
          p_parent_work_item_id: claim.work_item.id,
          p_reply_text: deterministic.text,
          p_kind: deterministic.kind,
          p_version: 1,
          p_priority: claim.work_item.priority,
        });
        if (queued.error) throw queued.error;
        await markTweetCompleted(admin, tweetId);
        await wakeReplyStage(admin, claim.work_item.priority);
        await tracePublicTurn(admin, {
          tweet,
          workItem: claim.work_item,
          userId,
          route: deterministic.kind,
          mode: "deterministic",
          routeDecision: deterministic.routeDecision,
          context,
          marketResolution: null,
          marketFacts: null,
          replyText: deterministic.text,
          lint: deterministic.lint,
          queued: queued.data,
          status: "completed",
        });
        await persistPublicConversationState(admin, {
          tweet,
          userId,
          route: deterministic.kind,
          context,
          marketResolution: null,
          marketFacts: null,
          replyText: deterministic.text,
        });
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `reply-work-item:${queued.data.reply_work_item_id}`,
        };
      }

      const kind = tweet.ai_route_kind === "coin_inquiry" ||
          tweet.ai_route_kind === "trade_advice"
        ? tweet.ai_route_kind
        : "conversation";
      const marketResolution = resolveMarketTargetForTurn(context, kind);
      const marketTarget = marketResolution.target?.target ?? null;
      const route: XAiRoute = {
        lane: "reply",
        reply_kind: kind,
        token_address: marketTarget?.address ?? null,
        token_symbol: null,
        token_chain: marketTarget?.chain ?? null,
        reason: String(tweet.ai_route_reason ?? "conversation"),
      };

      let reply;
      let marketFacts: Record<string, unknown> | null = null;
      try {
        marketFacts = marketTarget
          ? await resolveMarketFacts(admin, marketTarget)
          : null;
        reply = await composeXAiReply({
          text: tweet.text,
          route,
          conversation: context.transcript,
          context,
          marketResolution,
          marketFacts,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "x_reply_composition_error",
            tweet_id: tweetId,
            message: String(error instanceof Error ? error.message : error)
              .slice(0, 300),
          }),
        );
        return {
          kind: "retry",
          errorCode: "x_reply_composition_failed",
          delaySeconds: 60,
        };
      }
      const queued = await admin.rpc("enqueue_linkr_x_reply_v1", {
        p_parent_work_item_id: claim.work_item.id,
        p_reply_text: reply.text,
        p_kind: `conversation_${kind}`,
        p_version: 1,
        p_priority: claim.work_item.priority,
      });
      if (queued.error) throw queued.error;
      await markTweetCompleted(admin, tweetId);
      await wakeReplyStage(admin, claim.work_item.priority);
      await tracePublicTurn(admin, {
        tweet,
        workItem: claim.work_item,
        userId,
        route: `conversation_${kind}`,
        mode: "model",
        routeDecision: {
          route: kind,
          reason: tweet.ai_route_reason ?? "conversation",
          market_resolution: marketResolution,
        },
        context,
        marketResolution,
        marketFacts,
        replyText: reply.text,
        lint: reply.lint,
        queued: queued.data,
        status: "completed",
      });
      await persistPublicConversationState(admin, {
        tweet,
        userId,
        route: `conversation_${kind}`,
        context,
        marketResolution,
        marketFacts,
        replyText: reply.text,
      });

      return {
        kind: "complete",
        state: "succeeded",
        resultRef: `reply-work-item:${queued.data.reply_work_item_id}`,
      };
    },
  })
);

async function resolveMarketFacts(
  admin: any,
  target: NormalizedMarketAddress,
): Promise<Record<string, unknown>> {
  try {
    const bundle = await getMarketDataBundle(admin, {
      mint: target.address,
      chain: target.chain,
      includeDexscreener: true,
      includeBlockscout: target.chain === "robinhood",
      includeMoralis: target.chain === "robinhood",
      includeAnalytics: true,
    });
    const facts = buildPublicMarketFacts(bundle);
    delete facts.sources;
    delete facts.freshness;
    return facts;
  } catch {
    return {
      chain: target.chain === "solana" ? "Solana" : "Robinhood Chain",
      token_address: target.address,
      warnings: ["market_data_unavailable"],
    };
  }
}

function deterministicPublicReply(
  tweet: Record<string, unknown>,
  context: LinkrPublicTurnContext,
): {
  kind: "identity" | "capability_help" | "safe_refusal";
  text: string;
  lint: ReturnType<typeof lintPublicReply>;
  routeDecision: unknown;
} | null {
  const text = String(tweet.text ?? "");
  const decision = routeLinkrTurnDeterministic({
    text,
    is_follow_up: Boolean(tweet.is_follow_up),
    ingest_source: String(tweet.ingest_source ?? "") || null,
    ingest_reason: String(tweet.ingest_reason ?? "") || null,
    parent_reply_tweet_id: String(tweet.parent_reply_tweet_id ?? "") || null,
    has_media: Boolean(tweet.has_media),
    has_history: context.conversation.total_count > 0,
    engagement_gate_enabled: false,
  });
  if (decision.route === "identity") {
    const identityKind = decision.intent === "identity_builder"
      ? "builder"
      : decision.intent === "identity_model"
      ? "model"
      : "who";
    return deterministicReply(
      "identity",
      linkrIdentityReply(identityKind),
      decision,
    );
  }
  if (decision.route === "capability_help") {
    const reply = decision.intent === "chain_capability"
      ? chainCapabilityReply()
      : decision.intent === "schedule_capability"
      ? scheduleCapabilityReply()
      : "I can chat, answer token and market questions, search public X when configured, and prepare supported wallet, launch, transfer, rewards, and liquidity workflows. Value-moving actions stay confirmation-gated.";
    return deterministicReply("capability_help", reply, decision);
  }
  if (decision.route === "safe_refusal") {
    const reply = /key|seed/i.test(text)
      ? "I cannot export or reveal private keys or seed phrases. Use Linkr's wallet controls for safe account actions."
      : "I cannot guarantee returns or call something risk-free. I can help read the data, but you should DYOR before acting.";
    return deterministicReply("safe_refusal", reply, decision);
  }
  return null;
}

function deterministicReply(
  kind: "identity" | "capability_help" | "safe_refusal",
  text: string,
  routeDecision: unknown,
) {
  const sanitized = sanitizePublicReply(text);
  const lint = lintPublicReply(sanitized, kind);
  const finalText = lint.ok
    ? sanitized
    : "I can help with that, but I need to keep public replies safe and concise.";
  return {
    kind,
    text: finalText,
    lint: lint.ok ? lint : lintPublicReply(finalText, kind),
    routeDecision,
  };
}

async function resolveUserId(
  admin: any,
  workItemUserId: string | null | undefined,
  tweet: Record<string, unknown>,
): Promise<string | null> {
  if (workItemUserId) return String(workItemUserId);
  const twitterId = String(tweet.author_twitter_id ?? "").trim();
  if (!twitterId) return null;
  const { data } = await admin.from("profiles").select("user_id")
    .eq("twitter_id", twitterId).maybeSingle();
  return data?.user_id ?? null;
}

async function markTweetCompleted(admin: any, tweetId: string) {
  const updated = await admin.from("tweets_inbox").update({
    status: "completed",
    processed_at: new Date().toISOString(),
    error: null,
  }).eq("tweet_id", tweetId);
  if (updated.error) throw updated.error;
}

async function wakeReplyStage(admin: any, priority: number) {
  if (!isLinkrFastHandoffEnabled()) return;
  const replyStage = linkrQueueForRoute("reply.x", priority);
  if (!replyStage) return;
  const handoff = wakeAndDispatchStage(
    admin,
    replyStage,
    LINKR_STAGE_WORKER_FUNCTIONS[replyStage],
  );
  if (!scheduleBackgroundTask(handoff)) await handoff;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function tracePublicTurn(
  admin: any,
  args: {
    tweet: Record<string, unknown>;
    workItem: unknown;
    userId: string | null;
    route: string;
    mode: "deterministic" | "model";
    routeDecision: unknown;
    context: LinkrPublicTurnContext;
    marketResolution: PublicMarketResolution | null;
    marketFacts: Record<string, unknown> | null;
    replyText: string;
    lint: ReturnType<typeof lintPublicReply>;
    queued: Record<string, unknown> | null;
    status: string;
  },
) {
  try {
    const routeDecision = objectOrEmpty(args.routeDecision);
    await insertAgentRunOnce(admin, {
      tweet_id: args.tweet.tweet_id,
      user_id: args.userId,
      intent: args.route,
      confidence: Number(routeDecision.confidence ?? 0.8),
      requires_confirmation: false,
      status: args.status,
      idempotency_key: stableIdempotencyKey(
        "x_conversation",
        String(args.tweet.tweet_id ?? ""),
        args.route,
      ),
      route_decision: routeDecision,
      working_frame: {
        tweet_id: args.tweet.tweet_id,
        conversation_id: args.tweet.conversation_id,
        transcript_messages: args.context.conversation.messages.length,
        resolved_references: args.context.resolved_references,
        entities: args.context.entities.slice(0, 12),
        market_resolution: args.marketResolution,
        constraints: args.context.constraints,
      },
      prompt_slots: {
        has_transcript: Boolean(args.context.transcript),
        has_parent_reply: Boolean(args.context.parent_linkr_reply),
        has_thread_context: Boolean(args.context.thread_context),
        has_active_state: Boolean(args.context.active_state),
      },
      reply_plan: {
        mode: args.mode,
        intent: args.route,
        text: args.replyText,
        facts: args.context.facts.slice(0, 12),
        privacy: ["public"],
        fallback_text: "I can help, but I need one clearer public detail.",
        idempotency_key: stableIdempotencyKey(
          "reply_plan",
          String(args.tweet.tweet_id ?? ""),
          args.route,
        ),
        reply_kind: args.route,
      },
      route_resources: {
        market_facts_digest: digestFacts(args.marketFacts),
        queued: args.queued,
        lint: args.lint,
      },
      outcome: {
        status: args.status,
        route: args.route,
        queued: args.queued,
      },
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "x_public_turn_trace_error",
        tweet_id: args.tweet.tweet_id,
        message: String(error instanceof Error ? error.message : error).slice(
          0,
          300,
        ),
      }),
    );
  }
}

async function persistPublicConversationState(
  admin: any,
  args: {
    tweet: Record<string, unknown>;
    userId: string | null;
    route: string;
    context: LinkrPublicTurnContext;
    marketResolution: PublicMarketResolution | null;
    marketFacts: Record<string, unknown> | null;
    replyText: string;
  },
) {
  try {
    const marketEntity = args.marketResolution?.target
      ? publicMarketEntity(args.marketResolution.target, args.marketFacts)
      : null;
    const activeEntities = [
      ...(marketEntity ? [marketEntity] : []),
      ...args.context.entities.filter((entity) => entity.kind !== "token"),
    ].slice(0, 12);
    await upsertConversationState(admin, {
      conversation_id: args.tweet.conversation_id,
      participant_twitter_id: args.tweet.author_twitter_id,
      user_id: args.userId,
      active_topic: marketEntity ?? activeEntities[0] ?? null,
      active_entities: activeEntities,
      last_route: args.route,
      last_reply_tweet_id: null,
      anti_repetition: {
        last_reply_kind: args.route,
        last_reply_text: args.replyText.slice(0, 180),
      },
      expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "x_public_turn_state_error",
        tweet_id: args.tweet.tweet_id,
        message: String(error instanceof Error ? error.message : error).slice(
          0,
          300,
        ),
      }),
    );
  }
}

function digestFacts(
  facts: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!facts) return null;
  const out: Record<string, unknown> = {};
  for (
    const key of [
      "symbol",
      "name",
      "chain",
      "token_address",
      "price_usd",
      "liquidity_usd",
      "volume_24h_usd",
      "market_cap_usd",
      "warnings",
    ]
  ) {
    if (facts[key] !== undefined && facts[key] !== null) out[key] = facts[key];
  }
  return Object.keys(out).length ? out : null;
}
