// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { AgentApiError } from "./agent_api_errors.ts";
import {
  AGENT_SCOPES,
  normalizeScopes,
  parseJsonBody,
  stringField,
  type AgentScope,
} from "./agent_api_core.ts";
import { normalizeEvmAddress } from "./robinhood_chain.ts";

export {
  AGENT_SCOPES,
  normalizeScopes,
  parseJsonBody,
  stringField,
  type AgentScope,
};

export function boolField(body: any, names: string[], fallback = false): boolean {
  for (const name of names) {
    if (typeof body?.[name] === "boolean") return body[name];
  }
  return fallback;
}

export function normalizeAddressField(body: any, names: string[], required = true): string | null {
  const value = stringField(body, names, { required, max: 80 });
  if (!value) return null;
  try {
    return normalizeEvmAddress(value);
  } catch (_) {
    throw new AgentApiError("invalid_evm_address", 400, "Expected a full EVM contract address.", {
      field: names[0],
    });
  }
}

export function parseEthWei(value: unknown, field: string): bigint {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new AgentApiError("missing_field", 400, `Missing ${field}.`, {
      field,
    });
  }
  try {
    const wei = ethers.parseEther(text);
    if (wei <= 0n) throw new Error("non_positive");
    return wei;
  } catch (_) {
    throw new AgentApiError("invalid_eth_amount", 400, `${field} must be a positive ETH amount.`, {
      field,
    });
  }
}

export function parsePositiveNumber(value: unknown, field: string, max?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AgentApiError("invalid_number", 400, `${field} must be positive.`, { field });
  }
  if (max != null && n > max) {
    throw new AgentApiError("number_too_large", 400, `${field} exceeds the allowed maximum.`, {
      field,
      max,
    });
  }
  return n;
}

export function parseSlippageBps(value: unknown, fallback = 100): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) {
    throw new AgentApiError(
      "invalid_slippage_bps",
      400,
      "slippage_bps must be between 0 and 10000.",
    );
  }
  return Math.floor(n);
}

export function requireRiskAcknowledged(body: any) {
  if (body?.risk_acknowledged !== true) {
    throw new AgentApiError(
      "risk_acknowledgement_required",
      400,
      "risk_acknowledged must be true for this action.",
    );
  }
}

export function capExceeded(code: string, message: string) {
  return new AgentApiError(code, 403, message);
}
