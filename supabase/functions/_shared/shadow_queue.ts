// deno-lint-ignore-file no-explicit-any
import type { StageClaim } from "./queue_contracts.ts";

export function shadowQueueEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(
    Deno.env.get("LINKR_QUEUE_SHADOW_ENABLED")?.trim() ?? "",
  );
}

export async function acceptShadowWork(
  admin: any,
  input: Record<string, unknown>,
): Promise<void> {
  if (!shadowQueueEnabled()) return;
  const result = await admin.rpc("accept_linkr_work_item", {
    ...input,
    p_consumer_version: "shadow-v1",
    p_execution_generation: 0,
  });
  if (result.error) throw result.error;
}

export async function recordShadowReceipt(admin: any, claim: StageClaim) {
  const item = claim.work_item as StageClaim["work_item"] & {
    consumer_version?: string;
  };
  if (item.consumer_version !== "shadow-v1") {
    throw new Error("non_shadow_work_rejected_by_shadow_drainer");
  }
  const result = await admin.from("linkr_shadow_receipts").upsert({
    work_item_id: item.id,
    source_surface: item.source_surface,
    source_event_id: item.source_event_id,
    route: item.route,
    payload_hash: item.payload_hash,
    validated_at: new Date().toISOString(),
  }, { onConflict: "work_item_id", ignoreDuplicates: true });
  if (result.error) throw result.error;
}

export async function acceptShadowXPage(
  admin: any,
  tweetIds: string[],
): Promise<void> {
  if (!shadowQueueEnabled() || tweetIds.length === 0) return;
  const unique = [...new Set(tweetIds)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const result = await admin.rpc("accept_shadow_x_page", {
      p_tweet_ids: unique.slice(offset, offset + 100),
    });
    if (result.error) throw result.error;
  }
}
