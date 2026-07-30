// deno-lint-ignore-file no-explicit-any
import {
  assertLaunchPayloadMatchesThread,
  type LaunchSemanticVerification,
  verifyLaunchPayloadAgainstThread,
} from "./launch_semantic_verifier.ts";
import type { LaunchFields } from "./x_launch_command.ts";

export interface PreparedLaunchDraft {
  id: string;
  version: number;
  user_id: string;
  work_item_id: string;
  source_tweet_id?: string | null;
  source_refs?: unknown;
  filled_fields: LaunchFields;
  field_provenance: Record<string, unknown>;
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
    "id,version,user_id,work_item_id,source_tweet_id,source_refs,filled_fields,field_provenance,generation_context",
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
  const threadContext = await loadVerifierThreadContext(admin, draft);
  const verification = await verifyLaunchPayloadAgainstThread({
    originalUserRequest: threadContext.originalUserRequest,
    latestFollowUp: threadContext.latestFollowUp,
    previousAssistantReply: threadContext.previousAssistantReply,
    finalPayload: payload as LaunchFields,
    botHandle: Deno.env.get("X_BOT_HANDLE") ?? "linkrbot",
  });
  await recordLaunchSemanticVerification(admin, draft, verification);
  assertLaunchPayloadMatchesThread(verification);

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

async function recordLaunchSemanticVerification(
  admin: any,
  draft: PreparedLaunchDraft,
  verification: LaunchSemanticVerification,
) {
  const context = {
    ...(draft.generation_context ?? {}),
    launch_semantic_verifier: {
      prompt_version: verification.prompt_version,
      model: verification.model,
      matches_user_intent: verification.matches_user_intent,
      blocking_mismatches: verification.blocking_mismatches,
      confidence: verification.confidence,
      user_visible_summary: verification.user_visible_summary,
      clarification_question: verification.clarification_question,
      checked_at: new Date().toISOString(),
    },
  };
  const result = await admin.from("linkr_action_drafts").update({
    generation_context: context,
  }).eq("id", draft.id);
  if (result.error) throw result.error;
  draft.generation_context = context;
}

async function loadVerifierThreadContext(
  admin: any,
  draft: PreparedLaunchDraft,
): Promise<{
  originalUserRequest: string | null;
  latestFollowUp: string | null;
  previousAssistantReply: string | null;
}> {
  let originalUserRequest = readContextText(
    draft.generation_context,
    "launch_slot_thread",
    "original_user_request",
  );
  let latestFollowUp = readContextText(
    draft.generation_context,
    "launch_slot_thread",
    "latest_follow_up",
  );
  let previousAssistantReply = readContextText(
    draft.generation_context,
    "launch_slot_thread",
    "previous_assistant_reply",
  );

  const tweetIds = sourceRefTweetIds(draft.source_refs);
  if (draft.source_tweet_id && !tweetIds.includes(draft.source_tweet_id)) {
    tweetIds.push(draft.source_tweet_id);
  }
  const originalTweetId = tweetIds[0] ?? draft.source_tweet_id ?? "";
  const latestTweetId = tweetIds[tweetIds.length - 1] ??
    draft.source_tweet_id ?? "";

  if ((!originalUserRequest || !latestFollowUp) && tweetIds.length > 0) {
    const tweetResult = await admin.from("tweets_inbox").select(
      "tweet_id,text",
    ).in("tweet_id", [...new Set(tweetIds)]);
    if (!tweetResult.error && Array.isArray(tweetResult.data)) {
      const byId = new Map<string, string>(
        tweetResult.data.map((row: any) => [
          String(row.tweet_id ?? ""),
          String(row.text ?? ""),
        ]),
      );
      originalUserRequest ||= byId.get(originalTweetId) ?? null;
      latestFollowUp ||= byId.get(latestTweetId) ?? null;
    }
  }

  if (!previousAssistantReply && originalTweetId) {
    const replyResult = await admin.from("twitter_replies").select(
      "reply_text",
    )
      .eq("tweet_id", originalTweetId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!replyResult.error && replyResult.data?.reply_text) {
      previousAssistantReply = String(replyResult.data.reply_text);
    }
  }

  return { originalUserRequest, latestFollowUp, previousAssistantReply };
}

function sourceRefTweetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const tweetId = (item as Record<string, unknown>).tweet_id;
    if (typeof tweetId === "string" && tweetId.trim()) {
      ids.push(tweetId.trim());
    }
  }
  return ids;
}

function readContextText(
  context: Record<string, unknown>,
  section: string,
  key: string,
): string | null {
  const value = context?.[section];
  if (!value || typeof value !== "object") return null;
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" && text.trim() ? text : null;
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
