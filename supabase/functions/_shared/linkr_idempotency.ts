// Database-backed idempotency helpers. Edge-safe; callers provide the Supabase client.

export interface QueueReplyOnceArgs {
  tweet_id: string;
  reply_text: string;
  idempotency_key: string;
  conversation_id?: string | null;
  author_twitter_id?: string | null;
  reply_kind?: string | null;
  prompt_version?: string | null;
  lint_result?: Record<string, unknown> | null;
}

export async function queueReplyOnce(admin: any, args: QueueReplyOnceArgs) {
  const row = {
    tweet_id: args.tweet_id,
    reply_text: args.reply_text,
    status: "pending",
    conversation_id: args.conversation_id ?? null,
    author_twitter_id: args.author_twitter_id ?? null,
    reply_kind: args.reply_kind ?? null,
    prompt_version: args.prompt_version ?? null,
    lint_result: args.lint_result ?? null,
    idempotency_key: args.idempotency_key,
  };
  return insertOrSelect(admin, "twitter_replies", row, "idempotency_key", args.idempotency_key);
}

export async function insertAgentRunOnce(admin: any, row: Record<string, unknown>) {
  const key = String(row.idempotency_key ?? "").trim();
  if (!key) throw new Error("agent run idempotency_key is required");
  return insertOrSelect(admin, "agent_runs", row, "idempotency_key", key);
}

export async function insertPendingActionOnce(admin: any, row: Record<string, unknown>) {
  const key = String(row.idempotency_key ?? "").trim();
  if (!key) throw new Error("pending action idempotency_key is required");
  return insertOrSelect(admin, "pending_actions", row, "idempotency_key", key);
}

export async function upsertConversationState(admin: any, row: Record<string, unknown>) {
  const conversationId = String(row.conversation_id ?? "").trim();
  const participantTwitterId = String(row.participant_twitter_id ?? "").trim();
  if (!conversationId || !participantTwitterId) return { data: null, error: null };
  return await admin
    .from("linkr_conversation_state")
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: "conversation_id,participant_twitter_id" },
    )
    .select("*")
    .maybeSingle();
}

export function stableIdempotencyKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) =>
      String(part ?? "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 120),
    )
    .filter(Boolean)
    .join(":")
    .slice(0, 480);
}

async function insertOrSelect(
  admin: any,
  table: string,
  row: Record<string, unknown>,
  keyColumn: string,
  keyValue: string,
) {
  const inserted = await admin.from(table).insert(row).select("*").maybeSingle();
  if (!inserted.error) return inserted;
  const message = String(inserted.error?.message ?? inserted.error ?? "");
  const code = String(inserted.error?.code ?? "");
  if (code !== "23505" && !/duplicate key|unique/i.test(message)) return inserted;
  return await admin.from(table).select("*").eq(keyColumn, keyValue).maybeSingle();
}
