import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkXLaunchNativeBalance,
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

Deno.test("launch balance guard uses a lighter Solana intake minimum by default", () => {
  assertEquals(
    minimumLaunchNativeRequirement(
      "solana",
      { name: "Test Token", chain: "solana" },
      () => undefined,
    ).toString(),
    "8000000",
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

Deno.test("launch balance guard allows funding-eligible zero-dev Solana requests", async () => {
  const result = await checkXLaunchNativeBalance({
    admin: adminWithWallet("11111111111111111111111111111111"),
    userId: "user-1",
    chain: "solana",
    fields: { name: "Test Token", chain: "solana" },
    deps: {
      getSolBalanceLamports: async () => 0,
      isLaunchFundingEligible: async (_admin, userId, options) => {
        assertEquals(userId, "user-1");
        assertEquals(options.chain, "solana");
        return true;
      },
      env: (name) => name === "X_LAUNCH_MIN_BALANCE_SOL" ? "0.02" : undefined,
    },
  });
  if (!result.ok) throw new Error(result.replyKind);
  assertEquals(result.fundingExpected, true);
  assertEquals(result.requiredRaw, 20_000_000n);
});

Deno.test("launch balance guard still rejects when launch funding is disabled", async () => {
  const result = await checkXLaunchNativeBalance({
    admin: adminWithWallet("11111111111111111111111111111111"),
    userId: "user-1",
    chain: "solana",
    fields: { name: "Test Token", chain: "solana" },
    deps: {
      getSolBalanceLamports: async () => 0,
      isLaunchFundingEligible: async () => false,
      env: (name) => name === "X_LAUNCH_MIN_BALANCE_SOL" ? "0.02" : undefined,
    },
  });
  assertEquals(result.ok, false);
  if (result.ok) throw new Error("expected rejection");
  assertEquals(result.replyKind, "launch_insufficient_intake_balance");
});

Deno.test("launch balance guard does not fund explicit positive dev buys", async () => {
  let eligibilityChecked = false;
  const result = await checkXLaunchNativeBalance({
    admin: adminWithWallet("11111111111111111111111111111111"),
    userId: "user-1",
    chain: "solana",
    fields: {
      name: "Test Token",
      chain: "solana",
      dev_buy_amount: "0.01 SOL",
    },
    deps: {
      getSolBalanceLamports: async () => 0,
      isLaunchFundingEligible: async () => {
        eligibilityChecked = true;
        return true;
      },
      env: (name) => name === "X_LAUNCH_MIN_BALANCE_SOL" ? "0.02" : undefined,
    },
  });
  assertEquals(result.ok, false);
  assertEquals(eligibilityChecked, false);
});

function adminWithWallet(address: string) {
  return {
    from(table: string) {
      if (table !== "wallets") {
        throw new Error(`unexpected_table:${table}`);
      }
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle: async () => ({
          data: {
            id: "wallet-1",
            address,
            public_key: address,
            wallet_type: "solana",
            chain_id: null,
          },
          error: null,
        }),
      };
      return query;
    },
  };
}
