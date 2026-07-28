import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deterministicSymbol,
  enrichLaunchFields,
  normalizeDevBuy,
  resolveDevBuy,
} from "./launch_enrichment.ts";

Deno.test("deterministic launch enrichment preserves user fields and explicit chain", async () => {
  const result = await enrichLaunchFields({
    name: "Test Token",
    chain: "solana",
    symbol: "TST",
    description: "User supplied description",
    image_prompt: "User supplied square logo",
  });
  assertEquals(result.fields.chain, "solana");
  assertEquals(result.fields.symbol, "TST");
  assertEquals(result.fields.description, "User supplied description");
  assertEquals(result.fields.dev_buy_amount, "0 SOL");
  assertEquals(result.provenance.symbol, "user_text");
});

Deno.test("enrichment refuses to invent a chain", async () => {
  await assertRejects(
    () => enrichLaunchFields({ name: "Test Token" }),
    Error,
    "explicit_launch_chain_missing",
  );
});

Deno.test("enrichment normalizes a leading description separator", async () => {
  const result = await enrichLaunchFields({
    name: "Test Token",
    chain: "solana",
    symbol: "TST",
    description: ": this is a test token",
    image_prompt: "User supplied square logo",
  });
  assertEquals(result.fields.description, "this is a test token");
});

Deno.test("fallback symbol is stable and valid", () => {
  assertEquals(deterministicSymbol("!"), deterministicSymbol("!"));
  assertEquals(/^[A-Z0-9]{2,10}$/.test(deterministicSymbol("!")), true);
});

Deno.test("wallet-rule default dev buy applies only when the user omitted an amount", () => {
  const walletRule = resolveDevBuy({ name: "T", chain: "solana" }, {
    devBuySol: 0.25,
    firstLaunchSubsidyEligible: false,
  });
  assertEquals(walletRule.amount, "0.25 SOL");
  assertEquals(walletRule.provenance, "wallet_rules");

  const explicit = resolveDevBuy(
    { name: "T", chain: "solana", dev_buy_amount: "1 SOL" },
    { devBuySol: 0.25, firstLaunchSubsidyEligible: false },
  );
  assertEquals(explicit.amount, "1 SOL");
  assertEquals(explicit.provenance, "user_text");
});

Deno.test("subsidized first launch forces zero dev buy over the wallet rule", () => {
  const subsidized = resolveDevBuy({ name: "T", chain: "solana" }, {
    devBuySol: 0.25,
    firstLaunchSubsidyEligible: true,
  });
  assertEquals(subsidized.amount, "0 SOL");
  assertEquals(subsidized.provenance, "deterministic_fallback");
});

Deno.test("out-of-range or zero wallet-rule defaults fall back to zero", () => {
  assertEquals(
    resolveDevBuy({ name: "T", chain: "solana" }, { devBuySol: 0 }).amount,
    "0 SOL",
  );
  assertEquals(
    resolveDevBuy({ name: "T", chain: "solana" }, { devBuySol: 9 }).amount,
    "0 SOL",
  );
  assertEquals(
    resolveDevBuy({ name: "T", chain: "robinhood" }, { devBuyEth: 0.05 })
      .amount,
    "0.05 ETH",
  );
});

Deno.test("dev buy defaults to zero and cannot cross chains", () => {
  assertEquals(normalizeDevBuy(undefined, "robinhood"), "0 ETH");
  assertEquals(normalizeDevBuy("0.01 ETH", "robinhood"), "0.01 ETH");
  assertThrows(
    () => normalizeDevBuy("0.01 ETH", "solana"),
    Error,
    "initial_buy_chain_mismatch",
  );
});
