// deno-lint-ignore-file no-explicit-any

export interface FetchJsonArgs {
  provider: "blockscout" | "dexscreener" | "moralis";
  endpoint: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  admin?: any;
}

export type FetchJsonResult =
  | { ok: true; status: number; data: any; latencyMs: number }
  | { ok: false; status: number | null; error: string; latencyMs: number };

export async function fetchJsonWithTimeout(args: FetchJsonArgs): Promise<FetchJsonResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 8000);
  const method = args.method ?? "GET";

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(args.headers ?? {}),
    };
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (args.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      init.body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
    }

    const response = await fetch(args.url, init);
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const text = await response.text();
    const data = parseJsonOrText(text);

    if (!response.ok) {
      const error = summarizeError(data, text);
      await recordMarketApiEvent(args.admin, {
        provider: args.provider,
        endpoint: args.endpoint,
        status: "error",
        http_status: response.status,
        latency_ms: latencyMs,
        error,
      });
      return { ok: false, status: response.status, error, latencyMs };
    }

    await recordMarketApiEvent(args.admin, {
      provider: args.provider,
      endpoint: args.endpoint,
      status: "ok",
      http_status: response.status,
      latency_ms: latencyMs,
    });
    return { ok: true, status: response.status, data, latencyMs };
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    await recordMarketApiEvent(args.admin, {
      provider: args.provider,
      endpoint: args.endpoint,
      status: "error",
      http_status: null,
      latency_ms: latencyMs,
      error: message,
    });
    return { ok: false, status: null, error: message, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}

async function recordMarketApiEvent(
  admin: any,
  event: {
    provider: string;
    endpoint: string;
    status: string;
    http_status: number | null;
    latency_ms: number;
    cache_status?: string | null;
    error?: string | null;
  },
) {
  if (!admin) return;
  try {
    await admin.from("market_api_events").insert({
      provider: event.provider,
      endpoint: event.endpoint,
      status: event.status,
      http_status: event.http_status,
      latency_ms: event.latency_ms,
      cache_status: event.cache_status ?? null,
      error: event.error ? event.error.slice(0, 500) : null,
    });
  } catch (_) {
    // Provider telemetry must never break user-facing processing.
  }
}

function parseJsonOrText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function summarizeError(data: unknown, text: string): string {
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail;
    if (message) return String(message).slice(0, 500);
  }
  return String(text || "provider_error").slice(0, 500);
}
