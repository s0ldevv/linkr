// deno-lint-ignore-file no-explicit-any
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  persistSignedTransaction,
  transactionFence,
  transitionTransaction,
} from "../_shared/transaction_outbox.ts";
import * as pump from "../_shared/solana_launch/pump_adapter.ts";
import { resolvePumpFunLaunchMetadata } from "../_shared/launch_metadata.ts";
import {
  readLaunchFundingPolicy,
  readMetadataTestingPolicy,
} from "../_shared/admin_settings.ts";
import {
  cancelUnbroadcastSolanaLaunchFundingIfPresent,
  firstLaunchFundingDeficit,
  fundFirstSolanaLaunchIfNeeded,
  fundSolanaLaunchIfNeeded,
  SOL_FIRST_LAUNCH_FUNDING_LAMPORTS,
  type SolanaFundingKind,
} from "../_shared/solana_launch/funding.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { notifyLaunchUser } from "../_shared/launch_notifications.ts";
import * as walletModule from "../_shared/solana_launch/runtime.ts";

const VERSION = "worker-launch-solana-v1";
const STAGE = "launch_solana" as const;

Deno.serve((req) =>
  runStageWorker(req, {
    stage: STAGE,
    functionName: "worker-launch-solana",
    consumerVersion: VERSION,
    visibilitySeconds: 600,
    process: async (claim, admin, context) => {
      const allowed = await admin.rpc("linkr_chain_rollout_allowed_v1", {
        p_work_item_id: claim.work_item.id,
        p_stage: STAGE,
      });
      if (allowed.error) throw allowed.error;
      if (allowed.data !== true) {
        await queueOnce(
          admin,
          claim.work_item.source_surface,
          claim.work_item.id,
          "Your Solana launch is safely queued while the new launch worker is being rolled out.",
          "launch_rollout_wait",
        );
        return {
          kind: "retry",
          errorCode: "solana_launch_rollout_pending",
          delaySeconds: 900,
        };
      }
      if (!readBoolean("PUMP_FUN_LAUNCH_ENABLED", false)) {
        return {
          kind: "retry",
          errorCode: "solana_launch_disabled",
          delaySeconds: 900,
        };
      }

      const launchResult = await admin.from("coin_launches").select("*")
        .eq("work_item_id", claim.work_item.id).eq("chain", "solana")
        .limit(1).maybeSingle();
      if (launchResult.error) throw launchResult.error;
      const launch = launchResult.data;
      if (!launch) {
        return { kind: "dead_letter", reasonCode: "coin_launch_not_found" };
      }
      const userId = String(claim.work_item.user_id ?? "").trim();
      if (!userId) {
        return { kind: "dead_letter", reasonCode: "launch_user_missing" };
      }
      if (launch.status === "confirmed") {
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: `coin_launch:${launch.id}`,
        };
      }
      const existing = await admin.from("linkr_chain_transactions").select("*")
        .eq("work_item_id", claim.work_item.id).eq("attempt_number", 1)
        .maybeSingle();
      if (existing.error) {
        throw existing.error;
      }
      if (existing.data) {
        return {
          kind: "complete",
          state: "queued",
          nextRoute: existing.data.state === "broadcast"
            ? "confirm.solana"
            : "reconciliation",
          resultRef: `chain_transaction:${existing.data.id}`,
        };
      }
      const pendingResult = await admin.from("linkr_pending_actions").select(
        "id,status,action_payload,draft_id,confirmed_at",
      ).eq("work_item_id", claim.work_item.id).limit(1).maybeSingle();
      if (pendingResult.error) throw pendingResult.error;
      const pending = pendingResult.data;
      if (!pending || !["confirmed", "executing"].includes(pending.status)) {
        return {
          kind: "dead_letter",
          reasonCode: "launch_confirmation_missing",
        };
      }
      if (!pending.confirmed_at) {
        return {
          kind: "dead_letter",
          reasonCode: "launch_confirmation_time_missing",
        };
      }

      const fence = transactionFence(claim, context);
      let broadcasting = false;
      let transactionId = "";
      let preparedSignature = "";
      let walletSecret: Uint8Array | null = null;
      try {
        const walletId = String(
          launch.solana_launch_wallet_id ?? launch.launch_signer_wallet_id ??
            "",
        );
        const walletIdentity = await walletModule.loadSolanaWalletIdentityById(
          admin,
          walletId,
          userId,
        );
        if (!walletIdentity) {
          throw new Error("solana_launch_wallet_not_found");
        }
        const initialBuySol = boundedNumber(
          launch.dev_buy_sol ?? launch.requested_initial_buy_sol ?? 0,
          0,
          5,
        );
        const requiredSol = pump.estimatePumpFunLaunchRequiredSol(
          initialBuySol,
          {
            feeSharingEnabled: Boolean(
              launch.creator_rewards_config?.should_update_on_chain,
            ),
          },
        );
        const lamports = await walletModule.getSolBalanceLamports(
          walletIdentity.address,
        );
        const requiredLamports = Math.ceil(requiredSol * 1_000_000_000);
        if (lamports < requiredLamports) {
          const deficit = firstLaunchFundingDeficit(lamports, requiredLamports);
          const fundingPolicy = await readLaunchFundingPolicy(admin);
          if (
            fundingPolicy.mode !== "funding_disabled" &&
            initialBuySol === 0 &&
            deficit <= SOL_FIRST_LAUNCH_FUNDING_LAMPORTS
          ) {
            const fundingKind: SolanaFundingKind =
              fundingPolicy.mode === "fund_every_eligible_launch"
                ? "per_launch_minimum"
                : "first_launch_minimum";
            try {
              const subsidy = fundingKind === "first_launch_minimum"
                ? await fundFirstSolanaLaunchIfNeeded(admin, {
                  launchId: launch.id,
                  userId,
                  walletId,
                  destinationAddress: walletIdentity.address,
                  amountLamports: deficit,
                })
                : await fundSolanaLaunchIfNeeded(admin, {
                  launchId: launch.id,
                  userId,
                  walletId,
                  destinationAddress: walletIdentity.address,
                  amountLamports: deficit,
                  fundingKind,
                });
              if (subsidy.funded) {
                // Funding confirmation and launch signing are intentionally split
                // across invocations. A retry re-reads the user's confirmed balance
                // before any launch transaction is prepared.
                return {
                  kind: "retry",
                  errorCode: fundingKind === "first_launch_minimum"
                    ? "solana_first_launch_funded"
                    : "solana_per_launch_funded",
                  delaySeconds: 3,
                };
              }
              if (subsidy.status === "disabled") {
                return {
                  kind: "retry",
                  errorCode: subsidy.reason ??
                    "solana_first_launch_funding_disabled",
                  delaySeconds: 300,
                };
              }
            } catch (error) {
              // Platform funding wallet exhaustion pauses this launch with the
              // normal self-funding prompt instead of retrying silently, and
              // pages ops through the health feed. Other errors keep the
              // existing retry semantics.
              if (
                !/sol_funding_wallet_insufficient_balance/.test(
                  sanitizeError(error),
                )
              ) throw error;
              await recordHealthEvent(
                admin,
                "solana_first_launch_funding",
                "down",
                Date.now(),
                {
                  reason: "sol_funding_wallet_insufficient_balance",
                  launch_id: launch.id,
                  deficit_lamports: deficit.toString(),
                },
              );
            }
          }
          const paused = await admin.rpc("pause_linkr_launch_for_funds_v1", {
            p_work_item_id: claim.work_item.id,
            p_launch_id: launch.id,
            p_reason_code: "insufficient_solana_launch_balance",
          });
          if (paused.error) throw paused.error;
          const fundsText = claim.work_item.source_surface === "x"
            ? `Your wallet needs at least ${
              requiredSol.toFixed(4)
            } SOL for the launch fee and gas. Fund it, then reply \"retry launch\" in this thread.`
            : `Your launch is waiting for funds: the wallet needs at least ${
              requiredSol.toFixed(4)
            } SOL for the launch fee and gas. Top up the wallet, then submit the launch again.`;
          await notifyLaunchUser(admin, {
            workItemId: claim.work_item.id,
            sourceSurface: String(claim.work_item.source_surface ?? "unknown"),
            userId,
            launchId: launch.id,
            chain: "solana",
            status: "waiting_funds",
            kind: "launch_insufficient_funds",
            text: fundsText,
            payload: {
              required_sol: requiredSol,
              wallet_address: walletIdentity.address,
            },
          });
          return {
            kind: "complete",
            state: "waiting_funds",
            resultRef: `coin_launch:${launch.id}`,
          };
        }
        await cancelUnbroadcastSolanaLaunchFundingIfPresent(
          admin,
          launch.id,
          userId,
          "first_launch_minimum",
        );
        await cancelUnbroadcastSolanaLaunchFundingIfPresent(
          admin,
          launch.id,
          userId,
          "per_launch_minimum",
        );
        const wallet = await walletModule.loadSolanaWalletById(
          admin,
          walletId,
          userId,
        );
        if (!wallet) throw new Error("solana_launch_wallet_not_found");
        walletSecret = wallet.secret_key;
        const metadataPolicy = await readMetadataTestingPolicy(admin);
        const metadataOptions = {
          testingMode: metadataPolicy.enabled,
          testingWebsiteUrl: metadataPolicy.test_website_url,
          testingTwitterUrl: metadataPolicy.test_twitter_url,
          testingTelegramUrl: metadataPolicy.test_telegram_url,
          mintAddress: launch.mint_address ?? null,
        };
        console.log("Preparing pump.fun launch:", {
          launch_id: launch.id,
          name: launch.name,
          symbol: launch.symbol,
          source_surface: launch.source_surface,
          mayhem_mode: Boolean(launch.mayhem_mode_requested ?? false),
          metadata_urls: (() => {
            const m = resolvePumpFunLaunchMetadata(launch, metadataOptions);
            return {
              website: m.websiteUrl,
              twitter: m.twitterUrl,
              telegram: m.telegramUrl,
              testing_mode: m.testingMode,
            };
          })(),
        });
        const resolvedMetadata = resolvePumpFunLaunchMetadata(
          launch,
          metadataOptions,
        );
        const prepared = await pump.preparePumpFunLaunch(wallet, {
          launchId: launch.id,
          name: launch.name,
          symbol: launch.symbol,
          description: launch.description,
          imageUrl: launch.stable_logo_url ?? launch.image_url,
          initialBuySol,
          // Default is creator rewards paid to the launching user's wallet;
          // trader cashback only when the config explicitly opts in.
          cashback:
            launch.creator_rewards_config?.pump_cashback_enabled === true,
          creatorRewardsConfig: launch.creator_rewards_config ?? null,
          twitterUrl: resolvedMetadata.twitterUrl ?? "",
          websiteUrl: resolvedMetadata.websiteUrl,
          telegramUrl: resolvedMetadata.telegramUrl ?? "",
          mayhemMode: Boolean(launch.mayhem_mode_requested ?? false),
        });
        preparedSignature = prepared.signature;
        const persisted = await persistSignedTransaction(admin, {
          workItemId: claim.work_item.id,
          workerId: context.workerId,
          stage: STAGE,
          slotNumber: context.slot.slot_number,
          slotFencingToken: context.slot.fencing_token,
          resourceFencingToken: fence.resourceFencingToken,
          expectedStateVersion: claim.work_item.state_version,
          chain: "solana",
          walletId,
          launchId: launch.id,
          attemptNumber: 1,
          signedBytes: prepared.signedBytes,
          signature: prepared.signature,
          blockhash: prepared.blockhash,
          lastValidBlockHeight: prepared.lastValidBlockHeight,
          predictedAddress: prepared.mint,
          payloadHash: launch.launch_metadata?.image_sha256 ?? null,
          gasPolicy: {
            required_sol: requiredSol,
            initial_buy_sol: prepared.effectiveInitialBuySol,
          },
        });
        transactionId = String(persisted.id);
        await transitionTransaction(
          admin,
          transactionId,
          prepared.signature,
          fence,
          { expectedState: "signed", newState: "broadcasting" },
        );
        broadcasting = true;
        const launchUpdate = await admin.from("coin_launches").update({
          status: "submitting",
          mint: prepared.mint,
          token_address: prepared.mint,
          solana_launch_wallet_address: wallet.address,
          requested_initial_buy_lamports: Math.round(
            initialBuySol * 1_000_000_000,
          )
            .toString(),
          effective_initial_buy_lamports: prepared.effectiveInitialBuyLamports,
          pump_metadata_uri: prepared.metadataUri,
          launch_metadata: {
            ...(launch.launch_metadata ?? {}),
            outbox_transaction_id: transactionId,
            signed_transaction_hash: persisted.signed_transaction_hash,
            blockhash: prepared.blockhash,
            last_valid_block_height: prepared.lastValidBlockHeight,
          },
        }).eq("id", launch.id);
        if (launchUpdate.error) throw launchUpdate.error;
        await pump.broadcastPreparedPumpLaunch(prepared);
        await transitionTransaction(
          admin,
          transactionId,
          prepared.signature,
          fence,
          { expectedState: "broadcasting", newState: "broadcast" },
        );
        const submitted = await admin.from("coin_launches").update({
          status: "submitted",
          tx_hash: prepared.signature,
          tx_signature: prepared.signature,
          explorer_url: prepared.explorerUrl,
          pump_url: prepared.pumpUrl,
          solscan_url: prepared.solscanUrl,
          pump_receipt: prepared.receipt,
          processing_started_at: new Date().toISOString(),
          error: null,
        }).eq("id", launch.id);
        if (submitted.error) throw submitted.error;
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "confirm.solana",
          resultRef: `chain_transaction:${transactionId}`,
        };
      } catch (error) {
        const code = sanitizeError(error);
        if (broadcasting && transactionId) {
          await transitionTransaction(
            admin,
            transactionId,
            preparedSignature || null,
            fence,
            {
              expectedState: "broadcasting",
              newState: "reconciling",
              errorCode: "broadcast_outcome_ambiguous",
            },
          ).catch(() => {});
          return {
            kind: "complete",
            state: "queued",
            nextRoute: "reconciliation",
            resultRef: `chain_transaction:${transactionId}`,
          };
        }
        if (
          /invalid_|missing|mismatch|not_found|too_large|too_many/.test(code)
        ) {
          return { kind: "dead_letter", reasonCode: code.slice(0, 120) };
        }
        return {
          kind: "retry",
          errorCode: code.slice(0, 120),
          delaySeconds: 60,
        };
      } finally {
        walletSecret?.fill(0);
      }
    },
  })
);

async function queueOnce(
  admin: any,
  sourceSurface: string,
  workItemId: string,
  text: string,
  kind: string,
) {
  if (sourceSurface !== "x") return;
  const result = await admin.rpc("enqueue_linkr_x_reply_v1", {
    p_parent_work_item_id: workItemId,
    p_reply_text: text.slice(0, 280),
    p_kind: kind,
    p_version: 1,
    p_priority: 80,
  });
  if (result.error) throw result.error;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function sanitizeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/[1-9A-HJ-NP-Za-km-z]{64,100}/g, "[redacted]")
    .slice(0, 240);
}
