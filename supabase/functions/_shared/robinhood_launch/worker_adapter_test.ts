import { buildLaunchSalt } from "./worker_adapter.ts";

Deno.test("Robinhood launch salt is deterministic and action-specific", () => {
  const base = {
    launchId: "00000000-0000-4000-8000-000000000001",
    name: "Test",
    symbol: "test",
    metadataURI: "https://example.com/metadata.json",
    initialBuyWei: 0n,
  };
  const first = buildLaunchSalt(base);
  const second = buildLaunchSalt({ ...base });
  const other = buildLaunchSalt({ ...base, symbol: "OTHER" });
  if (!/^0x[a-f0-9]{64}$/.test(first) || first !== second || first === other) {
    throw new Error("launch fingerprint is not deterministic and unique");
  }
});
