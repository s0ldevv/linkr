export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-linkr-timestamp, x-linkr-nonce, x-linkr-body-sha256, x-linkr-signature, x-linkr-canonical-path",
  "Access-Control-Allow-Methods": "POST, GET, PATCH, DELETE, OPTIONS",
};

const DEFAULT_BROWSER_ORIGINS = [
  "https://linkr.cash",
  "https://www.linkr.cash",
  "https://linkr.bot",
  "https://www.linkr.bot",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://localhost:4174",
  "http://127.0.0.1:4174",
];

export function sensitiveCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin")?.trim() ?? "";
  const configured = (Deno.env.get("LINKR_BROWSER_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_BROWSER_ORIGINS, ...configured]);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && origin !== "null" && allowed.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function withSensitiveCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Headers");
  headers.delete("Access-Control-Allow-Methods");
  for (const [name, value] of Object.entries(sensitiveCorsHeaders(req))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
