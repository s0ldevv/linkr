// deno-lint-ignore-file no-explicit-any
import {
  authorizePreparedLaunch,
  loadPreparedLaunchDraft,
  pauseLaunchPreparation,
} from "../_shared/autonomous_launch.ts";
import { storeCapturedImage } from "../_shared/bounded_media.ts";
import { generateLaunchImage } from "../_shared/launch_image_generation.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";

const VERSION = "worker-image-generate-v1";

Deno.serve((req) =>
  runStageWorker(req, {
    stage: "image_generate",
    functionName: "worker-image-generate",
    consumerVersion: VERSION,
    visibilitySeconds: 180,
    process: async (claim, admin) => {
      const draftId = String(claim.work_item.payload?.draft_id ?? "");
      if (!draftId) {
        return { kind: "dead_letter", reasonCode: "launch_draft_id_missing" };
      }
      const draft = await loadPreparedLaunchDraft(admin, draftId);
      let generated;
      try {
        generated = await generateLaunchImage({
          prompt: String(draft.filled_fields.image_prompt ?? ""),
          negativePrompt: draft.filled_fields.image_negative_prompt,
          seed: `${draft.id}:${draft.filled_fields.name}`,
          allowFallback: claim.work_item.attempt_count >= 2,
        });
      } catch {
        return {
          kind: "retry",
          errorCode: "image_provider_retryable",
          delaySeconds: claim.work_item.attempt_count > 0 ? 120 : 45,
        };
      }
      const stored = await storeCapturedImage(admin, generated.image);
      try {
        const authorized = await authorizePreparedLaunch(
          admin,
          claim.work_item.id,
          draft,
          {
            ...stored,
            sha256: generated.image.sha256,
            contentType: generated.image.contentType,
            width: generated.image.width,
            height: generated.image.height,
          },
          generated.image.sourceUrl,
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
        return handlePreparationError(
          admin,
          claim.work_item.id,
          draft.id,
          error,
        );
      }
    },
  })
);

async function queueConfirmation(admin: any, workItemId: string, draft: any) {
  const chain = draft.filled_fields.chain === "solana"
    ? "Solana"
    : "Robinhood Chain";
  const result = await admin.rpc("enqueue_linkr_x_reply_v1", {
    p_parent_work_item_id: workItemId,
    p_reply_text:
      `Ready to launch $${draft.filled_fields.symbol} (${draft.filled_fields.name}) on ${chain}. Reply \"confirm launch\" within 24 hours.`,
    p_kind: "launch_confirmation",
    p_version: Math.max(1, Number(draft.version)),
    p_priority: 60,
  });
  if (result.error) throw result.error;
}

async function handlePreparationError(
  admin: any,
  workItemId: string,
  draftId: string,
  error: unknown,
) {
  const code = errorCode(error);
  const message = code.includes("wallet")
    ? "I couldn't find the primary wallet for that chain. Create or import it, then reply in this thread to continue."
    : "Your launch is saved, but the buy or advanced launch settings need review before I can submit it.";
  if (/wallet|initial_buy|profile_cap|launch_payload_fields/.test(code)) {
    await pauseLaunchPreparation(admin, draftId, code);
    const reply = await admin.rpc("enqueue_linkr_x_reply_v1", {
      p_parent_work_item_id: workItemId,
      p_reply_text: message,
      p_kind: "launch_preparation_paused",
      p_version: 1,
      p_priority: 60,
    });
    if (reply.error) throw reply.error;
    return {
      kind: "complete" as const,
      state: "succeeded",
      resultRef: `paused:${code}`,
    };
  }
  throw error;
}

function errorCode(error: unknown): string {
  return String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error,
  ).toLowerCase().match(/[a-z][a-z0-9:_-]{0,119}/)?.[0] ??
    "launch_preparation_failed";
}
