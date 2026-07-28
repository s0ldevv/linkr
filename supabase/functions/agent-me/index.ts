// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "profile:read");
    const body = {
      agent_profile: {
        id: ctx.agentProfile.id,
        name: ctx.agentProfile.name,
        status: ctx.agentProfile.status,
        type: ctx.agentProfile.agent_type,
        public_contact: ctx.agentProfile.public_contact,
      },
      key: {
        id: ctx.apiKey.id,
        prefix: ctx.apiKey.key_prefix,
        name: ctx.apiKey.name,
        scopes: ctx.scopes,
        status: ctx.apiKey.status,
        expires_at: ctx.apiKey.expires_at,
        limits: {
          max_buy_eth: ctx.apiKey.max_buy_eth,
          max_buy_sol: ctx.apiKey.max_buy_sol,
          max_sell_percent: ctx.apiKey.max_sell_percent,
          max_transfer_eth: ctx.apiKey.max_transfer_eth,
          max_transfer_sol: ctx.apiKey.max_transfer_sol,
          max_launch_initial_buy_eth: ctx.apiKey.max_launch_initial_buy_eth,
          max_liquidity_eth: ctx.apiKey.max_liquidity_eth,
        },
      },
      wallet: {
        id: ctx.wallet.id,
        address: ctx.wallet.address ?? ctx.wallet.public_key,
        chain_id: ctx.wallet.chain_id,
      },
    };
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse(body);
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});
