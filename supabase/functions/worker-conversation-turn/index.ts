import { composeXAiReply, type XAiRoute } from "../_shared/x_ai_intake.ts";
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

      const kind = tweet.ai_route_kind === "coin_inquiry" ||
          tweet.ai_route_kind === "trade_advice"
        ? tweet.ai_route_kind
        : "conversation";
      const route: XAiRoute = {
        lane: "reply",
        reply_kind: kind,
        token_address: null,
        token_symbol: null,
        token_chain: null,
        reason: String(tweet.ai_route_reason ?? "conversation"),
      };
      const { data: contextRows } = await admin.from("tweets_inbox")
        .select("text,author_username,created_at")
        .eq("conversation_id", tweet.conversation_id)
        .order("created_at", { ascending: false }).limit(6);
      const conversation = (contextRows ?? []).reverse().map((row: any) =>
        `@${row.author_username ?? "user"}: ${
          String(row.text ?? "").slice(0, 300)
        }`
      ).join("\n");

      let reply;
      try {
        reply = await composeXAiReply({
          text: tweet.text,
          route,
          conversation,
          marketFacts: null,
        });
      } catch {
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
      await admin.from("tweets_inbox").update({
        status: "completed",
        processed_at: new Date().toISOString(),
        error: null,
      }).eq("tweet_id", tweetId);

      // Fast handoff to reply delivery (opt-in via LINKR_FAST_HANDOFF_ENABLED).
      // The reply is its own durable work item (enqueue_linkr_x_reply_v1 already
      // committed it into the reply stage), so the generic cross-stage handoff in
      // runStageWorker does not cover it — this conversation item completes as a
      // terminal "succeeded". Wake+dispatch the reply stage directly so the reply
      // posts without waiting for the ~60s controller. Best-effort and idempotent:
      // the wake self-gates and the controller remains the recovery path.
      if (isLinkrFastHandoffEnabled()) {
        const replyStage = linkrQueueForRoute(
          "reply.x",
          claim.work_item.priority,
        );
        if (replyStage) {
          const handoff = wakeAndDispatchStage(
            admin,
            replyStage,
            LINKR_STAGE_WORKER_FUNCTIONS[replyStage],
          );
          if (!scheduleBackgroundTask(handoff)) await handoff;
        }
      }
      return {
        kind: "complete",
        state: "succeeded",
        resultRef: `reply-work-item:${queued.data.reply_work_item_id}`,
      };
    },
  }),
);
