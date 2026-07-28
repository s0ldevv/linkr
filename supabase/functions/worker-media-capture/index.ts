// deno-lint-ignore-file no-explicit-any
import {
  authorizePreparedLaunch,
  loadPreparedLaunchDraft,
  pauseLaunchPreparation,
} from "../_shared/autonomous_launch.ts";
import {
  captureBoundedXImage,
  storeCapturedImage,
} from "../_shared/bounded_media.ts";
import {
  LaunchIntentMismatchError,
  launchVerificationReply,
} from "../_shared/launch_semantic_verifier.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";

const VERSION = "worker-media-capture-v3";

Deno.serve((req) =>
  runStageWorker(req, {
    stage: "media_capture",
    functionName: "worker-media-capture",
    consumerVersion: VERSION,
    visibilitySeconds: 180,
    process: async (claim, admin) => {
      const draftId = String(claim.work_item.payload?.draft_id ?? "");
      if (!draftId) {
        // Authenticated non-X launches (dashboard, terminal, telegram,
        // agent_api) arrive via accept_linkr_launch_request_v1 with a
        // confirmed pending action instead of an X draft.
        return await processPendingActionLaunch(claim, admin);
      }
      const draft = await loadPreparedLaunchDraft(admin, draftId);
      const sourceUrl = String(
        draft.filled_fields.original_image_url ??
          draft.filled_fields.image_url ?? "",
      ).trim();
      if (!sourceUrl) {
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "image.generate",
          resultRef: `image-generation-fallback:${draft.id}`,
        };
      }
      let captured;
      try {
        captured = await captureBoundedXImage(sourceUrl);
      } catch (error) {
        const code = errorCode(error);
        if (
          /fetch_failed_(?:408|429|5\d\d)|abort|network|fetch/.test(code) &&
          claim.work_item.attempt_count < 2
        ) {
          return {
            kind: "retry",
            errorCode: "media_provider_retryable",
            delaySeconds: 60,
          };
        }
        return {
          kind: "complete",
          state: "queued",
          nextRoute: "image.generate",
          resultRef: `image-generation-fallback:${code}`,
        };
      }
      const stored = await storeCapturedImage(admin, captured);
      try {
        const authorized = await authorizePreparedLaunch(
          admin,
          claim.work_item.id,
          draft,
          {
            ...stored,
            sha256: captured.sha256,
            contentType: captured.contentType,
            width: captured.width,
            height: captured.height,
          },
          sourceUrl,
        );
        if (authorized.decision === "confirmation_required") {
          await queueConfirmation(admin, claim.work_item.id, draft);
        }
        return {
          kind: "complete",
          state: "succeeded",
          resultRef: authorized.launchId
            ? `coin_launch:${authorized.launchId}`
            : `pending_action:${authorized.pendingActionId}`,
        };
      } catch (error) {
        if (error instanceof LaunchIntentMismatchError) {
          await pauseLaunchPreparation(
            admin,
            draft.id,
            "launch_payload_intent_mismatch",
          );
          const reply = await admin.rpc("enqueue_linkr_x_reply_v1", {
            p_parent_work_item_id: claim.work_item.id,
            p_reply_text: launchVerificationReply(error.verification),
            p_kind: "launch_intent_clarification",
            p_version: 1,
            p_priority: 60,
          });
          if (reply.error) throw reply.error;
          return {
            kind: "complete",
            state: "succeeded",
            resultRef: "paused:launch_payload_intent_mismatch",
          };
        }
        const code = errorCode(error);
        if (/wallet|initial_buy|profile_cap|launch_payload_fields/.test(code)) {
          await pauseLaunchPreparation(admin, draft.id, code);
          const reply = await admin.rpc("enqueue_linkr_x_reply_v1", {
            p_parent_work_item_id: claim.work_item.id,
            p_reply_text: code.includes("wallet")
              ? "I couldn't find the primary wallet for that chain. Create or import it, then reply in this thread to continue."
              : "Your launch is saved, but the buy or advanced launch settings need review before I can submit it.",
            p_kind: "launch_preparation_paused",
            p_version: 1,
            p_priority: 60,
          });
          if (reply.error) {
            throw reply.error;
          }
          return {
            kind: "complete",
            state: "succeeded",
            resultRef: `paused:${code}`,
          };
        }
        throw error;
      }
    },
  })
);

async function processPendingActionLaunch(claim: any, admin: any) {
  if (claim.work_item.request_type !== "launch_coin") {
    return {
      kind: "dead_letter" as const,
      reasonCode: "launch_draft_id_missing",
    };
  }
  const pendingResult = await admin.from("linkr_pending_actions")
    .select("id,user_id,status,action_payload,source_surface")
    .eq("work_item_id", claim.work_item.id)
    .eq("action_type", "launch_coin")
    .in("status", ["confirmed", "executing", "executed"])
    .order("created_at", { ascending: true })
    .limit(1).maybeSingle();
  if (pendingResult.error) throw pendingResult.error;
  const pending = pendingResult.data;
  if (!pending) {
    return {
      kind: "dead_letter" as const,
      reasonCode: "launch_pending_action_missing",
    };
  }
  const payload = pending.action_payload ?? {};
  const chain = String(payload.chain ?? "");
  if (chain !== "solana" && chain !== "robinhood") {
    return { kind: "dead_letter" as const, reasonCode: "launch_chain_missing" };
  }
  const sourceUrl = String(payload.image_url ?? "").trim();
  if (!sourceUrl) {
    return { kind: "dead_letter" as const, reasonCode: "launch_image_missing" };
  }

  let captured;
  try {
    captured = await captureBoundedXImage(sourceUrl);
  } catch (error) {
    const code = errorCode(error);
    if (
      /fetch_failed_(?:408|429|5\d\d)|abort|network|fetch|redirect/.test(
        code,
      ) &&
      claim.work_item.attempt_count < 4
    ) {
      return {
        kind: "retry" as const,
        errorCode: "media_provider_retryable",
        delaySeconds: 60,
      };
    }
    return { kind: "dead_letter" as const, reasonCode: code };
  }
  const stored = await storeCapturedImage(admin, captured);

  const ensured = await admin.rpc("ensure_linkr_coin_launch_v1", {
    p_work_item_id: claim.work_item.id,
    p_pending_action_id: pending.id,
    p_image_url: stored.publicUrl,
    p_original_image_url: String(payload.original_image_url ?? sourceUrl),
    p_storage_path: stored.path,
    p_image_sha256: captured.sha256,
    p_image_content_type: captured.contentType,
    p_image_width: captured.width,
    p_image_height: captured.height,
  });
  if (ensured.error) throw ensured.error;
  const launchId = String(ensured.data?.launch_id ?? "");
  if (!launchId) throw new Error("launch_ensure_failed");

  const devBuy = Number(
    (chain === "solana"
      ? payload.dev_buy_sol ?? payload.initial_buy_sol
      : payload.dev_buy_eth ?? payload.initial_buy_eth) ?? 0,
  );
  const rewardsConfig = payload.creator_rewards_config &&
      typeof payload.creator_rewards_config === "object"
    ? payload.creator_rewards_config
    : null;
  const patch = await admin.from("coin_launches").update({
    source_surface: String(pending.source_surface ?? "dashboard"),
    idempotency_key: `queue-launch:${claim.work_item.id}`,
    metadata_website_url: nullableUrl(payload.website_url),
    metadata_twitter_url: nullableUrl(payload.twitter_url),
    metadata_telegram_url: nullableUrl(payload.telegram_url),
    creator_rewards_config: rewardsConfig,
    mayhem_mode_requested: Boolean(payload.mayhem_mode),
    launch_method: chain === "solana"
      ? "pump_fun_create_v2"
      : "single_sided_uniswap_v3_lp",
    ...(chain === "solana"
      ? { dev_buy_sol: Number.isFinite(devBuy) ? devBuy : 0 }
      : {
        dev_buy_eth: Number.isFinite(devBuy) ? devBuy : 0,
        requested_initial_buy_eth: Number.isFinite(devBuy) ? devBuy : 0,
      }),
  }).eq("id", launchId);
  if (patch.error) throw patch.error;

  return {
    kind: "complete" as const,
    state: "queued",
    nextRoute: chain === "solana" ? "launch.solana" : "launch.robinhood",
    resultRef: `coin_launch:${launchId}`,
  };
}

function nullableUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^https:\/\//i.test(text) ? text.slice(0, 2048) : null;
}

async function queueConfirmation(admin: any, workItemId: string, draft: any) {
  const chain = draft.filled_fields.chain === "solana"
    ? "Solana"
    : "Robinhood Chain";
  const mayhemText = draft.filled_fields.mayhem_mode ? " (Mayhem mode)" : "";
  const result = await admin.rpc("enqueue_linkr_x_reply_v1", {
    p_parent_work_item_id: workItemId,
    p_reply_text:
      `Ready to launch $${draft.filled_fields.symbol} (${draft.filled_fields.name}) on ${chain}${mayhemText}. Reply \"confirm launch\" within 24 hours.`,
    p_kind: "launch_confirmation",
    p_version: Math.max(1, Number(draft.version)),
    p_priority: 60,
  });
  if (result.error) throw result.error;
}

function errorCode(error: unknown): string {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error,
  ).toLowerCase().match(/[a-z][a-z0-9:_-]{0,119}/)?.[0] ??
    "launch_preparation_failed";
}
