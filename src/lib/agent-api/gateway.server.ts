import { agentApiOpenApi } from "./openapi";

type RouteMatch = {
  functionName: string;
  actionId?: string;
};

const routeMap: Record<string, string> = {
  "/api/me": "agent-me",
  "/api/wallet": "agent-wallet",
  "/api/portfolio": "agent-portfolio",
  "/api/history": "agent-history",
  "/api/agents/register": "agent-register",
  "/api/agent-api-keys": "agent-api-keys",
  "/api/agent-onboarding-tokens": "agent-onboarding-tokens",
  "/api/coins/new": "agent-coins-new",
  "/api/coin-info": "agent-coin-info",
  "/api/launch-token": "agent-launch-token",
  "/api/trade": "agent-trade",
  "/api/transfer": "agent-transfer",
  "/api/schedules": "create-scheduled-action",
  "/api/burn-token": "agent-burn-token",
  "/api/creator-rewards/claim": "agent-creator-rewards-claim",
  "/api/liquidity/add": "agent-liquidity-add",
  "/api/liquidity/remove": "agent-liquidity-remove",
  "/api/liquidity/positions": "agent-liquidity-positions",
  "/api/liquidity/collect-fees": "agent-liquidity-collect-fees",
  "/api/terminal/chat": "terminal-chat",
  "/api/terminal/conversations": "terminal-conversations",
  "/api/terminal/messages": "terminal-messages",
  "/api/terminal/action": "terminal-action",
  "/api/terminal/uploads": "terminal-upload",
};

export async function handleAgentApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = normalizeRequestId(request.headers.get("x-request-id"));
  if (request.method === "OPTIONS") return corsResponse(null);
  if (url.pathname === "/api/openapi.json") {
    return jsonResponse(agentApiOpenApi);
  }

  if (isInsecureProductionRequest(request, url)) {
    return jsonResponse(
      {
        error: { code: "https_required", message: "HTTPS is required." },
      },
      400,
    );
  }

  const match = matchRoute(url.pathname);
  if (!match) {
    return jsonResponse(
      {
        error: { code: "api_route_not_found", message: "API route not found." },
      },
      404,
    );
  }

  const supabaseUrl = (
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    import.meta.env.VITE_SUPABASE_URL
  )?.replace(/\/+$/, "");
  const supabaseApiKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseApiKey) {
    return jsonResponse(
      {
        error: {
          code: "server_not_configured",
          message: "Supabase server credentials are missing.",
        },
      },
      500,
    );
  }

  const target = new URL(`${supabaseUrl}/functions/v1/${match.functionName}`);
  url.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  if (match.actionId) target.searchParams.set("id", match.actionId);

  const headers = new Headers(request.headers);
  headers.set("apikey", supabaseApiKey);
  headers.set("X-Linkr-Canonical-Path", `${url.pathname}${url.search}`);
  headers.set("Accept-Encoding", "identity");
  headers.set("X-Request-ID", requestId);
  headers.delete("host");

  const maxBodyBytes = url.pathname === "/api/terminal/uploads" ? 12 * 1024 * 1024 : 1024 * 1024;
  try {
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await readRequestBodyWithLimit(request, maxBodyBytes);
    const timeoutMs = positiveIntegerEnv("LINKR_GATEWAY_CONNECT_TIMEOUT_MS", 30_000);
    const upstream = await fetchUpstream(
      target,
      {
        method: request.method,
        headers,
        body,
      },
      request.signal,
      timeoutMs,
    );
    const idleTimeoutMs =
      url.pathname === "/api/terminal/chat"
        ? positiveIntegerEnv("LINKR_GATEWAY_STREAM_IDLE_TIMEOUT_MS", 45_000)
        : positiveIntegerEnv("LINKR_GATEWAY_RESPONSE_IDLE_TIMEOUT_MS", 30_000);
    return normalizeUpstreamResponse(
      guardUpstreamBody(upstream, request.signal, idleTimeoutMs),
      requestId,
    );
  } catch (error) {
    if (error instanceof AgentGatewayError) {
      return jsonResponse(
        {
          error: { code: error.code, message: gatewayErrorMessage(error.code) },
          request_id: requestId,
        },
        error.status,
        requestId,
      );
    }
    console.error("agent_gateway_upstream_failed", { requestId, error });
    return jsonResponse(
      {
        error: {
          code: "upstream_unavailable",
          message: "Linkr could not reach the agent runtime.",
        },
        request_id: requestId,
      },
      502,
      requestId,
    );
  }
}

function matchRoute(pathname: string): RouteMatch | null {
  if (routeMap[pathname]) return { functionName: routeMap[pathname] };
  const scheduleMatch = /^\/api\/schedules\/([^/]+)$/.exec(pathname);
  if (scheduleMatch) {
    return {
      functionName: "create-scheduled-action",
      actionId: scheduleMatch[1],
    };
  }
  const actionMatch = /^\/api\/actions\/([^/]+)$/.exec(pathname);
  if (actionMatch) {
    return { functionName: "agent-action-status", actionId: actionMatch[1] };
  }
  return null;
}

async function readRequestBodyWithLimit(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AgentGatewayError("request_body_too_large", 413);
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("request_body_too_large").catch(() => {});
      throw new AgentGatewayError("request_body_too_large", 413);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

class AgentGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

function isInsecureProductionRequest(request: Request, url: URL): boolean {
  const host = request.headers.get("host") ?? url.host;
  if (!/linkr\.cash$/i.test(host)) return false;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return proto !== "https";
}

function jsonResponse(body: unknown, status = 200, requestId?: string): Response {
  return corsResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { "X-Request-ID": requestId } : {}),
    },
  });
}

function corsResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "authorization, content-type, idempotency-key, x-linkr-timestamp, x-linkr-nonce, x-linkr-body-sha256, x-linkr-signature",
      ...(init.headers ?? {}),
    },
  });
}

async function fetchUpstream(
  target: URL,
  init: RequestInit,
  requestSignal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromClient = () => controller.abort(requestSignal.reason);
  requestSignal.addEventListener("abort", abortFromClient, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("upstream_timeout"));
  }, timeoutMs);
  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new AgentGatewayError("upstream_timeout", 504);
    if (requestSignal.aborted) {
      throw new AgentGatewayError("client_disconnected", 499);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener("abort", abortFromClient);
  }
}

function guardUpstreamBody(
  upstream: Response,
  clientSignal: AbortSignal,
  idleTimeoutMs: number,
): Response {
  if (!upstream.body) return upstream;
  const reader = upstream.body.getReader();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    clearIdleTimer();
    void reader.cancel(error.message).catch(() => {});
    try {
      controllerRef?.error(error);
    } catch {
      // The downstream stream already closed.
    }
  };
  const resetIdleTimer = () => {
    clearIdleTimer();
    idleTimer = setTimeout(() => fail(new Error("upstream_response_idle_timeout")), idleTimeoutMs);
  };
  const abortFromClient = () => fail(new Error("client_disconnected"));
  clientSignal.addEventListener("abort", abortFromClient, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      resetIdleTimer();
      try {
        while (!settled) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdleTimer();
          controller.enqueue(value);
        }
        if (!settled) {
          settled = true;
          clearIdleTimer();
          controller.close();
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      } finally {
        clientSignal.removeEventListener("abort", abortFromClient);
      }
    },
    async cancel(reason) {
      settled = true;
      clearIdleTimer();
      clientSignal.removeEventListener("abort", abortFromClient);
      await reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

function normalizeRequestId(value: string | null): string {
  const candidate = value?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Math.floor(Number(process.env[name] ?? fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function gatewayErrorMessage(code: string): string {
  if (code === "request_body_too_large") {
    return "The request body is too large.";
  }
  if (code === "upstream_timeout") {
    return "The agent runtime could not be reached in time.";
  }
  if (code === "client_disconnected") return "The client disconnected.";
  return "The agent gateway could not process the request.";
}

function normalizeUpstreamResponse(upstream: Response, requestId: string): Response {
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("Cache-Control", "no-store, no-transform");
  headers.set("Content-Encoding", "identity");
  headers.set("X-Request-ID", requestId);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
