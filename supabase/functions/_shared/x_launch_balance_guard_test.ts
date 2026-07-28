import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  insufficientBalanceReply,
  minimumLaunchNativeRequirement,
  resolveGuardedLaunchChain,
} from "./x_launch_balance_guard.ts";

Deno.test("launch balance guard resolves deterministic or draft chain only", () => {
  assertEquals(
    resolveGuardedLaunchChain({
      incomingFields: { chain: "solana" },
    }),
    "solana",
  );
  assertEquals(
    resolveGuardedLaunchChain({
      existingFields: { chain: "robinhood" },
      incomingFields: { name: "Test" },
    }),
    "robinhood",
  );
  assertEquals(
    resolveGuardedLaunchChain({
      existingFields: { chain: "robinhood" },
      incomingFields: { chain_ambiguous: true },
    }),
    null,
  );
});

Deno.test("launch balance guard includes explicit dev buy in minimum", () => {
  const env = (name: string) =>
    name === "X_LAUNCH_MIN_BALANCE_ETH" ? "0.0005" : undefined;
  assertEquals(
    minimumLaunchNativeRequirement(
      "robinhood",
      { dev_buy_amount: "0.01 ETH" },
      env,
    ).toString(),
    "10500000000000000",
  );
});

Deno.test("launch balance guard no-balance reply is explicit", () => {
  const reply = insufficientBalanceReply(
    "solana",
    0n,
    20_000_000n,
  );
  assertMatch(reply, /has no SOL/);
  assertMatch(reply, /send the launch again/);
});
