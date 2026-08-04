// deno-lint-ignore-file no-explicit-any
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  clarificationReply,
  detectLaunchIntentWithAi,
  extractLaunchFields,
  isLaunchCancellation,
  isLaunchCommand,
  isLaunchConfirmation,
  isLaunchRetry,
  type LaunchFields,
  mergeLaunchFields,
  missingLaunchFields,
} from "../_shared/x_launch_command.ts";
import {
  checkXLaunchNativeBalance,
  resolveGuardedLaunchChain,
} from "../_shared/x_launch_balance_guard.ts";
import {
  buildLaunchDraftSlotPatch,
  mergeSlotProvenanceContext,
  reconcileLaunchDraftWithAi,
} from "../_shared/launch_slot_reconciler.ts";
import { withLaunchStateEcho } from "../_shared/launch_contract.ts";
import { parseXTradeCommand } from "../_shared/x_trade_command.ts";
import {
  classifyNftCommandWithAi,
  parseXNftCommand,
} from "../_shared/x_nft_command.ts";
import { prepareXNftXFlow } from "../_shared/x_nft_prepare.ts";
import { executeXTradeCommand } from "../_shared/x_trade_execute.ts";
import { prepareXAirdropXFlow } from "../_shared/x_airdrop_prepare.ts";
import {
  launchCooldownMessage,
  readLaunchCooldown,
} from "../_shared/launch_cooldown.ts";

const VERSION = "worker-command-prepare-v2";

Deno.serve((req) =>
  runStageWorker(req, {
    stage: "command_prepare",
    functionName: "worker-command-prepare",
    consumerVersion: VERSION,
    visibilitySeconds: 120,
    process: async (claim, admin) => {
      const tweetId = String(claim.work_item.source_event_id ?? "");
      const tweetResult = await admin.from("tweets_inbox").select("*")
        .eq("tweet_id", tweetId).maybeSingle();
      if (tweetResult.error) throw tweetResult.error;
      const tweet = tweetResult.data;
      if (!tweet) {
        return { kind: "dead_letter", reasonCode: "x_tweet_not_found" };
      }

      let userId = claim.work_item.user_id;
      if (!userId) {
        const profile = await admin.from("profiles").select("user_id")
          .eq("twitter_id", tweet.author_twitter_id).maybeSingle();
        if (profile.error) throw profile.error;
        userId = profile.data?.user_id ?? null;
      }
      if (!userId) {
        return {
          kind: "retry",
          errorCode: "x_user_provisioning_pending",
          delaySeconds: 60,
        };
      }

      const pendingResult = await admin.from("linkr_pending_actions").select(
        "*",
      )
        .eq("user_id", userId).eq("surface", "x").eq("status", "pending")
        .eq("surface_conversation_id", tweet.conversation_id)
        .order("created_at", { ascending: false }).limit(5);
      if (pendingResult.error) throw pendingResult.error;
      const pendingActions = Array.isArray(pendingResult.data)
        ? pendingResult.data
        : [];
      const pendingLaunch = pendingActions.find((action: any) =>
        action?.action_type === "launch_coin"
      ) ?? null;

      if (isLaunchConfirmation(tweet.text) && pendingLaunch) {
        const confirmed = await admin.rpc("confirm_linkr_launch_action_v2", {
          p_pending_action_id: pendingLaunch.id,
          p_confirmation_work_item_id: claim.work_item.id,
        });
        if (confirmed.error) throw confirmed.error;
        await queueReply(
          admin,
          claim.work_item.id,
          confirmed.data?.expired
            ? "launch_confirmation_expired"
            : "launch_confirmation_ack",
          1,
          confirmed.data?.expired
            ? "That launch approval expired. Nothing was signed or submitted. Start a new launch request when you're ready."
            : "Launch approved. The chain-specific worker is preparing the transaction now.",
        );
        await markTweetCompleted(admin, tweetId);
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `confirmation:${pendingLaunch.id}`,
        };
      }

      if (isLaunchCancellation(tweet.text) && pendingLaunch) {
        const cancelled = await admin.rpc("cancel_linkr_launch_action_v1", {
          p_pending_action_id: pendingLaunch.id,
          p_cancellation_work_item_id: claim.work_item.id,
        });
        if (cancelled.error) throw cancelled.error;
        await queueReply(
          admin,
          claim.work_item.id,
          "launch_cancelled",
          1,
          "Launch cancelled. No transaction was signed or submitted.",
        );
        await markTweetCompleted(admin, tweetId);
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `cancelled:${pendingLaunch.id}`,
        };
      }

      if (isLaunchRetry(tweet.text)) {
        const resumed = await admin.rpc(
          "resume_linkr_launch_after_funding_v1",
          {
            p_user_id: userId,
            p_input_work_item_id: claim.work_item.id,
          },
        );
        if (resumed.error) {
          if (
            /waiting_funds_launch_not_found/.test(
              String(resumed.error.message ?? resumed.error),
            )
          ) {
            await queueReply(
              admin,
              claim.work_item.id,
              "launch_retry_unavailable",
              1,
              "I couldn't find a launch waiting for funds in this thread.",
            );
            await markTweetCompleted(admin, tweetId);
            return {
              kind: "complete",
              state: "rejected",
              resultRef: "launch-retry-unavailable",
            };
          }
          throw resumed.error;
        }
        await queueReply(
          admin,
          claim.work_item.id,
          "launch_funding_retry_ack",
          1,
          "Funding check resumed. I'll submit the launch once the wallet passes preflight.",
        );
        await markTweetCompleted(admin, tweetId);
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `launch-retry:${resumed.data.economic_work_item_id}`,
        };
      }

      if (readBoolean("LINKR_NFT_PENDING_CONFIRMATION_ENABLED", true)) {
        const nftOutcome = await prepareXNftXFlow({
          admin,
          userId,
          workItem: claim.work_item,
          tweet,
          pendingActions,
        });
        if (nftOutcome) {
          await queueReply(
            admin,
            claim.work_item.id,
            nftOutcome.replyKind,
            1,
            nftOutcome.replyText,
          );
          await markTweetCompleted(admin, tweetId);
          return {
            kind: "complete",
            state: nftOutcome.state,
            resultRef: nftOutcome.resultRef,
          };
        }
      }

      const airdropOutcome = await prepareXAirdropXFlow({
        admin,
        userId,
        workItem: claim.work_item,
        tweet,
        pendingActions,
      });
      if (airdropOutcome) {
        await queueReply(
          admin,
          claim.work_item.id,
          airdropOutcome.replyKind,
          1,
          airdropOutcome.replyText,
        );
        await markTweetCompleted(admin, tweetId);
        return {
          kind: "complete",
          state: airdropOutcome.state,
          resultRef: airdropOutcome.resultRef,
        };
      }

      // X trade / transfer commands (buy, sell, transfer). Auto-executes when
      // the user has caps configured for the target chain and action.
      const tradeCommand = parseXTradeCommand(tweet.text);
      if (tradeCommand) {
        let outcome;
        try {
          outcome = await executeXTradeCommand({
            admin,
            userId,
            tweetId,
            command: tradeCommand,
          });
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "x_trade_retryable_error",
              tweet_id: tweetId,
              message: String(error instanceof Error ? error.message : error)
                .slice(0, 300),
            }),
          );
          return {
            kind: "retry",
            errorCode: "x_trade_infra_retry",
            delaySeconds: 60,
          };
        }
        await queueReply(
          admin,
          claim.work_item.id,
          outcome.replyKind,
          1,
          outcome.replyText,
        );
        await markTweetCompleted(admin, tweetId);
        return {
          kind: "complete",
          state: outcome.ok ? "succeeded" : "rejected",
          resultRef:
            `x-trade:${tradeCommand.kind}-${tradeCommand.chain}:${tweetId}`,
        };
      }

      // NFT commands (mint collection / mint NFT into collection) on Solana.
      // Try deterministic parser first for the well-formed shapes, then fall
      // back to an AI classifier that handles messy phrasings and fills only
      // the fields the user actually supplied (executor invents defaults).
      if (!readBoolean("LINKR_NFT_PENDING_CONFIRMATION_ENABLED", true)) {
        let nftCommand = parseXNftCommand(tweet.text);
        if (!nftCommand) {
          nftCommand = await classifyNftCommandWithAi(tweet.text);
        }
        if (nftCommand) {
          const queued = await admin.rpc("enqueue_linkr_nft_solana_v1", {
            p_parent_work_item_id: claim.work_item.id,
            p_payload: {
              kind: nftCommand.kind,
              tweet_id: tweetId,
              command: nftCommand,
            },
            p_priority: 50,
          });
          if (queued.error) throw queued.error;
          return {
            kind: "complete",
            state: "succeeded",
            resultRef: `x-nft-queued:${queued.data?.work_item_id ?? tweetId}`,
          };
        }
      }

      const resolved = await admin.rpc("resolve_linkr_launch_thread_v1", {
        p_input_work_item_id: claim.work_item.id,
        p_user_id: userId,
      });
      if (resolved.error) throw resolved.error;
      const existingDraft = resolved.data;
      const existingFields =
        (existingDraft?.filled_fields ?? {}) as LaunchFields;
      const existingProvenance =
        (existingDraft?.field_provenance ?? {}) as Record<string, unknown>;
      const deterministicFields = extractLaunchFields(
        tweet.text,
        tweet.media_url,
      );
      let launchCommand = isLaunchCommand(tweet.text);
      const guardedChain = resolveGuardedLaunchChain({
        existingFields,
        incomingFields: deterministicFields,
      });
      if ((launchCommand || existingDraft) && guardedChain) {
        try {
          const balanceGuard = await checkXLaunchNativeBalance({
            admin,
            userId,
            chain: guardedChain,
            fields: mergeLaunchFields(existingFields, deterministicFields),
          });
          if (!balanceGuard.ok) {
            await queueReply(
              admin,
              claim.work_item.id,
              balanceGuard.replyKind,
              1,
              balanceGuard.replyText,
            );
            await markTweetCompleted(admin, tweetId);
            return {
              kind: "complete",
              state: "rejected",
              resultRef: `launch-balance-guard:${guardedChain}:${tweetId}`,
            };
          }
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "x_launch_balance_guard_error",
              tweet_id: tweetId,
              chain: guardedChain,
              message: String(error instanceof Error ? error.message : error)
                .slice(0, 300),
            }),
          );
        }
      }
      if (!launchCommand && !existingDraft) {
        launchCommand = await detectLaunchIntentWithAi(tweet.text);
      }
      if (launchCommand && !existingDraft) {
        const cooldown = await readLaunchCooldown(admin, userId);
        if (!cooldown.allowed) {
          await queueReply(
            admin,
            claim.work_item.id,
            "launch_cooldown_active",
            1,
            launchCooldownMessage(cooldown),
          );
          await markTweetCompleted(admin, tweetId);
          return {
            kind: "complete",
            state: "rejected",
            resultRef: "launch-cooldown-active",
          };
        }
      }
      if (!existingDraft && !launchCommand) {
        if (alreadyEscapedToConversation(claim.work_item.payload)) {
          await queueReply(
            admin,
            claim.work_item.id,
            "safe_refusal",
            1,
            "I cannot turn that into a safe Linkr action from a public reply. Say it as a normal question or give the exact supported action you want.",
          );
          await markTweetCompleted(admin, tweetId);
          return {
            kind: "complete",
            state: "rejected",
            resultRef: "unsupported-command-loop-guard",
          };
        }
        await markConversationEscape(
          admin,
          claim.work_item.id,
          tweetId,
          claim.work_item.payload,
        );
        const routed = await admin.from("tweets_inbox").update({
          status: "processing",
          ai_processing_lane: "reply",
          ai_route_kind: "conversation",
          ai_route_reason: "command_prepare_no_exact_match_conversation_escape",
          ai_routed_at: new Date().toISOString(),
          error: null,
        }).eq("tweet_id", tweetId);
        if (routed.error) throw routed.error;
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "conversation.turn",
          resultRef: "command-prepare-conversation-escape",
        };
      }

      const threadContext = await loadLaunchThreadContext(
        admin,
        existingDraft,
        tweet,
      );
      let reconciliation;
      try {
        reconciliation = await reconcileLaunchDraftWithAi({
          existingFields,
          existingProvenance,
          originalLaunchText: threadContext.originalTweetText,
          latestUserText: tweet.text,
          latestTweetId: tweetId,
          originalTweetId: threadContext.originalTweetId,
          previousAssistantReplyText: threadContext.previousAssistantReplyText,
          currentMissingFields: missingLaunchFields(existingFields),
          latestMediaUrl: tweet.media_url,
          sourceRefs: existingDraft?.source_refs ?? null,
          botHandle: Deno.env.get("X_BOT_HANDLE") ?? "linkrbot",
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "x_launch_slot_reconciler_error",
            tweet_id: tweetId,
            message: String(error instanceof Error ? error.message : error)
              .slice(0, 300),
          }),
        );
        return {
          kind: "retry",
          errorCode: "launch_slot_reconciler_retryable",
          delaySeconds: 60,
        };
      }

      if (
        !launchReconcilerIntentCanMutate(reconciliation.intent, {
          existingDraft: Boolean(existingDraft),
          launchCommand,
        })
      ) {
        await queueReply(
          admin,
          claim.work_item.id,
          "launch_clarification",
          1,
          existingDraft
            ? savedLaunchClarification(existingFields)
            : 'To start a launch, say "launch a coin called ..." and include Solana or Robinhood.',
        );
        await markTweetCompleted(admin, tweetId);
        return {
          kind: "complete",
          state: existingDraft ? "waiting_user_input" : "rejected",
          resultRef: existingDraft
            ? `draft:${existingDraft.id}`
            : "unsupported-command",
        };
      }

      const slotPatch = buildLaunchDraftSlotPatch({
        existingFields,
        existingProvenance,
        originalLaunchText: threadContext.originalTweetText,
        latestUserText: tweet.text,
        latestTweetId: tweetId,
        originalTweetId: threadContext.originalTweetId,
        previousAssistantReplyText: threadContext.previousAssistantReplyText,
        currentMissingFields: missingLaunchFields(existingFields),
        latestMediaUrl: tweet.media_url,
        sourceRefs: existingDraft?.source_refs ?? null,
        botHandle: Deno.env.get("X_BOT_HANDLE") ?? "linkrbot",
      }, reconciliation);
      const fields = slotPatch.filledFields;
      const provenance = slotPatch.fieldProvenance;

      // A clarification round only counts when we actually stop and ask. Two
      // rounds without the required slots getting any closer means the loop is
      // not converging, and asking a third time will not help.
      const priorRounds = Number(
        existingDraft?.generation_context?.clarification_rounds ?? 0,
      );
      const clarificationRounds = Number.isFinite(priorRounds) && priorRounds > 0
        ? Math.min(priorRounds, 10)
        : 0;

      const generationContext = {
        ...mergeSlotProvenanceContext(
          (existingDraft?.generation_context ?? {}) as Record<string, unknown>,
          slotPatch,
        ),
        explicit_launch_intent: launchCommand ||
          existingDraft?.generation_context?.explicit_launch_intent === true,
        last_input_tweet_id: tweetId,
        clarification_rounds: clarificationRounds,
      };
      const draftResult = await admin.rpc("upsert_linkr_launch_draft_v2", {
        p_input_work_item_id: claim.work_item.id,
        p_user_id: userId,
        p_filled_fields: fields,
        p_field_provenance: provenance,
        p_generation_context: generationContext,
      });
      if (draftResult.error) throw draftResult.error;
      const draft = draftResult.data;
      const missing = missingLaunchFields(draft.filled_fields as LaunchFields);

      // A launch may only be stopped for a slot the user actually has to
      // supply. `clarificationReply` must never be handed a synthetic missing
      // list: it previously received a hardcoded ["name"] whenever a
      // clarification was wanted but nothing was missing, which is how the bot
      // asked a user to name a token it had been holding for four turns.
      const stalling = clarificationRounds >= 2;
      if (slotPatch.needsClarification && !stalling) {
        const question = slotPatch.clarificationQuestion ??
          (missing.length > 0
            ? clarificationReply(missing, draft.filled_fields as LaunchFields)
            : null);
        if (question) {
          if (missing.length === 0) {
            const paused = await admin.rpc("pause_linkr_launch_preparation_v1", {
              p_draft_id: draft.id,
              p_reason_code: "launch_slot_clarification_required",
            });
            if (paused.error) throw paused.error;
          }
          await recordClarificationRound(admin, draft, clarificationRounds + 1);
          logLaunchClarification({
            surface: "x",
            draftId: draft.id,
            round: clarificationRounds + 1,
            missing,
            blockingSlots: slotPatch.blockedSlots.filter((slot) =>
              missing.includes(slot)
            ),
            advisorySlots: slotPatch.advisorySlots,
            questionSource: slotPatch.clarificationQuestion ? "model" : "contract",
          });
          await queueReply(
            admin,
            claim.work_item.id,
            "launch_clarification",
            Number(draft.version),
            withLaunchStateEcho(draft.filled_fields, question),
          );
          await markTweetCompleted(admin, tweetId);
          return {
            kind: "complete",
            state: "waiting_user_input",
            resultRef: `draft:${draft.id}`,
          };
        }
        // Nothing required is outstanding and there is no honest question to
        // ask. Never stall: fall through and let enrichment fill the rest.
      }

      if (missing.length > 0) {
        logLaunchClarification({
          surface: "x",
          draftId: draft.id,
          round: clarificationRounds + 1,
          missing,
          blockingSlots: missing,
          advisorySlots: slotPatch.advisorySlots,
          questionSource: "contract",
        });
        await recordClarificationRound(admin, draft, clarificationRounds + 1);
        await queueReply(
          admin,
          claim.work_item.id,
          "launch_clarification",
          Number(draft.version),
          clarificationReply(missing, draft.filled_fields as LaunchFields),
        );
        await markTweetCompleted(admin, tweetId);
        return draft.work_item_id === claim.work_item.id
          ? {
            kind: "complete",
            state: "waiting_user_input",
            resultRef: `draft:${draft.id}`,
          }
          : {
            kind: "complete",
            state: "succeeded",
            resultRef: `draft-update:${draft.id}`,
          };
      }

      const queued = await admin.rpc("queue_linkr_launch_enrichment_v1", {
        p_draft_id: draft.id,
        p_input_work_item_id: claim.work_item.id,
      });
      if (queued.error) throw queued.error;
      await markTweetCompleted(admin, tweetId);
      return draft.work_item_id === claim.work_item.id
        ? {
          kind: "complete",
          state: "waiting_prerequisite",
          resultRef: `launch-enrichment:${queued.data.enrichment_work_item_id}`,
        }
        : {
          kind: "complete",
          state: "succeeded",
          resultRef:
            `launch-enrichment-update:${queued.data.enrichment_work_item_id}`,
        };
    },
  })
);

function launchReconcilerIntentCanMutate(
  intent: string,
  context: { existingDraft: boolean; launchCommand: boolean },
): boolean {
  return (context.existingDraft || context.launchCommand) &&
    (intent === "continue_launch" || intent === "edit_launch");
}

function savedLaunchClarification(fields: LaunchFields): string {
  const missing = missingLaunchFields(fields);
  if (missing.length > 0) return clarificationReply(missing, fields);
  return withLaunchStateEcho(
    fields,
    'Reply with the launch change you want, or "cancel launch".',
  );
}

/**
 * Count how many times this draft has stopped to ask. Two rounds without the
 * required slots getting closer means asking again will not help, so the
 * pipeline proceeds on autofill instead of looping.
 *
 * Never allowed to fail a launch: a counter that cannot be written is a
 * telemetry problem, not a reason to stop.
 */
async function recordClarificationRound(
  admin: any,
  draft: any,
  round: number,
): Promise<void> {
  try {
    const context = {
      ...((draft?.generation_context ?? {}) as Record<string, unknown>),
      clarification_rounds: round,
    };
    const result = await admin.from("linkr_action_drafts")
      .update({ generation_context: context })
      .eq("id", draft.id);
    if (result.error) throw result.error;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "launch_clarification_round_not_recorded",
        draft_id: draft?.id ?? null,
        message: String(error instanceof Error ? error.message : error).slice(
          0,
          200,
        ),
      }),
    );
  }
}

function logLaunchClarification(entry: {
  surface: string;
  draftId: string | null;
  round: number;
  missing: string[];
  blockingSlots: string[];
  advisorySlots: string[];
  questionSource: "model" | "contract";
}): void {
  console.log(
    JSON.stringify({ event: "launch_clarification_emitted", ...entry }),
  );
}

async function loadLaunchThreadContext(
  admin: any,
  existingDraft: any,
  tweet: any,
): Promise<{
  originalTweetId: string;
  originalTweetText: string;
  previousAssistantReplyText: string | null;
}> {
  const originalTweetId = firstText([
    existingDraft?.source_tweet_id,
    firstSourceRefTweetId(existingDraft?.source_refs),
    tweet.parent_tweet_id,
    tweet.root_tweet_id,
    tweet.referenced_tweet_id,
    tweet.tweet_id,
  ]);
  let originalTweetText = String(tweet.text ?? "");
  if (originalTweetId && originalTweetId !== String(tweet.tweet_id ?? "")) {
    const originalResult = await admin.from("tweets_inbox").select("text")
      .eq("tweet_id", originalTweetId).order("created_at", {
        ascending: true,
      }).limit(1).maybeSingle();
    if (!originalResult.error && originalResult.data?.text) {
      originalTweetText = String(originalResult.data.text);
    }
  }

  let previousAssistantReplyText: string | null = null;
  if (originalTweetId) {
    const replyResult = await admin.from("twitter_replies").select("reply_text")
      .eq("tweet_id", originalTweetId).order("created_at", {
        ascending: false,
      }).limit(1).maybeSingle();
    if (!replyResult.error && replyResult.data?.reply_text) {
      previousAssistantReplyText = String(replyResult.data.reply_text);
    }
  }

  return {
    originalTweetId: originalTweetId || String(tweet.tweet_id ?? ""),
    originalTweetText,
    previousAssistantReplyText,
  };
}

function firstSourceRefTweetId(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    if (item && typeof item === "object") {
      const tweetId = (item as Record<string, unknown>).tweet_id;
      if (typeof tweetId === "string" && tweetId.trim()) {
        return tweetId.trim();
      }
    }
  }
  return "";
}

function firstText(values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

async function queueReply(
  admin: any,
  parentId: string,
  kind: string,
  version: number,
  text: string,
) {
  const result = await admin.rpc("enqueue_linkr_x_reply_v1", {
    p_parent_work_item_id: parentId,
    p_reply_text: text,
    p_kind: kind,
    p_version: Math.max(1, version),
    p_priority: 50,
  });
  if (result.error) throw result.error;
}

function alreadyEscapedToConversation(payload: unknown): boolean {
  return !!(payload && typeof payload === "object" &&
    (payload as Record<string, unknown>).command_prepare_conversation_escape ===
      true);
}

async function markConversationEscape(
  admin: any,
  workItemId: string,
  tweetId: string,
  existingPayload: unknown,
) {
  const payload = existingPayload && typeof existingPayload === "object" &&
      !Array.isArray(existingPayload)
    ? { ...(existingPayload as Record<string, unknown>) }
    : {};
  const result = await admin.from("linkr_work_items").update({
    payload: {
      ...payload,
      command_prepare_conversation_escape: true,
      command_prepare_conversation_escape_tweet_id: tweetId,
    },
  }).eq("id", workItemId);
  if (result.error) throw result.error;
}

async function markTweetCompleted(admin: any, tweetId: string) {
  const result = await admin.from("tweets_inbox").update({
    status: "completed",
    processed_at: new Date().toISOString(),
    error: null,
  }).eq("tweet_id", tweetId);
  if (result.error) throw result.error;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}
