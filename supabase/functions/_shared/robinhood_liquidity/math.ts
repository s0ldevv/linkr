import { ethers } from "https://esm.sh/ethers@6";

export const Q192 = 2n ** 192n;

export function snapTick(tick: number, spacing: number, direction: "down" | "up"): number {
  if (!Number.isFinite(tick) || !Number.isFinite(spacing) || spacing <= 0) {
    throw new Error("invalid_tick_or_spacing");
  }
  const quotient = tick / spacing;
  const snapped =
    direction === "down" ? Math.floor(quotient) * spacing : Math.ceil(quotient) * spacing;
  return Math.trunc(snapped);
}

export function defaultWideRange(args: {
  currentTick: number;
  spacing: number;
  width: number;
  multiplier: number;
  fallbackLower?: number | null;
  fallbackUpper?: number | null;
}): { tickLower: number; tickUpper: number } {
  const halfWidth = Math.max(args.spacing, Math.floor(args.width * args.multiplier));
  let lower = snapTick(args.currentTick - halfWidth, args.spacing, "down");
  let upper = snapTick(args.currentTick + halfWidth, args.spacing, "up");
  if (lower >= upper && args.fallbackLower != null && args.fallbackUpper != null) {
    lower = snapTick(args.fallbackLower, args.spacing, "down");
    upper = snapTick(args.fallbackUpper, args.spacing, "up");
  }
  if (lower >= upper) throw new Error("invalid_liquidity_range");
  return { tickLower: lower, tickUpper: upper };
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.floor(slippageBps))));
  return (amount * (10_000n - bps)) / 10_000n;
}

export function parseTokenUnits(value: unknown, decimals: number): bigint | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("invalid_token_amount");
  return ethers.parseUnits(text, decimals);
}

export function parseEthUnits(value: unknown): bigint {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("invalid_eth_amount");
  const wei = ethers.parseEther(text);
  if (wei <= 0n) throw new Error("amount_must_be_positive");
  return wei;
}

export function formatUnitsSafe(
  value: string | bigint | null | undefined,
  decimals = 18,
  digits = 6,
): string {
  if (value == null) return "0";
  const raw = typeof value === "bigint" ? value : BigInt(String(value || "0"));
  const formatted = ethers.formatUnits(raw, decimals);
  const number = Number(formatted);
  if (!Number.isFinite(number)) return formatted;
  if (number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function estimateCounterpartAmount(args: {
  wethAmountWei: bigint;
  sqrtPriceX96: bigint;
  tokenIsToken0: boolean;
  tokenDecimals: number;
}): bigint {
  if (args.wethAmountWei <= 0n || args.sqrtPriceX96 <= 0n) return 0n;
  const sqrtSquared = args.sqrtPriceX96 * args.sqrtPriceX96;
  const tokenScale = 10n ** BigInt(args.tokenDecimals);
  const wethScale = 10n ** 18n;
  if (args.tokenIsToken0) {
    return (args.wethAmountWei * Q192 * tokenScale) / (sqrtSquared * wethScale);
  }
  return (args.wethAmountWei * sqrtSquared * tokenScale) / (Q192 * wethScale);
}
