// deno-lint-ignore-file no-explicit-any
import { notifyLaunchUser } from "../_shared/launch_notifications.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";
import {
  persistSignedTransaction,
  transactionFence,
  transitionTransaction,
} from "../_shared/transaction_outbox.ts";
import * as assetsModule from "../_shared/robinhood_launch/assets.ts";
import {
  fundFirstLaunchIfNeeded,
  type FundingKind,
  fundRobinhoodLaunchIfNeeded,
} from "../_shared/robinhood_launch/funding.ts";
import * as launchModule from "../_shared/robinhood_launch/worker_adapter.ts";
import {
  readLaunchFundingPolicy,
  readMetadataTestingPolicy,
} from "../_shared/admin_settings.ts";
import { resolvePumpFunLaunchMetadata } from "../_shared/launch_metadata.ts";

const VERSION = "worker-launch-robinhood-v1";
const STAGE = "launch_robinhood" as const;
// Hardcoded on. Previously the ROBINHOOD_LAUNCH_ENABLED edge secret, which had
// been set to "true" in production since launch. Flip to false to halt Robinhood
// launches (in-flight work items retry rather than fail).
const ROBINHOOD_LAUNCH_ENABLED: boolean = true;

Deno.serve((req) =>
  runStageWorker(req, {
    stage: STAGE,
    functionName: "worker-launch-robinhood",
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
          "Your Robinhood Chain launch is safely queued while the new launch worker is being rolled out.",
          "launch_rollout_wait",
        );
        return {
          kind: "retry",
          errorCode: "robinhood_launch_rollout_pending",
          delaySeconds: 900,
        };
      }
      if (!ROBINHOOD_LAUNCH_ENABLED) {
        return {
          kind: "retry",
          errorCode: "robinhood_launch_disabled",
          delaySeconds: 900,
        };
      }

      const launchResult = await admin.from("coin_launches").select("*")
        .eq("work_item_id", claim.work_item.id).eq("chain", "robinhood")
        .limit(1).maybeSingle();
      if (launchResult.error) throw launchResult.error;
      const launch = launchResult.data;
      if (!launch) {
        return { kind: "dead_letter", reasonCode: "coin_launch_not_found" };
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
            ? "confirm.robinhood"
            : "reconciliation",
          resultRef: `chain_transaction:${existing.data.id}`,
        };
      }

      const pendingResult = await admin.from("linkr_pending_actions").select(
        "id,status,action_payload,draft_id,confirmed_at,user_id",
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
      if (pending.draft_id) {
        const draft = await admin.from("linkr_action_drafts").select(
          "status,version",
        )
          .eq("id", pending.draft_id).maybeSingle();
        if (draft.error) throw draft.error;
        if (
          !draft.data ||
          !["converted_to_pending", "completed"].includes(draft.data.status)
        ) {
          return {
            kind: "dead_letter",
            reasonCode: "launch_draft_version_invalid",
          };
        }
      }
      const userId = claim.work_item.user_id;
      if (!userId) {
        return { kind: "dead_letter", reasonCode: "launch_user_id_missing" };
      }

      let broadcasting = false;
      let transactionId = "";
      let preparedHash = "";
      let walletSecret: Uint8Array | null = null;
      const fence = transactionFence(claim, context);
      try {
        let currentLaunch = launch;
        const metadataPolicy = await readMetadataTestingPolicy(admin);
        const onchainMetadata = resolvePumpFunLaunchMetadata(
          currentLaunch,
          {
            testingMode: metadataPolicy.enabled,
            testingWebsiteUrl: metadataPolicy.test_website_url,
            testingTwitterUrl: metadataPolicy.test_twitter_url,
            testingTelegramUrl: metadataPolicy.test_telegram_url,
            mintAddress: null,
          },
        );
        if (needsRobinhoodIpfsAssets(currentLaunch)) {
          const assets = await assetsModule
            .prepareLaunchAssets(admin, {
              launchId: launch.id,
              name: launch.name,
              symbol: launch.symbol,
              description: launch.description,
              imageUrl: launch.stable_logo_url ?? launch.image_url,
              website: onchainMetadata.websiteUrl,
              twitter: onchainMetadata.twitterUrl,
              telegram: onchainMetadata.telegramUrl,
              externalUrl: onchainMetadata.websiteUrl,
            });
          const updated = await admin.from("coin_launches").update({
            image_url: assets.imageUrl,
            stable_logo_url: assets.stableLogoUrl,
            token_logo_storage_path: assets.tokenLogoStoragePath,
            metadata_uri: assets.metadataUri,
            token_metadata_storage_path: assets.tokenMetadataStoragePath,
            token_metadata_hash: assets.tokenMetadataHash,
            metadata_storage_provider: assets.metadataStorageProvider,
            metadata_storage_error: assets.metadataStorageError,
            ipfs_image_uri: assets.ipfsImageUri,
            ipfs_image_cid: assets.ipfsImageCid,
            ipfs_image_gateway_url: assets.ipfsImageGatewayUrl,
            ipfs_metadata_uri: assets.ipfsMetadataUri,
            ipfs_metadata_cid: assets.ipfsMetadataCid,
            ipfs_metadata_gateway_url: assets.ipfsMetadataGatewayUrl,
            filebase_image_object_key: assets.filebaseImageObjectKey,
            filebase_metadata_object_key: assets.filebaseMetadataObjectKey,
          }).eq("id", launch.id).select("*").single();
          if (updated.error) throw updated.error;
          currentLaunch = updated.data;
        }

        currentLaunch = await ensureRobinhoodLaunchSaltSeed(
          admin,
          currentLaunch,
        );
        const walletId = String(currentLaunch.launch_signer_wallet_id ?? "");
        const wallet = await launchModule.loadWalletById(
          admin,
          walletId,
          userId,
        );
        if (!wallet) throw new Error("launch_signer_wallet_not_found");
        walletSecret = wallet.private_key;
        const signer = launchModule.walletFromLoadedWallet(wallet);
        const initialBuyWei = launchModule.parseInitialBuyWei(
          currentLaunch.requested_initial_buy_wei ??
            currentLaunch.requested_initial_buy_eth ??
            currentLaunch.dev_buy_eth ?? "0",
        );
        const draft = {
          launchId: currentLaunch.id,
          name: currentLaunch.name,
          symbol: currentLaunch.symbol,
          metadataURI: requireIpfsUri(currentLaunch.metadata_uri, "metadata_uri"),
          logoURI: requireIpfsUri(currentLaunch.ipfs_image_uri, "logo_uri"),
          description: currentLaunch.description ?? "",
          twitter: onchainMetadata.twitterUrl,
          telegram: onchainMetadata.telegramUrl,
          website: onchainMetadata.websiteUrl,
          initialBuyWei,
          saltSeed: currentLaunch.launch_metadata?.robinhood_launch_salt_seed,
        };
        const preflight = await launchModule.estimateSingleSidedLaunch(
          signer,
          draft,
        );
        if (preflight.signerBalanceWei < preflight.requiredBalanceWei) {
          // Top up to the funding target, not to the bare requirement: the gas
          // price moves between this preflight and the one the retry runs
          // before signing, and funding the exact deficit leaves the launch
          // looping until the watchdog kills it. See launchFundingTargetWei.
          const deficitWei = launchModule.launchFundingTargetWei(preflight) -
            preflight.signerBalanceWei;
          const fundingPolicy = await readLaunchFundingPolicy(admin);
          if (
            fundingPolicy.mode !== "funding_disabled" &&
            initialBuyWei === 0n &&
            deficitWei > 0n
          ) {
            const fundingKind: FundingKind =
              fundingPolicy.mode === "fund_every_eligible_launch"
                ? "per_launch_minimum"
                : "first_launch_minimum";
            try {
              const subsidy = fundingKind === "first_launch_minimum"
                ? await fundFirstLaunchIfNeeded(admin, {
                  launchId: currentLaunch.id,
                  userId,
                  walletId,
                  destinationAddress: wallet.address,
                  amountWei: deficitWei,
                  enabled: true,
                })
                : await fundRobinhoodLaunchIfNeeded(admin, {
                  launchId: currentLaunch.id,
                  userId,
                  walletId,
                  destinationAddress: wallet.address,
                  amountWei: deficitWei,
                  fundingKind,
                  enabled: true,
                });
              if (subsidy.funded) {
                return {
                  kind: "retry",
                  errorCode: fundingKind === "first_launch_minimum"
                    ? "robinhood_first_launch_funded"
                    : "robinhood_per_launch_funded",
                  delaySeconds: 3,
                };
              }
            } catch (error) {
              const fundingError = sanitizeError(error);
              if (
                !/first_launch_subsidy|first_launch_funding_already_pending|first_launch_minimum_cap_exceeded|per_launch_minimum_cap_exceeded|dev_wallet_insufficient_balance|ETH_DEV_WALLET/
                  .test(
                    fundingError,
                  )
              ) throw error;
            }
          }
          const paused = await admin.rpc("pause_linkr_launch_for_funds_v1", {
            p_work_item_id: claim.work_item.id,
            p_launch_id: currentLaunch.id,
            p_reason_code: "insufficient_launch_signer_balance",
          });
          if (paused.error) throw paused.error;
          await notifyLaunchUser(admin, {
            workItemId: claim.work_item.id,
            sourceSurface: String(claim.work_item.source_surface ?? "unknown"),
            userId,
            launchId: currentLaunch.id,
            chain: "robinhood",
            status: "waiting_funds",
            kind: "launch_insufficient_funds",
            text: claim.work_item.source_surface === "x"
              ? 'Your wallet does not have enough ETH for the launch fee and gas. Fund it, then reply "retry launch" in this thread.'
              : "Your launch is waiting for funds: the wallet does not have enough ETH for the launch fee and gas. Top up the wallet, then submit the launch again.",
          });
          return {
            kind: "complete",
            state: "waiting_funds",
            resultRef: `coin_launch:${currentLaunch.id}`,
          };
        }
        const prepared = await launchModule.prepareSignedSingleSidedLaunch(
          signer,
          draft,
          preflight,
        );
        preparedHash = prepared.txHash;
        const persisted = await persistSignedTransaction(admin, {
          workItemId: claim.work_item.id,
          workerId: context.workerId,
          stage: STAGE,
          slotNumber: context.slot.slot_number,
          slotFencingToken: context.slot.fencing_token,
          resourceFencingToken: fence.resourceFencingToken,
          expectedStateVersion: claim.work_item.state_version,
          chain: "robinhood",
          walletId,
          launchId: currentLaunch.id,
          attemptNumber: 1,
          signedBytes: prepared.signedBytes,
          transactionHash: prepared.txHash,
          nonce: prepared.nonce,
          predictedAddress: prepared.predictedToken,
          payloadHash: currentLaunch.token_metadata_hash,
          gasPolicy: {
            gas_limit: prepared.gasLimit.toString(),
            gas_price_wei: prepared.gasPriceWei.toString(),
            total_value_wei: prepared.totalMsgValueWei.toString(),
          },
        });
        transactionId = String(persisted.id);
        await transitionTransaction(
          admin,
          transactionId,
          prepared.txHash,
          fence,
          { expectedState: "signed", newState: "broadcasting" },
        );
        broadcasting = true;
        const submitting = await admin.from("coin_launches").update({
          status: "submitting",
          factory: prepared.factoryAddress,
          launch_signer_address: prepared.signerAddress,
          token_address: prepared.predictedToken,
          launch_fee_wei: prepared.launchFeeWei.toString(),
          total_msg_value_wei: prepared.totalMsgValueWei.toString(),
          effective_initial_buy_wei: initialBuyWei.toString(),
          launch_metadata: {
            ...(currentLaunch.launch_metadata ?? {}),
            outbox_transaction_id: transactionId,
            robinhood_metadata_token_address: prepared.predictedToken,
            robinhood_onchain_logo: draft.logoURI,
            robinhood_onchain_website: draft.website,
            signed_transaction_hash: persisted.signed_transaction_hash,
            salt: prepared.salt,
          },
        }).eq("id", currentLaunch.id);
        if (submitting.error) throw submitting.error;
        await launchModule.broadcastSignedSingleSidedLaunch(
          signer.provider!,
          prepared,
        );
        await transitionTransaction(
          admin,
          transactionId,
          prepared.txHash,
          fence,
          { expectedState: "broadcasting", newState: "broadcast" },
        );
        const submitted = await admin.from("coin_launches").update({
          status: "submitted",
          tx_hash: prepared.txHash,
          tx_signature: prepared.txHash,
          explorer_url:
            `https://robinhoodchain.blockscout.com/tx/${prepared.txHash}`,
          processing_started_at: new Date().toISOString(),
          error: null,
        }).eq("id", currentLaunch.id);
        if (submitted.error) throw submitted.error;
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "confirm.robinhood",
          resultRef: `chain_transaction:${transactionId}`,
        };
      } catch (error) {
        const code = sanitizeError(error);
        if (broadcasting && transactionId) {
          await transitionTransaction(
            admin,
            transactionId,
            preparedHash,
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
          /invalid_|missing|mismatch|not_found|too_large|too_long/.test(code)
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

async function ensureRobinhoodLaunchSaltSeed(admin: any, launch: any) {
  const metadata = isRecord(launch.launch_metadata)
    ? { ...launch.launch_metadata }
    : {};
  const existing = launchModule.normalizeLaunchSaltSeed(
    metadata.robinhood_launch_salt_seed,
  );
  if (existing) {
    if (metadata.robinhood_launch_salt_seed === existing) return launch;
    metadata.robinhood_launch_salt_seed = existing;
  } else {
    metadata.robinhood_launch_salt_seed = launchModule.generateLaunchSaltSeed();
  }
  const updated = await admin.from("coin_launches").update({
    launch_metadata: metadata,
  }).eq("id", launch.id).select("*").single();
  if (updated.error) throw updated.error;
  return updated.data;
}

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
    p_reply_text: text,
    p_kind: kind,
    p_version: 1,
    p_priority: 80,
  });
  if (result.error) throw result.error;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function needsRobinhoodIpfsAssets(launch: any): boolean {
  const metadataUri = String(launch.metadata_uri ?? "").trim();
  const logoUri = String(launch.ipfs_image_uri ?? "").trim();
  const provider = String(launch.metadata_storage_provider ?? "").trim();
  return provider !== "filebase" ||
    !/^ipfs:\/\//i.test(metadataUri) ||
    !/^ipfs:\/\//i.test(logoUri);
}

function requireIpfsUri(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!/^ipfs:\/\//i.test(text)) {
    throw new Error(`invalid_robinhood_${field}_ipfs_required`);
  }
  return text;
}

function sanitizeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/0x[a-fA-F0-9]{64}/g, "[redacted]")
    .slice(0, 240);
}
