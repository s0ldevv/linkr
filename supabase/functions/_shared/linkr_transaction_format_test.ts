import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatTransactionAmount } from "../../../src/lib/linkr/transaction-format.ts";

Deno.test("transaction amount formatter renders Solana native amounts", () => {
  assertEquals(
    formatTransactionAmount({
      amount_eth: null,
      amount_sol: 0.005,
      chain: "solana",
    }),
    "0.005 SOL",
  );
});

Deno.test("transaction amount formatter renders Ethereum native amounts", () => {
  assertEquals(
    formatTransactionAmount({
      amount_eth: 0.0015,
      amount_sol: null,
      chain: "robinhood",
    }),
    "0.0015 ETH",
  );
});

Deno.test("transaction amount formatter preserves original USD spends", () => {
  const formatted = formatTransactionAmount({
    amount_original: 12.5,
    amount_original_unit: "usd",
    amount_sol: 0.05,
    chain: "solana",
  });
  assertStringIncludes(formatted, "12.50");
});
