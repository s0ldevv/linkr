// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/http.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  cleanCliText,
  cliVerificationOrigin,
  hashedRequestValue,
  normalizeCliLimits,
  normalizeCliScopes,
  noStoreHeaders,
  randomBase64Url,
  requestIp,
  sha256Hex,
} from "../_shared/cli_auth.ts";
import { consumeRateLimit } from "../_shared/http.ts";

const TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());

  const admin = serviceClient();
  try {
    const ipHash = await hashedRequestValue(requestIp(req));
    const limit = await consumeRateLimit(admin, {
      subjectType: "cli_auth_start",
      subjectId: ipHash,
      windowSeconds: 60,
      limit: 12,
    });
    if (!limit.allowed) {
      throw new AgentApiError(
        "rate_limit_exceeded",
        429,
        "Too many login attempts.",
      );
    }

    const body = await readJsonBody(req, 32 * 1024) as any;
    const scopes = normalizeCliScopes(body?.requested_scopes);
    const limits = normalizeCliLimits(body?.requested_limits, scopes);
    const deviceCode = randomBase64Url(32);
    const browserRequestCode = randomBase64Url(32);
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const origin = cliVerificationOrigin(req);
    const verificationUrl = new URL("/cli/auth", origin);
    verificationUrl.searchParams.set("request", browserRequestCode);

    const { error } = await admin.from("cli_auth_sessions").insert({
      device_code_hash: await sha256Hex(deviceCode),
      browser_request_hash: await sha256Hex(browserRequestCode),
      requested_scopes: scopes,
      requested_limits: limits,
      client_name: cleanCliText(body?.client_name, "Linkr CLI"),
      cli_version: cleanCliText(body?.cli_version, "unknown").slice(0, 40),
      request_ip_hash: ipHash,
      request_user_agent_hash: await hashedRequestValue(
        req.headers.get("user-agent") ?? "",
      ),
      expires_at: expiresAt,
    });
    if (error) throw error;

    console.log(JSON.stringify({
      event: "cli_auth_start",
      scopes,
      cli_version: cleanCliText(body?.cli_version, "unknown").slice(0, 40),
    }));

    return agentJsonResponse(
      {
        device_code: deviceCode,
        verification_url: verificationUrl.toString(),
        expires_at: expiresAt,
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
});
