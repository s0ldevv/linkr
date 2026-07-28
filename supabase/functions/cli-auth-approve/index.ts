// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { consumeRateLimit, readJsonBody } from "../_shared/http.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
  unauthorized,
} from "../_shared/agent_api_errors.ts";
import { getCallerAuthContext, serviceClient } from "../_shared/supabase.ts";
import { getActiveBanForAuthUser } from "../_shared/x_bans.ts";
import {
  createCliUserCode,
  hashedRequestValue,
  isRecentCliXAuthenticationForRequest,
  normalizeCliOpaqueCode,
  noStoreHeaders,
  requestIp,
  sha256Hex,
} from "../_shared/cli_auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());

  const admin = serviceClient();
  try {
    const caller = await getCallerAuthContext(req);
    if (!caller) throw unauthorized();
    const userId = caller.userId;

    const activeBan = (await getActiveBanForAuthUser(admin, userId)).ban;
    if (activeBan) {
      throw new AgentApiError(
        "banned_x_user",
        403,
        "This X account is banned from Linkr.",
      );
    }

    const limit = await consumeRateLimit(admin, {
      subjectType: "cli_auth_approve",
      subjectId: userId,
      windowSeconds: 60,
      limit: 20,
    });
    if (!limit.allowed) {
      throw new AgentApiError(
        "rate_limit_exceeded",
        429,
        "Too many approval attempts.",
      );
    }

    const body = await readJsonBody(req, 32 * 1024) as any;
    const requestCode = normalizeCliOpaqueCode(
      body?.request_code ?? body?.request,
    );
    if (!requestCode) {
      throw new AgentApiError(
        "invalid_request_code",
        400,
        "Invalid CLI login request.",
      );
    }
    const requestCodeHash = await sha256Hex(requestCode);
    const now = new Date().toISOString();

    const pending = await admin
      .from("cli_auth_sessions")
      .select("id,created_at,expires_at")
      .eq("browser_request_hash", requestCodeHash)
      .eq("status", "pending")
      .gt("expires_at", now)
      .is("consumed_at", null)
      .maybeSingle();
    if (pending.error) throw pending.error;
    if (!pending.data) {
      throw new AgentApiError(
        "cli_login_request_invalid_or_expired",
        404,
        "This CLI login request is invalid or expired.",
      );
    }
    if (
      !isRecentCliXAuthenticationForRequest(
        caller.authenticatedAt,
        pending.data.created_at,
      )
    ) {
      throw new AgentApiError(
        "cli_x_authentication_required",
        403,
        "Authenticate your X account before approving this CLI login.",
      );
    }

    const userCode = createCliUserCode();
    const updated = await admin
      .from("cli_auth_sessions")
      .update({
        user_code_hash: await sha256Hex(userCode),
        approved_user_id: userId,
        approve_ip_hash: await hashedRequestValue(requestIp(req)),
        approve_user_agent_hash: await hashedRequestValue(
          req.headers.get("user-agent") ?? "",
        ),
        status: "approved",
        approved_at: now,
      })
      .eq("id", pending.data.id)
      .eq("status", "pending")
      .gt("expires_at", now)
      .is("consumed_at", null)
      .select("id,expires_at")
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) {
      throw new AgentApiError(
        "cli_login_request_invalid_or_expired",
        404,
        "This CLI login request is invalid or expired.",
      );
    }

    console.log(JSON.stringify({
      event: "cli_auth_approve",
      user_id: userId,
      session_id: updated.data.id,
    }));

    return agentJsonResponse(
      { user_code: userCode, expires_at: updated.data.expires_at },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
});
