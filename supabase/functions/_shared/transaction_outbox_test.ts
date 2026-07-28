import { sha256Hex, transactionFence } from "./transaction_outbox.ts";

Deno.test("signed transaction hash is deterministic", async () => {
  const hash = await sha256Hex(
    new TextEncoder().encode("linkr-signed-transaction"),
  );
  if (
    hash !== "31c21564403c49fb0fc9819367b7d4515967ce1bb69da65fd1d7b129085b760f"
  ) {
    throw new Error(`unexpected hash ${hash}`);
  }
});

Deno.test("economic transaction fences require the wallet lease", () => {
  let rejected = false;
  try {
    transactionFence(
      {
        work_item: { id: crypto.randomUUID(), state_version: 3 },
        resource_fencing_token: null,
      },
      {
        workerId: "worker:test",
        stage: "launch_robinhood",
        slot: { slot_number: 1, fencing_token: 4 },
      },
    );
  } catch (error) {
    rejected = String(error).includes("economic_resource_fence_missing");
  }
  if (!rejected) throw new Error("missing resource fence was accepted");
});

Deno.test("economic transaction fences preserve every lease token", () => {
  const workItemId = crypto.randomUUID();
  const fence = transactionFence(
    {
      work_item: { id: workItemId, state_version: 8 },
      resource_fencing_token: 12,
    },
    {
      workerId: "worker:test",
      stage: "launch_solana",
      slot: { slot_number: 2, fencing_token: 9 },
    },
  );
  if (
    fence.workItemId !== workItemId || fence.expectedStateVersion !== 8 ||
    fence.resourceFencingToken !== 12 || fence.slotFencingToken !== 9
  ) {
    throw new Error("transaction fence changed a lease token");
  }
});
