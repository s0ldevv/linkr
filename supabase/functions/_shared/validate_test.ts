import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateBuy, validateLaunch, validateSell } from "./validate.ts";

const profile = {
  default_slippage_bps: 100,
  max_auto_buy_eth: 0.01,
  max_auto_sell_percent: 50,
  require_confirmation_for_all_tx: false,
};

Deno.test("validateBuy accepts full contract address buys", () => {
  const result = validateBuy({
    extraction: {
      token_address: "0x1234567890abcdef1234567890abcdef12345678",
      amount_original: 0.001,
      amount_original_unit: "eth",
    },
    amount: { amount_eth: 0.001, amount_usd: null, amount_original_unit: "eth" },
    threadMints: [],
    profile,
    ethBalance: 1,
  });
  assertEquals(result.valid, true);
  assertEquals(result.requires_confirmation, false);
  assertEquals(result.normalized_action.output_mint, "0x1234567890abcdef1234567890abcdef12345678");
});

Deno.test("validateBuy rejects cashtag-only buys", () => {
  const result = validateBuy({
    extraction: {
      token_symbol: "CASH",
      amount_original: 0.001,
      amount_original_unit: "eth",
    },
    amount: { amount_eth: 0.001, amount_usd: null, amount_original_unit: "eth" },
    threadMints: [],
    profile,
    ethBalance: 1,
  });
  assertEquals(result.valid, false);
  assertEquals(result.reply_code, "contractAddressRequired");
});

Deno.test("validateBuy requires confirmation for thread context token", () => {
  const result = validateBuy({
    extraction: { amount_original: 0.001, amount_original_unit: "eth" },
    amount: { amount_eth: 0.001, amount_usd: null, amount_original_unit: "eth" },
    threadMints: ["0x1234567890abcdef1234567890abcdef12345678"],
    profile,
    ethBalance: 1,
  });
  assertEquals(result.valid, true);
  assertEquals(result.requires_confirmation, true);
  assertEquals(result.normalized_action.address_source, "thread_context");
});

Deno.test("validateSell requires percent or all amount", () => {
  const result = validateSell({
    extraction: { token_address: "0x1234567890abcdef1234567890abcdef12345678" },
    profile,
    ownsToken: true,
    resolvedMint: "0x1234567890abcdef1234567890abcdef12345678",
  });
  assertEquals(result.valid, false);
  assertEquals(result.reply_code, "missingAmount");
});

Deno.test("validateLaunch accepts an explicitly requested Solana dev buy without a saved cap", () => {
  const result = validateLaunch({
    extraction: {
      coin_name: "Linkr",
      coin_symbol: "LINKR",
      dev_buy_original: 0.1,
      dev_buy_original_unit: "sol",
    },
    hasImage: true,
    launchChain: "solana",
    devBuy: {
      amount_eth: null,
      amount_sol: 0.1,
      amount_usd: null,
      amount_original_unit: "sol",
    },
    profile: { max_auto_dev_buy_sol: 0 },
    solBalance: 1,
  });
  assertEquals(result.valid, true);
  assertEquals(result.requires_confirmation, false);
  assertEquals(result.normalized_action.dev_buy_sol, 0.1);
});

Deno.test("validateLaunch accepts an explicitly requested Robinhood dev buy without a saved cap", () => {
  const result = validateLaunch({
    extraction: {
      coin_name: "Linkr",
      coin_symbol: "LINKR",
      dev_buy_original: 0.01,
      dev_buy_original_unit: "eth",
    },
    hasImage: true,
    launchChain: "robinhood",
    devBuy: {
      amount_eth: 0.01,
      amount_usd: null,
      amount_original_unit: "eth",
    },
    profile: { max_auto_dev_buy_eth: 0 },
    ethBalance: 1,
  });
  assertEquals(result.valid, true);
  assertEquals(result.requires_confirmation, false);
  assertEquals(result.normalized_action.dev_buy_eth, 0.01);
});

Deno.test("validateLaunch forces Robinhood X creator rewards routing to 100 percent", () => {
  const result = validateLaunch({
    extraction: {
      coin_name: "Linkr",
      coin_symbol: "LINKR",
      dev_buy_original: 0,
      dev_buy_original_unit: "eth",
      creator_rewards_recipient_handle: "recipient",
      creator_rewards_share_percent: 25,
      creator_rewards_share_bps: 2_500,
    },
    hasImage: true,
    launchChain: "robinhood",
    devBuy: {
      amount_eth: 0,
      amount_usd: null,
      amount_original_unit: "eth",
    },
    profile: {},
    ethBalance: 0,
  });

  assertEquals(result.valid, true);
  assertEquals(result.normalized_action.creator_rewards_recipient_handle, "recipient");
  assertEquals(result.normalized_action.creator_rewards_share_percent, 100);
  assertEquals(result.normalized_action.creator_rewards_share_bps, 10_000);
});
