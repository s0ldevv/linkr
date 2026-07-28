// deno-lint-ignore-file no-explicit-any

// Surface-aware launch notifications. X launches reply in-thread; every other
// surface gets a linkr_action_receipts row, which terminal/dashboard/agent
// clients already read (RLS-scoped to the owning user).
export async function notifyLaunchUser(admin: any, args: {
  workItemId: string;
  sourceSurface: string;
  userId: string;
  launchId: string;
  chain: string;
  status: string;
  kind: string;
  text: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (args.sourceSurface === "x") {
    const result = await admin.rpc("enqueue_linkr_x_reply_v1", {
      p_parent_work_item_id: args.workItemId,
      p_reply_text: args.text.slice(0, 280),
      p_kind: args.kind,
      p_version: 1,
      p_priority: 80,
    });
    if (result.error) throw result.error;
    return;
  }

  // One receipt per launch+status: a retried pause does not spam the feed.
  const existing = await admin.from("linkr_action_receipts")
    .select("id")
    .eq("user_id", args.userId)
    .eq("canonical_record_id", args.launchId)
    .eq("status", args.status)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;

  const pendingResult = await admin.from("linkr_pending_actions")
    .select(
      "id,surface,surface_conversation_id,terminal_conversation_id,x_thread_id,cron_job_id",
    )
    .eq("work_item_id", args.workItemId)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pendingResult.error) throw pendingResult.error;
  const pending = pendingResult.data;

  const inserted = await admin.from("linkr_action_receipts").insert({
    user_id: args.userId,
    surface: pending?.surface ?? args.sourceSurface,
    source_surface: args.sourceSurface,
    surface_conversation_id: pending?.surface_conversation_id ?? null,
    terminal_conversation_id: pending?.terminal_conversation_id ?? null,
    x_thread_id: pending?.x_thread_id ?? null,
    cron_job_id: pending?.cron_job_id ?? null,
    pending_action_id: pending?.id ?? null,
    work_item_id: args.workItemId,
    receipt_type: "launch_coin",
    status: args.status,
    summary: args.text.slice(0, 500),
    chain: args.chain,
    canonical_record_type: "coin_launch",
    canonical_record_id: args.launchId,
    payload: { kind: args.kind, ...args.payload ?? {} },
  });
  if (inserted.error) throw inserted.error;
}
