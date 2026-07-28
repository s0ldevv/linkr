import { ethers } from "https://esm.sh/ethers@6";
import { insufficientNativeBalanceErrorMessage } from "../wallet_balance_reply.ts";

export function ethAmountToWei(amountEth: number): bigint {
  if (!Number.isFinite(amountEth) || amountEth <= 0) throw new Error("invalid_swap_eth_amount");
  return ethers.parseEther(String(amountEth));
}

export function applyGasPadding(gasWei: bigint, paddingBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.floor(paddingBps)));
  return (gasWei * (10_000n + bps)) / 10_000n;
}

export function ensureEnoughEthForBuy(args: {
  balanceWei: bigint;
  inputWei: bigint;
  estimatedGasWei: bigint | null;
  gasPaddingBps: number;
}): void {
  const gas =
    args.estimatedGasWei == null ? 0n : applyGasPadding(args.estimatedGasWei, args.gasPaddingBps);
  const requiredWei = args.inputWei + gas;
  if (args.balanceWei < requiredWei) {
    throw new Error(
      insufficientNativeBalanceErrorMessage({
        symbol: "ETH",
        currentBalance: Number(ethers.formatEther(args.balanceWei)),
        requiredAmount: Number(ethers.formatEther(requiredWei)),
      }),
    );
  }
}

export function amountFromPercent(balanceWei: bigint, percent: number): bigint {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
    throw new Error("invalid_sell_percent");
  return (balanceWei * BigInt(Math.floor(percent * 10_000))) / 1_000_000n;
}

export function formatTokenAmount(
  rawWei: string | bigint | null | undefined,
  decimals: number,
): string {
  if (rawWei == null) return "unknown";
  try {
    const formatted = ethers.formatUnits(BigInt(rawWei), decimals);
    const n = Number(formatted);
    if (!Number.isFinite(n)) return formatted;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
    if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, "");
    if (n >= 0.0001) return n.toFixed(6).replace(/\.?0+$/, "");
    return n.toPrecision(4);
  } catch (_) {
    return "unknown";
  }
}
