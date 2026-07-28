import { LAMPORTS_PER_SOL } from "../solana_chain.ts";

export function solToLamportsString(value: number | string): string {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) throw new Error("invalid_sol_amount");
  const [whole, fraction = ""] = text.split(".");
  const lamports =
    BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt((fraction + "0".repeat(9)).slice(0, 9));
  if (lamports <= 0n) throw new Error("amount_must_be_positive");
  return lamports.toString();
}

export function amountFromPercent(rawBalance: bigint, percent: number): bigint {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return 0n;
  return (rawBalance * BigInt(Math.floor(percent * 10_000))) / 1_000_000n;
}

export function formatTokenAmount(
  raw: string | bigint | null | undefined,
  decimals: number,
): string {
  if (raw == null) return "0";
  const value = typeof raw === "bigint" ? raw : BigInt(String(raw));
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toString();
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const trimmed =
    fractionText.length > 6 ? fractionText.slice(0, 6).replace(/0+$/, "") : fractionText;
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}
