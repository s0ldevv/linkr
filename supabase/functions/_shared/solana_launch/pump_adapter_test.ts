import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  estimatePumpFunLaunchFundingFromSimulation,
  fallbackPumpFunLaunchFundingEstimate,
  SOLANA_LAUNCH_FUNDING_LAMPORTS,
} from "./pump_adapter.ts";
import { SOL_LAUNCH_FUNDING_CAP_LAMPORTS } from "./funding.ts";

/** Rent-exempt minimum for a basic Solana account, verified against mainnet. */
const RENT_EXEMPT_MINIMUM_LAMPORTS = 890_880n;

/** Real payer debits observed on mainnet launches, 2026-07-30. */
const OBSERVED_LAUNCH_DEBITS = [7_422_480n, 7_443_360n, 7_464_240n];

Deno.test("launch funding is a flat hardcoded 0.015 SOL", () => {
  assertEquals(SOLANA_LAUNCH_FUNDING_LAMPORTS, 15_000_000n);
});

// The whole point of the constant: funding no longer depends on an estimate, so
// there is no arithmetic left that can under-fund a launch.
Deno.test("both estimator paths fund the same flat amount", () => {
  const fallback = fallbackPumpFunLaunchFundingEstimate({
    creatorRewardsConfig: null,
  });
  assertEquals(fallback.fundingTargetLamports, SOLANA_LAUNCH_FUNDING_LAMPORTS);

  const simulated = estimatePumpFunLaunchFundingFromSimulation({
    simulationValue: {
      preBalances: [1_000_000_000],
      postBalances: [992_460_000],
      fee: 15_000,
      unitsConsumed: 384_000,
    },
    payerIndex: 0,
    feeLamports: 5_000n,
    fallbackMinimumLamports: 20_000_000n,
  });
  assertEquals(simulated.fundingTargetLamports, SOLANA_LAUNCH_FUNDING_LAMPORTS);

  // A missing-balance simulation cannot change what gets funded either.
  const degraded = estimatePumpFunLaunchFundingFromSimulation({
    simulationValue: { fee: 12_000, unitsConsumed: null },
    payerIndex: 0,
    feeLamports: 5_000n,
    fallbackMinimumLamports: 20_000_000n,
  });
  assertEquals(degraded.fundingTargetLamports, SOLANA_LAUNCH_FUNDING_LAMPORTS);
});

Deno.test("the measured launch cost is still recorded for the audit trail", () => {
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
  });
  assertEquals(estimate.minimumLaunchLamports, 7_540_000n);
  assertEquals(estimate.payerDebitLamports, 7_540_000n);
  assertEquals(estimate.feeLamports, 15_000n);
  assertEquals(estimate.simulationUnitsConsumed, 384_000);
  assertEquals(estimate.bufferLamports, 0n);
});

Deno.test("Pump launch fallback estimate excludes dev buy amounts", () => {
  const estimate = fallbackPumpFunLaunchFundingEstimate({
    creatorRewardsConfig: null,
  });
  assertEquals(estimate.minimumLaunchLamports, 20_000_000n);
  assertEquals(estimate.bufferLamports, 0n);
});

// The one property the flat amount has to satisfy. If pump.fun launch costs
// ever grow into this margin, raise SOLANA_LAUNCH_FUNDING_LAMPORTS — this test
// is what will tell you.
Deno.test("the funded amount covers a real launch and leaves the payer rent-exempt", () => {
  for (const debit of OBSERVED_LAUNCH_DEBITS) {
    const remaining = SOLANA_LAUNCH_FUNDING_LAMPORTS - debit;
    assertEquals(remaining > 0n, true, `funding must cover a debit of ${debit}`);
    assertEquals(
      remaining >= RENT_EXEMPT_MINIMUM_LAMPORTS,
      true,
      `debit ${debit} leaves ${remaining}, under the rent floor`,
    );
  }
});

Deno.test("the flat funding amount stays under the funding cap", () => {
  assertEquals(
    SOLANA_LAUNCH_FUNDING_LAMPORTS <= SOL_LAUNCH_FUNDING_CAP_LAMPORTS,
    true,
  );
});
