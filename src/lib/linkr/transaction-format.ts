import { formatEth, formatUsd } from "./format.ts";

export type TransactionAmountLike = {
  amount_eth?: number | string | null;
  amount_original?: number | string | null;
  amount_original_unit?: string | null;
  amount_sol?: number | string | null;
  amount_usd?: number | string | null;
  chain?: string | null;
  native_symbol?: string | null;
};

export function formatTransactionAmount(tx: TransactionAmountLike): string {
  const originalUnit = normalizeUnit(tx.amount_original_unit);
  if (tx.amount_original != null && originalUnit) {
    if (originalUnit === "USD") return formatUsd(tx.amount_original);
    return `${formatEth(tx.amount_original, 6)} ${originalUnit}`;
  }

  if (tx.amount_usd != null) return formatUsd(tx.amount_usd);

  const nativeSymbol = normalizeUnit(tx.native_symbol);
  if (nativeSymbol === "SOL" && tx.amount_sol != null) {
    return `${formatEth(tx.amount_sol, 6)} SOL`;
  }
  if (nativeSymbol === "ETH" && tx.amount_eth != null) {
    return `${formatEth(tx.amount_eth, 6)} ETH`;
  }

  if (String(tx.chain ?? "").toLowerCase() === "solana" && tx.amount_sol != null) {
    return `${formatEth(tx.amount_sol, 6)} SOL`;
  }
  if (tx.amount_eth != null) return `${formatEth(tx.amount_eth, 6)} ETH`;
  if (tx.amount_sol != null) return `${formatEth(tx.amount_sol, 6)} SOL`;

  return "--";
}

function normalizeUnit(value: string | null | undefined): string | null {
  const unit = String(value ?? "").trim().toUpperCase();
  return unit || null;
}
