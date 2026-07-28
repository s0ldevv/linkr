import {
  ROBINHOOD_POSITION_MANAGER_ADDRESS,
  ROBINHOOD_V3_FACTORY_ADDRESS,
  ROBINHOOD_WETH_ADDRESS,
  SINGLE_SIDED_POOL_FEE,
  SINGLE_SIDED_RANGE_WIDTH,
} from "../robinhood_launch/constants.ts";

export function isLiquidityEnabled(): boolean {
  return String(Deno.env.get("ROBINHOOD_LIQUIDITY_ENABLED") ?? "false").toLowerCase() === "true";
}

export function readV3FactoryAddress(): string {
  return Deno.env.get("ROBINHOOD_V3_FACTORY_ADDRESS")?.trim() || ROBINHOOD_V3_FACTORY_ADDRESS;
}

export function readPositionManagerAddress(): string {
  return (
    Deno.env.get("ROBINHOOD_V3_POSITION_MANAGER_ADDRESS")?.trim() ||
    Deno.env.get("ROBINHOOD_POSITION_MANAGER_ADDRESS")?.trim() ||
    ROBINHOOD_POSITION_MANAGER_ADDRESS
  );
}

export function readWethAddress(): string {
  return Deno.env.get("ROBINHOOD_WETH_ADDRESS")?.trim() || ROBINHOOD_WETH_ADDRESS;
}

export function readDefaultPoolFee(): number {
  const value = Number(Deno.env.get("ROBINHOOD_LIQUIDITY_DEFAULT_FEE") ?? SINGLE_SIDED_POOL_FEE);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : SINGLE_SIDED_POOL_FEE;
}

export function readDefaultRangeMultiplier(): number {
  const value = Number(Deno.env.get("ROBINHOOD_LIQUIDITY_DEFAULT_RANGE_MULTIPLIER") ?? "2");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

export function readDefaultRangeWidth(): number {
  const value = Number(
    Deno.env.get("ROBINHOOD_LIQUIDITY_DEFAULT_RANGE_WIDTH") ?? SINGLE_SIDED_RANGE_WIDTH,
  );
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : SINGLE_SIDED_RANGE_WIDTH;
}

export function readLiquidityDeadlineSeconds(): number {
  const value = Number(Deno.env.get("ROBINHOOD_LIQUIDITY_DEADLINE_SECONDS") ?? "900");
  return Number.isFinite(value) && value >= 60 ? Math.floor(value) : 900;
}

export function readMaxAddEth(): number {
  const value = Number(Deno.env.get("ROBINHOOD_LIQUIDITY_MAX_ADD_ETH") ?? "100");
  return Number.isFinite(value) && value > 0 ? value : 100;
}

export function readMaxRemovePercent(): number {
  const value = Number(Deno.env.get("ROBINHOOD_LIQUIDITY_MAX_REMOVE_PERCENT") ?? "100");
  return Number.isFinite(value) && value > 0 ? Math.min(100, value) : 100;
}
