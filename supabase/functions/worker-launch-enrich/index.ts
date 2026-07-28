// deno-lint-ignore-file no-explicit-any
import { loadPreparedLaunchDraft } from "../_shared/autonomous_launch.ts";
import { isFirstLaunchSubsidyEligible } from "../_shared/first_launch_subsidy.ts";
import { enrichLaunchFields } from "../_shared/launch_enrichment.ts";
import { runStageWorker } from "../_shared/queue_worker_versioned.ts";

const VERSION = "worker-launch-enrich-v1";

Deno.serve((req) =>
  runStageWorker(req, {
    stage: "launch_enrich",
    functionName: "worker-launch-enrich",
    consumerVersion: VERSION,
    visibilitySeconds: 180,
    process: async (claim, admin) => {
      const draftId = String(claim.work_item.payload?.draft_id ?? "");
      if (!draftId) {
        return { kind: "dead_letter", reasonCode: "launch_draft_id_missing" };
      }
      const draft = await loadPreparedLaunchDraft(admin, draftId);
      const profileResult = await admin.from("profiles")
        .select("default_dev_buy_sol,default_dev_buy_eth")
        .eq("user_id", draft.user_id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      const subsidyEligible = draft.filled_fields.chain === "solana"
        ? await isFirstLaunchSubsidyEligible(admin, draft.user_id, {
          chain: "solana",
        })
        : false;
      let enriched;
      try {
        enriched = await enrichLaunchFields(draft.filled_fields, {
          devBuySol: profileResult.data?.default_dev_buy_sol,
          devBuyEth: profileResult.data?.default_dev_buy_eth,
          firstLaunchSubsidyEligible: subsidyEligible,
        });
      } catch (error) {
        const code = errorCode(error);
        if (/comet|fetch|timeout|abort|429|5\d\d/.test(code)) {
          return {
            kind: "retry",
            errorCode: "launch_metadata_provider_retryable",
            delaySeconds: 60,
          };
        }
        return { kind: "dead_letter", reasonCode: code };
      }
      const generatedFields = pick(enriched.fields, [
        "symbol",
        "description",
        "image_prompt",
        "image_negative_prompt",
        "dev_buy_amount",
      ]);
      const generatedProvenance = pick(
        enriched.provenance,
        Object.keys(generatedFields),
      );
      const updated = await admin.rpc("update_linkr_launch_enrichment_v1", {
        p_draft_id: draft.id,
        p_expected_version: draft.version,
        p_generated_fields: generatedFields,
        p_generated_provenance: generatedProvenance,
        p_generation_context: enriched.generationContext,
      });
      if (updated.error) {
        throw updated.error;
      }
      const imageUrl = String(updated.data?.filled_fields?.image_url ?? "")
        .trim();
      return {
        kind: "complete",
        state: "queued",
        nextRoute: imageUrl ? "media.capture" : "image.generate",
        resultRef: `draft:${draft.id}:v${updated.data.version}`,
      };
    },
  })
);

function pick(
  source: object,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const values = source as Record<string, unknown>;
  for (const key of keys) {
    if (
      values[key] !== undefined && values[key] !== null && values[key] !== ""
    ) {
      output[key] = values[key];
    }
  }
  return output;
}

function errorCode(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 120) ||
    "launch_enrichment_failed";
}
