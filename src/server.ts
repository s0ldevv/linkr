import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleAgentApiRequest } from "./lib/agent-api/gateway.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Cloudflare was removed from in front of Vercel on 2026-07-29; its beacon origin
  // is no longer injected into responses and is deliberately not allowlisted here.
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "script-src-elem 'self' 'unsafe-inline' https://telegram.org",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src https://dexscreener.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self' https://x.com https://twitter.com",
  "upgrade-insecure-requests",
  "report-uri /api/csp-report",
  "report-to linkr-csp",
].join("; ");

const BASE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Origin-Agent-Cluster": "?1",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
} as const;

const DOCUMENT_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
} as const;

const CSP_REPORT_PATH = "/api/csp-report";
const CSP_REPORT_MAX_BYTES = 32 * 1024;
const ASSET_FAILURE_PATH = "/api/asset-failure";
const ASSET_FAILURE_MAX_BYTES = 4 * 1024;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"}; try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const pathname = new URL(request.url).pathname;
  applyDocumentCacheHeaders(request, response, headers, pathname);
  headers.set(
    "Referrer-Policy",
    pathname.startsWith("/auth") || pathname.startsWith("/app/wallet")
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
  );
  headers.set("Reporting-Endpoints", `linkr-csp="${CSP_REPORT_PATH}"`);
  headers.set(
    "Report-To",
    JSON.stringify({
      group: "linkr-csp",
      max_age: 10_886_400,
      endpoints: [{ url: new URL(CSP_REPORT_PATH, request.url).toString() }],
    }),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function applyDocumentCacheHeaders(
  request: Request,
  response: Response,
  headers: Headers,
  pathname: string,
) {
  if (pathname.startsWith("/api/")) return;

  const contentType = response.headers.get("content-type") ?? "";
  const accept = request.headers.get("accept") ?? "";
  const fetchDest = request.headers.get("sec-fetch-dest") ?? "";
  const isDocument =
    contentType.includes("text/html") ||
    fetchDest === "document" ||
    (accept.includes("text/html") && !pathname.includes("."));

  if (!isDocument) return;

  for (const [name, value] of Object.entries(DOCUMENT_CACHE_HEADERS)) {
    headers.set(name, value);
  }
}

// A chunk 404 means production served a different build than the one that rendered
// the HTML. It is never a browser cache problem, so it is worth logging loudly:
// silent client-side reloads are why the 2026-07-29 outage ran undiagnosed.
async function handleAssetFailureReport(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > ASSET_FAILURE_MAX_BYTES) {
    return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    console.warn(
      JSON.stringify({
        event: "asset_load_failure",
        asset: safeAssetPath(payload.asset),
        outcome: safeReportToken(payload.outcome),
        document: safePathname(payload.document),
        deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      }),
    );
  } catch {
    // Malformed reports are deliberately ignored and never echoed.
  }

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function handleCspReport(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > CSP_REPORT_MAX_BYTES) {
    return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > CSP_REPORT_MAX_BYTES) {
    return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const report = readCspReport(parsed);
    console.warn(
      JSON.stringify({
        event: "csp_violation",
        document: safeReportLocation(report["document-uri"] ?? report.url),
        blocked: safeReportLocation(report["blocked-uri"] ?? report.blockedURL),
        directive: safeReportToken(
          report["effective-directive"] ??
            report.effectiveDirective ??
            report["violated-directive"],
        ),
        disposition: safeReportToken(report.disposition),
      }),
    );
  } catch {
    // Malformed browser reports are deliberately ignored and never echoed.
  }

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function readCspReport(payload: Record<string, unknown>): Record<string, unknown> {
  const legacy = payload["csp-report"];
  if (legacy && typeof legacy === "object") return legacy as Record<string, unknown>;
  const body = payload.body;
  if (body && typeof body === "object") return body as Record<string, unknown>;
  return payload;
}

function safeReportLocation(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (["inline", "eval", "self"].includes(raw)) return raw;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    const scheme = raw.match(/^[a-z][a-z0-9+.-]*:/i)?.[0];
    return scheme?.toLowerCase() ?? "invalid";
  }
}

function safeReportToken(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9 _-]{1,100}$/i.test(value) ? value : null;
}

// The reported asset is expected to be an http(s) URL or an absolute path. Only the
// pathname is kept, so a hostile scheme or a query string can never reach the logs.
// safeReportLocation is not reused here: it renders a bare pathname as "invalid",
// and the pathname is the field that actually identifies the failing chunk.
function safeAssetPath(value: unknown): string | null {
  return typeof value === "string" ? safePathname(pathnameOf(value)) : null;
}

function safePathname(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^\/[\w./~%@:-]{0,300}$/.test(raw) ? raw : null;
}

function pathnameOf(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.pathname : "";
  } catch {
    return "";
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === CSP_REPORT_PATH) {
        return withSecurityHeaders(request, await handleCspReport(request));
      }
      if (url.pathname === ASSET_FAILURE_PATH) {
        return withSecurityHeaders(request, await handleAssetFailureReport(request));
      }
      if (url.pathname.startsWith("/api/")) {
        return withSecurityHeaders(request, await handleAgentApiRequest(request));
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && "code" in error) {
        const status = Number((error as { status: unknown }).status);
        const code = String((error as { code: unknown }).code);
        if (Number.isInteger(status) && status >= 400 && status < 500) {
          return withSecurityHeaders(
            request,
            new Response(JSON.stringify({ error: { code, message: code } }), {
              status,
              headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
                "access-control-allow-origin": "*",
              },
            }),
          );
        }
      }
      console.error(error);
      return withSecurityHeaders(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
