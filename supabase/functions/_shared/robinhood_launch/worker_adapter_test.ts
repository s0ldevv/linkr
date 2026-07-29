import {
  buildLaunchSalt,
  generateLaunchSaltSeed,
  normalizeLaunchSaltSeed,
} from "./worker_adapter.ts";

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

Deno.test("Robinhood launch salt honors a durable random seed", () => {
  const saltSeed =
    "0x1111111111111111111111111111111111111111111111111111111111111111";
  const salt = buildLaunchSalt({
    launchId: "00000000-0000-4000-8000-000000000001",
    name: "Test",
    symbol: "test",
    metadataURI: "https://example.com/metadata.json",
    initialBuyWei: 0n,
    saltSeed,
  });
  if (salt !== saltSeed) throw new Error("durable salt seed was not honored");
});

Deno.test("Robinhood launch salt seeds are valid nonzero bytes32 values", () => {
  const seed = generateLaunchSaltSeed();
  if (!/^0x[a-f0-9]{64}$/.test(seed)) {
    throw new Error("generated salt seed is not bytes32 hex");
  }
  if (normalizeLaunchSaltSeed(seed) !== seed) {
    throw new Error("generated salt seed does not normalize");
  }
  if (normalizeLaunchSaltSeed(crypto.randomUUID()) !== null) {
    throw new Error("invalid salt seed normalized");
  }
  if (
    normalizeLaunchSaltSeed(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ) !== null
  ) {
    throw new Error("zero salt seed normalized");
  }
});
