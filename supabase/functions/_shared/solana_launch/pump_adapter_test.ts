import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  estimatePumpFunLaunchFundingFromSimulation,
  fallbackPumpFunLaunchFundingEstimate,
  PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS,
  pumpFunLaunchFundingBufferLamports,
} from "./pump_adapter.ts";
import { SOL_LAUNCH_FUNDING_CAP_LAMPORTS } from "./funding.ts";

/** Rent-exempt minimum for a basic Solana account, verified against mainnet. */
const RENT_EXEMPT_MINIMUM_LAMPORTS = 890_880n;

Deno.test("Pump launch fallback estimate excludes dev buy amounts", () => {
  const estimate = fallbackPumpFunLaunchFundingEstimate({
    creatorRewardsConfig: null,
  });
  assertEquals(estimate.minimumLaunchLamports, 20_000_000n);
  assertEquals(
    estimate.fundingTargetLamports,
    20_000_000n + PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS,
  );
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
  assertEquals(
    estimate.fundingTargetLamports,
    7_690_000n + PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS,
  );
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
  assertEquals(
    estimate.fundingTargetLamports,
    20_000_000n + PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS,
  );
  assertEquals(estimate.payerDebitLamports, 12_000n);
});

// The production failure of 2026-07-30: funded to exactly the estimate, the
// payer was left with 150,000 lamports — 740,880 below the rent-exempt floor —
// and the launch was rejected with InsufficientFundsForRent on account 0.
Deno.test("a funded launch wallet stays rent-exempt after the launch debits it", () => {
  const estimate = estimatePumpFunLaunchFundingFromSimulation({
    simulationValue: {
      preBalances: [1_019_269_138],
      postBalances: [1_011_846_658], // debit of 7_422_480, the real incident
      fee: 24_000,
      unitsConsumed: 99_685,
    },
    payerIndex: 0,
    feeLamports: 5_000n,
    fallbackMinimumLamports: 20_000_000n,
    bufferLamports: 150_000n,
  });

  assertEquals(estimate.payerDebitLamports, 7_422_480n);
  const remaining = estimate.fundingTargetLamports -
    estimate.payerDebitLamports;
  assertEquals(remaining >= RENT_EXEMPT_MINIMUM_LAMPORTS, true);
  // Under the old target of debit + buffer this was 150_000 and the launch died.
  assertEquals(remaining, 150_000n + PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS);
});

Deno.test("the rent headroom exceeds the rent-exempt floor it exists to clear", () => {
  assertEquals(
    PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS > RENT_EXEMPT_MINIMUM_LAMPORTS,
    true,
  );
  // The buffer knob cannot express this: it is capped far below the floor.
  assertEquals(
    pumpFunLaunchFundingBufferLamports(() => "99999999") <
      RENT_EXEMPT_MINIMUM_LAMPORTS,
    true,
  );
});

// Funding is skipped outright when the deficit exceeds the cap, so every
// fundable estimate has to stay underneath it — including the fallback reserve,
// which previously sat exactly at the old 0.02 SOL ceiling.
Deno.test("every funding target still fits under the funding cap", () => {
  const fallback = fallbackPumpFunLaunchFundingEstimate({
    creatorRewardsConfig: null,
  });
  assertEquals(
    fallback.fundingTargetLamports <= SOL_LAUNCH_FUNDING_CAP_LAMPORTS,
    true,
  );

  const simulated = estimatePumpFunLaunchFundingFromSimulation({
    simulationValue: {
      preBalances: [1_019_269_138],
      postBalances: [1_011_846_658],
      fee: 24_000,
      unitsConsumed: 99_685,
    },
    payerIndex: 0,
    feeLamports: 5_000n,
    fallbackMinimumLamports: 20_000_000n,
    bufferLamports: 150_000n,
  });
  assertEquals(
    simulated.fundingTargetLamports <= SOL_LAUNCH_FUNDING_CAP_LAMPORTS,
    true,
  );
});
