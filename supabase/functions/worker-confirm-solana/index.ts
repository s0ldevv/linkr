// deno-lint-ignore-file no-explicit-any
import { readSolanaSignature } from "../_shared/chain_confirmation.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  transactionFence,
  transitionTransaction,
} from "../_shared/transaction_outbox.ts";

const VERSION = "worker-confirm-solana-v1";
const STAGE = "confirm_solana" as const;
// Solana confirms in a few seconds. Returning immediately on the first
// "pending" read hands the item back to the queue and costs a full dispatch
// round trip, so poll briefly in-worker first and only requeue if the
// transaction is still unconfirmed after the window.
const CONFIRMATION_POLL_WINDOW_MS = 20_000;
const CONFIRMATION_POLL_INTERVAL_MS = 1_500;

Deno.serve((req) =>
  runStageWorker(req, {
    stage: STAGE,
    functionName: "worker-confirm-solana",
    consumerVersion: VERSION,
    visibilitySeconds: 120,
    process: async (claim, admin, context) => {
      const transactionResult = await admin.from("linkr_chain_transactions")
        .select("*").eq("work_item_id", claim.work_item.id)
        .eq("chain", "solana").eq("attempt_number", 1).maybeSingle();
      if (transactionResult.error) throw transactionResult.error;
      const transaction = transactionResult.data;
      if (!transaction) {
        return {
          kind: "dead_letter",
          reasonCode: "chain_transaction_not_found",
        };
      }
      const launchResult = await admin.from("coin_launches").select("*")
        .eq("id", transaction.launch_id).eq("work_item_id", claim.work_item.id)
        .maybeSingle();
      if (launchResult.error) throw launchResult.error;
      const launch = launchResult.data;
      if (!launch) {
        return { kind: "dead_letter", reasonCode: "coin_launch_not_found" };
      }
      const signature = String(
        transaction.signature ?? transaction.transaction_hash ?? "",
      );
      const mint = String(transaction.predicted_address ?? launch.mint ?? "");
      if (!signature || signature.length > 128 || !mint || mint.length > 64) {
        return {
          kind: "dead_letter",
          reasonCode: "transaction_identity_invalid",
        };
      }
      const fence = transactionFence(claim, context);

      try {
        if (transaction.state !== "confirmed") {
          if (transaction.state !== "broadcast") {
            return {
              kind: "complete",
              state: "queued",
              nextRoute: "reconciliation",
              resultRef: `chain_transaction:${transaction.id}`,
            };
          }
          const status = await awaitSolanaConfirmation(signature);
          if (status.state === "pending") {
            return {
              kind: "retry",
              errorCode: "solana_confirmation_pending",
              delaySeconds: 5,
            };
          }
          if (status.state === "failed") {
            await transitionTransaction(
              admin,
              transaction.id,
              signature,
              fence,
              {
                expectedState: "broadcast",
                newState: "failed",
                errorCode: "solana_launch_failed",
              },
            );
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
          await transitionTransaction(admin, transaction.id, signature, fence, {
            expectedState: "broadcast",
            newState: "confirmed",
          });
        }

        const explorer = `https://solscan.io/tx/${
          encodeURIComponent(signature)
        }`;
        // Post the raw contract address only — no links (X flags URL + CA combos).
        const reply = `Launched $${
          String(launch.symbol).toUpperCase()
        } on Solana\nCA: ${mint}`;
        const finalized = await admin.rpc("finalize_linkr_coin_launch_v2", {
          p_work_item_id: claim.work_item.id,
          p_launch_id: launch.id,
          p_transaction_id: transaction.id,
          p_chain: "solana",
          p_transaction_hash: signature,
          p_token_address: mint,
          p_explorer_url: explorer,
          p_reply_text: reply.slice(0, 280),
          p_details: {
            metadata_uri: launch.pump_metadata_uri ?? null,
            pump_url: `https://pump.fun/${mint}`,
            solscan_url: `https://solscan.io/token/${mint}`,
            confirmed_by: VERSION,
          },
        });
        if (finalized.error) {
          throw finalized.error;
        }
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `coin_launch:${launch.id}`,
        };
      } catch {
        if (transaction.state === "broadcast") {
          await transitionTransaction(admin, transaction.id, signature, fence, {
            expectedState: "broadcast",
            newState: "reconciling",
            errorCode: "solana_confirmation_ambiguous",
          }).catch(() => {});
        }
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "reconciliation",
          resultRef: `chain_transaction:${transaction.id}`,
        };
      }
    },
  })
);

async function awaitSolanaConfirmation(signature: string) {
  const deadline = Date.now() + CONFIRMATION_POLL_WINDOW_MS;
  let status = await readSolanaSignature(signature);
  while (status.state === "pending" && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS)
    );
    status = await readSolanaSignature(signature);
  }
  return status;
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
      "The Solana launch transaction failed. No replacement transaction was created.",
    p_kind: "launch_failed",
    p_version: 1,
    p_priority: 90,
  });
  if (reply.error) throw reply.error;
}
