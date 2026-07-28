// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "profile:read", { requireIdempotency: true });
    const { data, error } = await admin
      .from("agent_api_keys")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", ctx.apiKeyId)
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .select("id,status,revoked_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AgentApiError("api_key_not_active", 409);
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({ key: data });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});
