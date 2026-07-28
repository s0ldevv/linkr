import type { MarketChain } from "./market_data/types.ts";

export type NativeBalanceSymbol = "ETH" | "SOL";

type WalletBalanceReplyInput = {
  requestedChain: MarketChain | null;
  ethBalance: number;
  solBalance: number | null;
  hasSolanaWallet: boolean;
};

export const INSUFFICIENT_NATIVE_BALANCE_ERROR_PREFIX = "insufficient_native_balance:";

function formatNativeBalance(value: number): string {
  return value.toFixed(4);
}

export function formatNativeTransactionBalance(value: number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  const decimals = amount >= 1 ? 4 : 6;
  const fixed = amount.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "");
}

export function insufficientNativeBalanceReply(args: {
  symbol: NativeBalanceSymbol;
  currentBalance: number;
  requiredAmount?: number | null;
}): string {
  const current = formatNativeTransactionBalance(args.currentBalance);
  const required = Number(args.requiredAmount ?? 0);
  if (Number.isFinite(required) && required > 0) {
    return `Your balance is too low to cover that transaction. Required: ${formatNativeTransactionBalance(
      required,
    )} ${args.symbol}. Current balance: ${current} ${args.symbol}.`;
  }
  return `Your balance is too low to cover that transaction. Your current balance is ${current} ${args.symbol}.`;
}

export function nativeBalanceIsTooLow(currentBalance: number, requiredAmount: number): boolean {
  const current = Number(currentBalance);
  const required = Number(requiredAmount);
  if (!Number.isFinite(current) || current < 0) return true;
  if (!Number.isFinite(required) || required <= 0) return false;
  return current + 1e-12 < required;
}

export function readNativeBalanceReserve(envName: string, fallback: number): number {
  const value = Number(Deno.env.get(envName));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function nativeAmountWithReserve(amount: unknown, reserve: number): number {
  const base = Number(amount ?? 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const extra = Number.isFinite(reserve) && reserve > 0 ? reserve : 0;
  return base + extra;
}

export function insufficientNativeBalanceErrorMessage(args: {
  symbol: NativeBalanceSymbol;
  currentBalance: number;
  requiredAmount?: number | null;
}): string {
  return INSUFFICIENT_NATIVE_BALANCE_ERROR_PREFIX + insufficientNativeBalanceReply(args);
}

export function insufficientNativeBalanceReplyFromError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith(INSUFFICIENT_NATIVE_BALANCE_ERROR_PREFIX)
    ? message.slice(INSUFFICIENT_NATIVE_BALANCE_ERROR_PREFIX.length)
    : null;
}

export function formatWalletBalanceReply(input: WalletBalanceReplyInput): string {
  if (input.requestedChain === "solana") {
    if (!input.hasSolanaWallet) {
      return "I could not find a Linkr SOL wallet yet. Open Linkr to finish wallet setup.";
    }
    return `Your Linkr SOL balance is ${formatNativeBalance(input.solBalance ?? 0)} SOL. View full portfolio in Linkr.`;
  }

  if (input.requestedChain === "robinhood") {
    return `Your Linkr EVM wallet balance is ${formatNativeBalance(input.ethBalance)} ETH on Robinhood Chain. View full portfolio in Linkr.`;
  }

  if (!input.hasSolanaWallet) {
    return `Balances: ${formatNativeBalance(input.ethBalance)} ETH on Robinhood Chain. I could not find a SOL wallet yet; view Linkr to finish setup.`;
  }

  return `Balances: ${formatNativeBalance(input.ethBalance)} ETH on Robinhood Chain, ${formatNativeBalance(input.solBalance ?? 0)} SOL. View full portfolio in Linkr.`;
}
