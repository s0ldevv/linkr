// deno-lint-ignore-file no-explicit-any
// Robinhood Chain EVM helpers. Signing lives in transfer/wallet modules.

import { ethers } from "https://esm.sh/ethers@6";
import {
  jsonRpc,
  providerPoolEnabled,
  readProviderEndpoints,
} from "./provider_pool.ts";

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_ID_HEX = "0x1237";
export const ROBINHOOD_RPC_FALLBACK_URL =
  "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER_BASE_URL =
  "https://robinhoodchain.blockscout.com";
export const ROBINHOOD_NATIVE_SYMBOL = "ETH";
export const ROBINHOOD_NATIVE_ASSET_ID = "native:eth";

export function robinhoodRpcUrl(): string {
  const configured = Deno.env.get("ROBINHOOD_RPC_URL")?.trim();
  const legacy = configured || ROBINHOOD_RPC_FALLBACK_URL;
  if (!providerPoolEnabled()) return legacy;
  return readProviderEndpoints("ROBINHOOD_RPC_ENDPOINTS_JSON", legacy)[0].url;
}
export async function evmRpc<T = any>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  if (providerPoolEnabled()) {
    const legacy = Deno.env.get("ROBINHOOD_RPC_URL")?.trim() ||
      ROBINHOOD_RPC_FALLBACK_URL;
    const endpoints = readProviderEndpoints(
      "ROBINHOOD_RPC_ENDPOINTS_JSON",
      legacy,
    );
    return (await jsonRpc<T>(endpoints, method, params)).result;
  }
  const res = await fetch(robinhoodRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`robinhood_rpc_http_${res.status}`);
  const body = await res.json();
  if (body?.error) {
    const message = body.error?.message ?? JSON.stringify(body.error);
    throw new Error(`robinhood_rpc_${method}: ${message}`);
  }
  return body.result as T;
}

export function robinhoodProvider(): ethers.AbstractProvider {
  const network = { chainId: ROBINHOOD_CHAIN_ID, name: "robinhood" };
  const legacy = Deno.env.get("ROBINHOOD_RPC_URL")?.trim() ||
    ROBINHOOD_RPC_FALLBACK_URL;
  if (!providerPoolEnabled()) {
    return new ethers.JsonRpcProvider(legacy, network);
  }
  const endpoints = readProviderEndpoints(
    "ROBINHOOD_RPC_ENDPOINTS_JSON",
    legacy,
  );
  const providers = endpoints.map((endpoint) => ({
    provider: new ethers.JsonRpcProvider(endpoint.url, network),
    priority: Math.max(1, 101 - endpoint.priority),
    weight: endpoint.weight ?? 1,
    stallTimeout: Math.min(endpoint.timeout_ms, 5_000),
  }));
  return new ethers.FallbackProvider(providers, network, { quorum: 1 });
}

export async function assertRobinhoodChain(): Promise<void> {
  const chainId = await evmRpc<string>("eth_chainId", []);
  if (String(chainId).toLowerCase() !== ROBINHOOD_CHAIN_ID_HEX) {
    throw new Error(`unexpected_robinhood_chain_id_${chainId}`);
  }
}

export function isEvmAddress(value: string | null | undefined): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? "").trim());
}

export function normalizeEvmAddress(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!isEvmAddress(trimmed)) throw new Error("invalid_evm_address");
  return ethers.getAddress(trimmed);
}

export function privateKeyBytesToHex(bytes: Uint8Array): string {
  return ethers.hexlify(bytes);
}

export function privateKeyHexToBytes(hex: string): Uint8Array {
  const normalized = String(hex ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error("invalid_evm_private_key");
  }
  return ethers.getBytes(normalized);
}

export function weiHexToEthString(hexWei: string): string {
  return ethers.formatEther(BigInt(hexWei));
}

export function ethToWei(value: number | string): bigint {
  return ethers.parseEther(String(value));
}

export async function getEthBalance(address: string): Promise<number> {
  const checked = normalizeEvmAddress(address);
  const result = await evmRpc<string>("eth_getBalance", [checked, "latest"]);
  return Number(ethers.formatEther(BigInt(result)));
}

export async function getEthBalanceWei(address: string): Promise<bigint> {
  const checked = normalizeEvmAddress(address);
  const result = await evmRpc<string>("eth_getBalance", [checked, "latest"]);
  return BigInt(result);
}

export function getAddressExplorerUrl(address: string): string {
  return `${ROBINHOOD_EXPLORER_BASE_URL}/address/${
    normalizeEvmAddress(address)
  }`;
}

export function getTxExplorerUrl(hash: string): string {
  return `${ROBINHOOD_EXPLORER_BASE_URL}/tx/${String(hash).trim()}`;
}

export async function getErc20TokenBalances(
  ownerAddress: string,
): Promise<any[]> {
  const owner = normalizeEvmAddress(ownerAddress);
  const url =
    `${ROBINHOOD_EXPLORER_BASE_URL}/api/v2/addresses/${owner}/tokens?type=ERC-20`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = await res.json();
    const items = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body)
      ? body
      : [];
    return items.map(normalizeBlockscoutTokenBalance).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function normalizeBlockscoutTokenBalance(item: any): any | null {
  const token = item?.token ?? item?.token_info ?? item ?? {};
  const rawAddress = token?.address_hash ??
    token?.addressHash ??
    token?.address ??
    token?.contract_address ??
    item?.token_address ??
    item?.address_hash;
  if (!isEvmAddress(rawAddress)) return null;
  const tokenAddress = normalizeEvmAddress(rawAddress);
  const tokenType = String(
    token?.type ?? token?.token_type ?? item?.token_type ?? "ERC-20",
  );
  if (tokenType && !/^erc-?20$/i.test(tokenType)) return null;

  const decimals = numberOrFallback(token?.decimals ?? item?.decimals, 18);
  const rawValue = bigintOrNull(item?.value) ??
    bigintOrNull(item?.balance) ??
    bigintOrNull(item?.raw_value) ??
    bigintOrNull(item?.quantity);
  if (rawValue == null) return null;
  const amount = Number(ethers.formatUnits(rawValue, decimals));
  const exchangeRate = numberOrNull(
    token?.exchange_rate ?? item?.exchange_rate,
  );
  const usdValue = exchangeRate == null ? null : amount * exchangeRate;

  return {
    chain: "robinhood",
    chain_id: ROBINHOOD_CHAIN_ID,
    mint: tokenAddress,
    token_address: tokenAddress,
    explorer_url: `${ROBINHOOD_EXPLORER_BASE_URL}/token/${tokenAddress}`,
    symbol: stringOrNull(token?.symbol),
    name: stringOrNull(token?.name),
    decimals,
    amount,
    raw_value: rawValue.toString(),
    usd_value: Number.isFinite(usdValue) ? usdValue : null,
    token_type: tokenType || "ERC-20",
    logo_url: stringOrNull(token?.icon_url),
    possible_spam: String(token?.reputation ?? "").toLowerCase() === "scam"
      ? true
      : null,
    raw: item,
  };
}

function bigintOrNull(value: unknown): bigint | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    if (/^0x[a-fA-F0-9]+$/.test(text)) return BigInt(text);
    if (/^\d+$/.test(text)) return BigInt(text);
    return null;
  } catch (_) {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function numberOrFallback(value: unknown, fallback: number): number {
  const number = numberOrNull(value);
  if (number == null || number < 0) return fallback;
  return Math.floor(number);
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}
