// Amount normalization: USD <-> native assets using live prices.

import { getEthUsdPrice } from "./eth_price.ts";
import { getSolUsdPrice } from "./sol_price.ts";

export interface NormalizedAmount {
  amount_original: number | null;
  amount_original_unit: string | null;
  amount_eth: number | null;
  amount_sol?: number | null;
  amount_usd: number | null;
  eth_price_usd: number | null;
  sol_price_usd?: number | null;
}

// deno-lint-ignore no-explicit-any
export async function normalizeAmount(
  admin: any,
  input: {
    amount_original: number | null;
    amount_original_unit: string | null;
  },
): Promise<NormalizedAmount | { error: string }> {
  const unit = input.amount_original_unit?.toLowerCase() ?? null;
  const out: NormalizedAmount = {
    amount_original: input.amount_original ?? null,
    amount_original_unit: unit,
    amount_eth: null,
    amount_usd: null,
    eth_price_usd: null,
  };
  if (input.amount_original == null || !unit) return out;

  if (unit === "eth") {
    out.amount_eth = input.amount_original;
    const p = await getEthUsdPrice(admin);
    if (p) {
      out.eth_price_usd = p.price;
      out.amount_usd = input.amount_original * p.price;
    }
    return out;
  }

  if (unit === "usd") {
    const p = await getEthUsdPrice(admin);
    if (!p) return { error: "eth_price_unavailable" };
    out.eth_price_usd = p.price;
    out.amount_usd = input.amount_original;
    out.amount_eth = input.amount_original / p.price;
    return out;
  }

  return out;
}

// deno-lint-ignore no-explicit-any
export async function normalizeSolAmount(
  admin: any,
  input: {
    amount_original: number | null;
    amount_original_unit: string | null;
  },
): Promise<NormalizedAmount | { error: string }> {
  const unit = input.amount_original_unit?.toLowerCase() ?? null;
  const out: NormalizedAmount = {
    amount_original: input.amount_original ?? null,
    amount_original_unit: unit,
    amount_eth: null,
    amount_sol: null,
    amount_usd: null,
    eth_price_usd: null,
    sol_price_usd: null,
  };
  if (input.amount_original == null || !unit) return out;

  if (unit === "sol") {
    out.amount_sol = input.amount_original;
    const price = await getSolUsdPrice(admin);
    if (price) {
      out.sol_price_usd = price.price;
      out.amount_usd = input.amount_original * price.price;
    }
    return out;
  }

  if (unit === "usd") {
    const price = await getSolUsdPrice(admin);
    if (!price) return { error: "sol_price_unavailable" };
    out.sol_price_usd = price.price;
    out.amount_usd = input.amount_original;
    out.amount_sol = input.amount_original / price.price;
    return out;
  }

  return out;
}
