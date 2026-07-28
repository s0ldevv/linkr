import { ROBINHOOD_CHAIN_ID } from "../robinhood_chain.ts";
import { ROBINHOOD_WETH_ADDRESS } from "../robinhood_launch/constants.ts";

export const UNISWAP_TRADE_API_URL = "https://trade-api.gateway.uniswap.org/v1";
export const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEFAULT_UNISWAP_UNIVERSAL_ROUTER_ADDRESS =
  "0x8876789976decbfcbbbe364623c63652db8c0904";
export const UNISWAP_ROUTER_VERSION = "2.0";

export function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

export function isSwapEnabled(): boolean {
  return (
    readBoolean("ROBINHOOD_SWAP_ENABLED", false) &&
    !!readUniswapApiKey() &&
    !!readSwapRouterAddress() &&
    !!readSwapWethAddress()
  );
}

export function readUniswapApiKey(): string {
  return Deno.env.get("UNISWAP_API_KEY")?.trim() ?? "";
}

export function readSwapRouterAddress(): string {
  return (
    Deno.env.get("ROBINHOOD_SWAP_ROUTER_ADDRESS")?.trim() ??
    DEFAULT_UNISWAP_UNIVERSAL_ROUTER_ADDRESS
  );
}

export function readSwapWethAddress(): string {
  return Deno.env.get("ROBINHOOD_WETH_ADDRESS")?.trim() ?? ROBINHOOD_WETH_ADDRESS;
}

export function readSwapMaxPriceImpactBps(): number {
  return readPositiveNumber("LINKR_SWAP_MAX_PRICE_IMPACT_BPS", 1000);
}

export function readSwapQuoteTtlSeconds(): number {
  return readPositiveNumber("LINKR_SWAP_QUOTE_TTL_SECONDS", 30);
}

export function readSwapConfirmationBlocks(): number {
  return Math.floor(readPositiveNumber("LINKR_SWAP_CONFIRMATION_BLOCKS", 1));
}

export function readSwapDeadlineSeconds(): number {
  return Math.floor(readPositiveNumber("LINKR_SWAP_DEADLINE_SECONDS", 900));
}

export function readSwapGasPaddingBps(): number {
  return Math.floor(readPositiveNumber("LINKR_SWAP_GAS_PADDING_BPS", 1500));
}

export function readSwapMinOutputUsd(): number {
  return readNonNegativeNumber("LINKR_SWAP_MIN_OUTPUT_USD", 0);
}

export function assertRobinhoodSwapChain(chainId: unknown): void {
  if (Number(chainId) !== ROBINHOOD_CHAIN_ID) throw new Error("swap_wrong_chain");
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeNumber(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
