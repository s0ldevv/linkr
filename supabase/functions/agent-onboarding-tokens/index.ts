// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/http.ts";
import { agentErrorResponse, agentJsonResponse, methodNotAllowed, unauthorized } from "../_shared/agent_api_errors.ts";
import { createOnboardingToken } from "../_shared/agent_onboarding.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const userId = await getCallerUserId(req);
  if (!userId) return agentErrorResponse(unauthorized());
  const admin = serviceClient();

  try {
    if (req.method === "GET") {
      const { data, error } = await admin
        .from("agent_onboarding_tokens")
        .select("id,requested_scopes,status,expires_at,used_at,created_at,metadata")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return agentJsonResponse({ tokens: data ?? [] });
    }

    if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
    const body = await readJsonBody(req, 64 * 1024) as any;
    const created = await createOnboardingToken(admin, {
      userId,
      requestedScopes: body.requested_scopes,
      ttlMinutes: Number(body.ttl_minutes ?? 60),
      metadata: { name: String(body.name ?? "").trim() || null },
    });
    return agentJsonResponse({ token: created.token, onboarding_token: created.row });
  } catch (error) {
    return agentErrorResponse(error);
  }
});
