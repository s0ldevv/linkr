// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/http.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
  unauthorized,
} from "../_shared/agent_api_errors.ts";
import { createAgentCredential, createApiKeyForAgent } from "../_shared/agent_onboarding.ts";
import { normalizeScopes } from "../_shared/agent_api_core.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const userId = await getCallerUserId(req);
  if (!userId) return agentErrorResponse(unauthorized());
  const admin = serviceClient();

  try {
    if (req.method === "GET") {
      const [profilesResult, keysResult, requestsResult] = await Promise.all([
        admin
          .from("agent_profiles")
          .select(
            "id,user_id,wallet_id,name,agent_type,status,public_contact,created_at,updated_at,disabled_at,metadata",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        admin
          .from("agent_api_keys")
          .select(
            "id,agent_profile_id,wallet_id,name,key_prefix,scopes,status,require_hmac,max_buy_eth,max_buy_sol,max_sell_percent,max_transfer_eth,max_transfer_sol,max_launch_initial_buy_eth,max_liquidity_eth,daily_request_limit,daily_tx_limit,expires_at,last_used_at,created_at,revoked_at",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        admin
          .from("agent_api_requests")
          .select(
            "id,created_at,agent_profile_id,api_key_id,method,path,idempotency_key,status_code,error_code,error_message,duration_ms,user_agent",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (keysResult.error) throw keysResult.error;
      if (requestsResult.error) throw requestsResult.error;
      return agentJsonResponse({
        profiles: profilesResult.data ?? [],
        keys: keysResult.data ?? [],
        actions: requestsResult.data ?? [],
      });
    }

    if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
    const body = await readJsonBody(req, 64 * 1024) as any;
    const action = String(body.action ?? "create_agent").trim();

    if (action === "create_agent") {
      const created = await createAgentCredential(admin, {
        userId,
        agentName: body.agent_name ?? body.name,
        agentType: body.agent_type,
        publicContact: body.public_contact,
        requestedScopes: body.requested_scopes,
        limits: body.limits,
        metadata: { source: "dashboard" },
      });
      return agentJsonResponse({
        agent_profile: created.agentProfile,
        wallet: created.wallet,
        key: created.apiKey.row,
        api_key: created.apiKey.plaintext,
      });
    }

    if (action === "create_key") {
      const agentProfileId = String(body.agent_profile_id ?? "").trim();
      const { data: profile, error: profileError } = await admin
        .from("agent_profiles")
        .select("*")
        .eq("id", agentProfileId)
        .eq("user_id", userId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return agentErrorResponse(unauthorized("agent_profile_not_found"));
      const key = await createApiKeyForAgent(admin, {
        userId,
        agentProfileId: profile.id,
        walletId: profile.wallet_id,
        name: String(body.name ?? "API key").trim() || "API key",
        scopes: normalizeScopes(body.scopes ?? body.requested_scopes),
        limits: body.limits ?? {},
        expiresAt: body.expires_at ?? null,
      });
      return agentJsonResponse({ key: key.row, api_key: key.plaintext });
    }

    if (action === "revoke_key") {
      const keyId = String(body.key_id ?? "").trim();
      if (!keyId) throw new AgentApiError("missing_key_id", 400, "Missing key_id.");
      const { data, error } = await admin
        .from("agent_api_keys")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", keyId)
        .eq("user_id", userId)
        .select("id,status,revoked_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new AgentApiError("key_not_found", 404, "API key not found.");
      return agentJsonResponse({ key: data });
    }

    if (action === "disable_profile") {
      const profileId = String(body.agent_profile_id ?? "").trim();
      if (!profileId)
        throw new AgentApiError("missing_agent_profile_id", 400, "Missing agent_profile_id.");
      const { data, error } = await admin
        .from("agent_profiles")
        .update({ status: "disabled", disabled_at: new Date().toISOString() })
        .eq("id", profileId)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new AgentApiError("agent_profile_not_found", 404, "Agent profile not found.");
      const { error: revokeError } = await admin
        .from("agent_api_keys")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("agent_profile_id", data.id)
        .eq("user_id", userId)
        .neq("status", "revoked");
      if (revokeError) throw revokeError;
      return agentJsonResponse({ agent_profile: data });
    }

    return agentErrorResponse(methodNotAllowed());
  } catch (error) {
    return agentErrorResponse(error);
  }
});
