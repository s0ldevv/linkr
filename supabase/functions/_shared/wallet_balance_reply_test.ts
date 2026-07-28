import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatWalletBalanceReply,
  insufficientNativeBalanceErrorMessage,
  insufficientNativeBalanceReply,
  insufficientNativeBalanceReplyFromError,
} from "./wallet_balance_reply.ts";

Deno.test("formatWalletBalanceReply targets SOL balance requests", () => {
  assertEquals(
    formatWalletBalanceReply({
      requestedChain: "solana",
      ethBalance: 1.23456,
      solBalance: 2.34567,
      hasSolanaWallet: true,
    }),
    "Your Linkr SOL balance is 2.3457 SOL. View full portfolio in Linkr.",
  );
});

Deno.test("formatWalletBalanceReply targets EVM and Robinhood balance requests", () => {
  assertEquals(
    formatWalletBalanceReply({
      requestedChain: "robinhood",
      ethBalance: 0.123456,
      solBalance: 9,
      hasSolanaWallet: true,
    }),
    "Your Linkr EVM wallet balance is 0.1235 ETH on Robinhood Chain. View full portfolio in Linkr.",
  );
});

Deno.test("formatWalletBalanceReply shows both balances for generic wallet requests", () => {
  assertEquals(
    formatWalletBalanceReply({
      requestedChain: null,
      ethBalance: 0.5,
      solBalance: 4,
      hasSolanaWallet: true,
    }),
    "Balances: 0.5000 ETH on Robinhood Chain, 4.0000 SOL. View full portfolio in Linkr.",
  );
});

Deno.test("insufficientNativeBalanceReply includes required and current balance", () => {
  assertEquals(
    insufficientNativeBalanceReply({
      symbol: "ETH",
      currentBalance: 0.1,
      requiredAmount: 0.25,
    }),
    "Your balance is too low to cover that transaction. Required: 0.25 ETH. Current balance: 0.1 ETH.",
  );
});

Deno.test("insufficientNativeBalanceReplyFromError unwraps scheduler-safe errors", () => {
  const message = insufficientNativeBalanceErrorMessage({
    symbol: "SOL",
    currentBalance: 0.00001,
  });
  assertEquals(
    insufficientNativeBalanceReplyFromError(new Error(message)),
    "Your balance is too low to cover that transaction. Your current balance is 0.00001 SOL.",
  );
});
