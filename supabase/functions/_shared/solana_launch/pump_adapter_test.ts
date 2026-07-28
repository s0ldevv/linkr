import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  estimatePumpFunLaunchFundingFromSimulation,
  fallbackPumpFunLaunchFundingEstimate,
  pumpFunLaunchFundingBufferLamports,
} from "./pump_adapter.ts";

Deno.test("Pump launch fallback estimate excludes dev buy amounts", () => {
  const estimate = fallbackPumpFunLaunchFundingEstimate({
    creatorRewardsConfig: null,
  });
  assertEquals(estimate.minimumLaunchLamports, 20_000_000n);
  assertEquals(estimate.fundingTargetLamports, 20_000_000n);
  assertEquals(estimate.bufferLamports, 0n);
});

Deno.test("Pump launch funding buffer is tiny and capped", () => {
  assertEquals(pumpFunLaunchFundingBufferLamports(() => undefined), 150_000n);
  assertEquals(
    pumpFunLaunchFundingBufferLamports((name) =>
      name === "PUMP_FUN_LAUNCH_FUNDING_BUFFER_LAMPORTS" ? "250000" : undefined
    ),
    250_000n,
  );
  assertEquals(
    pumpFunLaunchFundingBufferLamports((name) =>
      name === "PUMP_FUN_LAUNCH_FUNDING_BUFFER_LAMPORTS" ? "900000" : undefined
    ),
    300_000n,
  );
});

Deno.test("Pump launch estimate uses simulated payer debit plus buffer", () => {
  const estimate = estimatePumpFunLaunchFundingFromSimulation({
    simulationValue: {
      preBalances: [1_000_000_000],
      postBalances: [992_460_000],
      fee: 15_000,
      unitsConsumed: 384_000,
    },
    payerIndex: 0,
    feeLamports: 5_000n,
    fallbackMinimumLamports: 20_000_000n,
    bufferLamports: 150_000n,
  });
  assertEquals(estimate.minimumLaunchLamports, 7_540_000n);
  assertEquals(estimate.fundingTargetLamports, 7_690_000n);
  assertEquals(estimate.feeLamports, 15_000n);
  assertEquals(estimate.simulationUnitsConsumed, 384_000);
});

Deno.test("Pump launch estimate stays conservative when balances are missing", () => {
  const estimate = estimatePumpFunLaunchFundingFromSimulation({
    simulationValue: { fee: 12_000, unitsConsumed: null },
    payerIndex: 0,
    feeLamports: 5_000n,
    fallbackMinimumLamports: 20_000_000n,
    bufferLamports: 150_000n,
  });
  assertEquals(estimate.minimumLaunchLamports, 20_000_000n);
  assertEquals(estimate.bufferLamports, 0n);
  assertEquals(estimate.fundingTargetLamports, 20_000_000n);
  assertEquals(estimate.payerDebitLamports, 12_000n);
});
