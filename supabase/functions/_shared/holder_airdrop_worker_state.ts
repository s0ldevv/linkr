export const HOLDER_AIRDROP_PERSISTED_BATCH_STATUSES = [
  "signed",
  "broadcasting",
  "broadcast",
  "reconciling",
] as const;

export type HolderAirdropPersistedBatchStatus =
  (typeof HOLDER_AIRDROP_PERSISTED_BATCH_STATUSES)[number];

export type HolderAirdropWorkerBatch = {
  status: string;
};

export type HolderAirdropPersistedBatchAction =
  | "broadcast_once"
  | "reconcile_only"
  | "ignore";

export function isPersistedHolderAirdropBatch(
  batch: HolderAirdropWorkerBatch | null | undefined,
): batch is HolderAirdropWorkerBatch & {
  status: HolderAirdropPersistedBatchStatus;
} {
  return !!batch &&
    (HOLDER_AIRDROP_PERSISTED_BATCH_STATUSES as readonly string[]).includes(
      batch.status,
    );
}

export function shouldProcessPersistedBatchBeforeRevalidation(args: {
  airdropStatus: string;
  batch: HolderAirdropWorkerBatch | null | undefined;
}): boolean {
  return args.airdropStatus !== "completed" &&
    isPersistedHolderAirdropBatch(args.batch);
}

export function persistedBatchAction(
  batch: HolderAirdropWorkerBatch,
): HolderAirdropPersistedBatchAction {
  if (batch.status === "signed") return "broadcast_once";
  if (
    batch.status === "broadcasting" || batch.status === "broadcast" ||
    batch.status === "reconciling"
  ) {
    return "reconcile_only";
  }
  return "ignore";
}
