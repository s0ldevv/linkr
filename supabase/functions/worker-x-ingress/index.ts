import { classifyXTurnWithAi } from "../_shared/x_ai_intake.ts";
import {
  isLaunchCancellation,
  isLaunchCommand,
  isLaunchConfirmation,
  isLaunchRetry,
} from "../_shared/x_launch_command.ts";
import { parseXTradeCommand } from "../_shared/x_trade_command.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";

const VERSION = "worker-x-ingress-v2";

Deno.serve((req) =>
  runStageWorker(req, {
    stage: "x_ingress",
    functionName: "worker-x-ingress",
    consumerVersion: VERSION,
    visibilitySeconds: 120,
    process: async (claim, admin) => {
      const tweetId = String(
        claim.work_item.source_event_id ?? claim.work_item.payload?.tweet_id ??
          "",
      );
      const { data: tweet, error } = await admin.from("tweets_inbox").select(
        "*",
      )
        .eq("tweet_id", tweetId).maybeSingle();
      if (error) throw error;
      if (!tweet) {
        return { kind: "dead_letter", reasonCode: "x_tweet_not_found" };
      }

      const text = String(tweet.text ?? "");
      let userId = claim.work_item.user_id;
      if (!userId) {
        const profile = await admin.from("profiles").select("user_id")
          .eq("twitter_id", tweet.author_twitter_id).maybeSingle();
        if (profile.error) throw profile.error;
        userId = profile.data?.user_id ?? null;
      }
      let activeLaunchThread = false;
      if (userId) {
        const resolved = await admin.rpc("resolve_linkr_launch_thread_v1", {
          p_input_work_item_id: claim.work_item.id,
          p_user_id: userId,
        });
        if (resolved.error) throw resolved.error;
        activeLaunchThread = Boolean(resolved.data?.id);
      }
      let lane: "reply" | "legacy";
      let replyKind: string | null = null;
      let reason: string;
      if (
        isLaunchCommand(text) || isLaunchConfirmation(text) ||
        isLaunchCancellation(text) || isLaunchRetry(text) || activeLaunchThread
      ) {
        lane = "legacy";
        reason = activeLaunchThread
          ? "active_launch_thread"
          : "deterministic_launch_command";
      } else if (parseXTradeCommand(text)) {
        lane = "legacy";
        reason = "deterministic_trade_command";
      } else {
        try {
          const route = await classifyXTurnWithAi(text);
          lane = route.lane;
          replyKind = route.reply_kind;
          reason = route.reason;
        } catch {
          return {
            kind: "retry",
            errorCode: "x_classification_failed",
            delaySeconds: 60,
          };
        }
      }

      const { error: updateError } = await admin.from("tweets_inbox").update({
        status: "processing",
        ai_processing_lane: lane,
        ai_route_kind: replyKind,
        ai_route_reason: reason,
        ai_routed_at: new Date().toISOString(),
        error: null,
      }).eq("tweet_id", tweetId);
      if (updateError) throw updateError;
      return {
        kind: "complete",
        state: "queued",
        nextRoute: lane === "reply" ? "conversation.turn" : "command.prepare",
        resultRef: `x-route:${lane}:${replyKind ?? "command"}`,
      };
    },
  }),
);
