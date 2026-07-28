import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { amountFromPercent, ethAmountToWei, formatTokenAmount } from "./amount.ts";

Deno.test("ethAmountToWei converts ETH to wei", () => {
  assertEquals(ethAmountToWei(0.001).toString(), "1000000000000000");
});

Deno.test("ethAmountToWei rejects invalid values", () => {
  assertThrows(() => ethAmountToWei(0), Error, "invalid_swap_eth_amount");
  assertThrows(() => ethAmountToWei(Number.NaN), Error, "invalid_swap_eth_amount");
});

Deno.test("amountFromPercent computes raw sell amount", () => {
  assertEquals(amountFromPercent(1_000_000n, 25).toString(), "250000");
  assertEquals(amountFromPercent(1_000_000n, 12.5).toString(), "125000");
});

Deno.test("amountFromPercent rejects unsafe percentages", () => {
  assertThrows(() => amountFromPercent(1_000_000n, 0), Error, "invalid_sell_percent");
  assertThrows(() => amountFromPercent(1_000_000n, 101), Error, "invalid_sell_percent");
});

Deno.test("formatTokenAmount is concise for replies", () => {
  assertEquals(formatTokenAmount("1000000000000000000", 18), "1");
  assertEquals(formatTokenAmount("123450000", 6), "123.45");
});
