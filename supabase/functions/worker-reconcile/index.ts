// deno-lint-ignore-file no-explicit-any
import {
  readRobinhoodReceipt,
  readRobinhoodTransactionCount,
  readSolanaBlockHeight,
  readSolanaSignature,
  rebroadcastRobinhoodRaw,
  rebroadcastSolanaRaw,
  verifyRobinhoodLaunchReceipt,
} from "../_shared/chain_confirmation.ts";
import type { StageOutcome } from "../_shared/queue_worker.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  loadSignedTransaction,
  transactionFence,
  transitionTransaction,
} from "../_shared/transaction_outbox.ts";

const VERSION = "worker-reconcile-v2";
const STAGE = "reconciliation" as const;

Deno.serve((req) =>
  runStageWorker(req, {
    stage: STAGE,
    functionName: "worker-reconcile",
    consumerVersion: VERSION,
    visibilitySeconds: 180,
    process: async (claim, admin, context) => {
      const transactionResult = await admin.from("linkr_chain_transactions")
        .select("*").eq("work_item_id", claim.work_item.id)
        .order("attempt_number", { ascending: false }).limit(1).maybeSingle();
      if (transactionResult.error) throw transactionResult.error;
      if (transactionResult.data) {
        return await reconcileChain(
          claim,
          admin,
          context,
          transactionResult.data,
        );
      }
      return await reconcileXReply(claim, admin);
    },
  })
);

async function reconcileChain(
  claim: any,
  admin: any,
  context: any,
  transaction: any,
): Promise<StageOutcome> {
  const launchResult = await admin.from("coin_launches").select("*")
    .eq("id", transaction.launch_id).eq("work_item_id", claim.work_item.id)
    .maybeSingle();
  if (launchResult.error) throw launchResult.error;
  const launch = launchResult.data;
  if (!launch) {
    return { kind: "dead_letter", reasonCode: "coin_launch_not_found" };
  }
  const identity = String(
    transaction.transaction_hash ?? transaction.signature ?? "",
  );
  const token = String(
    transaction.predicted_address ?? launch.token_address ?? launch.mint ?? "",
  );
  if (!identity || !token) {
    return { kind: "dead_letter", reasonCode: "transaction_identity_invalid" };
  }
  const fence = transactionFence(claim, context);

  if (transaction.state === "confirmed") {
    return await finalizeConfirmed(
      admin,
      claim.work_item.id,
      launch,
      transaction,
    );
  }
  if (transaction.state === "failed" || transaction.state === "replaced") {
    await markFailed(
      admin,
      claim.work_item.source_surface,
      claim.work_item.id,
      launch.id,
      transaction.last_error_code ?? "chain_transaction_failed",
    );
    return {
      kind: "complete",
      state: "rejected",
      resultRef: `chain_transaction:${transaction.id}`,
    };
  }

  try {
    if (transaction.chain === "robinhood") {
      const receipt = await readRobinhoodReceipt(identity);
      if (receipt.state === "confirmed") {
        const launchEvent = verifyRobinhoodLaunchReceipt(receipt.receipt!, {
          factory: launch.factory,
          token,
          creator: launch.launch_signer_address,
        });
        await transitionTransaction(admin, transaction.id, identity, fence, {
          expectedState: transaction.state,
          newState: "confirmed",
        });
        return await finalizeConfirmed(admin, claim.work_item.id, launch, {
          ...transaction,
          state: "confirmed",
        }, launchEvent);
      }
      if (receipt.state === "reverted") {
        await transitionTransaction(admin, transaction.id, identity, fence, {
          expectedState: transaction.state,
          newState: "failed",
          errorCode: "robinhood_launch_reverted",
        });
        await markFailed(
          admin,
          claim.work_item.source_surface,
          claim.work_item.id,
          launch.id,
          "robinhood_launch_reverted",
        );
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `chain_transaction:${transaction.id}`,
        };
      }

      const nonce = BigInt(String(transaction.nonce));
      const signer = String(launch.launch_signer_address ?? "");
      if (!/^0x[a-fA-F0-9]{40}$/.test(signer)) {
        return {
          kind: "dead_letter",
          reasonCode: "launch_signer_address_invalid",
        };
      }
      const latest = await readRobinhoodTransactionCount(signer, "latest");
      const pending = await readRobinhoodTransactionCount(signer, "pending");
      if (latest > nonce) {
        await transitionTransaction(admin, transaction.id, identity, fence, {
          expectedState: transaction.state,
          newState: "replaced",
          errorCode: "wallet_nonce_consumed_by_unknown_transaction",
        });
        await createCriticalIncident(admin, claim.work_item.id, {
          chain: "robinhood",
          transaction_id: transaction.id,
          nonce: nonce.toString(),
          latest_nonce: latest.toString(),
        });
        return {
          kind: "dead_letter",
          reasonCode: "wallet_nonce_consumed_ambiguous",
          fingerprint: `economic-ambiguity:${claim.work_item.id}`,
        };
      }
      if (pending <= nonce) {
        const bytes = await loadSignedTransaction(admin, transaction.id);
        const returnedHash = await rebroadcastRobinhoodRaw(bytes);
        if (returnedHash.toLowerCase() !== identity.toLowerCase()) {
          throw new Error("robinhood_rebroadcast_hash_mismatch");
        }
        if (transaction.state !== "broadcast") {
          await transitionTransaction(admin, transaction.id, identity, fence, {
            expectedState: transaction.state,
            newState: "broadcast",
          });
        }
      }
      return {
        kind: "retry",
        errorCode: "robinhood_reconciliation_pending",
        delaySeconds: 20,
      };
    }

    if (transaction.chain === "solana") {
      const status = await readSolanaSignature(identity);
      if (status.state === "confirmed") {
        await transitionTransaction(admin, transaction.id, identity, fence, {
          expectedState: transaction.state,
          newState: "confirmed",
        });
        return await finalizeConfirmed(admin, claim.work_item.id, launch, {
          ...transaction,
          state: "confirmed",
        });
      }
      if (status.state === "failed") {
        await transitionTransaction(admin, transaction.id, identity, fence, {
          expectedState: transaction.state,
          newState: "failed",
          errorCode: "solana_launch_failed",
        });
        await markFailed(
          admin,
          claim.work_item.source_surface,
          claim.work_item.id,
          launch.id,
          "solana_launch_failed",
        );
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `chain_transaction:${transaction.id}`,
        };
      }
      const blockHeight = await readSolanaBlockHeight();
      const lastValid = Number(transaction.last_valid_block_height ?? 0);
      if (!Number.isSafeInteger(lastValid) || lastValid < 1) {
        return {
          kind: "dead_letter",
          reasonCode: "solana_validity_window_missing",
        };
      }
      if (blockHeight > lastValid) {
        await transitionTransaction(admin, transaction.id, identity, fence, {
          expectedState: transaction.state,
          newState: "failed",
          errorCode: "solana_blockhash_expired_unconfirmed",
        });
        await markFailed(
          admin,
          claim.work_item.source_surface,
          claim.work_item.id,
          launch.id,
          "solana_blockhash_expired_unconfirmed",
        );
        return {
          kind: "complete",
          state: "rejected",
          resultRef: `chain_transaction:${transaction.id}`,
        };
      }
      const bytes = await loadSignedTransaction(admin, transaction.id);
      const returnedSignature = await rebroadcastSolanaRaw(bytes);
      if (returnedSignature !== identity) {
        throw new Error("solana_rebroadcast_signature_mismatch");
      }
      if (transaction.state !== "broadcast") {
        await transitionTransaction(admin, transaction.id, identity, fence, {
          expectedState: transaction.state,
          newState: "broadcast",
        });
      }
      return {
        kind: "retry",
        errorCode: "solana_reconciliation_pending",
        delaySeconds: 12,
      };
    }
    return { kind: "dead_letter", reasonCode: "unsupported_transaction_chain" };
  } catch (error) {
    const code = sanitizeError(error);
    if (/mismatch|integrity|invalid/.test(code)) {
      await createCriticalIncident(admin, claim.work_item.id, {
        chain: transaction.chain,
        transaction_id: transaction.id,
        error: code,
      });
      return {
        kind: "dead_letter",
        reasonCode: code.slice(0, 120),
        fingerprint: `economic-reconciliation:${claim.work_item.id}`,
      };
    }
    return { kind: "retry", errorCode: code.slice(0, 120), delaySeconds: 30 };
  }
}

async function finalizeConfirmed(
  admin: any,
  workItemId: string,
  launch: any,
  transaction: any,
  launchEvent?: {
    factory: string;
    creator: string;
    pool: string;
  },
): Promise<StageOutcome> {
  const identity = String(
    transaction.transaction_hash ?? transaction.signature,
  );
  const token = String(
    transaction.predicted_address ?? launch.token_address ?? launch.mint,
  );
  const isSolana = transaction.chain === "solana";
  const explorer = isSolana
    ? `https://solscan.io/tx/${encodeURIComponent(identity)}`
    : `https://robinhoodchain.blockscout.com/tx/${identity}`;
  const reply = isSolana
    ? `Launched $${
      String(launch.symbol).toUpperCase()
    } on Solana. Token: https://pump.fun/${token}`
    : `Launched $${
      String(launch.symbol).toUpperCase()
    } on Robinhood Chain. Transaction: ${explorer}`;
  const finalized = await admin.rpc("finalize_linkr_coin_launch_v2", {
    p_work_item_id: workItemId,
    p_launch_id: launch.id,
    p_transaction_id: transaction.id,
    p_chain: transaction.chain,
    p_transaction_hash: identity,
    p_token_address: token,
    p_explorer_url: explorer,
    p_reply_text: reply.slice(0, 280),
    p_details: {
      reconciled_by: VERSION,
      ...(isSolana
        ? {
          metadata_uri: launch.pump_metadata_uri ?? null,
          pump_url: `https://pump.fun/${token}`,
          solscan_url: `https://solscan.io/token/${token}`,
        }
        : {}),
      ...(!isSolana && launchEvent
        ? {
          factory: launchEvent.factory,
          creator: launchEvent.creator,
          pool: launchEvent.pool,
        }
        : {}),
    },
  });
  if (finalized.error) throw finalized.error;
  return {
    kind: "complete",
    state: "succeeded",
    resultRef: `coin_launch:${launch.id}`,
  };
}

async function reconcileXReply(claim: any, admin: any): Promise<StageOutcome> {
  const replyResult = await admin.from("twitter_replies").select("*")
    .eq("work_item_id", claim.work_item.id).maybeSingle();
  if (replyResult.error) throw replyResult.error;
  const reply = replyResult.data;
  if (!reply) {
    return { kind: "dead_letter", reasonCode: "reconciliation_target_missing" };
  }
  if (reply.status === "posted" && reply.reply_tweet_id) {
    return {
      kind: "complete",
      state: "succeeded",
      resultRef: `x-reply:${reply.reply_tweet_id}`,
    };
  }
  if (reply.status === "failed") {
    await updateXDelivery(admin, claim.work_item.id, {
      state: "failed",
      last_error_code: String(reply.error ?? "x_reply_failed").slice(0, 240),
    });
    return {
      kind: "complete",
      state: "rejected",
      resultRef: `x-reply-failed:${reply.id}`,
    };
  }
  const found = await findPostedReply(reply).catch(() => null);
  if (found) {
    const updated = await admin.from("twitter_replies").update({
      status: "posted",
      reply_tweet_id: found,
      posted_at: new Date().toISOString(),
      next_attempt_at: null,
      error: null,
      error_details: { reconciled_by: VERSION },
    }).eq("id", reply.id);
    if (updated.error) throw updated.error;
    await updateXDelivery(admin, claim.work_item.id, {
      state: "sent",
      provider_message_id: found,
      sent_at: new Date().toISOString(),
      last_error_code: null,
    });
    return {
      kind: "complete",
      state: "succeeded",
      resultRef: `x-reply:${found}`,
    };
  }
  const ageMs = Date.now() -
    Date.parse(reply.last_attempt_at ?? reply.created_at);
  await updateXDelivery(admin, claim.work_item.id, {
    state: "ambiguous",
    ambiguous_at: new Date().toISOString(),
    last_error_code: "x_reply_reconciliation_pending",
  });
  if (ageMs < 15 * 60_000 && claim.work_item.attempt_count < 20) {
    return {
      kind: "retry",
      errorCode: "x_reply_reconciliation_pending",
      delaySeconds: 30,
    };
  }
  await createCriticalIncident(admin, claim.work_item.id, {
    channel: "x",
    reply_id: reply.id,
    original_tweet_id: reply.tweet_id,
    reason: "post_outcome_could_not_be_proven",
  });
  return {
    kind: "dead_letter",
    reasonCode: "x_reply_outcome_ambiguous",
    fingerprint: `x-reply-ambiguity:${reply.id}`,
  };
}

async function updateXDelivery(
  admin: any,
  workItemId: string,
  values: Record<string, unknown>,
) {
  const result = await admin.from("linkr_notification_deliveries").update({
    ...values,
    updated_at: new Date().toISOString(),
  }).eq("work_item_id", workItemId).eq("channel", "x");
  if (result.error) throw result.error;
}

async function findPostedReply(reply: any): Promise<string | null> {
  const bearer = Deno.env.get("X_BEARER_TOKEN")?.trim();
  if (!bearer) throw new Error("X_BEARER_TOKEN_missing");
  const username = Deno.env.get("X_BOT_USERNAME")?.trim().replace(/^@/, "") ||
    "linkrcash";
  const conversationId = String(reply.conversation_id ?? reply.tweet_id ?? "");
  if (!/^\d{1,32}$/.test(conversationId)) {
    throw new Error("x_conversation_id_invalid");
  }
  const query = encodeURIComponent(
    `conversation_id:${conversationId} from:${username}`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(
      `https://api.x.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=referenced_tweets`,
      {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`x_reconcile_search_${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new Error("x_reconcile_response_too_large");
  }
  const text = await readBoundedText(response, 64 * 1024);
  const body = JSON.parse(text);
  const expected = normalizeText(reply.reply_text);
  const row = (Array.isArray(body?.data) ? body.data : []).find((item: any) => {
    const references = Array.isArray(item?.referenced_tweets)
      ? item.referenced_tweets
      : [];
    return normalizeText(item?.text) === expected &&
      references.some((reference: any) =>
        reference?.type === "replied_to" &&
        String(reference?.id) === String(reply.tweet_id)
      );
  });
  return row?.id ? String(row.id) : null;
}

async function markFailed(
  admin: any,
  sourceSurface: string,
  workItemId: string,
  launchId: string,
  error: string,
) {
  const launch = await admin.from("coin_launches").update({
    status: "failed",
    error,
    processed_at: new Date().toISOString(),
  }).eq("id", launchId);
  if (launch.error) throw launch.error;
  const pending = await admin.from("linkr_pending_actions").update({
    status: "failed",
    updated_at: new Date().toISOString(),
  }).eq("work_item_id", workItemId).in("status", ["confirmed", "executing"]);
  if (pending.error) throw pending.error;
  if (sourceSurface !== "x") return;
  const reply = await admin.rpc("enqueue_linkr_x_reply_v1", {
    p_parent_work_item_id: workItemId,
    p_reply_text:
      "The launch transaction could not be confirmed and no replacement transaction was created.",
    p_kind: "launch_failed",
    p_version: 1,
    p_priority: 90,
  });
  if (reply.error) throw reply.error;
}

async function createCriticalIncident(
  admin: any,
  workItemId: string,
  details: Record<string, unknown>,
) {
  const result = await admin.rpc("record_linkr_platform_incident_v1", {
    p_fingerprint: `economic-reconciliation:${workItemId}`,
    p_severity: "critical",
    p_title: "Economic transaction outcome requires operator review",
    p_details: details,
  });
  if (result.error) throw result.error;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("x_reconcile_response_too_large").catch(() => {});
        throw new Error("x_reconcile_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function sanitizeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/0x[a-fA-F0-9]{64}/g, "[redacted]")
    .slice(0, 240);
}
