// deno-lint-ignore-file no-explicit-any
import type { LaunchFields } from "./x_launch_command.ts";

export interface PreparedLaunchDraft {
  id: string;
  version: number;
  user_id: string;
  work_item_id: string;
  filled_fields: LaunchFields;
  field_provenance: Record<string, string>;
  generation_context: Record<string, unknown>;
}

export interface LaunchAuthorizationResult {
  decision: "auto_authorized" | "confirmation_required";
  pendingActionId: string;
  rootWorkItemId: string;
  launchId: string | null;
  economicWorkItemId: string | null;
}

export interface PersistedLaunchImage {
  publicUrl: string;
  path: string;
  sha256: string;
  contentType: string;
  width: number;
  height: number;
}

export async function loadPreparedLaunchDraft(
  admin: any,
  draftId: string,
): Promise<PreparedLaunchDraft> {
  const result = await admin.from("linkr_action_drafts").select(
    "id,version,user_id,work_item_id,filled_fields,field_provenance,generation_context",
  ).eq("id", draftId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("launch_draft_not_found");
  const draft = result.data as PreparedLaunchDraft;
  if (
    draft.filled_fields?.chain !== "solana" &&
    draft.filled_fields?.chain !== "robinhood"
  ) {
    throw new Error("explicit_launch_chain_missing");
  }
  if (
    !["user_text", "thread_context"].includes(
      String(draft.field_provenance?.chain ?? ""),
    )
  ) {
    throw new Error("explicit_launch_chain_provenance_required");
  }
  return draft;
}

export async function authorizePreparedLaunch(
  admin: any,
  preparationWorkItemId: string,
  draft: PreparedLaunchDraft,
  stored: PersistedLaunchImage,
  originalImageUrl: string,
): Promise<LaunchAuthorizationResult> {
  const chain = draft.filled_fields.chain;
  if (chain !== "solana" && chain !== "robinhood") {
    throw new Error("explicit_launch_chain_missing");
  }
  let walletQuery = admin.from("wallets").select("id")
    .eq("user_id", draft.user_id)
    .eq("wallet_type", chain === "solana" ? "solana" : "evm")
    .eq("is_primary", true);
  if (chain === "robinhood") walletQuery = walletQuery.eq("chain_id", 4663);
  const wallet = await walletQuery.order("created_at", { ascending: true })
    .limit(1).maybeSingle();
  if (wallet.error) throw wallet.error;
  if (!wallet.data?.id) throw new Error("launch_wallet_missing");

  const payload = compactLaunchPayload(draft.filled_fields);
  const result = await admin.rpc("authorize_linkr_launch_v2", {
    p_draft_id: draft.id,
    p_preparation_work_item_id: preparationWorkItemId,
    p_wallet_id: wallet.data.id,
    p_payload: payload,
    p_image_url: stored.publicUrl,
    p_original_image_url: originalImageUrl || stored.publicUrl,
    p_storage_path: stored.path,
    p_image_sha256: stored.sha256,
    p_image_content_type: stored.contentType,
    p_image_width: stored.width,
    p_image_height: stored.height,
  });
  if (result.error) throw result.error;
  const activation = result.data?.activation ?? null;
  return {
    decision: result.data?.decision,
    pendingActionId: String(result.data?.pending_action_id ?? ""),
    rootWorkItemId: String(result.data?.root_work_item_id ?? ""),
    launchId: activation?.launch_id ? String(activation.launch_id) : null,
    economicWorkItemId: activation?.economic_work_item_id
      ? String(activation.economic_work_item_id)
      : null,
  };
}

export async function pauseLaunchPreparation(
  admin: any,
  draftId: string,
  reasonCode: string,
) {
  const result = await admin.rpc("pause_linkr_launch_preparation_v1", {
    p_draft_id: draftId,
    p_reason_code: reasonCode.slice(0, 120),
  });
  if (result.error) throw result.error;
  return result.data;
}

function compactLaunchPayload(fields: LaunchFields): Record<string, unknown> {
  const allowed = [
    "name",
    "symbol",
    "description",
    "chain",
    "dev_buy_amount",
    "website_url",
    "twitter_url",
    "telegram_url",
    "creator_rewards_config",
    "mayhem_mode",
  ];
  const output: Record<string, unknown> = {};
  const source = fields as Record<string, unknown>;
  for (const key of allowed) {
    if (source[key] !== undefined && source[key] !== null) {
      output[key] = source[key];
    }
  }
  return output;
}
