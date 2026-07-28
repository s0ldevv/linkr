// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/http.ts";
import { agentErrorResponse, agentJsonResponse, methodNotAllowed, unauthorized } from "../_shared/agent_api_errors.ts";
import { createAgentCredential, redeemOnboardingToken } from "../_shared/agent_onboarding.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());

  try {
    const admin = serviceClient();
    const body = await readJsonBody(req, 64 * 1024) as any;
    let userId = await getCallerUserId(req);
    const onboardingToken = String(body.onboarding_token ?? "").trim();
    let requestedScopes = body.requested_scopes;

    if (!userId && onboardingToken) {
      const redeemed = await redeemOnboardingToken(admin, onboardingToken);
      userId = redeemed.user_id;
      requestedScopes = requestedScopes ?? redeemed.requested_scopes;
    }

    if (!userId) throw unauthorized("registration_auth_required");

    const created = await createAgentCredential(admin, {
      userId,
      agentName: body.agent_name ?? body.name,
      agentType: body.agent_type,
      publicContact: body.public_contact,
      requestedScopes,
      limits: body.limits,
      metadata: { source: onboardingToken ? "onboarding_token" : "dashboard_session" },
    });

    return agentJsonResponse({
      agent_profile_id: created.agentProfile.id,
      user_id: userId,
      wallet: {
        id: created.wallet.id,
        address: created.wallet.address ?? created.wallet.public_key,
        chain_id: created.wallet.chain_id,
      },
      api_key: created.apiKey.plaintext,
      key: created.apiKey.row,
      signing: {
        algorithm: "HMAC-SHA256",
        required_headers: [
          "Authorization",
          "X-Linkr-Timestamp",
          "X-Linkr-Nonce",
          "X-Linkr-Body-SHA256",
          "X-Linkr-Signature",
        ],
      },
    });
  } catch (error) {
    return agentErrorResponse(error);
  }
});
