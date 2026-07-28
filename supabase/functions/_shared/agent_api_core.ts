// Authentication and thin intake primitives. Keep this module free of chain
// SDKs so every authenticated API endpoint does not initialize Ethers/Solana.
import { AgentApiError } from "./agent_api_errors.ts";

export const AGENT_SCOPES = [
  "profile:read",
  "actions:read",
  "coins:read",
  "coin:read",
  "chat:write",
  "launch:write",
  "trade:buy",
  "trade:sell",
  "transfer:write",
  "schedule:read",
  "schedule:write",
  "burn:write",
  "rewards:claim",
  "liquidity:write",
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

export function normalizeScopes(
  value: unknown,
  fallback: AgentScope[] = ["profile:read"],
): AgentScope[] {
  const raw = Array.isArray(value) ? value : fallback;
  const scopes = new Set<AgentScope>();
  for (const item of raw) {
    if (
      typeof item === "string" &&
      (AGENT_SCOPES as readonly string[]).includes(item)
    ) {
      scopes.add(item as AgentScope);
    }
  }
  if (scopes.size === 0) scopes.add("profile:read");
  return [...scopes];
}

export async function readBoundedBodyText(
  req: Request,
  maximumBytes = 128 * 1024,
): Promise<string> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new AgentApiError("request_body_too_large", 413);
  }
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("request_body_too_large").catch(() => {});
        throw new AgentApiError("request_body_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AgentApiError("invalid_utf8_body", 400);
  }
}

export function parseJsonBody(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentApiError(
      "invalid_json",
      400,
      "Request body must be valid JSON.",
    );
  }
}

// deno-lint-ignore no-explicit-any
export function stringField(
  body: any,
  names: string[],
  options: { required?: boolean; max?: number } = {},
): string | null {
  for (const name of names) {
    const value = body?.[name];
    if (typeof value === "string" && value.trim()) {
      const text = value.trim();
      if (options.max && text.length > options.max) {
        throw new AgentApiError("field_too_long", 400, `${name} is too long.`, {
          field: name,
        });
      }
      return text;
    }
  }
  if (options.required) {
    throw new AgentApiError("missing_field", 400, `Missing ${names[0]}.`, {
      field: names[0],
    });
  }
  return null;
}
