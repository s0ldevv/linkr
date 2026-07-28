import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideLaunchExecution,
  launchRequestSignals,
  zeroLaunchDevBuy,
} from "./launch_execution_policy.ts";

Deno.test("first launch with an explicit Solana chain auto-executes at zero dev buy", () => {
  const signals = launchRequestSignals({ text: "Launch $LINKR on Solana" });
  assertEquals(
    decideLaunchExecution({ firstLaunchSubsidyEligible: true, signals }),
    {
      explicitChain: true,
      explicitDevBuy: false,
      autoExecute: true,
      forceZeroDevBuy: true,
      reason: "first_launch",
    },
  );
});

Deno.test("first launch still requires confirmation when the chain is omitted", () => {
  const signals = launchRequestSignals({
    text: "Launch $LINKR with this image",
    extraction: {
      chain: "robinhood",
      launch_chain_explicit: false,
      dev_buy_original: 0,
      dev_buy_original_unit: "eth",
    },
  });
  assertEquals(
    decideLaunchExecution({ firstLaunchSubsidyEligible: true, signals }).reason,
    "chain_confirmation_required",
  );
});

Deno.test("later launch with explicit chain and dev buy auto-executes", () => {
  const signals = launchRequestSignals({
    text: "Launch $LINKR on Robinhood Chain with a 0.01 ETH dev buy",
  });
  const decision = decideLaunchExecution({
    firstLaunchSubsidyEligible: false,
    signals,
  });
  assertEquals(decision.autoExecute, true);
  assertEquals(decision.reason, "fully_specified");
});

Deno.test("later launch with explicit zero dev buy auto-executes", () => {
  const signals = launchRequestSignals({
    text: "Launch $LINKR on Pump.fun with no dev buy",
  });
  assertEquals(signals, { explicitChain: true, explicitDevBuy: true });
  assertEquals(
    decideLaunchExecution({ firstLaunchSubsidyEligible: false, signals })
      .autoExecute,
    true,
  );
});

Deno.test("later launch with explicit chain and no dev buy uses exact zero", () => {
  const signals = launchRequestSignals({ text: "Launch $LINKR on Solana" });
  const decision = decideLaunchExecution({
    firstLaunchSubsidyEligible: false,
    signals,
  });
  assertEquals(decision.autoExecute, true);
  assertEquals(decision.forceZeroDevBuy, true);
  assertEquals(decision.reason, "explicit_chain_zero_default");
});

Deno.test("extracted launch chain and positive amount are explicit", () => {
  const signals = launchRequestSignals({
    extraction: {
      launch_chain: "solana",
      dev_buy_original: 0.25,
      dev_buy_original_unit: "sol",
    },
  });
  assertEquals(signals, { explicitChain: true, explicitDevBuy: true });
});

Deno.test("zeroLaunchDevBuy clears chain-incompatible values", () => {
  assertEquals(
    zeroLaunchDevBuy({ dev_buy_eth: 1, dev_buy_usd: 100 }, "solana"),
    {
      dev_buy_original: 0,
      dev_buy_original_amount: 0,
      dev_buy_original_unit: "sol",
      dev_buy_usd: null,
      initial_buy_eth: 0,
      initial_buy_sol: 0,
      dev_buy_sol: 0,
    },
  );
});
