// deno-lint-ignore-file no-explicit-any
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import type { XNftCommand } from "../_shared/x_nft_command.ts";

const VERSION = "worker-nft-solana-v4";

Deno.serve((req) =>
  runStageWorker(req, {
    stage: "nft_solana",
    functionName: "worker-nft-solana",
    consumerVersion: VERSION,
    visibilitySeconds: 600,
    process: async (claim, admin) => {
      const payload = claim.work_item.payload ?? {};
      const tweetId = String(payload.tweet_id ?? claim.work_item.source_event_id ?? "").trim();
      if (!tweetId) {
        return { kind: "dead_letter", reasonCode: "nft_tweet_id_missing" };
      }

      const command = normalizeCommand(payload.command);
      if (!command) {
        await queueReply(
          admin,
          claim.work_item.id,
          "nft_command_invalid",
          1,
          "I couldn't read the NFT mint request. Please try again with the collection/NFT name.",
        );
        await markTweetCompleted(admin, tweetId, "nft_command_invalid");
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `x-nft-invalid:${tweetId}`,
        };
      }

      const tweetResult = await admin.from("tweets_inbox").select("*")
        .eq("tweet_id", tweetId).maybeSingle();
      if (tweetResult.error) throw tweetResult.error;
      const tweet = tweetResult.data;
      if (!tweet) {
        return { kind: "dead_letter", reasonCode: "x_tweet_not_found" };
      }

      let userId = String(claim.work_item.user_id ?? "").trim();
      if (!userId) {
        const profile = await admin.from("profiles").select("user_id")
          .eq("twitter_id", tweet.author_twitter_id).maybeSingle();
        if (profile.error) throw profile.error;
        userId = String(profile.data?.user_id ?? "").trim();
      }
      if (!userId) {
        return {
          kind: "retry",
          errorCode: "x_user_provisioning_pending",
          delaySeconds: 60,
        };
      }

      let outcome;
      try {
        const { executeXNftCommand } = await import(
          "../_shared/x_nft_execute.ts"
        );
        outcome = await executeXNftCommand({
          admin,
          userId,
          tweetId,
          tweet,
          command,
        });
      } catch (error) {
        const message = safeErrorMessage(error);
        outcome = {
          ok: false,
          replyKind: "nft_execution_error",
          replyText: `Couldn't finish the NFT mint: ${message}`,
        };
      }

      await queueReply(
        admin,
        claim.work_item.id,
        outcome.replyKind,
        1,
        outcome.replyText,
      );
      await markTweetCompleted(
        admin,
        tweetId,
        outcome.ok ? null : outcome.replyKind,
      );

      return {
        kind: "complete",
        state: outcome.ok ? "succeeded" : "rejected",
        resultRef: `x-nft:${command.kind}:${tweetId}`,
      };
    },
  })
);

function normalizeCommand(value: unknown): XNftCommand | null {
  if (!value || typeof value !== "object") return null;
  const command = value as Record<string, unknown>;
  const kind = String(command.kind ?? "");
  if (kind === "create_collection") {
    const name = cleanText(command.name, 32);
    const symbol = cleanText(command.symbol, 10).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!name || !symbol) return null;
    return {
      kind,
      name,
      symbol,
      description: cleanOptional(command.description, 512),
      websiteUrl: cleanUrl(command.websiteUrl),
      twitterUrl: cleanUrl(command.twitterUrl),
      telegramUrl: cleanUrl(command.telegramUrl),
    };
  }
  if (kind === "mint_nft") {
    const collectionQuery = cleanText(command.collectionQuery, 80);
    if (!collectionQuery) return null;
    return {
      kind,
      collectionQuery,
      name: cleanOptional(command.name, 32),
    };
  }
  return null;
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

async function markTweetCompleted(
  admin: any,
  tweetId: string,
  errorCode: string | null,
) {
  const result = await admin.from("tweets_inbox").update({
    status: "completed",
    processed_at: new Date().toISOString(),
    error: errorCode,
  }).eq("tweet_id", tweetId);
  if (result.error) throw result.error;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function cleanOptional(value: unknown, max: number): string | null {
  const text = cleanText(value, max);
  return text || null;
}

function cleanUrl(value: unknown): string | null {
  const text = cleanText(value, 300);
  return /^https?:\/\//i.test(text) ? text : null;
}

function safeErrorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 160) || "nft_execution_failed";
}