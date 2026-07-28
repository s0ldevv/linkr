import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { explicitHandle } from "./solana_recipient.ts";
import { solanaSwapFeeReserveLamports } from "./solana_swap/constants.ts";
import { formatUsdcRaw, parseUsdcToRaw } from "./solana_usdc.ts";

Deno.test("USDC parsing preserves all six decimal places exactly", () => {
  assertEquals(parseUsdcToRaw("1").toString(), "1000000");
  assertEquals(parseUsdcToRaw("0.000001").toString(), "1");
  assertEquals(parseUsdcToRaw("123456.123456").toString(), "123456123456");
  assertEquals(formatUsdcRaw(123456123456n), "123456.123456");
});

Deno.test("USDC parsing rejects rounding, exponent notation, signs, and zero", () => {
  for (const value of ["0", "1.0000001", "1e3", "-1", "+1", "1."]) {
    assertThrows(() => parseUsdcToRaw(value));
  }
});

Deno.test("recipient handles must be one explicit X handle", () => {
  assertEquals(explicitHandle("@Alice_123"), "alice_123");
  assertEquals(explicitHandle("Alice_123"), null);
  assertEquals(explicitHandle("send to @Alice_123"), null);
  assertEquals(explicitHandle("@handle-that-is-too-long"), null);
});

Deno.test("swap fee reserve includes the configured priority cap and ATA safety buffer", () => {
  assertEquals(solanaSwapFeeReserveLamports(1_000_000, false), 1_010_000n);
  assertEquals(solanaSwapFeeReserveLamports(1_000_000, true), 3_100_000n);
  assertThrows(() => solanaSwapFeeReserveLamports(10_000_001, false));
});
