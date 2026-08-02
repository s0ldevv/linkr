import {
  buildLaunchSalt,
  generateLaunchSaltSeed,
  type LaunchPreflight,
  launchFundingTargetWei,
  normalizeLaunchSaltSeed,
} from "./worker_adapter.ts";

function preflight(requiredBalanceWei: bigint): LaunchPreflight {
  return {
    factoryAddress: "0xdf669618137Ae2351D2D68962db0a4F5C28d45FA",
    signerAddress: "0x2C1618bc46E3ec80abB0565D3451D624113b09C2",
    predictedToken: "0x98dAd16350fF1580f77584A33b94804cd45ba6d9",
    launchFeeWei: 0n,
    initialBuyWei: 0n,
    totalMsgValueWei: 0n,
    gasEstimate: 6_224_081n,
    gasLimit: 7_468_897n,
    gasPriceWei: 20_190_000n,
    estimatedGasCostWei: requiredBalanceWei,
    requiredBalanceWei,
    signerBalanceWei: 0n,
  };
}

Deno.test("Launch funding covers the gas-price swing between preflights", () => {
  // Measured live on chain 4663 at the worker's 3s retry cadence: the gas
  // estimate never moved (6,224,081) but the price did on every sample, and
  // the resulting requirement ranged over these two values. Funding the exact
  // deficit at the low end leaves the launch short at the high end, which is
  // the retry loop this headroom exists to prevent.
  const lowestRequiredWei = 149_377_940_000_000n;
  const highestRequiredWei = 152_425_249_976_000n;

  const funded = launchFundingTargetWei(preflight(lowestRequiredWei));
  if (funded <= highestRequiredWei) {
    throw new Error(
      `funding target ${funded} does not cover observed peak requirement ${highestRequiredWei}`,
    );
  }
  if (funded !== lowestRequiredWei + lowestRequiredWei * 25n / 100n) {
    throw new Error("default headroom is not 25%");
  }
});

Deno.test("Launch funding headroom is configurable and bounded", () => {
  const key = "ROBINHOOD_LAUNCH_FUNDING_HEADROOM_BPS";
  const original = Deno.env.get(key);
  const restore = () =>
    original === undefined ? Deno.env.delete(key) : Deno.env.set(key, original);
  try {
    Deno.env.set(key, "1000");
    if (launchFundingTargetWei(preflight(1_000_000n)) !== 1_100_000n) {
      throw new Error("explicit headroom override was not applied");
    }
    // A typo must fall back to the default, never scale the transfer.
    for (const bogus of ["999999", "abc", "-100", "", "10001"]) {
      Deno.env.set(key, bogus);
      if (launchFundingTargetWei(preflight(1_000_000n)) !== 1_250_000n) {
        throw new Error(`unsafe headroom "${bogus}" was not rejected`);
      }
    }
    // Nothing required means nothing funded, at any headroom.
    Deno.env.set(key, "2500");
    if (launchFundingTargetWei(preflight(0n)) !== 0n) {
      throw new Error("headroom invented a transfer with nothing required");
    }
  } finally {
    restore();
  }
});

Deno.test("Robinhood launch salt is deterministic and action-specific", () => {
  const base = {
    launchId: "00000000-0000-4000-8000-000000000001",
    name: "Test",
    symbol: "test",
    metadataURI: "https://example.com/metadata.json",
    logoURI: "ipfs://example-logo",
    description: "Launch metadata",
    website: "https://linkr.cash",
    twitter: "https://x.com/linkrcash",
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
    logoURI: "ipfs://example-logo",
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
