import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  launchConfiguration,
  normalizedInitialBuy,
} from "./launch_configuration.ts";

Deno.test("launch configuration defaults to zero without inventing a buy", () => {
  assertEquals(normalizedInitialBuy({}, "solana"), 0);
  assertEquals(normalizedInitialBuy({}, "robinhood"), 0);
  assertEquals(
    launchConfiguration({ id: "work", source_surface: "x" }, {}, "solana")
      .dev_buy_sol,
    0,
  );
});

Deno.test("chain-mismatched and oversized buys are rejected", () => {
  assertThrows(
    () => normalizedInitialBuy({ dev_buy_amount: "0.01 ETH" }, "solana"),
    Error,
    "initial_buy_chain_mismatch",
  );
  assertThrows(
    () => normalizedInitialBuy({ dev_buy_sol: 6 }, "solana"),
    Error,
    "initial_buy_out_of_range",
  );
});
