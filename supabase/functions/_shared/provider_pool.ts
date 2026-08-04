export interface ProviderEndpoint {
  label: string;
  url: string;
  priority: number;
  timeout_ms: number;
  weight?: number;
  operations?: string[];
}

interface CircuitState {
  failures: number;
  openUntil: number;
  latencyMs: number | null;
}

const circuits = new Map<string, CircuitState>();

// Hardcoded on. Previously the LINKR_RPC_POOL_ENABLED edge secret, which had
// been set to "true" in production. Note that no *_RPC_ENDPOINTS_JSON is
// configured, so readProviderEndpoints synthesizes a single "legacy-primary"
// endpoint from SOLANA_RPC_URL / ROBINHOOD_RPC_URL: the pool currently supplies
// circuit-breaking over one endpoint, not failover.
const LINKR_RPC_POOL_ENABLED: boolean = true;

export function providerPoolEnabled(): boolean {
  return LINKR_RPC_POOL_ENABLED;
}

export function readProviderEndpoints(
  envName: string,
  fallbackUrl?: string | null,
): ProviderEndpoint[] {
  const raw = Deno.env.get(envName)?.trim();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`invalid_${envName.toLowerCase()}`);
    }
  }
  const items = Array.isArray(parsed) ? parsed : [];
  const endpoints = items.map(normalizeEndpoint).filter((
    item,
  ): item is ProviderEndpoint => item !== null);
  if (!endpoints.length && fallbackUrl?.trim()) {
    endpoints.push({
      label: "legacy-primary",
      url: fallbackUrl.trim(),
      priority: 100,
      timeout_ms: 10_000,
    });
  }
  if (!endpoints.length) throw new Error(`missing_${envName.toLowerCase()}`);
  return endpoints.sort((a, b) =>
    b.priority - a.priority || a.label.localeCompare(b.label)
  );
}

export async function providerFetch(
  endpoints: ProviderEndpoint[],
  init: RequestInit,
  options: { operation?: string; retryStatuses?: number[] } = {},
): Promise<
  { response: Response; endpoint: ProviderEndpoint; latencyMs: number }
> {
  const retryStatuses = new Set(
    options.retryStatuses ?? [408, 425, 429, 500, 502, 503, 504],
  );
  const supported = endpoints.filter((endpoint) =>
    !options.operation || !endpoint.operations?.length ||
    endpoint.operations.includes(options.operation)
  );
  if (!supported.length) throw new Error("provider_operation_unsupported");
  const eligible = supported.filter((endpoint) =>
    (circuits.get(circuitKey(endpoint))?.openUntil ?? 0) <= Date.now()
  );
  // When all circuits are open, probe only the endpoint closest to cooldown.
  // Sending the same request to every unhealthy provider creates a retry storm.
  const candidates = eligible.length ? eligible : [
    [...supported].sort((a, b) =>
      (circuits.get(circuitKey(a))?.openUntil ?? 0) -
      (circuits.get(circuitKey(b))?.openUntil ?? 0)
    )[0],
  ];
  let lastError: unknown = new Error("provider_pool_exhausted");

  for (const endpoint of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), endpoint.timeout_ms);
    const started = Date.now();
    try {
      const response = await fetch(endpoint.url, {
        ...init,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      if (!response.ok && retryStatuses.has(response.status)) {
        await response.body?.cancel().catch(() => {});
        markFailure(endpoint);
        lastError = new Error(`provider_http_${response.status}`);
        continue;
      }
      markSuccess(endpoint, latencyMs);
      return { response, endpoint, latencyMs };
    } catch (error) {
      markFailure(endpoint);
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function jsonRpc<T>(
  endpoints: ProviderEndpoint[],
  method: string,
  params: unknown[],
): Promise<{ result: T; endpointLabel: string; latencyMs: number }> {
  const id = crypto.randomUUID();
  const { response, endpoint, latencyMs } = await providerFetch(endpoints, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }, { operation: method });
  const body = await response.json();
  if (body?.error) {
    const code = Number(body.error.code);
    // JSON-RPC application errors can be deterministic chain state. They are
    // not evidence that the endpoint is unhealthy and must not trigger replay.
    throw new Error(
      `json_rpc_error_${Number.isFinite(code) ? code : "unknown"}`,
    );
  }
  return {
    result: body.result as T,
    endpointLabel: endpoint.label,
    latencyMs,
  };
}

export function sanitizedEndpointIdentity(endpoint: ProviderEndpoint): string {
  try {
    const url = new URL(endpoint.url);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return "invalid-endpoint";
  }
}

export function providerFetchAdapter(endpoints: ProviderEndpoint[]) {
  return async (_input: Request | URL | string, init?: RequestInit) => {
    const operation = jsonRpcMethod(init?.body);
    const { response } = await providerFetch(endpoints, init ?? {}, {
      operation: operation ?? undefined,
    });
    return response;
  };
}

export function providerRpcFetchAdapter(
  readEndpoints: ProviderEndpoint[],
  sendEndpoints: ProviderEndpoint[] = readEndpoints,
) {
  return async (_input: Request | URL | string, init?: RequestInit) => {
    const operation = jsonRpcMethod(init?.body);
    const isSend = operation === "sendTransaction" ||
      operation === "eth_sendRawTransaction";
    const { response } = await providerFetch(
      isSend ? sendEndpoints : readEndpoints,
      init ?? {},
      { operation: operation ?? undefined },
    );
    return response;
  };
}

function jsonRpcMethod(body: BodyInit | null | undefined): string | null {
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.method === "string" ? parsed.method : null;
  } catch {
    return null;
  }
}

function normalizeEndpoint(value: unknown): ProviderEndpoint | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const label = String(item.label ?? "").trim();
  const url = String(item.url ?? "").trim();
  if (!label || !url || !/^https:\/\//i.test(url)) return null;
  const priority = Number(item.priority ?? 0);
  const timeout = Number(item.timeout_ms ?? item.timeout ?? 10_000);
  return {
    label: label.slice(0, 80),
    url,
    priority: Number.isFinite(priority) ? Math.trunc(priority) : 0,
    timeout_ms: Number.isFinite(timeout)
      ? Math.min(Math.max(Math.trunc(timeout), 500), 30_000)
      : 10_000,
    weight: Number.isFinite(Number(item.weight))
      ? Math.max(1, Math.trunc(Number(item.weight)))
      : 1,
    operations: Array.isArray(item.operations)
      ? item.operations.filter((entry): entry is string =>
        typeof entry === "string"
      ).slice(0, 100)
      : undefined,
  };
}

function circuitKey(endpoint: ProviderEndpoint): string {
  return `${endpoint.label}:${sanitizedEndpointIdentity(endpoint)}`;
}

function markFailure(endpoint: ProviderEndpoint) {
  const key = circuitKey(endpoint);
  const current = circuits.get(key) ??
    { failures: 0, openUntil: 0, latencyMs: null };
  const failures = current.failures + 1;
  circuits.set(key, {
    failures,
    latencyMs: current.latencyMs,
    openUntil: failures >= 3
      ? Date.now() + Math.min(60_000, 2 ** Math.min(failures, 10) * 250)
      : 0,
  });
}

function markSuccess(endpoint: ProviderEndpoint, latencyMs: number) {
  const key = circuitKey(endpoint);
  const current = circuits.get(key);
  circuits.set(key, {
    failures: 0,
    openUntil: 0,
    latencyMs: current?.latencyMs == null
      ? latencyMs
      : current.latencyMs * 0.8 + latencyMs * 0.2,
  });
}
