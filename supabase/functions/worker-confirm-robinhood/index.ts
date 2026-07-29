// deno-lint-ignore-file no-explicit-any
import {
  readRobinhoodReceipt,
  verifyRobinhoodLaunchReceipt,
} from "../_shared/chain_confirmation.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  transactionFence,
  transitionTransaction,
} from "../_shared/transaction_outbox.ts";
import { refreshRobinhoodLaunchMetadataForToken } from "../_shared/robinhood_launch/finalize_metadata.ts";

const VERSION = "worker-confirm-robinhood-v1";
const STAGE = "confirm_robinhood" as const;

Deno.serve((req) =>
  runStageWorker(req, {
    stage: STAGE,
    functionName: "worker-confirm-robinhood",
    consumerVersion: VERSION,
    visibilitySeconds: 120,
    process: async (claim, admin, context) => {
      const transactionResult = await admin.from("linkr_chain_transactions")
        .select("*").eq("work_item_id", claim.work_item.id)
        .eq("chain", "robinhood").eq("attempt_number", 1).maybeSingle();
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

      const txHash = String(transaction.transaction_hash ?? "");
      const predictedToken = String(
        transaction.predicted_address ?? launch.token_address ?? "",
      );
      if (
        !/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
        (predictedToken && !/^0x[a-fA-F0-9]{40}$/.test(predictedToken))
      ) {
        return {
          kind: "dead_letter",
          reasonCode: "transaction_identity_invalid",
        };
      }
      const fence = transactionFence(claim, context);

      try {
        let launchEvent:
          | ReturnType<typeof verifyRobinhoodLaunchReceipt>
          | null = null;
        if (transaction.state !== "confirmed") {
          if (transaction.state !== "broadcast") {
            return {
              kind: "complete",
              state: "queued",
              nextRoute: "reconciliation",
              resultRef: `chain_transaction:${transaction.id}`,
            };
          }
          const receipt = await readRobinhoodReceipt(txHash);
          if (receipt.state === "pending") {
            return {
              kind: "retry",
              errorCode: "robinhood_confirmation_pending",
              delaySeconds: 15,
            };
          }
          if (receipt.state === "reverted") {
            await transitionTransaction(admin, transaction.id, txHash, fence, {
              expectedState: "broadcast",
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
          launchEvent = verifyRobinhoodLaunchReceipt(receipt.receipt!, {
            factory: launch.factory,
            creator: launch.launch_signer_address,
          });
          await transitionTransaction(admin, transaction.id, txHash, fence, {
            expectedState: "broadcast",
            newState: "confirmed",
          });
        }
        if (!launchEvent) {
          const receipt = await readRobinhoodReceipt(txHash);
          if (receipt.state !== "confirmed") {
            return {
              kind: "retry",
              errorCode: "robinhood_confirmed_receipt_unavailable",
              delaySeconds: 20,
            };
          }
          launchEvent = verifyRobinhoodLaunchReceipt(receipt.receipt!, {
            factory: launch.factory,
            creator: launch.launch_signer_address,
          });
        }

        const token = launchEvent?.token ?? predictedToken;
        if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
          return {
            kind: "dead_letter",
            reasonCode: "launched_token_missing",
          };
        }
        const finalizedLaunch = await refreshRobinhoodLaunchMetadataForToken(
          admin,
          launch,
          token,
        );
        // Post the raw contract address only — no links (X flags URL + CA combos).
        const reply = `Launched $${
          String(finalizedLaunch.symbol).toUpperCase()
        } on Robinhood Chain\nCA: ${token}`;
        const finalized = await admin.rpc("finalize_linkr_coin_launch_v2", {
          p_work_item_id: claim.work_item.id,
          p_launch_id: finalizedLaunch.id,
          p_transaction_id: transaction.id,
          p_chain: "robinhood",
          p_transaction_hash: txHash,
          p_token_address: token,
          p_explorer_url: `https://robinhoodchain.blockscout.com/tx/${txHash}`,
          p_reply_text: reply.slice(0, 280),
          p_details: {
            factory: launchEvent?.factory ?? finalizedLaunch.factory ?? null,
            creator: launchEvent?.creator ??
              finalizedLaunch.launch_signer_address ?? null,
            pool: launchEvent?.pool ?? finalizedLaunch.pool ?? null,
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
      } catch (error) {
        if (transaction.state === "broadcast") {
          await transitionTransaction(admin, transaction.id, txHash, fence, {
            expectedState: "broadcast",
            newState: "reconciling",
            errorCode: "robinhood_confirmation_ambiguous",
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
      "The Robinhood Chain launch transaction reverted. No replacement transaction was created.",
    p_kind: "launch_failed",
    p_version: 1,
    p_priority: 90,
  });
  if (reply.error) throw reply.error;
}
