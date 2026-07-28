// deno-lint-ignore-file no-explicit-any
// Channel-neutral Linkr runtime, with terminal as the first realtime adapter.

// Chain-read helpers (ethers / @solana/web3.js) are intentionally NOT imported
// here — they blow the worker boot budget (HTTP 546). Live wallet/portfolio
// reads are relayed to the chain-isolated `linkr-agent-wallet-read` function via
// readWalletContext(). See linkr_action_dispatch.ts.
import {
  callCometResponses,
  callCometResponsesStream,
  extractOutputText,
} from "./comet.ts";
import { extractFromText } from "./extract.ts";
import { readWalletContext } from "./linkr_action_dispatch.ts";
import { buildAgentCoinDetail } from "./coin_detail.ts";

// USDC mint inlined so this runtime does not import solana_usdc.ts (which pulls
// @solana/web3.js).
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
import { detectConversationShortcut } from "./conversation.ts";
import {
  isScheduleCapabilityQuestion,
  scheduleClarificationReply,
} from "./linkr_schedule_language.ts";
import {
  formatScheduleConfirmReply,
  normalizeIntervalSeconds,
  normalizeScheduleKind,
  parseScheduleTrigger,
  type ScheduledActionType,
  type ScheduleKind,
  SCHEDULER_CONFIRMATION_PHRASE,
  type SchedulerTrigger,
} from "./scheduler.ts";
import {
  buildTerminalNaturalPrompt,
  buildTerminalSummaryPrompt,
  isRepetitiveTerminalReply,
  isTerminalTradeAdviceQuestion,
  lintTerminalReply,
  sanitizeTerminalReply,
  shouldIndexTerminalMemory,
  shouldRouteTerminalNaturalBeforeAction,
  terminalMemoryTitle,
  terminalNaturalFallbackReply,
} from "./linkr_terminal_natural.ts";
import {
  buildTerminalXSearchReply,
  buildTerminalXSearchRequest,
  isTerminalXSearchCapabilityQuestion,
  isTerminalXSearchRequest,
  xSearchPostsToItems,
} from "./linkr_terminal_x_search.ts";
import { queryLinkrDataAccess } from "./linkr_data_access.ts";
import { fetchThreadContext } from "./thread.ts";
import { searchPublicX } from "./x_search_tool.ts";
// pump_creator_rewards.ts pulls @solana/web3.js; excluded from this runtime.
// NOTE: creator_rewards_claim.ts + linkr_action_runtime.ts are intentionally NOT
// imported here. They statically pull the on-chain execution engine
// (@pump-fun/pump-sdk, swap/liquidity/launch signers), which pushed this shared
// conversational runtime's deployed graph to ~10 MiB and made every function
// that imports it (terminal-chat, telegram-webhook) fail to boot with HTTP 546
// (WORKER_RESOURCE_LIMIT). This runtime now only routes, reads, and previews;
// value-moving execution is dispatched to dedicated chain-split executor
// functions. See linkr_action_dispatch.ts.
import {
  cancelPendingActionViaDispatch,
  confirmActionViaDispatch,
} from "./linkr_action_dispatch.ts";
import { stableIdempotencyKey } from "./linkr_idempotency.ts";
import { isFirstLaunchSubsidyEligible } from "./first_launch_subsidy.ts";
import {
  decideLaunchExecution,
  launchRequestSignals,
  zeroLaunchDevBuy,
} from "./launch_execution_policy.ts";
import { indexMemory } from "./memory.ts";
import {
  extractImmediateReferences,
  type ResolvedReference,
  resolveReferences,
} from "./linkr_reference_resolver.ts";
import { validateToolInput } from "./linkr_tool_registry.ts";
// token_burn.ts pulls ethers + @solana/web3.js; excluded from this runtime.
// Burn previews are degraded gracefully until the executor path is live.
import type {
  LinkrRuntimeContext,
  LinkrTurnInput,
  LinkrTurnOutputSink,
  LinkrTurnResult,
} from "./linkr_agent_runtime_types.ts";

type RuntimeState = {
  conversation: any;
  recent_messages: any[];
  pending_actions: any[];
  drafts: any[];
  source_refs: any[];
  profile: any;
  memory_snippets: any[];
};

type RouteDecision = {
  route: string;
  intent: string;
  action_type?: string | null;
  confidence: number;
  reason: string;
};

type ModelAnswerOptions = {
  toolFacts?: string | null;
  fallbackText?: string | null;
};

export async function processLinkrAgentTurn(
  admin: any,
  input: LinkrTurnInput,
  sink: LinkrTurnOutputSink,
): Promise<LinkrTurnResult> {
  const runId = input.conversation?.run_id;
  if (!runId) throw new Error("run_id_required");
  const lock = await acquireRunLock(admin, input, runId);
  const ctx: LinkrRuntimeContext = { admin, input, sink, run_id: runId };
  const pendingIds: string[] = [];
  const jobIds: string[] = [];
  const memoryEventIds: string[] = [];

  try {
    await sink.setStatus("context_loading");
    await sink.emit("context_loading", { label: "Loading Linkr context" });
    const state = await loadRuntimeState(admin, input);
    const referenceResolution = resolveReferences({
      text: input.text,
      active_entities: state.conversation?.active_entities ?? [],
      source_refs: [...state.source_refs, ...(input.source_refs ?? [])],
      recent_messages: state.recent_messages,
      pending_actions: state.pending_actions,
      drafts: state.drafts,
    });

    for (const ref of extractImmediateReferences(input.text)) {
      await persistSourceRef(
        admin,
        input,
        runId,
        ref,
        input.conversation?.user_message_id ?? null,
      );
      await sink.emit("source_ref", { ref });
    }

    if (referenceResolution.ambiguity) {
      await reply(ctx, referenceResolution.ambiguity, [
        {
          type: "clarification_prompt",
          text: referenceResolution.ambiguity,
        },
      ]);
      await finishRun(admin, input, runId, "completed", "clarification", {
        referenceResolution,
      });
      return result(
        input,
        runId,
        "completed",
        "clarification",
        pendingIds,
        jobIds,
        memoryEventIds,
      );
    }

    const decision = decideRoute(input, referenceResolution.refs, state);
    await sink.emit("route", decision);

    if (decision.route === "confirm_action") {
      const pending = referenceResolution.refs.find((ref) =>
        ref.entity_type === "pending_action"
      );
      if (!pending?.entity_id) {
        const text =
          "I do not have exactly one pending action to confirm here.";
        await reply(ctx, text, [{ type: "clarification_prompt", text }]);
        await finishRun(admin, input, runId, "completed", decision.route, {
          decision,
        });
        return result(
          input,
          runId,
          "completed",
          decision.route,
          pendingIds,
          jobIds,
          memoryEventIds,
        );
      }
      const dispatch = await confirmActionViaDispatch({
        admin,
        userId: input.user_id,
        pendingActionId: pending.entity_id,
        runId,
      });
      if (dispatch.job?.id) jobIds.push(String(dispatch.job.id));
      const receiptPart = dispatch.receipt || dispatch.result
        ? {
          type: "transaction_receipt",
          receipt: dispatch.receipt ?? null,
          result: dispatch.result ?? null,
          pending_action_id: pending.entity_id,
        }
        : {
          type: "system_notice",
          text: dispatch.message,
          pending_action_id: pending.entity_id,
        };
      await reply(ctx, dispatch.message, [receiptPart]);
      await finishRun(admin, input, runId, "completed", decision.route, {
        decision,
        execution_dispatch: dispatch,
      });
      return result(
        input,
        runId,
        "completed",
        decision.route,
        pendingIds,
        jobIds,
        memoryEventIds,
      );
    }

    if (decision.route === "cancel_action") {
      const pending = referenceResolution.refs.find((ref) =>
        ref.entity_type === "pending_action"
      );
      if (!pending?.entity_id) {
        const text = "I do not have exactly one pending action to cancel here.";
        await reply(ctx, text, [{ type: "clarification_prompt", text }]);
        await finishRun(admin, input, runId, "completed", decision.route, {
          decision,
        });
        return result(
          input,
          runId,
          "completed",
          decision.route,
          pendingIds,
          jobIds,
          memoryEventIds,
        );
      }
      const cancelled = await cancelPendingActionViaDispatch({
        admin,
        userId: input.user_id,
        pendingActionId: pending.entity_id,
      });
      const text = cancelled.cancelled
        ? "Cancelled. I will not run that action."
        : "That action was already handled.";
      await reply(ctx, text, [
        {
          type: "system_notice",
          text,
          pending_action_id: pending.entity_id,
        },
      ]);
      await updateConversationPendingCount(admin, input);
      await finishRun(admin, input, runId, "cancelled", decision.route, {
        decision,
        cancelled,
      });
      return result(
        input,
        runId,
        "cancelled",
        decision.route,
        pendingIds,
        jobIds,
        memoryEventIds,
      );
    }

    if (decision.route === "prepare_action") {
      const prepared = await prepareAction(
        ctx,
        decision,
        referenceResolution.refs,
        state,
      );
      if (prepared.pending?.id) pendingIds.push(prepared.pending.id);
      if (prepared.memory_event_id) {
        memoryEventIds.push(prepared.memory_event_id);
      }
      await updateConversationPendingCount(admin, input);
      const preparedStatus = prepared.completed === true
        ? "completed"
        : "awaiting_confirmation";
      await finishRun(admin, input, runId, preparedStatus, decision.route, {
        decision,
        prepared,
      });
      return result(
        input,
        runId,
        preparedStatus,
        decision.route,
        pendingIds,
        jobIds,
        memoryEventIds,
      );
    }

    const answer = await answerReadOnly(
      ctx,
      decision,
      referenceResolution.refs,
      state,
    );
    if (answer.streamed) {
      await ctx.sink.setAssistantMessage({
        content: answer.text,
        parts: answer.parts,
        status: "completed",
        metadata: { streamed: true, route: decision.route },
      });
    } else {
      await reply(ctx, answer.text, answer.parts);
    }
    if (answer.memory_event_id) memoryEventIds.push(answer.memory_event_id);
    await finishRun(admin, input, runId, "completed", decision.route, {
      decision,
      answer,
    });
    return result(
      input,
      runId,
      "completed",
      decision.route,
      pendingIds,
      jobIds,
      memoryEventIds,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = runtimeErrorCode(message);
    const text = userSafeError(message);
    console.error(JSON.stringify({
      event: "linkr_agent_runtime_failed",
      run_id: runId,
      surface: input.surface,
      error_code: errorCode,
      error_message: message.slice(0, 500),
    }));
    await sink
      .setAssistantMessage({
        content: text,
        parts: [{ type: "error", text }],
        status: "failed",
        metadata: { error_code: errorCode },
      })
      .catch(() => {});
    await finishRun(admin, input, runId, "failed", "error", {
      error_code: errorCode,
    }).catch(() => {});
    await sink.emit("error", { message: text, error_code: errorCode }).catch(
      () => {},
    );
    throw error;
  } finally {
    await releaseRunLock(admin, lock).catch(() => {});
  }
}

async function loadRuntimeState(
  admin: any,
  input: LinkrTurnInput,
): Promise<RuntimeState> {
  const conversationId = input.conversation?.terminal_conversation_id;
  const [conversation, messages, pending, drafts, refs, profile, memory] =
    await Promise.all([
      conversationId
        ? admin
          .from("linkr_terminal_conversations")
          .select("*")
          .eq("id", conversationId)
          .eq("user_id", input.user_id)
          .maybeSingle()
        : Promise.resolve({ data: null }),
      conversationId
        ? admin
          .from("linkr_terminal_messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .eq("user_id", input.user_id)
          .order("created_at", { ascending: false })
          .limit(24)
        : Promise.resolve({ data: [] }),
      admin
        .from("linkr_pending_actions")
        .select("*")
        .eq("user_id", input.user_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10),
      admin
        .from("linkr_action_drafts")
        .select("*")
        .eq("user_id", input.user_id)
        .in("status", ["open", "awaiting_clarification", "ready"])
        .order("updated_at", { ascending: false })
        .limit(10),
      conversationId
        ? admin
          .from("linkr_source_refs")
          .select("*")
          .eq("terminal_conversation_id", conversationId)
          .eq("user_id", input.user_id)
          .order("created_at", { ascending: false })
          .limit(30)
        : Promise.resolve({ data: [] }),
      admin.from("profiles").select("*").eq("user_id", input.user_id)
        .maybeSingle(),
      loadRelevantTerminalMemory(admin, input.user_id, input.text),
    ]);
  for (
    const item of [
      conversation,
      messages,
      pending,
      drafts,
      refs,
      profile,
      memory,
    ]
  ) {
    if (item.error) throw item.error;
  }
  return {
    conversation: conversation.data,
    recent_messages: [...(messages.data ?? [])].reverse(),
    pending_actions: pending.data ?? [],
    drafts: drafts.data ?? [],
    source_refs: refs.data ?? [],
    profile: profile.data,
    memory_snippets: memory.data ?? [],
  };
}

async function loadRelevantTerminalMemory(
  admin: any,
  userId: string,
  text: string,
) {
  const cleaned = String(text ?? "")
    .trim()
    .slice(0, 180);
  const recentPromise = admin
    .from("user_memory_index")
    .select("source_type,source_id,title,searchable_text,metadata,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(6);

  const memorySearch = cleaned.length > 3
    ? safeSupabaseResult(
      admin.rpc("search_linkr_user_memory", {
        p_user_id: userId,
        p_query: cleaned.slice(0, 200),
        p_limit: 6,
      }),
    )
    : Promise.resolve({
      data: [],
      error: null,
    });

  const eventPromise = admin
    .from("linkr_memory_events")
    .select("event_type,title,summary,metadata,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(6);

  const [recent, searched, events] = await Promise.all([
    recentPromise,
    memorySearch,
    eventPromise,
  ]);
  if (recent.error) return recent;
  if (events.error) return events;

  const seen = new Set<string>();
  const data = [
    ...(searched.data ?? []),
    ...(recent.data ?? []),
    ...(events.data ?? []),
  ]
    .filter((row: any) => {
      const key = [
        row.source_type,
        row.source_id,
        row.title,
        row.searchable_text,
        row.summary,
      ].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
  return { data, error: null };
}

async function safeSupabaseResult(query: any) {
  try {
    const result = await query;
    if (result?.error) return { data: [], error: null };
    return { data: result?.data ?? [], error: null };
  } catch (_) {
    return { data: [], error: null };
  }
}

function decideRoute(
  input: LinkrTurnInput,
  refs: ResolvedReference[],
  state: RuntimeState,
): RouteDecision {
  const text = input.text;
  const normalized = text.trim().toLowerCase();
  const hasImageAttachment = hasTerminalImageAttachment(input.attachments);
  if (!normalized && hasImageAttachment) {
    return {
      route: "prepare_action",
      intent: "prepare_action",
      action_type: "launch_coin",
      confidence: 0.79,
      reason: "image attachment with no text",
    };
  }
  if (
    /^(confirm(?: (?:it|buy|sell|burn|transfer|launch|claim))?|yes(?: run it)?|execute it|go ahead|run it)(?: please)?[.!]?$/i
      .test(
        normalized,
      )
  ) {
    return {
      route: "confirm_action",
      intent: "confirm_action",
      confidence: 0.96,
      reason: "confirmation phrase",
    };
  }
  if (
    /^(cancel(?: it| that)?|never mind|nevermind|stop that)(?: please)?[.!]?$/i
      .test(normalized)
  ) {
    return {
      route: "cancel_action",
      intent: "cancel_action",
      confidence: 0.94,
      reason: "cancel phrase",
    };
  }
  if (isScheduleCapabilityQuestion(text)) {
    return {
      route: "capabilities",
      intent: "schedule_capability",
      confidence: 0.92,
      reason: "schedule capability question",
    };
  }
  if (isTerminalXSearchCapabilityQuestion(text)) {
    return {
      route: "capabilities",
      intent: "x_search_capability",
      confidence: 0.92,
      reason: "X search capability question",
    };
  }
  if (refs.some((ref) => ref.entity_type === "x_post")) {
    return {
      route: "post",
      intent: "post_explanation",
      confidence: 0.85,
      reason: "X post reference",
    };
  }
  if (isTerminalXSearchRequest(text)) {
    return {
      route: "x_search",
      intent: "x_search",
      confidence: 0.88,
      reason: "live public X search request",
    };
  }
  if (isTerminalTradeAdviceQuestion(text)) {
    return {
      route: "trade_advice",
      intent: "trade_advice",
      confidence: 0.9,
      reason: "trade advice question",
    };
  }
  if (isTerminalHistoryQuestion(normalized)) {
    return {
      route: "history",
      intent: "history",
      confidence: 0.86,
      reason: "history/data question",
    };
  }
  if (shouldRouteTerminalNaturalBeforeAction(text)) {
    return {
      route: "conversation",
      intent: "action_capability_or_guidance",
      confidence: 0.84,
      reason: "terminal action question without concrete execution slots",
    };
  }
  if (
    /\b(buy|sell|swap|exchange|convert|burn|send|transfer|launch|create coin|add liquidity|remove liquidity|collect fees|claim|schedule)\b/
      .test(
        normalized,
      )
  ) {
    return {
      route: "prepare_action",
      intent: "prepare_action",
      action_type: actionTypeFor(normalized),
      confidence: 0.86,
      reason: "value-moving action words",
    };
  }
  if (
    /\b(who are you|built you|builder|what model|what are you)\b/.test(
      normalized,
    )
  ) {
    return {
      route: "identity",
      intent: "identity",
      confidence: 0.9,
      reason: "identity question",
    };
  }
  const shortcut = detectConversationShortcut(text);
  if (shortcut?.kind === "capability_help") {
    return {
      route: "capabilities",
      intent: "capability_help",
      confidence: 0.94,
      reason: "conversation shortcut capability question",
    };
  }
  if (shortcut) {
    return {
      route: "small_talk",
      intent: shortcut.kind,
      confidence: 0.9,
      reason: "conversation shortcut",
    };
  }
  if (isConversationalRepairRequest(normalized)) {
    return {
      route: "small_talk",
      intent: "regular_conversation",
      confidence: 0.86,
      reason: "regular conversation request",
    };
  }
  if (/\b(what can you do|help|commands|chains|support)\b/.test(normalized)) {
    return {
      route: "capabilities",
      intent: /chains|support/.test(normalized)
        ? "chain_capability"
        : "capability_help",
      confidence: 0.9,
      reason: "capability question",
    };
  }
  if (/\b(wallet|balance|deposit address|address)\b/.test(normalized)) {
    return {
      route: "wallet",
      intent: "wallet_balance",
      confidence: 0.9,
      reason: "wallet question",
    };
  }
  if (/\b(portfolio|hold|holdings|own)\b/.test(normalized)) {
    return {
      route: "portfolio",
      intent: "portfolio",
      confidence: 0.86,
      reason: "portfolio question",
    };
  }
  if (
    /\b(history|recent|bought|sold|transactions|activity|launches|launched|pending|lp|liquidity)\b/
      .test(
        normalized,
      )
  ) {
    return {
      route: "history",
      intent: "history",
      confidence: 0.82,
      reason: "history/data question",
    };
  }
  if (refs.some((ref) => ref.entity_type === "token")) {
    return {
      route: "token",
      intent: "coin_inquiry",
      confidence: 0.85,
      reason: "token reference",
    };
  }
  if (/^(hi|hello|hey|gm|yo)\b/.test(normalized)) {
    return {
      route: "small_talk",
      intent: "small_talk",
      confidence: 0.82,
      reason: "small talk",
    };
  }
  if (state.conversation?.summary) {
    return {
      route: "conversation",
      intent: "conversation_followup",
      confidence: 0.65,
      reason: "conversation follow-up",
    };
  }
  return {
    route: "general",
    intent: "general_inquiry",
    confidence: 0.6,
    reason: "fallback general question",
  };
}

async function answerReadOnly(
  ctx: LinkrRuntimeContext,
  decision: RouteDecision,
  refs: ResolvedReference[],
  state: RuntimeState,
): Promise<{
  text: string;
  parts: any[];
  memory_event_id?: string | null;
  streamed?: boolean;
}> {
  const { admin, input, sink } = ctx;
  await sink.emit("tool_start", { tool: decision.route });
  switch (decision.route) {
    case "identity":
      return answerWithModel(ctx, state, refs, decision, [
        {
          type: "system_notice",
          title: "Linkr",
          text:
            "Built by @S0Ldev. Usually lives on X; here it has private app context.",
        },
      ]);
    case "capabilities":
      return answerWithModel(ctx, state, refs, decision, [
        {
          type: "tool_status",
          label: "Capabilities loaded",
          status: "completed",
        },
      ]);
    case "small_talk":
      return answerWithModel(ctx, state, refs, decision);
    case "wallet":
      return answerWallet(ctx, state, refs, decision);
    case "portfolio":
      return answerPortfolio(ctx, state, refs, decision);
    case "history":
      return answerHistory(ctx, state, refs, decision);
    case "token":
      return answerToken(ctx, state, refs, decision);
    case "trade_advice":
      return answerTradeAdvice(ctx, state, refs, decision);
    case "post":
      return answerPost(ctx, state, refs, decision);
    case "x_search":
      return answerXSearch(ctx, state, refs, decision);
    default:
      return answerWithModel(ctx, state, refs, decision);
  }
}

async function answerWallet(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
) {
  const { input } = ctx;
  const { evmWallet, solWallet, eth, sol } = await readWalletContext(
    input.user_id,
    "wallet",
  );
  const parts = [
    {
      type: "wallet_address",
      wallets: {
        robinhood: evmWallet
          ? {
            address: evmWallet.address,
            balance_eth: eth,
            explorer_url: evmWallet.explorer_url,
          }
          : null,
        solana: solWallet
          ? {
            address: solWallet.address,
            balance_sol: sol,
            explorer_url: solWallet.explorer_url,
          }
          : null,
      },
    },
  ];
  const fallbackText = `Your wallet is ready. Robinhood Chain: ${
    evmWallet ? short(evmWallet.address) : "not found"
  }${eth == null ? "" : ` (${formatNumber(eth)} ETH)`}. Solana: ${
    solWallet ? short(solWallet.address) : "not found"
  }${sol == null ? "" : ` (${formatNumber(sol)} SOL)`}.`;
  return answerWithModel(ctx, state, refs, decision, parts, {
    toolFacts: compactJson({
      task: "wallet_balance",
      wallets: parts[0].wallets,
      instruction:
        "Answer naturally. If a wallet is missing, say that plainly. Do not expose full private internals; shortened public wallet addresses are okay.",
    }),
    fallbackText,
  });
}

async function answerPortfolio(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
) {
  const { input } = ctx;
  const { evmWallet, solWallet, evmTokens = [], solTokens = [] } =
    await readWalletContext(input.user_id, "portfolio");
  const holdings = [...evmTokens, ...solTokens]
    .filter((h: any) => Number(h.amount ?? 0) > 0)
    .slice(0, 12);
  const top = holdings
    .slice(0, 5)
    .map((h: any) =>
      `${h.symbol ?? short(h.token_address ?? h.mint)} ${
        formatNumber(h.amount)
      }`
    )
    .join(", ");
  const fallbackText = holdings.length
    ? `I found ${holdings.length} token holding${
      holdings.length === 1 ? "" : "s"
    }. Top: ${top}.`
    : "I did not find token holdings with a positive balance yet.";
  const parts = [
    {
      type: "portfolio_snapshot",
      holdings,
      wallets: {
        robinhood: evmWallet?.address ?? null,
        solana: solWallet?.address ?? null,
      },
    },
  ];
  return answerWithModel(ctx, state, refs, decision, parts, {
    toolFacts: compactJson({
      task: "portfolio_snapshot",
      holdings,
      wallet_count: [evmWallet, solWallet].filter(Boolean).length,
      instruction:
        "Answer like a helpful portfolio read. If empty, be conversational and explain it means no positive token balances were found, not that the account is broken.",
    }),
    fallbackText,
  });
}

async function answerHistory(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
) {
  const { admin, input } = ctx;
  const lower = input.text.toLowerCase();
  const kind = lower.includes("launch")
    ? "launch.query"
    : lower.includes("liquidity") || lower.includes("lp")
    ? "liquidity.position_query"
    : lower.includes("pending")
    ? "draft.status_query"
    : "transaction.query";
  const tool = kind === "draft.status_query"
    ? await queryLinkrDataAccess(admin, {
      tool: "draft.status_query",
      scope: "self",
      user_id: input.user_id,
      limit: 10,
    })
    : kind === "launch.query"
    ? await queryLinkrDataAccess(admin, {
      tool: "launch.query",
      scope: "self",
      user_id: input.user_id,
      limit: 10,
    })
    : kind === "liquidity.position_query"
    ? await queryLinkrDataAccess(admin, {
      tool: "liquidity.position_query",
      scope: "self",
      user_id: input.user_id,
      limit: 10,
    })
    : await queryLinkrDataAccess(admin, {
      tool: "transaction.query",
      scope: "self",
      user_id: input.user_id,
      limit: 10,
    });
  const facts = tool.facts as any;
  const rows = facts.transactions ?? facts.launches ?? facts.positions ??
    facts.drafts ?? [];
  const summary = summarizeRows(rows, kind);
  const parts = [
    {
      type: "tool_result",
      tool: kind,
      result: tool,
      items: rows,
    },
  ];
  return answerWithModel(ctx, state, refs, decision, parts, {
    toolFacts: compactJson({
      task: kind,
      user_question: input.text,
      rows: rows.slice(0, 10),
      tool_summary: tool.summary,
      tool_ok: tool.ok,
      instruction:
        "Answer the user's exact history question. If they ask for last/latest, use the first row because rows are newest-first. Be natural and do not say generic record-count language unless useful.",
    }),
    fallbackText: summary,
  });
}

async function answerToken(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
) {
  const token = refs.find((ref) => ref.entity_type === "token") ??
    latestActiveToken(state);
  if (!token) {
    return answerWithModel(ctx, state, refs, decision, [], {
      fallbackText: "Send the token contract or mint and I will check it.",
      toolFacts:
        "No token contract or mint was resolved for this turn. Ask naturally for the missing token.",
    });
  }
  const address = String((token.value as any).address ?? token.entity_id);
  const detail = await buildAgentCoinDetail(ctx.admin, address, {
    analytics: true,
    chain: (token.value as any).chain,
  }).catch((error) => ({ error: String(error), token_address: address }));
  const name = (detail as any)?.metadata?.name ??
    (detail as any)?.launch?.name ?? "that token";
  const market = (detail as any)?.market;
  const price = market?.price_usd ? ` Price: $${market.price_usd}.` : "";
  const fallbackText = `I checked ${name} (${short(address)}).${price} ${
    (detail as any)?.launch
      ? "It is in Linkr launch history."
      : "I did not find a Linkr launch row for it."
  }`;
  return answerWithModel(
    ctx,
    state,
    refs,
    decision,
    [
      {
        type: "token_card",
        detail,
      },
    ],
    {
      toolFacts: compactJson({
        task: "token_lookup",
        token_address: address,
        detail,
        instruction:
          "Give a useful token read in plain language. Mention price, market cap/liquidity if present, whether it appears to be a Linkr launch, and any data gaps. Do not make a buy/sell recommendation unless the user asks for a trade read.",
      }),
      fallbackText,
    },
  );
}

async function answerTradeAdvice(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
) {
  const token = refs.find((ref) => ref.entity_type === "token") ??
    latestActiveToken(state);
  if (!token) {
    return answerWithModel(ctx, state, refs, decision, [], {
      fallbackText:
        "I can help you think through the trade, but I need the token first. Send the contract, mint, cashtag, or paste the post you are looking at.",
      toolFacts:
        "The user is asking for a trade opinion, but no token or post is resolved. Ask for the missing token/post and keep it conversational.",
    });
  }
  const address = String((token.value as any).address ?? token.entity_id);
  const detail = await buildAgentCoinDetail(ctx.admin, address, {
    analytics: true,
    chain: (token.value as any).chain,
  }).catch((error) => ({ error: String(error), token_address: address }));
  return answerWithModel(
    ctx,
    state,
    refs,
    decision,
    [
      {
        type: "token_card",
        detail,
      },
    ],
    {
      toolFacts: compactJson({
        task: "trade_advice",
        token_address: address,
        detail,
        instruction:
          "The user is asking whether buying/selling/holding is a good idea. Give a balanced risk read, not financial advice or a command. Never say they should definitely buy or sell. Mention concrete supporting factors from the facts, missing info, and what you would check next.",
      }),
      fallbackText:
        "I can help think it through, but I would treat it as a risk read rather than a yes/no call. I would check liquidity, market cap, volume, holders, launch provenance, and current X chatter before touching it.",
    },
  );
}

async function answerPost(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
) {
  const post = refs.find((ref) => ref.entity_type === "x_post");
  if (!post) {
    return answerWithModel(ctx, state, refs, decision, [], {
      fallbackText: "Paste the X post URL and I will read the thread context.",
      toolFacts:
        "No X post URL/reference was resolved for this turn. Ask for the post URL naturally.",
    });
  }
  const tweet = { id: post.entity_id, text: (post.value as any)?.url ?? "" };
  const thread = await fetchThreadContext(tweet).catch((error) => ({
    flattened_context: "",
    error: String(error),
    detected_media_urls: [],
  }));
  const fallbackText = thread.flattened_context
    ? `I pulled that X context. It appears to be about: ${
      thread.flattened_context
        .replace(/\s+/g, " ")
        .slice(0, 240)
    }`
    : "I found the X post reference, but I could not fetch enough thread text from X right now.";
  return answerWithModel(
    ctx,
    state,
    refs,
    decision,
    [
      {
        type: "x_thread_card",
        tweet_id: post.entity_id,
        thread,
      },
    ],
    {
      toolFacts: compactJson({
        task: "x_post_explanation",
        post_id: post.entity_id,
        thread,
        instruction:
          "Explain the post/thread in a clean conversational way. If fetch failed or context is thin, say that plainly and suggest what the user can paste next.",
      }),
      fallbackText,
    },
  );
}

async function answerXSearch(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
) {
  const request = buildTerminalXSearchRequest(ctx.input.text);
  if (!request.query) {
    const fallbackText =
      "I can search public X from here. Give me a cashtag, token address, mint, profile handle, or topic and I will pull a recent/top read.";
    return answerWithModel(
      ctx,
      state,
      refs,
      decision,
      [
        {
          type: "tool_status",
          label: "X search needs a topic",
          status: "needs_input",
        },
      ],
      {
        fallbackText,
        toolFacts:
          "The user asked for X search, but no searchable topic was resolved. Ask for a cashtag, token address, mint, handle, or topic.",
      },
    );
  }

  const validation = validateToolInput(
    "x.search",
    { query: request.query },
    "terminal",
  );
  if (!validation.ok) {
    const fallbackText =
      "I can search public X, but I need a cleaner topic first. Send a cashtag, CA, mint, handle, or short phrase.";
    return answerWithModel(
      ctx,
      state,
      refs,
      decision,
      [
        {
          type: "tool_status",
          label: "X search validation",
          status: "needs_input",
          errors: validation.errors,
        },
      ],
      {
        fallbackText,
        toolFacts: compactJson({
          task: "x_search_validation",
          errors: validation.errors,
          instruction: "Ask for a cleaner X search topic naturally.",
        }),
      },
    );
  }

  await ctx.sink.emit("tool_start", {
    tool: "x.search",
    topic: request.topic,
    reason: request.reason,
  });
  const [recent, relevant] = await Promise.all([
    searchPublicX({
      query: request.query,
      max_results: 10,
      sort_order: "recency",
    }),
    searchPublicX({
      query: request.query,
      max_results: 10,
      sort_order: "relevancy",
    }),
  ]);
  const summary = buildTerminalXSearchReply({
    topic: request.topic,
    query: request.query,
    recent,
    relevant,
  });
  const items = xSearchPostsToItems(summary.posts);
  await ctx.sink.emit("tool_complete", {
    tool: "x.search",
    topic: request.topic,
    recent_ok: recent.ok,
    relevant_ok: relevant.ok,
    count: summary.posts.length,
  });
  const parts = [
    {
      type: "x_search_result",
      title: `X search: ${request.topic}`,
      text: summary.posts.length
        ? `Query: ${request.query}. Checked ${summary.posts.length} public posts.`
        : `Query: ${request.query}. No useful public posts came back from recent/top search.`,
      tool: "x.search",
      query: request.query,
      topic: request.topic,
      sentiment: summary.sentiment,
      result: {
        recent_ok: recent.ok,
        relevant_ok: relevant.ok,
        recent_error: recent.error ?? null,
        relevant_error: relevant.error ?? null,
      },
      items,
    },
  ];
  return answerWithModel(ctx, state, refs, decision, parts, {
    toolFacts: compactJson({
      task: "x_search",
      topic: request.topic,
      query: request.query,
      sentiment: summary.sentiment,
      deterministic_summary: summary.text,
      posts: summary.posts.slice(0, 8),
      instruction:
        "Summarize the X search naturally. Keep it grounded in public posts, mention it is noisy social context, and do not turn it into financial advice.",
    }),
    fallbackText: summary.text,
  });
}

async function answerWithModel(
  ctx: LinkrRuntimeContext,
  state: RuntimeState,
  refs: ResolvedReference[],
  decision: RouteDecision,
  parts: any[] = [],
  options: ModelAnswerOptions = {},
) {
  const buildPrompt = (repetitionInstruction: string | null = null) =>
    buildTerminalNaturalPrompt({
      text: ctx.input.text,
      route: decision.route,
      intent: decision.intent,
      conversationSummary: state.conversation?.summary,
      activeTopic: state.conversation?.active_topic,
      activeEntities: state.conversation?.active_entities ?? [],
      recentMessages: state.recent_messages,
      refs,
      pendingActions: state.pending_actions,
      drafts: state.drafts,
      sourceRefs: state.source_refs,
      toolFacts: options.toolFacts,
      memorySnippets: state.memory_snippets,
      profile: state.profile,
      repetitionInstruction,
    });

  let streamedText = "";
  try {
    const streamed = await callCometResponsesStream({
      models: terminalModelList(),
      input: buildCometInput(ctx.input, buildPrompt()),
      reasoning: { effort: "low" },
      onTextDelta: async (delta, accumulated) => {
        streamedText = accumulated;
        await ctx.sink.appendAssistantDelta(delta);
      },
    });
    let text = sanitizeTerminalReply(streamed.text);
    const lint = lintTerminalReply(text);
    if (
      text && lint.ok && !isRepetitiveTerminalReply(text, state.recent_messages)
    ) {
      const memoryEventId = await maybeRememberTerminalTurn(ctx, text);
      return { text, parts, streamed: true, memory_event_id: memoryEventId };
    }

    await ctx.sink
      .emit("model_reroll", {
        reason: lint.ok ? "repetition" : "reply_lint",
        blocked: lint.blocked,
      })
      .catch(() => {});
    const response = await callCometResponses({
      models: terminalModelList(),
      input: buildCometInput(
        ctx.input,
        buildPrompt(
          "Your previous reply was too repetitive or exposed unsafe wording. Give a fresh, natural, user-facing answer without internal implementation details.",
        ),
      ),
      reasoning: { effort: "low" },
    });
    text = sanitizeTerminalReply(extractOutputText(response));
    const rerollLint = lintTerminalReply(text);
    if (
      text && rerollLint.ok &&
      !isRepetitiveTerminalReply(text, state.recent_messages)
    ) {
      const memoryEventId = await maybeRememberTerminalTurn(ctx, text);
      return {
        text,
        parts,
        streamed: Boolean(streamedText.trim()),
        memory_event_id: memoryEventId,
      };
    }
  } catch (error) {
    await ctx.sink
      .emit("model_fallback", {
        reason: error instanceof Error
          ? error.message.slice(0, 240)
          : String(error).slice(0, 240),
      })
      .catch(() => {});
    if (streamedText.trim()) {
      const text = sanitizeTerminalReply(streamedText);
      const lint = lintTerminalReply(text);
      if (text && lint.ok) return { text, parts, streamed: true };
    }
  }
  return {
    text: options.fallbackText ?? terminalNaturalFallbackReply(ctx.input.text),
    parts,
    streamed: Boolean(streamedText.trim()),
  };
}

function isConversationalRepairRequest(normalized: string): boolean {
  return (
    /\b(no small talk|small talk|regular convo|regular conversation|normal convo|normal conversation|just chat|just talk|able to talk|can you talk|conversate|conversation)\b/
      .test(
        normalized,
      ) ||
    /\b(how are you|how are u|how r you|hows it going|how is it going|how are things|how you doing|how are you doing|hows your day|how is your day)\b/
      .test(
        normalized,
      ) ||
    /\b(what is up|whats up|what's up|sup|what are you up to)\b/.test(
      normalized,
    )
  );
}

function buildCometInput(
  input: LinkrTurnInput,
  text: string,
): string | Array<Record<string, unknown>> {
  const images = terminalImageAttachments(input.attachments);
  if (!images.length) return text;
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: text || "Attached image for context.",
        },
        ...images.map((sourceUrl) => ({
          type: "input_image",
          image_url: { url: sourceUrl },
        })),
      ],
    },
  ];
}

function isTerminalHistoryQuestion(normalized: string): boolean {
  return (
    /\b(what did i launch|what have i launched|last launch|latest launch|recent launches|my launches|launch history|show .*launch)\b/
      .test(
        normalized,
      ) ||
    /\b(my history|recent activity|recent transactions|transaction history|what did i buy|what did i sell|what have i bought|what have i sold)\b/
      .test(
        normalized,
      ) ||
    /\b(show|list|what).*\b(pending actions?|pending drafts?|drafts?)\b/.test(
      normalized,
    ) ||
    /\b(my .*lp|lp positions|liquidity positions|my pools|show .*liquidity)\b/
      .test(normalized)
  );
}

function terminalModelList(): string[] {
  return uniqueModelList([
    ...(readModelList("COMET_TERMINAL_MODELS") ?? []),
    ...(readModelList("COMET_TERMINAL_MODEL") ?? []),
    "gpt-5.6-terra",
    "gpt-5.4",
    "gpt-5.4-mini",
    ...(readModelList("COMET_REPLY_MODELS") ?? []),
    "gpt-5-mini",
  ]);
}

function terminalSummaryModelList(): string[] {
  return uniqueModelList([
    ...(readModelList("COMET_TERMINAL_SUMMARY_MODELS") ?? []),
    "gpt-5.6-luna",
    "gpt-5-mini",
  ]);
}

function readModelList(name: string): string[] | null {
  const raw = Deno.env.get(name);
  if (!raw?.trim()) return null;
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : null;
}

function uniqueModelList(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

async function maybeRememberTerminalTurn(
  ctx: LinkrRuntimeContext,
  assistantReply: string,
): Promise<string | null> {
  if (!shouldIndexTerminalMemory(ctx.input.text)) return null;
  const sourceId = ctx.input.conversation?.user_message_id ?? ctx.run_id;
  const title = terminalMemoryTitle(ctx.input.text);
  const summary = [
    "User memory from terminal:",
    ctx.input.text,
    "",
    "Linkr reply:",
    assistantReply,
  ]
    .join("\n")
    .slice(0, 3000);

  await indexMemory(
    ctx.admin,
    ctx.input.user_id,
    "terminal_memory",
    sourceId,
    title,
    summary,
    {
      surface: ctx.input.surface,
      terminal_conversation_id:
        ctx.input.conversation?.terminal_conversation_id ?? null,
    },
  ).catch(() => {});

  const memoryEvent = await writeMemoryEvent(
    ctx.admin,
    ctx.input,
    ctx.run_id,
    "indexed",
    title,
    summary.slice(0, 1000),
    "terminal_memory",
  ).catch(() => null);
  await ctx.sink
    .emit("memory_update", {
      title,
      event_id: memoryEvent?.id ?? null,
    })
    .catch(() => {});
  return memoryEvent?.id ?? null;
}

async function prepareAction(
  ctx: LinkrRuntimeContext,
  decision: RouteDecision,
  refs: ResolvedReference[],
  state: RuntimeState,
) {
  const { admin, input, sink } = ctx;
  let actionType = decision.action_type ??
    actionTypeFor(input.text.toLowerCase());
  const payloadActionType = actionType === "schedule_action"
    ? scheduledBaseActionTypeFor(input.text) ?? "schedule_action"
    : actionType;
  let extracted = extractActionPayload(
    input.text,
    payloadActionType,
    refs,
    state,
    input.attachments,
  );
  if (payloadActionType === "burn_token") {
    const { parseTokenBurnCommand } = await import("./token_burn.ts");
    const parsed = parseTokenBurnCommand(input.text);
    extracted = {
      ...extracted,
      chain: parsed.chain,
      token: parsed.token,
      amount: parsed.amount,
      burn_parse_errors: parsed.errors,
    };
  }
  const scheduleDraft = buildScheduleDraftPayload(
    input.text,
    payloadActionType,
    extracted,
  );
  if (scheduleDraft) {
    const baseMissing = missingFields(payloadActionType, extracted);
    if (baseMissing.length > 0) {
      const draft = await createDraft(
        admin,
        input,
        payloadActionType,
        extracted,
        baseMissing,
      );
      const question = clarificationFor(
        payloadActionType,
        baseMissing,
        extracted,
      );
      await sink.emit("action_draft", {
        draft,
        missing_fields: baseMissing,
      });
      await reply(ctx, question, [
        {
          type: "clarification_prompt",
          text: question,
          draft,
        },
      ]);
      return { draft, pending: null };
    }
    actionType = "schedule_action";
    extracted = scheduleDraft;
  }
  const missing = missingFields(actionType, extracted);
  if (missing.length > 0) {
    const draft = await createDraft(
      admin,
      input,
      actionType,
      extracted,
      missing,
    );
    const question = clarificationFor(actionType, missing, extracted);
    await sink.emit("action_draft", { draft, missing_fields: missing });
    await reply(ctx, question, [
      {
        type: "clarification_prompt",
        text: question,
        draft,
      },
    ]);
    return { draft, pending: null };
  }

  const validation = validateToolInput(
    "action.prepare_" + prepareToolSuffix(actionType),
    normalizeToolInput(actionType, extracted),
    input.surface,
  );
  if (!validation.ok) {
    throw new Error("invalid_action_payload:" + validation.errors.join(","));
  }
  let launchExecution: ReturnType<typeof decideLaunchExecution> | null = null;
  if (actionType === "launch_coin") {
    const chain = extracted.chain === "solana" ? "solana" : "robinhood";
    const eligibility = await isFirstLaunchSubsidyEligible(
      admin,
      input.user_id,
      {
        chain,
      },
    );
    launchExecution = decideLaunchExecution({
      firstLaunchSubsidyEligible: eligibility,
      signals: launchRequestSignals({
        text: input.text,
        extraction: extracted,
      }),
    });
    if (launchExecution.forceZeroDevBuy) {
      extracted = zeroLaunchDevBuy(extracted, chain);
    }
    extracted.first_launch_subsidy_eligible = eligibility;
    extracted.launch_execution_policy = launchExecution;
  }
  if (actionType === "claim_creator_rewards") {
    const rewards = await import("./creator_rewards_claim.ts");
    try {
      const preview = await rewards.previewCreatorRewardsClaim(
        admin,
        input.user_id,
        extracted,
      );
      extracted = {
        ...extracted,
        chain: preview.chain,
        launch_id: preview.launch?.id ?? extracted.launch_id,
        token: preview.address ?? extracted.token,
        claim_preview: preview,
        claim_confirmation_text: rewards.creatorRewardsConfirmationReply(
          preview,
        ),
      };
    } catch (error) {
      const text = rewards.creatorRewardsErrorReply(error);
      await reply(ctx, text, [{ type: "system_notice", text }]);
      return { draft: null, pending: null, completed: true };
    }
  }
  if (actionType === "burn_token") {
    const burn = await import("./token_burn.ts");
    try {
      const preview = await burn.previewTokenBurn(admin, {
        userId: input.user_id,
        chain: extracted.chain,
        token: extracted.token,
        amount: extracted.amount,
      });
      extracted = {
        ...extracted,
        burn_preview: preview,
        irreversible: true,
        burn_confirmation_text: burn.tokenBurnConfirmationText(preview),
      };
    } catch (error) {
      const text = burnPreparationError(error);
      await reply(ctx, text, [{ type: "system_notice", text }]);
      return { draft: null, pending: null, completed: true };
    }
  }
  const pending = await createPendingAction(
    admin,
    input,
    actionType,
    extracted,
  );
  await sink.emit("action_required", { pending_action: pending });
  // Inline auto-execution was removed: the on-chain execution engine is no
  // longer bundled into this conversational runtime (it broke the worker boot
  // budget → HTTP 546). Every launch — including previously auto-executed ones —
  // now surfaces a confirmation card and is executed via the dedicated executor
  // path. The pending action is already persisted, so nothing is lost.
  void launchExecution;
  await sink.createPendingActionCard({
    pending_action_id: pending.id,
    action_type: actionType,
    summary: pending.summary,
    confirmation_phrase: pending.confirmation_phrase,
    expires_at: pending.expires_at,
    payload: pending.action_payload,
  });
  const confirmationText = actionType === "claim_creator_rewards"
    ? extracted.claim_confirmation_text
    : actionType === "burn_token"
    ? extracted.burn_confirmation_text
    : actionType === "schedule_action"
    ? formatScheduleConfirmReply({
      actionType: extracted.action_type as ScheduledActionType,
      chain: extracted.chain === "solana" ? "solana" : "robinhood",
      action: extracted,
      trigger: extracted.trigger as SchedulerTrigger,
    })
    : null;
  const text = typeof confirmationText === "string"
    ? confirmationText
    : `I prepared that ${
      labelAction(
        actionType,
      )
    }. Review the details, then confirm if you want me to run it.`;
  await reply(ctx, text, [
    {
      type: "confirmation_card",
      pending_action: pending,
    },
  ]);
  const memoryEvent = await writeMemoryEvent(
    admin,
    input,
    ctx.run_id,
    "indexed",
    `Prepared ${actionType}`,
    pending.summary,
  );
  return { pending, memory_event_id: memoryEvent?.id ?? null };
}

function actionTypeFor(text: string): string {
  if (
    /\b(claim|collect|harvest)\b/.test(text) &&
    /\b(creator rewards?|creator fees?|launch rewards?|pump rewards?|cashback)\b/
      .test(text)
  ) {
    return "claim_creator_rewards";
  }
  if (/\badd liquidity\b/.test(text)) return "add_liquidity";
  if (/\bremove liquidity\b/.test(text)) return "remove_liquidity";
  if (/\bcollect (fees|liquidity fees)\b/.test(text)) {
    return "collect_liquidity_fees";
  }
  if (/\bschedule\b/.test(text)) return "schedule_action";
  if (/\bburn\b/.test(text)) return "burn_token";
  if (/\blaunch|create coin|make a coin\b/.test(text)) return "launch_coin";
  if (
    /\b(swap|exchange|convert)\b/.test(text) &&
    /\busdc\b/.test(text) &&
    /\b(sol|solana)\b/.test(text)
  ) {
    return "swap";
  }
  if (/\bsell\b/.test(text)) return "sell";
  if (/\bsend|transfer\b/.test(text)) return "transfer";
  return "buy";
}

function extractActionPayload(
  text: string,
  actionType: string,
  refs: ResolvedReference[],
  state: RuntimeState,
  attachments: LinkrTurnInput["attachments"] = [],
) {
  const lower = text.toLowerCase();
  const extracted = extractFromText(text);
  const tokenRef = refs.find((ref) => ref.entity_type === "token") ?? null;
  const activeToken = tokenRef ?? latestActiveToken(state);
  const token = activeToken
    ? String((activeToken.value as any).address ?? activeToken.entity_id)
    : (extracted.mints[0] ?? null);
  const chain = inferChain(text, activeToken, token);
  const percent = /\bhalf\b/.test(lower)
    ? 50
    : /\ball\b/.test(lower)
    ? 100
    : (numberBefore(text, "%") ?? null);
  const amountEth = numberBefore(text, "eth");
  const amountSol = numberBefore(text, "sol");
  const amountUsdc = numberBefore(text, "usdc");
  const recipient = transferRecipient(text);
  const payload: Record<string, unknown> = { chain, token };
  const tag = cashtag(text);
  if (tag) payload.symbol = tag.replace(/^\$/, "").toUpperCase();
  if (amountEth != null) payload.amount_eth = amountEth;
  if (amountSol != null) payload.amount_sol = amountSol;
  if (amountUsdc != null) payload.amount_usdc = amountUsdc;
  if (percent != null) payload.percent = percent;
  if (recipient) payload.recipient = recipient;
  if (actionType === "transfer" && amountUsdc != null) {
    payload.chain = "solana";
    payload.asset = "usdc";
    payload.token = SOLANA_USDC_MINT;
  }
  if (
    actionType === "transfer" &&
    !payload.amount_eth &&
    !payload.amount_sol &&
    !payload.amount_usdc
  ) {
    payload.amount = numberBeforeAny(text);
  }
  if (actionType === "swap") {
    payload.chain = "solana";
    payload.token = SOLANA_USDC_MINT;
    const solIndex = lower.search(/\b(sol|solana)\b/);
    const usdcIndex = lower.search(/\busdc\b/);
    if (solIndex >= 0 && usdcIndex >= 0) {
      payload.direction = solIndex < usdcIndex ? "sol_to_usdc" : "usdc_to_sol";
    }
    payload.slippage_bps = Number(state.profile?.default_slippage_bps ?? 0);
    payload.priority_fee_lamports = Number(
      state.profile?.solana_priority_fee_lamports ?? 1_000_000,
    );
  }
  // Irreversible burn parsing and on-chain preview are loaded lazily in
  // prepareAction so ordinary conversations do not pay the chain-SDK boot cost.
  if (actionType === "launch_coin") {
    const attachedImage = terminalImageAttachments(attachments)[0] ?? null;
    payload.name = quoted(text, "name") ?? fieldAfter(text, /\bname(?:d)?\s+/i);
    payload.symbol = quoted(text, "symbol") ??
      cashtag(text)?.replace(/^\$/, "");
    payload.description = quoted(text, "description") ?? null;
    payload.image_url = attachedImage ?? firstUrl(text);
    payload.initial_buy_eth = amountEth ?? null;
    payload.initial_buy_sol = amountSol ?? null;
    payload.raw_user_text = text;
    const signals = launchRequestSignals({ text });
    payload.launch_chain_explicit = signals.explicitChain;
    payload.dev_buy_explicit = signals.explicitDevBuy;
    // Creator-rewards-share parsing (parsePumpCreatorRewardsShareRequest) pulls
    // @solana/web3.js and is excluded from this runtime's boot graph. The
    // dedicated launch executor re-derives recipient/share from raw_user_text.
    payload.raw_user_text = text;
  }
  if (actionType.includes("liquidity")) {
    payload.percent = payload.percent ?? percent ?? null;
    payload.position_id = fieldAfter(text, /\b(position|lp)\s+/i);
    payload.risk_acknowledged = true;
  }
  if (actionType === "claim_creator_rewards") {
    payload.launch_id = text.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    )?.[0] ?? null;
    payload.latest = /\b(last|latest|recent)\s+launch\b/.test(lower) ||
      (/\bmy\b/.test(lower) &&
        /\bcreator rewards?|creator fees?|launch rewards?\b/.test(lower));
    if (token) payload.token = token;
  }
  return payload;
}

function buildScheduleDraftPayload(
  text: string,
  baseActionType: string,
  action: Record<string, unknown>,
): Record<string, unknown> | null {
  const scheduledActionType = toScheduledActionType(baseActionType);
  if (!scheduledActionType) return null;
  const recurrence = inferScheduleRecurrence(text);
  let trigger = parseScheduleTrigger({
    tweetText: text,
    extraction: action,
  });
  if (!trigger && recurrence.interval_seconds) {
    trigger = {
      trigger_type: "time",
      scheduled_for: new Date(Date.now() + recurrence.interval_seconds * 1000)
        .toISOString(),
      delay_seconds: recurrence.interval_seconds,
    };
  }
  if (!trigger) return null;
  if (
    trigger.trigger_type === "market_cap" &&
    !marketTriggerAction(scheduledActionType)
  ) {
    return null;
  }

  const scheduleKind = recurrence.schedule_kind ??
    normalizeScheduleKind(null, trigger.trigger_type);
  const intervalSeconds = recurrence.interval_seconds ??
    normalizeIntervalSeconds(scheduleKind, null);
  const scheduledAction = toScheduledActionPayload(scheduledActionType, action);
  if (!scheduledAction) return null;
  return {
    ...scheduledAction,
    action_type: scheduledActionType,
    chain: scheduledAction.chain,
    schedule_kind: scheduleKind,
    interval_seconds: intervalSeconds,
    trigger,
    trigger_payload: trigger,
    scheduled_for: trigger.trigger_type === "time"
      ? trigger.scheduled_for
      : null,
    next_check_at: trigger.trigger_type === "market_cap"
      ? trigger.next_check_at
      : null,
  };
}

function toScheduledActionType(value: string): ScheduledActionType | null {
  if (value === "buy") return "buy";
  if (value === "sell") return "sell";
  if (value === "transfer") return "transfer";
  if (value === "launch_coin") return "launch_coin";
  if (value === "claim_creator_rewards") return "claim_creator_rewards";
  if (value === "add_liquidity") return "add_liquidity";
  if (value === "remove_liquidity") return "remove_liquidity";
  if (value === "collect_liquidity_fees") return "collect_liquidity_fees";
  return null;
}

function scheduledBaseActionTypeFor(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\blaunch|create coin|make a coin\b/.test(lower)) return "launch_coin";
  if (
    /\b(claim|collect|harvest)\b/.test(lower) &&
    /\b(creator rewards?|creator fees?|launch rewards?|pump rewards?|cashback)\b/
      .test(lower)
  ) return "claim_creator_rewards";
  if (/\badd liquidity\b/.test(lower)) return "add_liquidity";
  if (/\bremove liquidity\b/.test(lower)) return "remove_liquidity";
  if (/\bcollect (fees|liquidity fees)\b/.test(lower)) {
    return "collect_liquidity_fees";
  }
  if (/\bsell\b/.test(lower)) return "sell";
  if (/\bsend|transfer\b/.test(lower)) return "transfer";
  if (/\bbuy|swap|trade\b/.test(lower)) return "buy";
  return null;
}

function inferScheduleRecurrence(
  text: string,
): { schedule_kind: ScheduleKind | null; interval_seconds: number | null } {
  const lower = text.toLowerCase();
  if (/\b(every|each)\s+week\b|\bweekly\b/.test(lower)) {
    return { schedule_kind: "weekly", interval_seconds: 7 * 24 * 60 * 60 };
  }
  if (/\b(every|each)\s+day\b|\bdaily\b/.test(lower)) {
    return { schedule_kind: "daily", interval_seconds: 24 * 60 * 60 };
  }
  const interval = parseEveryIntervalSeconds(lower);
  if (interval != null) {
    return { schedule_kind: "interval", interval_seconds: interval };
  }
  return { schedule_kind: null, interval_seconds: null };
}

function parseEveryIntervalSeconds(text: string): number | null {
  const match =
    /\b(?:every|each)\s+(\d+(?:\.\d+)?)?\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i
      .exec(text);
  if (!match) return null;
  const amount = match[1] == null || match[1] === "" ? 1 : Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = String(match[2] ?? "").toLowerCase();
  const seconds = ["second", "seconds", "sec", "secs", "s"].includes(unit)
    ? amount
    : ["minute", "minutes", "min", "mins", "m"].includes(unit)
    ? amount * 60
    : ["hour", "hours", "hr", "hrs", "h"].includes(unit)
    ? amount * 60 * 60
    : amount * 24 * 60 * 60;
  return Math.max(60, Math.min(Math.round(seconds), 30 * 24 * 60 * 60));
}

function toScheduledActionPayload(
  actionType: ScheduledActionType,
  action: Record<string, unknown>,
): Record<string, unknown> | null {
  const chain = inferScheduledActionChain(action);
  const token = String(action.token ?? action.token_address ?? "").trim();
  const base: Record<string, unknown> = {
    chain,
    source: "terminal",
  };
  if (actionType === "buy") {
    return {
      ...base,
      token,
      token_address: token,
      amount_original: action.amount_sol ?? action.amount_eth ?? action.amount,
      amount_original_unit: action.amount_sol ? "sol" : "eth",
      amount_sol: action.amount_sol ?? null,
      amount_eth: action.amount_eth ?? null,
    };
  }
  if (actionType === "sell") {
    return {
      ...base,
      token,
      token_address: token,
      percent: action.percent,
      amount_pct: action.percent,
      amount_all: Number(action.percent) >= 100,
    };
  }
  if (actionType === "transfer") {
    return {
      ...base,
      recipient: action.recipient,
      amount_original: action.amount_sol ?? action.amount_eth ??
        action.amount_usdc ??
        action.amount,
      amount_original_unit: action.amount_sol
        ? "sol"
        : action.amount_usdc
        ? "usdc"
        : "eth",
      amount_sol: action.amount_sol ?? null,
      amount_eth: action.amount_eth ?? null,
    };
  }
  if (actionType === "launch_coin") {
    return {
      ...base,
      name: action.name,
      symbol: action.symbol,
      description: action.description,
      image_url: action.image_url,
      initial_buy_eth: action.initial_buy_eth ?? null,
      initial_buy_sol: action.initial_buy_sol ?? null,
      amount_eth: action.initial_buy_eth ?? null,
      amount_sol: action.initial_buy_sol ?? null,
      raw_user_text: action.raw_user_text,
    };
  }
  if (actionType === "claim_creator_rewards") {
    return {
      ...base,
      token,
      token_address: token || null,
      symbol: action.symbol ?? null,
      launch_id: action.launch_id ?? null,
      latest: action.latest === true,
    };
  }
  if (actionType === "add_liquidity") {
    return {
      ...base,
      token,
      token_address: token,
      amount_sol: action.amount_sol ?? null,
      amount_eth: action.amount_eth ?? null,
      token_amount: action.token_amount ?? action.amount ?? null,
    };
  }
  if (actionType === "remove_liquidity") {
    return {
      ...base,
      token,
      token_address: token || null,
      position_id: action.position_id ?? null,
      percent: action.percent,
      amount_pct: action.percent,
    };
  }
  return {
    ...base,
    token,
    token_address: token || null,
    position_id: action.position_id ?? null,
  };
}

function marketTriggerAction(actionType: ScheduledActionType): boolean {
  return actionType === "buy" || actionType === "sell";
}

function inferScheduledActionChain(
  action: Record<string, unknown>,
): "robinhood" | "solana" {
  const explicit = String(action.chain ?? "").trim().toLowerCase();
  if (["sol", "solana"].includes(explicit)) return "solana";
  if (["eth", "evm", "robinhood", "robinhood_chain", "rhood"].includes(explicit)) {
    return "robinhood";
  }
  if (action.amount_sol != null || action.initial_buy_sol != null) {
    return "solana";
  }
  if (action.amount_eth != null || action.initial_buy_eth != null) {
    return "robinhood";
  }
  const token = String(action.token ?? action.token_address ?? action.mint ?? "")
    .trim();
  if (isEvmAddressShape(token)) return "robinhood";
  if (isSolanaAddressShape(token)) return "solana";
  return "robinhood";
}

function terminalImageAttachments(
  attachments: LinkrTurnInput["attachments"] = [],
): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter(
      (item): item is NonNullable<LinkrTurnInput["attachments"]>[number] => {
        if (!item || typeof item !== "object") return false;
        if (String(item.kind) !== "image") return false;
        return Boolean(String(item.source_url ?? "").trim());
      },
    )
    .map((item) => String(item.source_url).trim())
    .filter(Boolean)
    .slice(0, 4);
}

function hasTerminalImageAttachment(
  attachments: LinkrTurnInput["attachments"] = [],
): boolean {
  return terminalImageAttachments(attachments).length > 0;
}

function missingFields(
  actionType: string,
  payload: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  if (
    ["buy", "sell", "add_liquidity", "remove_liquidity"].includes(actionType) &&
    !payload.token
  ) {
    missing.push("token");
  }
  if (
    actionType === "buy" && !payload.amount_eth && !payload.amount_sol &&
    !payload.amount
  ) {
    missing.push("amount");
  }
  if (actionType === "sell" && !payload.percent) missing.push("percent");
  if (actionType === "swap") {
    if (!payload.direction) missing.push("direction");
    if (
      (payload.direction === "sol_to_usdc" && !payload.amount_sol) ||
      (payload.direction === "usdc_to_sol" && !payload.amount_usdc)
    ) {
      missing.push("amount");
    }
  }
  if (actionType === "transfer") {
    if (!payload.recipient) missing.push("recipient");
    if (
      !payload.amount_eth && !payload.amount_sol && !payload.amount_usdc &&
      !payload.amount
    ) {
      missing.push("amount");
    }
  }
  if (actionType === "burn_token") {
    if (!payload.chain) missing.push("chain");
    if (!payload.token) missing.push("token");
    if (!payload.amount) missing.push("amount");
    if (
      Array.isArray(payload.burn_parse_errors) &&
      (payload.burn_parse_errors as string[]).some((error) =>
        [
          "burn_chain_address_mismatch",
          "native_asset_burn_not_supported",
          "burn_multiple_tokens",
        ].includes(error)
      )
    ) {
      missing.push("valid_burn_command");
    }
  }
  if (actionType === "launch_coin") {
    for (const key of ["name", "symbol", "description", "image_url"]) {
      if (!payload[key]) missing.push(key);
    }
  }
  if (actionType === "remove_liquidity" && !payload.percent) {
    missing.push("percent");
  }
  if (
    actionType === "collect_liquidity_fees" && !payload.position_id &&
    !payload.token
  ) {
    missing.push("position_id");
  }
  if (
    actionType === "claim_creator_rewards" &&
    !payload.launch_id &&
    !payload.token &&
    !payload.symbol &&
    payload.latest !== true
  ) {
    missing.push("launch");
  }
  if (actionType === "schedule_action") {
    if (!payload.action_type || !payload.trigger) {
      missing.push("exact_schedule_details");
    }
    if (!payload.chain) missing.push("chain");
  }
  return missing;
}

function clarificationFor(
  actionType: string,
  missing: string[],
  payload: Record<string, unknown>,
) {
  if (actionType === "schedule_action") {
    return scheduleClarificationReply();
  }
  if (actionType === "claim_creator_rewards") {
    return "Which launch should I claim creator rewards from? Send the contract address, Solana mint, cashtag, or say latest launch.";
  }
  if (actionType === "launch_coin") {
    return `I can draft the launch, but I still need: ${missing.join(", ")}.`;
  }
  if (actionType === "transfer") {
    return `I can prepare the transfer, but I need ${missing.join(" and ")}.`;
  }
  if (actionType === "burn_token") {
    const parseErrors = Array.isArray(payload.burn_parse_errors)
      ? (payload.burn_parse_errors as string[])
      : [];
    if (parseErrors.includes("native_asset_burn_not_supported")) {
      return "This command burns fungible tokens, not native ETH or SOL. Send the token-unit amount, explicit chain, and full CA or mint.";
    }
    if (parseErrors.includes("burn_chain_address_mismatch")) {
      return "The CA or mint format does not match the chain you named. Check both and send the burn command again.";
    }
    if (parseErrors.includes("burn_multiple_tokens")) {
      return "I found more than one address. Send exactly one full token CA or mint for this burn.";
    }
    if (missing.includes("chain")) {
      return "Which chain is this burn for: Solana or Robinhood Chain? I will not infer the chain for an irreversible burn.";
    }
    if (missing.includes("token")) {
      return "Send the full token contract address or Solana mint you want to burn. I will not burn by ticker or token name.";
    }
    if (missing.includes("amount")) {
      return "What exact token amount should I permanently burn? You can also explicitly say all.";
    }
  }
  if (actionType === "sell" && missing.includes("percent")) {
    return "What percent should I sell? You can say half, all, or a number like 25%.";
  }
  if (missing.includes("token")) {
    return "Which token should I use? Send the contract address or mint.";
  }
  if (missing.includes("amount")) {
    return `How much should I ${labelAction(actionType)}?`;
  }
  return `I need ${missing.join(", ")} before I can prepare that ${
    labelAction(actionType)
  }.`;
}

async function createDraft(
  admin: any,
  input: LinkrTurnInput,
  actionType: string,
  payload: Record<string, unknown>,
  missing: string[],
) {
  const draftKey =
    `${input.surface}:${input.surface_conversation_id}:${actionType}`;
  const row = {
    user_id: input.user_id,
    surface: input.surface,
    source_surface: input.surface,
    surface_conversation_id: input.surface_conversation_id,
    terminal_conversation_id: input.conversation?.terminal_conversation_id ??
      null,
    draft_key: draftKey,
    action_type: actionType,
    status: "awaiting_clarification",
    required_fields: missing,
    filled_fields: payload,
    source_refs: input.source_refs ?? [],
    last_message_id: input.conversation?.user_message_id ?? null,
    idempotency_key: stableIdempotencyKey(
      `${input.surface}-draft`,
      input.user_id,
      draftKey,
    ),
    updated_at: new Date().toISOString(),
  };
  const existing = await admin
    .from("linkr_action_drafts")
    .select("id")
    .eq("user_id", input.user_id)
    .eq("draft_key", draftKey)
    .in("status", ["open", "awaiting_clarification", "ready"])
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    const updated = await admin
      .from("linkr_action_drafts")
      .update(row)
      .eq("id", existing.data.id)
      .select("*")
      .maybeSingle();
    if (updated.error) throw updated.error;
    return updated.data;
  }
  const inserted = await admin.from("linkr_action_drafts").insert(row).select(
    "*",
  ).maybeSingle();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function createPendingAction(
  admin: any,
  input: LinkrTurnInput,
  actionType: string,
  payload: Record<string, unknown>,
) {
  const summary = pendingSummary(actionType, payload);
  const key = stableIdempotencyKey(
    `${input.surface}-pending`,
    input.user_id,
    actionType,
    JSON.stringify(payload),
    input.conversation?.terminal_conversation_id,
  );
  const row = {
    user_id: input.user_id,
    surface: input.surface,
    source_surface: input.surface,
    surface_conversation_id: input.surface_conversation_id,
    terminal_conversation_id: input.conversation?.terminal_conversation_id ??
      null,
    user_message_id: input.conversation?.user_message_id ?? null,
    assistant_message_id: input.conversation?.assistant_message_id ?? null,
    action_type: actionType,
    status: "pending",
    confirmation_phrase: confirmationPhrase(actionType),
    summary,
    action_payload: payload,
    risk_summary: riskSummary(actionType, payload),
    deterministic_validation: {
      schema: "v1",
      validated_at: new Date().toISOString(),
    },
    source_refs: input.source_refs ?? [],
    idempotency_key: key,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const inserted = await admin.from("linkr_pending_actions").insert(row).select(
    "*",
  ).maybeSingle();
  if (!inserted.error) return inserted.data;
  const code = String(inserted.error?.code ?? "");
  if (code === "23505") {
    const existing = await admin
      .from("linkr_pending_actions")
      .select("*")
      .eq("idempotency_key", key)
      .eq("user_id", input.user_id)
      .maybeSingle();
    if (existing.error) throw existing.error;
    return existing.data;
  }
  throw inserted.error;
}

function normalizeToolInput(
  actionType: string,
  payload: Record<string, unknown>,
) {
  if (actionType === "buy") {
    return {
      chain: payload.chain,
      token: payload.token,
      amount: payload.amount_eth ?? payload.amount_sol ?? payload.amount,
    };
  }
  if (actionType === "sell") {
    return {
      chain: payload.chain,
      token: payload.token,
      percent: payload.percent,
    };
  }
  if (actionType === "transfer") {
    return {
      chain: payload.chain,
      recipient: payload.recipient,
      amount: payload.amount_eth ?? payload.amount_sol ?? payload.amount_usdc ??
        payload.amount,
    };
  }
  if (actionType === "swap") {
    return {
      chain: "solana",
      direction: payload.direction,
      amount: payload.amount_sol ?? payload.amount_usdc ?? payload.amount,
    };
  }
  if (actionType === "burn_token") {
    return {
      chain: payload.chain,
      token: payload.token,
      amount: payload.amount,
    };
  }
  if (actionType === "launch_coin") {
    return {
      chain: payload.chain,
      name: payload.name,
      symbol: payload.symbol,
      description: payload.description,
      image_url: payload.image_url,
    };
  }
  if (actionType === "add_liquidity") {
    return { chain: payload.chain, token: payload.token };
  }
  if (actionType === "remove_liquidity") {
    return {
      chain: payload.chain,
      token: payload.token,
      percent: payload.percent,
    };
  }
  if (actionType === "collect_liquidity_fees") {
    return { position_id: payload.position_id ?? payload.token };
  }
  if (actionType === "claim_creator_rewards") {
    return {
      chain: payload.chain,
      token: payload.token,
      symbol: payload.symbol,
      launch_id: payload.launch_id,
      latest: payload.latest,
    };
  }
  return {
    chain: payload.chain,
    token: payload.token ?? payload.token_address ?? payload.position_id,
    action_type: payload.action_type,
  };
}

function compactJson(value: unknown, max = 9000): string {
  try {
    const text = JSON.stringify(value, (key, item) => {
      if (
        /\b(private|secret|encrypted|authorization|api[_-]?key|service[_-]?role|seed|mnemonic)\b/i
          .test(
            key,
          )
      ) {
        return "[redacted]";
      }
      return item;
    });
    return text.length > max ? text.slice(0, max - 3) + "..." : text;
  } catch (_) {
    const text = String(value ?? "");
    return text.length > max ? text.slice(0, max - 3) + "..." : text;
  }
}

function prepareToolSuffix(actionType: string) {
  if (actionType === "launch_coin") return "launch";
  if (actionType === "schedule_action") return "schedule";
  if (actionType === "collect_liquidity_fees") return "collect_fees";
  if (actionType === "claim_creator_rewards") return "claim_creator_rewards";
  if (actionType === "burn_token") return "burn";
  return actionType;
}

async function reply(ctx: LinkrRuntimeContext, text: string, parts: any[]) {
  await ctx.sink.appendAssistantDelta(text);
  await ctx.sink.setAssistantMessage({
    content: text,
    parts,
    status: "completed",
  });
}

async function finishRun(
  admin: any,
  input: LinkrTurnInput,
  runId: string,
  status: string,
  route: string,
  outcome: any,
) {
  await admin
    .from("linkr_agent_runs")
    .update({
      status,
      outcome,
      reply_plan: outcome?.answer ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("user_id", input.user_id);
  const conversationId = input.conversation?.terminal_conversation_id;
  if (conversationId) {
    await updateConversationSummary(
      admin,
      conversationId,
      input.user_id,
      route,
    );
  }
}

async function updateConversationSummary(
  admin: any,
  conversationId: string,
  userId: string,
  route: string,
) {
  const [conversation, messagesResult, pendingResult, draftsResult] =
    await Promise.all([
      admin
        .from("linkr_terminal_conversations")
        .select("summary,active_entities")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("linkr_terminal_messages")
        .select("role,content,created_at,parts")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(18),
      admin
        .from("linkr_pending_actions")
        .select("action_type,status,summary,created_at,expires_at")
        .eq("terminal_conversation_id", conversationId)
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(8),
      admin
        .from("linkr_action_drafts")
        .select("action_type,status,required_fields,filled_fields,updated_at")
        .eq("terminal_conversation_id", conversationId)
        .eq("user_id", userId)
        .in("status", ["open", "awaiting_clarification", "ready"])
        .order("updated_at", { ascending: false })
        .limit(8),
    ]);
  if (conversation.error || messagesResult.error) return;

  const messages = messagesResult.data ?? [];
  const ordered = [...(messages ?? [])].reverse();
  const activeEntities = extractImmediateReferences(
    ordered.map((m: any) => m.content).join("\n"),
  ).slice(-12);
  const fallbackSummary = buildFallbackConversationSummary(
    conversation.data?.summary,
    ordered,
    route,
    pendingResult.data ?? [],
    draftsResult.data ?? [],
  );
  const summary = await summarizeConversationSemantically(
    conversation.data?.summary,
    route,
    ordered,
    activeEntities,
    pendingResult.data ?? [],
    draftsResult.data ?? [],
  ).catch(() => fallbackSummary);
  await admin
    .from("linkr_terminal_conversations")
    .update({
      summary,
      active_topic: {
        route,
        updated_at: new Date().toISOString(),
        unresolved_tasks: [
          ...(pendingResult.data ?? []).map(
            (item: any) => `pending ${item.action_type ?? "action"}`,
          ),
          ...(draftsResult.data ?? []).map(
            (item: any) =>
              `draft ${item.action_type ?? "action"} needs ${
                Array.isArray(item.required_fields)
                  ? item.required_fields.join(", ")
                  : "details"
              }`,
          ),
        ].slice(0, 8),
        recent_linkr_lines: ordered
          .filter((m: any) => m.role === "assistant")
          .map((m: any) => String(m.content ?? "").slice(0, 220))
          .filter(Boolean)
          .slice(-5),
      },
      active_entities: activeEntities,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("user_id", userId);
}

async function summarizeConversationSemantically(
  previousSummary: string | null | undefined,
  route: string,
  recentMessages: any[],
  activeEntities: any[],
  pendingActions: any[],
  drafts: any[],
): Promise<string> {
  const response = await callCometResponses({
    models: terminalSummaryModelList(),
    input: buildTerminalSummaryPrompt({
      previousSummary,
      route,
      recentMessages,
      activeEntities,
      pendingActions,
      drafts,
    }),
    reasoning: { effort: "none" },
  });
  const text = sanitizeTerminalReply(extractOutputText(response));
  const lint = lintTerminalReply(text);
  if (!text || !lint.ok) {
    return buildFallbackConversationSummary(
      previousSummary,
      recentMessages,
      route,
      pendingActions,
      drafts,
    );
  }
  return text.slice(0, 1800);
}

function buildFallbackConversationSummary(
  previousSummary: string | null | undefined,
  recentMessages: any[],
  route: string,
  pendingActions: any[],
  drafts: any[],
): string {
  const recent = recentMessages
    .slice(-8)
    .map(
      (m: any) =>
        `${m.role === "assistant" ? "Linkr" : "User"}: ${
          String(m.content ?? "")
            .replace(/\s+/g, " ")
            .slice(0, 180)
        }`,
    )
    .join("\n");
  const openItems = [
    ...pendingActions.map((item: any) =>
      `pending ${item.action_type ?? "action"}`
    ),
    ...drafts.map((item: any) => `draft ${item.action_type ?? "action"}`),
  ].slice(0, 8);
  return [
    previousSummary ? `Prior: ${previousSummary.slice(0, 500)}` : "",
    `Latest route: ${route}.`,
    openItems.length ? `Open items: ${openItems.join("; ")}.` : "",
    "Recent turns:",
    recent,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);
}

async function updateConversationPendingCount(
  admin: any,
  input: LinkrTurnInput,
) {
  const conversationId = input.conversation?.terminal_conversation_id;
  if (!conversationId) return;
  const { count } = await admin
    .from("linkr_pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("terminal_conversation_id", conversationId)
    .eq("user_id", input.user_id)
    .eq("status", "pending");
  await admin
    .from("linkr_terminal_conversations")
    .update({ pending_action_count: count ?? 0 })
    .eq("id", conversationId)
    .eq("user_id", input.user_id);
}

async function persistSourceRef(
  admin: any,
  input: LinkrTurnInput,
  runId: string,
  ref: ResolvedReference,
  messageId: string | null,
) {
  const conversationId = input.conversation?.terminal_conversation_id ?? null;
  if (!conversationId) return null;
  const row = {
    user_id: input.user_id,
    surface: input.surface,
    surface_conversation_id: input.surface_conversation_id,
    terminal_conversation_id: conversationId,
    message_id: messageId,
    run_id: runId,
    ref_type: ref.entity_type,
    ref_key: ref.entity_id,
    label: ref.label,
    url: (ref.value as any)?.url ?? null,
    privacy_label: ref.privacy_label,
    source_payload: ref,
    resolved_payload: ref.value,
    confidence: ref.confidence,
    freshness: ref.freshness,
  };
  const { data, error } = await admin
    .from("linkr_source_refs")
    .upsert(row, {
      onConflict: "user_id,surface,surface_conversation_id,ref_type,ref_key",
    })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function writeMemoryEvent(
  admin: any,
  input: LinkrTurnInput,
  runId: string,
  eventType: string,
  title: string,
  summary: string,
  sourceType = "terminal_action",
) {
  const { data, error } = await admin
    .from("linkr_memory_events")
    .insert({
      user_id: input.user_id,
      surface: input.surface,
      surface_conversation_id: input.surface_conversation_id,
      terminal_conversation_id: input.conversation?.terminal_conversation_id ??
        null,
      message_id: input.conversation?.user_message_id ?? null,
      run_id: runId,
      event_type: eventType,
      memory_source_type: sourceType,
      memory_source_id: input.conversation?.user_message_id ?? null,
      title,
      summary,
      privacy_label: "user_private",
    })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function acquireRunLock(
  admin: any,
  input: LinkrTurnInput,
  runId: string,
) {
  const scopeId = input.surface_conversation_id;
  const lockKey = `${input.surface}:${scopeId}`;
  const ownerId = `${runId}:${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const acquired = await admin.rpc("acquire_linkr_agent_lock", {
    p_lock_key: lockKey,
    p_user_id: input.user_id,
    p_surface: input.surface,
    p_scope_type: "conversation",
    p_scope_id: scopeId,
    p_run_id: runId,
    p_owner_id: ownerId,
    p_expires_at: expiresAt,
  });
  if (acquired.error) throw acquired.error;
  if (acquired.data === true) return { lockKey, ownerId };
  throw new Error("conversation_run_locked");
}

async function releaseRunLock(
  admin: any,
  lock: { lockKey: string; ownerId: string },
) {
  await admin
    .from("linkr_agent_locks")
    .delete()
    .eq("lock_key", lock.lockKey)
    .eq("owner_id", lock.ownerId);
}

function result(
  input: LinkrTurnInput,
  runId: string,
  status: LinkrTurnResult["status"],
  route: string,
  pendingIds: string[],
  jobIds: string[],
  memoryIds: string[],
): LinkrTurnResult {
  return {
    status,
    route,
    surface: input.surface,
    assistant_message_id: input.conversation?.assistant_message_id ?? undefined,
    run_id: runId,
    pending_action_ids: pendingIds,
    action_job_ids: jobIds,
    memory_event_ids: memoryIds,
  };
}

function latestActiveToken(state: RuntimeState): ResolvedReference | null {
  const entities = Array.isArray(state.conversation?.active_entities)
    ? state.conversation.active_entities
    : [];
  const found = [...entities]
    .reverse()
    .find((item: any) =>
      item?.entity_type === "token" || item?.kind === "token"
    );
  if (!found) return null;
  return {
    entity_type: "token",
    entity_id: found.entity_id ?? found.id,
    label: found.label ?? found.entity_id ?? "token",
    value: found.value ?? found,
    surface_source: "conversation_state",
    confidence: 0.72,
    reason: "latest active token",
    privacy_label: found.privacy_label ?? "user_private",
    freshness: "recent",
  };
}

function inferChain(
  text: string,
  tokenRef: ResolvedReference | null,
  tokenAddress?: string | null,
): "robinhood" | "solana" {
  const lower = text.toLowerCase();
  if (/\b(sol|solana|pump|pump\.fun|pumpswap)\b/.test(lower)) return "solana";
  if (/\b(eth|evm|robinhood|rhood)\b/.test(lower)) return "robinhood";
  const chain = String((tokenRef?.value as any)?.chain ?? "");
  if (chain === "solana") return "solana";
  if (chain === "robinhood") return "robinhood";
  const token = String(tokenAddress ?? "").trim();
  if (isEvmAddressShape(token)) return "robinhood";
  if (isSolanaAddressShape(token)) return "solana";
  if (/\b0x[a-fA-F0-9]{40}\b/.test(text)) return "robinhood";
  if (/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.test(text)) return "solana";
  return "robinhood";
}

function isEvmAddressShape(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isSolanaAddressShape(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function numberBefore(text: string, unit: string): number | null {
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(\\d+(?:\\.\\d+)?)\\s*" + escaped, "i");
  const match = re.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numberBeforeAny(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstAddressAfter(text: string, _prefix: RegExp): string | null {
  const evm = /\b0x[a-fA-F0-9]{40}\b/.exec(text);
  if (evm) return evm[0];
  const sol = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/.exec(text);
  return sol?.[0] ?? null;
}

function transferRecipient(text: string): string | null {
  const afterTo =
    /\bto\s+(@[A-Za-z0-9_]{1,15}|0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/i
      .exec(text);
  if (afterTo?.[1]) return afterTo[1];
  return firstAddressAfter(text, /(to|send|transfer)\s+/i);
}

function quoted(text: string, label: string): string | null {
  const re = new RegExp(label + "\\s*[:=]\\s*[\"']([^\"']+)[\"']", "i");
  return re.exec(text)?.[1]?.trim() ?? null;
}

function fieldAfter(text: string, re: RegExp): string | null {
  const match = re.exec(text);
  if (!match) return null;
  return (
    text
      .slice(match.index + match[0].length)
      .split(/[,.]/)[0]
      ?.trim() || null
  );
}

function cashtag(text: string): string | null {
  return /\$[A-Za-z][A-Za-z0-9]{1,12}\b/.exec(text)?.[0] ?? null;
}

function firstUrl(text: string): string | null {
  return /https?:\/\/\S+/i.exec(text)?.[0]?.replace(/[),.]+$/, "") ?? null;
}

function pendingSummary(actionType: string, payload: Record<string, unknown>) {
  if (actionType === "schedule_action") {
    return `Schedule ${payload.action_type} on ${payload.chain}`;
  }
  if (actionType === "buy") {
    return `Buy ${payload.amount_eth ?? payload.amount_sol ?? payload.amount} ${
      payload.amount_sol ? "SOL" : "ETH"
    } of ${short(String(payload.token))}`;
  }
  if (actionType === "sell") {
    return `Sell ${payload.percent}% of ${short(String(payload.token))}`;
  }
  if (actionType === "transfer") {
    return `Send ${
      payload.amount_eth ?? payload.amount_sol ?? payload.amount_usdc ??
        payload.amount
    } ${payload.amount_usdc ? "USDC" : payload.amount_sol ? "SOL" : "ETH"} to ${
      short(
        String(payload.recipient),
      )
    }`;
  }
  if (actionType === "swap") {
    const solToUsdc = payload.direction === "sol_to_usdc";
    return `Swap ${solToUsdc ? payload.amount_sol : payload.amount_usdc} ${
      solToUsdc ? "SOL" : "USDC"
    } for ${solToUsdc ? "USDC" : "SOL"}`;
  }
  if (actionType === "launch_coin") {
    return `Launch $${payload.symbol} on ${payload.chain}`;
  }
  if (actionType === "burn_token") {
    const preview = payload.burn_preview as any;
    return `Permanently burn ${preview?.amount ?? payload.amount}${
      preview?.symbol ? ` ${preview.symbol}` : " tokens"
    } on ${preview?.chain === "solana" ? "Solana" : "Robinhood Chain"} (${
      short(
        String(preview?.token ?? payload.token),
      )
    })`;
  }
  if (actionType === "claim_creator_rewards") {
    return String(
      (payload.claim_preview as any)?.summary ??
        `Claim creator rewards for ${
          short(
            String(
              payload.token ?? payload.symbol ?? payload.launch_id ?? "launch",
            ),
          )
        }`,
    );
  }
  return `${labelAction(actionType)} for ${
    short(
      String(payload.token ?? payload.position_id ?? ""),
    )
  }`;
}

function confirmationPhrase(actionType: string) {
  if (actionType === "schedule_action") return SCHEDULER_CONFIRMATION_PHRASE;
  if (actionType === "claim_creator_rewards") return "confirm claim";
  if (actionType === "burn_token") return "confirm burn";
  return actionType === "launch_coin"
    ? "confirm launch"
    : `confirm ${labelAction(actionType)}`;
}

function riskSummary(actionType: string, payload: Record<string, unknown>) {
  if (actionType === "burn_token") {
    return [
      {
        level: "critical",
        text:
          "This permanently destroys the exact token amount shown. It cannot be reversed or recovered.",
      },
      { level: "important", text: pendingSummary(actionType, payload) },
    ];
  }
  return [
    {
      level: "important",
      text:
        "This can move wallet value and cannot be reversed by Linkr after submission.",
    },
    { level: "info", text: pendingSummary(actionType, payload) },
  ];
}

function summarizeRows(rows: any[], kind: string) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "I did not find matching records for that yet.";
  }
  const label = kind.replace(".query", "").replace("_", " ");
  const first = rows
    .slice(0, 5)
    .map((
      row: any,
    ) => (row.symbol ? `$${row.symbol}` : (row.action ?? row.status ?? row.id)))
    .join(", ");
  return `I found ${rows.length} ${label} record${
    rows.length === 1 ? "" : "s"
  }. Recent: ${first}.`;
}

function labelAction(value: string) {
  return value.replace(/_/g, " ");
}

function short(value: string | null | undefined) {
  if (!value) return "";
  return value.length > 14
    ? `${value.slice(0, 6)}...${value.slice(-4)}`
    : value;
}

function formatNumber(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function runtimeErrorCode(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "runtime_error";
}

function userSafeError(message: string) {
  if (
    /transfer_status_uncertain|submission_outcome_unknown|reconcil/i.test(
      message,
    )
  ) {
    return "The transaction outcome is not confirmed yet. I blocked duplicate execution and marked it for reconciliation.";
  }
  if (/conversation_run_locked/.test(message)) {
    return "I am still finishing the previous turn in this conversation. Give me a moment and try again.";
  }
  if (/insufficient/i.test(message)) {
    return "That cannot run because the wallet balance is too low.";
  }
  if (/wallet/i.test(message)) {
    return "I could not find the required Linkr wallet for that action.";
  }
  if (
    /no_rewards_claimable|fee-sharing|creator rewards|multiple_matching_launches|missing_launch_id|launch_not_found|launch_token_not_confirmed/
      .test(
        message,
      )
  ) {
    return "I could not safely prepare or execute that creator-rewards claim. No transaction was created.";
  }
  return "I hit a runtime error before completing that. I did not execute any new value-moving action.";
}

function burnPreparationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/evm_burn_verification_unavailable/.test(message)) {
    return "I could not verify the token contract's burn function right now, so I stopped before creating a transaction. Try again later.";
  }
  if (/evm_token_burn_not_supported/.test(message)) {
    return "That Robinhood Chain token does not support the standard holder burn function, so I will not attempt it or substitute a dead-address transfer.";
  }
  if (/no_token_balance/.test(message)) {
    return "Your Linkr wallet does not hold that token.";
  }
  if (/insufficient_native_balance_for_burn_gas/.test(message)) {
    return "Your Linkr wallet does not have enough native chain balance to pay the burn transaction fee.";
  }
  if (/insufficient_token_balance/.test(message)) {
    return "Your Linkr wallet does not hold enough of that token for the requested burn.";
  }
  if (/precision|invalid_burn_amount|positive/.test(message)) {
    return "That burn amount is not valid for the token's decimal precision. Send an exact positive token amount.";
  }
  if (/mint|token_contract|address|public_key/.test(message)) {
    return "I could not validate that full token contract address or Solana mint for the selected chain.";
  }
  if (/wallet/.test(message)) {
    return "I could not find the required Linkr wallet for that burn.";
  }
  if (/simulation/.test(message)) {
    return "The burn failed its on-chain simulation, so I did not create a confirmation.";
  }
  return "I could not safely prepare that burn. No transaction was created.";
}
