// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { AgentApiError } from "../_shared/agent_api_errors.ts";
import { stringField } from "../_shared/agent_api_schemas.ts";
import { buildAgentCoinDetail } from "../_shared/coin_detail.ts";
import { normalizeMarketAddress } from "../_shared/market_data/chains.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "coin:read");
    const url = new URL(req.url);
    const rawAddress = stringField(
      {
        token_address:
          url.searchParams.get("token_address") ??
          url.searchParams.get("address") ??
          url.searchParams.get("mint"),
      },
      ["token_address"],
      { required: true, max: 100 },
    );
    const normalized = normalizeMarketAddress(rawAddress);
    if (!normalized) {
      throw new AgentApiError(
        "invalid_token_address",
        400,
        "Expected a full Robinhood Chain EVM contract address or Solana mint address.",
        { field: "token_address" },
      );
    }
    const detail = await buildAgentCoinDetail(admin, normalized.address, {
      chain: normalized.chain,
      analytics: url.searchParams.get("analytics") !== "false",
    });
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse(detail);
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});
