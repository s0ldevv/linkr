// deno-lint-ignore-file no-explicit-any
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  clarificationReply,
  detectLaunchIntentWithAi,
  extractLaunchFields,
  extractLaunchFieldsWithAi,
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
import { parseXTradeCommand } from "../_shared/x_trade_command.ts";
import {
  classifyNftCommandWithAi,
  parseXNftCommand,
} from "../_shared/x_nft_command.ts";

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
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (pendingResult.error) throw pendingResult.error;
      const pending = pendingResult.data;

      if (isLaunchConfirmation(tweet.text) && pending) {
        const confirmed = await admin.rpc("confirm_linkr_launch_action_v2", {
          p_pending_action_id: pending.id,
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
          resultRef: `confirmation:${pending.id}`,
        };
      }

      if (isLaunchCancellation(tweet.text) && pending) {
        const cancelled = await admin.rpc("cancel_linkr_launch_action_v1", {
          p_pending_action_id: pending.id,
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
          resultRef: `cancelled:${pending.id}`,
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

      // X trade / transfer commands (buy, sell, transfer). Auto-executes when
      // the user has caps configured for the target chain and action.
      const tradeCommand = parseXTradeCommand(tweet.text);
      if (tradeCommand) {
        const { executeXTradeCommand } = await import(
          "../_shared/x_trade_execute.ts"
        );
        const outcome = await executeXTradeCommand({
          admin,
          userId,
          tweetId,
          command: tradeCommand,
        });
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

      const resolved = await admin.rpc("resolve_linkr_launch_thread_v1", {
        p_input_work_item_id: claim.work_item.id,
        p_user_id: userId,
      });
      if (resolved.error) throw resolved.error;
      const existingDraft = resolved.data;
      const existingFields =
        (existingDraft?.filled_fields ?? {}) as LaunchFields;
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
      if (!existingDraft && !launchCommand) {
        await queueReply(
          admin,
          claim.work_item.id,
          "unsupported_command",
          1,
          'I couldn\'t match that to an active launch. Start with "launch a coin called ..." and include Solana or Robinhood.',
        );
        await markTweetCompleted(admin, tweetId);
        return {
          kind: "complete",
          state: "rejected",
          resultRef: "unsupported-command",
        };
      }

      const incoming = await extractLaunchFieldsWithAi(
        tweet.text,
        tweet.media_url,
      );
      const merged = mergeLaunchFields(existingFields, incoming);
      const fields: Record<string, unknown> = { ...merged };
      const existingProvenance =
        (existingDraft?.field_provenance ?? {}) as Record<string, string>;
      const provenance: Record<string, string> = { ...existingProvenance };
      for (
        const key of [
          "name",
          "symbol",
          "description",
          "dev_buy_amount",
        ] as const
      ) {
        if (incoming[key]) provenance[key] = "user_text";
      }
      if (incoming.image_url) provenance.image_url = "user_media";
      if (incoming.chain) provenance.chain = "user_text";
      else if (existingFields.chain && !incoming.chain_ambiguous) {
        provenance.chain = "thread_context";
      }
      if (incoming.chain_ambiguous) {
        fields.chain = null;
        provenance.chain = "user_text";
      }
      delete fields.chain_ambiguous;

      const generationContext = {
        ...(existingDraft?.generation_context ?? {}),
        explicit_launch_intent: launchCommand ||
          existingDraft?.generation_context?.explicit_launch_intent === true,
        last_input_tweet_id: tweetId,
        extraction_version: "launch-command-v2",
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

      if (missing.length > 0) {
        await queueReply(
          admin,
          claim.work_item.id,
          "launch_clarification",
          Number(draft.version),
          clarificationReply(missing),
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

async function markTweetCompleted(admin: any, tweetId: string) {
  const result = await admin.from("tweets_inbox").update({
    status: "completed",
    processed_at: new Date().toISOString(),
    error: null,
  }).eq("tweet_id", tweetId);
  if (result.error) throw result.error;
}
