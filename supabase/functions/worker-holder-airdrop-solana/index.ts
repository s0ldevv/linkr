// deno-lint-ignore-file no-explicit-any
import {
  Keypair,
  PublicKey,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import type { StageOutcome } from "../_shared/queue_worker.ts";
import {
  loadSolanaWalletById,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import {
  buildHolderAirdropBatchTransaction,
  classifyHolderAirdropSignatureStatus,
  dryRunHolderAirdropBatch,
  signHolderAirdropBatchTransaction,
  toBase64,
  validateStoredHolderAirdropBatchTransaction,
} from "../_shared/holder_airdrop_executor.ts";
import {
  persistedBatchAction,
  shouldProcessPersistedBatchBeforeRevalidation,
} from "../_shared/holder_airdrop_worker_state.ts";

const VERSION = "worker-holder-airdrop-solana-v1";
const RECONCILE_RETRY_SECONDS = 10;

Deno.serve((req) =>
  runStageWorker(req, {
    stage: "holder_airdrop_solana",
    functionName: "worker-holder-airdrop-solana",
    consumerVersion: VERSION,
    visibilitySeconds: 600,
    process: async (claim, admin) => {
      const airdropId = String(claim.work_item.payload?.airdrop_id ?? "");
      const airdrop = await loadAirdrop(admin, airdropId, claim.work_item.id);
      if (!airdrop) {
        return { kind: "dead_letter", reasonCode: "holder_airdrop_not_found" };
      }
      const persistedBatch = await loadPersistedBatchToProcess(
        admin,
        airdrop.id,
      );
      if (
        shouldProcessPersistedBatchBeforeRevalidation({
          airdropStatus: String(airdrop.status),
          batch: persistedBatch,
        })
      ) {
        return await processPersistedBatch({
          admin,
          connection: solanaConnection(),
          airdrop,
          batch: persistedBatch,
          walletAddress: String(airdrop.wallet_address),
        });
      }
      if (["completed", "failed"].includes(String(airdrop.status))) {
        await notifyTerminal(admin, airdrop.id, claim.work_item.id);
        return {
          kind: "complete",
          state: airdrop.status === "completed" ? "succeeded" : "rejected",
          resultRef: `holder-airdrop:${airdrop.id}`,
        };
      }
      if (
        !["queued", "validating", "executing", "reconciling"].includes(
          String(airdrop.status),
        )
      ) {
        return {
          kind: "dead_letter",
          reasonCode: "holder_airdrop_state_invalid",
        };
      }

      const connection = solanaConnection();
      let walletAddress: string;
      let sourceRaw: bigint;
      try {
        walletAddress = await revalidateLaunchAndWallet(admin, airdrop);
        sourceRaw = await readSourceTokenBalance(
          connection,
          airdrop,
          walletAddress,
        );
      } catch (error) {
        const code = safeErrorCode(error);
        await failAirdropBeforeBroadcast(admin, airdrop, code);
        await notifyTerminal(admin, airdrop.id, claim.work_item.id);
        return { kind: "complete", state: "rejected", resultRef: code };
      }

      const claimToken = crypto.randomUUID();
      const claimed = await admin.rpc("claim_linkr_holder_airdrop_batch_v1", {
        p_airdrop_id: airdrop.id,
        p_work_item_id: claim.work_item.id,
        p_claim_token: claimToken,
      });
      if (claimed.error) throw claimed.error;
      if (!claimed.data?.batch_id) {
        return await finishIfTerminalOrRetry(
          admin,
          airdrop,
          claim.work_item.id,
        );
      }

      const recipients = await loadBatchRecipients(
        admin,
        claimed.data.batch_id,
      );
      const requiredRaw = requiredBatchRaw(recipients);
      const built = buildHolderAirdropBatchTransaction({
        mint: airdrop.mint,
        sourceTokenAccount: airdrop.source_token_account,
        authority: walletAddress,
        decimals: Number(airdrop.token_decimals),
        recipients,
      });

      let dryRun;
      try {
        dryRun = await dryRunHolderAirdropBatch({
          connection,
          transaction: built.transaction,
          authority: walletAddress,
          destinationAccounts: built.destinationAccounts,
          requiredTokenRaw: requiredRaw,
          currentSourceTokenRaw: sourceRaw,
          simulate: async (transaction) => {
            const result = await (connection as any).simulateTransaction(
              transaction,
              { sigVerify: false, replaceRecentBlockhash: false },
            );
            return result.value;
          },
        });
      } catch (error) {
        const code = safeErrorCode(error);
        await failUnsignedBatch(
          admin,
          airdrop,
          claimed.data.batch_id,
          claimToken,
          code,
        );
        await notifyTerminal(admin, airdrop.id, claim.work_item.id);
        return { kind: "complete", state: "rejected", resultRef: code };
      }

      const wallet = await loadSolanaWalletById(
        admin,
        airdrop.wallet_id,
        airdrop.user_id,
      );
      if (!wallet || wallet.address !== walletAddress) {
        return {
          kind: "dead_letter",
          reasonCode: "holder_airdrop_wallet_secret_revalidation_failed",
        };
      }
      let signedBytes: Uint8Array | null = null;
      try {
        const signed = await signHolderAirdropBatchTransaction({
          transaction: built.transaction,
          authority: Keypair.fromSecretKey(wallet.secret_key),
          blockhash: dryRun.blockhash,
          lastValidBlockHeight: dryRun.lastValidBlockHeight,
        });
        signedBytes = signed.signedBytes;
        const recorded = await admin.rpc(
          "record_linkr_holder_airdrop_batch_signed_v1",
          {
            p_batch_id: claimed.data.batch_id,
            p_airdrop_id: airdrop.id,
            p_work_item_id: claim.work_item.id,
            p_claim_token: claimToken,
            p_signed_transaction_base64: toBase64(signed.signedBytes),
            p_signed_transaction_hash: signed.signedTransactionHash,
            p_signature: signed.signature,
            p_blockhash: signed.blockhash,
            p_last_valid_block_height: signed.lastValidBlockHeight,
            p_simulation_result: {
              fee_lamports: dryRun.feeLamports.toString(),
              rent_lamports: dryRun.rentLamports.toString(),
              required_sol_lamports: dryRun.requiredSolLamports.toString(),
            },
          },
        );
        if (recorded.error) throw recorded.error;
      } finally {
        signedBytes?.fill(0);
        wallet.secret_key.fill(0);
      }

      const batch = await loadBatch(admin, claimed.data.batch_id);
      if (!batch) {
        return {
          kind: "dead_letter",
          reasonCode: "holder_airdrop_batch_missing_after_sign",
        };
      }
      return await processPersistedBatch({
        admin,
        connection,
        airdrop,
        batch,
        walletAddress,
      });
    },
  })
);

async function processPersistedBatch(args: {
  admin: any;
  connection: any;
  airdrop: any;
  batch: any;
  walletAddress: string;
}): Promise<StageOutcome> {
  const recipients = await loadBatchRecipients(args.admin, args.batch.id);
  const signedBytes = await validateStoredHolderAirdropBatchTransaction({
    signedTransaction: String(args.batch.signed_transaction ?? ""),
    signedTransactionHash: String(args.batch.signed_transaction_hash ?? ""),
    signature: String(args.batch.signature ?? ""),
    blockhash: String(args.batch.blockhash ?? ""),
    mint: args.airdrop.mint,
    sourceTokenAccount: args.airdrop.source_token_account,
    authority: args.walletAddress,
    decimals: Number(args.airdrop.token_decimals),
    recipients,
  });
  const signature = String(args.batch.signature);
  try {
    const action = persistedBatchAction(args.batch);
    if (action === "broadcast_once") {
      const currentBlockHeight = await args.connection.getBlockHeight(
        "confirmed",
      );
      if (currentBlockHeight > Number(args.batch.last_valid_block_height)) {
        return await settleBatch(
          args,
          "failed",
          "holder_airdrop_signed_transaction_expired",
          null,
        );
      }
      const broadcasting = await args.admin.rpc(
        "mark_linkr_holder_airdrop_batch_broadcasting_v1",
        {
          p_batch_id: args.batch.id,
          p_airdrop_id: args.airdrop.id,
          p_work_item_id: args.airdrop.work_item_id,
          p_signature: signature,
        },
      );
      if (broadcasting.error) throw broadcasting.error;
      if (broadcasting.data?.duplicate === true) {
        return {
          kind: "retry",
          errorCode: "holder_airdrop_broadcast_already_in_progress",
          delaySeconds: RECONCILE_RETRY_SECONDS,
        };
      }
      try {
        const returnedSignature = await args.connection.sendRawTransaction(
          signedBytes,
          { skipPreflight: false, maxRetries: 3 },
        );
        if (returnedSignature !== signature) {
          return await settleBatch(
            args,
            "failed",
            "holder_airdrop_signature_mismatch",
            null,
          );
        }
        const broadcast = await args.admin.rpc(
          "record_linkr_holder_airdrop_batch_broadcast_v1",
          {
            p_batch_id: args.batch.id,
            p_airdrop_id: args.airdrop.id,
            p_work_item_id: args.airdrop.work_item_id,
            p_signature: signature,
          },
        );
        if (broadcast.error) throw broadcast.error;
      } catch {
        return {
          kind: "retry",
          errorCode: "holder_airdrop_broadcast_outcome_ambiguous",
          delaySeconds: RECONCILE_RETRY_SECONDS,
        };
      }
    }

    const status = await readSignatureState(args.connection, signature);
    if (status.kind === "confirmed") {
      return await settleBatch(args, "confirmed", null, status);
    }
    if (status.kind === "failed") {
      return await settleBatch(
        args,
        "failed",
        "holder_airdrop_transaction_failed",
        status,
      );
    }
    const currentBlockHeight = await args.connection.getBlockHeight(
      "confirmed",
    );
    if (
      status.kind === "unknown" &&
      currentBlockHeight > Number(args.batch.last_valid_block_height)
    ) {
      return await settleBatch(
        args,
        "failed",
        "holder_airdrop_transaction_expired_unconfirmed",
        status,
      );
    }
    const pending = await args.admin.rpc(
      "settle_linkr_holder_airdrop_batch_v1",
      {
        p_batch_id: args.batch.id,
        p_airdrop_id: args.airdrop.id,
        p_work_item_id: args.airdrop.work_item_id,
        p_signature: signature,
        p_outcome: "pending",
        p_error_code: "holder_airdrop_confirmation_pending",
        p_slot: status.slot,
        p_confirmation: { state: status.kind },
      },
    );
    if (pending.error) throw pending.error;
    return {
      kind: "retry",
      errorCode: "holder_airdrop_confirmation_pending",
      delaySeconds: RECONCILE_RETRY_SECONDS,
    };
  } finally {
    signedBytes.fill(0);
  }
}

async function settleBatch(
  args: { admin: any; airdrop: any; batch: any },
  outcome: "confirmed" | "failed",
  errorCode: string | null,
  status: { kind: string; slot: number | null } | null,
): Promise<StageOutcome> {
  const settled = await args.admin.rpc("settle_linkr_holder_airdrop_batch_v1", {
    p_batch_id: args.batch.id,
    p_airdrop_id: args.airdrop.id,
    p_work_item_id: args.airdrop.work_item_id,
    p_signature: args.batch.signature,
    p_outcome: outcome,
    p_error_code: errorCode,
    p_slot: status?.slot ?? null,
    p_confirmation: status ? { state: status.kind, slot: status.slot } : {},
  });
  if (settled.error) throw settled.error;
  if (settled.data?.terminal === true) {
    await notifyTerminal(
      args.admin,
      args.airdrop.id,
      args.airdrop.work_item_id,
    );
    return {
      kind: "complete",
      state: settled.data.airdrop_status === "completed"
        ? "succeeded"
        : "rejected",
      resultRef: `holder-airdrop:${args.airdrop.id}`,
    };
  }
  return {
    kind: "retry",
    errorCode: "holder_airdrop_next_batch",
    delaySeconds: 1,
  };
}

async function finishIfTerminalOrRetry(
  admin: any,
  airdrop: any,
  workItemId: string,
): Promise<StageOutcome> {
  const current = await loadAirdrop(admin, airdrop.id, workItemId);
  if (!current) {
    return { kind: "dead_letter", reasonCode: "holder_airdrop_not_found" };
  }
  if (["completed", "failed"].includes(String(current.status))) {
    await notifyTerminal(admin, current.id, workItemId);
    return {
      kind: "complete",
      state: current.status === "completed" ? "succeeded" : "rejected",
      resultRef: `holder-airdrop:${current.id}`,
    };
  }
  return {
    kind: "retry",
    errorCode: "holder_airdrop_reconciliation_pending",
    delaySeconds: RECONCILE_RETRY_SECONDS,
  };
}

async function loadAirdrop(admin: any, airdropId: string, workItemId: string) {
  const result = await admin.from("linkr_holder_airdrops").select("*")
    .eq("id", airdropId).eq("work_item_id", workItemId).maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function loadBatch(admin: any, batchId: string) {
  const result = await admin.from("linkr_holder_airdrop_batches").select("*")
    .eq("id", batchId).maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function loadPersistedBatchToProcess(admin: any, airdropId: string) {
  const result = await admin.from("linkr_holder_airdrop_batches").select("*")
    .eq("airdrop_id", airdropId)
    .in("status", ["signed", "broadcasting", "broadcast", "reconciling"])
    .order("batch_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function loadBatchRecipients(admin: any, batchId: string) {
  const result = await admin.from("linkr_holder_airdrop_recipients")
    .select("ordinal,owner_address,allocation_raw")
    .eq("batch_id", batchId)
    .order("ordinal", { ascending: true });
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function revalidateLaunchAndWallet(
  admin: any,
  airdrop: any,
): Promise<string> {
  const launchResult = await admin.from("coin_launches").select(
    "id,user_id,mint,token_address,status,chain,solana_launch_wallet_id,launch_signer_wallet_id",
  ).eq("id", airdrop.launch_id).eq("user_id", airdrop.user_id)
    .eq("status", "confirmed").eq("chain", "solana").eq("mint", airdrop.mint)
    .maybeSingle();
  if (launchResult.error) throw launchResult.error;
  const launch = launchResult.data;
  if (
    !launch || (launch.token_address && launch.token_address !== launch.mint)
  ) {
    throw new Error("holder_airdrop_launch_revalidation_failed");
  }
  const walletResult = await admin.from("wallets").select(
    "id,user_id,address,public_key,wallet_type",
  ).eq("id", airdrop.wallet_id).eq("user_id", airdrop.user_id)
    .eq("wallet_type", "solana").maybeSingle();
  if (walletResult.error) throw walletResult.error;
  const walletAddress = String(
    walletResult.data?.address ?? walletResult.data?.public_key ?? "",
  );
  if (!walletAddress || walletAddress !== airdrop.wallet_address) {
    throw new Error("holder_airdrop_wallet_revalidation_failed");
  }
  return walletAddress;
}

async function readSourceTokenBalance(
  connection: any,
  airdrop: any,
  walletAddress: string,
): Promise<bigint> {
  const sourceInfo = await connection.getParsedAccountInfo(
    new PublicKey(airdrop.source_token_account),
    "confirmed",
  );
  const sourceData = (sourceInfo.value?.data as any)?.parsed?.info;
  if (
    String(sourceData?.mint ?? "") !== airdrop.mint ||
    String(sourceData?.owner ?? "") !== walletAddress
  ) {
    throw new Error("holder_airdrop_source_account_mismatch");
  }
  return BigInt(String(sourceData?.tokenAmount?.amount ?? "0"));
}

async function readSignatureState(connection: any, signature: string) {
  const result = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  return classifyHolderAirdropSignatureStatus(result.value?.[0]);
}

async function notifyTerminal(
  admin: any,
  airdropId: string,
  workItemId: string,
) {
  const notified = await admin.rpc("notify_linkr_holder_airdrop_terminal_v1", {
    p_airdrop_id: airdropId,
    p_work_item_id: workItemId,
  });
  if (notified.error) throw notified.error;
}

async function failUnsignedBatch(
  admin: any,
  airdrop: any,
  batchId: string,
  claimToken: string,
  code: string,
) {
  const now = new Date().toISOString();
  const batch = await admin.from("linkr_holder_airdrop_batches").update({
    status: "failed",
    last_error_code: code,
    updated_at: now,
  }).eq("id", batchId).eq("claim_token", claimToken).eq("status", "claimed");
  if (batch.error) throw batch.error;
  const airdropUpdate = await admin.from("linkr_holder_airdrops").update({
    status: "failed",
    failure_code: code,
    completed_at: now,
    updated_at: now,
  }).eq("id", airdrop.id);
  if (airdropUpdate.error) throw airdropUpdate.error;
  const pending = await admin.from("linkr_pending_actions").update({
    status: "failed",
    updated_at: now,
  }).eq("id", airdrop.pending_action_id)
    .in("status", ["pending", "confirmed", "executing"]);
  if (pending.error) throw pending.error;
}

async function failAirdropBeforeBroadcast(
  admin: any,
  airdrop: any,
  code: string,
) {
  const now = new Date().toISOString();
  const batches = await admin.from("linkr_holder_airdrop_batches").update({
    status: "failed",
    last_error_code: code,
    updated_at: now,
  }).eq("airdrop_id", airdrop.id)
    .in("status", ["planned", "claimed", "signed"]);
  if (batches.error) throw batches.error;
  const airdropUpdate = await admin.from("linkr_holder_airdrops").update({
    status: "failed",
    failure_code: code,
    completed_at: now,
    updated_at: now,
  }).eq("id", airdrop.id);
  if (airdropUpdate.error) throw airdropUpdate.error;
  const pending = await admin.from("linkr_pending_actions").update({
    status: "failed",
    updated_at: now,
  }).eq("id", airdrop.pending_action_id)
    .in("status", ["pending", "confirmed", "executing"]);
  if (pending.error) throw pending.error;
}

function requiredBatchRaw(
  recipients: Array<{ allocation_raw: string }>,
): bigint {
  return recipients.reduce(
    (sum, row) => sum + BigInt(String(row.allocation_raw)),
    0n,
  );
}

function safeErrorCode(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "holder_airdrop_failed";
}
