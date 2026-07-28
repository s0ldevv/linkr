import { stableIdempotencyKey } from "./linkr_idempotency.ts";

export async function createOrUpdateActionDraft(admin: any, args: {
  user_id: string;
  conversation_id?: string | null;
  source_tweet_id?: string | null;
  action_type: string;
  required_fields: string[];
  filled_fields: Record<string, unknown>;
  entity_refs?: unknown[];
}) {
  const draftKey = `${args.action_type}:${args.conversation_id ?? args.source_tweet_id ?? args.user_id}`;
  const row = {
    user_id: args.user_id,
    conversation_id: args.conversation_id ?? null,
    source_tweet_id: args.source_tweet_id ?? null,
    draft_key: draftKey,
    action_type: args.action_type,
    status: args.required_fields.length > 0 ? "awaiting_clarification" : "open",
    required_fields: args.required_fields,
    filled_fields: args.filled_fields,
    entity_refs: args.entity_refs ?? [],
    idempotency_key: stableIdempotencyKey("draft", args.user_id, draftKey),
    updated_at: new Date().toISOString(),
  };
  const existing = await admin
    .from("linkr_action_drafts")
    .select("id")
    .eq("user_id", args.user_id)
    .eq("draft_key", draftKey)
    .in("status", ["open", "awaiting_clarification"])
    .maybeSingle();

  if (existing.data?.id) {
    return await admin
      .from("linkr_action_drafts")
      .update(row)
      .eq("id", existing.data.id)
      .select("*")
      .maybeSingle();
  }

  return await admin
    .from("linkr_action_drafts")
    .insert(row)
    .select("*")
    .maybeSingle();
}

export async function resolvePublicXHandle(admin: any, handle: string) {
  const normalized = String(handle ?? "").replace(/^@/, "").toLowerCase();
  if (!normalized) return null;
  const { data } = await admin
    .from("profiles")
    .select("user_id,twitter_id,twitter_username,display_name")
    .ilike("twitter_username", normalized)
    .maybeSingle();
  return data ?? null;
}
