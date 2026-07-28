// deno-lint-ignore-file no-explicit-any
import { type AgentScope, normalizeScopes } from "./agent_api_core.ts";

const BASE32_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DEFAULT_APP_ORIGIN = "https://www.linkr.cash";
export const CLI_AUTH_RECENT_X_AUTH_MAX_AGE_MS = 5 * 60 * 1000;
const CLI_AUTH_REQUEST_CLOCK_SKEW_MS = 30 * 1000;

export const CLI_DEFAULT_SCOPES: AgentScope[] = [
  "profile:read",
  "actions:read",
  "coins:read",
  "coin:read",
  "chat:write",
];

const LIMIT_FIELDS = [
  "max_buy_eth",
  "max_buy_sol",
  "max_sell_percent",
  "max_transfer_eth",
  "max_transfer_sol",
  "max_launch_initial_buy_eth",
  "max_launch_initial_buy_sol",
  "max_liquidity_eth",
] as const;

const CLI_MAX_LIMITS: Record<(typeof LIMIT_FIELDS)[number], number> = {
  max_buy_eth: 0.01,
  max_buy_sol: 0.05,
  max_sell_percent: 25,
  max_transfer_eth: 0,
  max_transfer_sol: 0,
  max_launch_initial_buy_eth: 0.01,
  max_launch_initial_buy_sol: 0.05,
  max_liquidity_eth: 0.01,
};

const INTEGER_LIMIT_FIELDS = [
  "daily_request_limit",
  "daily_tx_limit",
] as const;

const CLI_MAX_INTEGER_LIMITS: Record<
  (typeof INTEGER_LIMIT_FIELDS)[number],
  number
> = {
  daily_request_limit: 500,
  daily_tx_limit: 25,
};

export type CliAuthLimits = Record<string, number | null>;

export function randomBase64Url(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createCliUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = Array.from(bytes, (byte) => BASE32_ALPHABET[byte & 31]).join(
    "",
  );
  return `LINKR-${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function normalizeCliOpaqueCode(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{32,256}$/.test(text) ? text : "";
}

export function normalizeCliUserCode(value: unknown): string {
  const text = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
  if (!/^LINKR[2-9A-HJ-NP-Z]{10}$/.test(text)) return "";
  return `LINKR-${text.slice(5, 10)}-${text.slice(10, 15)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function cleanCliText(value: unknown, fallback = ""): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || fallback;
}

export function normalizeCliScopes(value: unknown): AgentScope[] {
  const scopes = normalizeScopes(value, CLI_DEFAULT_SCOPES);
  const out = new Set<AgentScope>();
  for (const scope of scopes) out.add(scope);
  for (const scope of CLI_DEFAULT_SCOPES) out.add(scope);
  return [...out];
}

export function normalizeCliLimits(
  value: unknown,
  scopes: AgentScope[],
): CliAuthLimits {
  const input = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const hasWriteScope = scopes.some((scope) =>
    scope.endsWith(":write") || scope.startsWith("trade:")
  );
  const out: CliAuthLimits = {};

  for (const field of LIMIT_FIELDS) {
    const parsed = numberLimit(input[field], CLI_MAX_LIMITS[field]);
    out[field] = parsed ?? (hasWriteScope ? 0 : null);
  }
  for (const field of INTEGER_LIMIT_FIELDS) {
    out[field] = integerLimit(input[field], CLI_MAX_INTEGER_LIMITS[field]);
  }

  if (out.daily_request_limit == null) {
    out.daily_request_limit = CLI_MAX_INTEGER_LIMITS.daily_request_limit;
  }
  if (out.daily_tx_limit == null && hasWriteScope) {
    out.daily_tx_limit = CLI_MAX_INTEGER_LIMITS.daily_tx_limit;
  }
  return out;
}

export function cliVerificationOrigin(req?: Request): string {
  const forwarded = originFromValue(req?.headers.get("x-linkr-public-origin"));
  if (forwarded && isTrustedPublicOrigin(forwarded)) return forwarded;

  for (
    const name of [
      "APP_ORIGIN",
      "PUBLIC_SITE_URL",
      "LINKR_APP_URL",
      "SITE_URL",
    ]
  ) {
    const origin = originFromValue(Deno.env.get(name));
    if (origin) return origin;
  }
  return DEFAULT_APP_ORIGIN;
}

export function requestIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0] ??
      req.headers.get("x-real-ip") ??
      "unknown"
  ).trim().slice(0, 128) || "unknown";
}

export async function hashedRequestValue(value: unknown): Promise<string> {
  const pepper = Deno.env.get("CLI_AUTH_METADATA_PEPPER") ??
    Deno.env.get("AGENT_API_KEY_PEPPER_V2") ??
    Deno.env.get("AGENT_API_KEY_PEPPER") ??
    "linkr-cli-auth";
  return sha256Hex(`${pepper}:${String(value ?? "").slice(0, 500)}`);
}

export function isRecentCliXAuthenticationForRequest(
  authenticatedAt: Date | null,
  requestCreatedAt: unknown,
  nowMs = Date.now(),
): boolean {
  if (!authenticatedAt || !Number.isFinite(authenticatedAt.getTime())) {
    return false;
  }
  const requestCreatedAtMs = new Date(String(requestCreatedAt ?? "")).getTime();
  if (!Number.isFinite(requestCreatedAtMs)) return false;

  const authenticatedAtMs = authenticatedAt.getTime();
  const ageMs = nowMs - authenticatedAtMs;
  if (ageMs < 0 || ageMs > CLI_AUTH_RECENT_X_AUTH_MAX_AGE_MS) {
    return false;
  }
  return authenticatedAtMs >=
    requestCreatedAtMs - CLI_AUTH_REQUEST_CLOCK_SKEW_MS;
}

export function noStoreHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    ...headers,
  };
}

function numberLimit(value: unknown, max: number): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

function integerLimit(value: unknown, max: number): number | null {
  if (value == null || value === "") return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

function originFromValue(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isTrustedPublicOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (!["http:", "https:"].includes(protocol)) return false;
    const host = hostname.toLowerCase();
    return host === "linkr.cash" ||
      host === "www.linkr.cash" ||
      host === "linkr-new.vercel.app" ||
      host.endsWith(".vercel.app") ||
      host === "localhost" ||
      host === "127.0.0.1";
  } catch {
    return false;
  }
}
