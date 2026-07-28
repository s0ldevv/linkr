// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { agentErrorResponse, agentJsonResponse, methodNotAllowed } from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { executeLiquidityAction } from "../_shared/robinhood_liquidity/actions.ts";
import { isLiquidityEnabled } from "../_shared/robinhood_liquidity/constants.ts";
import { quoteCollectFees } from "../_shared/robinhood_liquidity/quote.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    if (!isLiquidityEnabled()) throw new Error("liquidity_not_enabled");
    ctx = await requireAgentApiKey(req, admin, "liquidity:write", { requireIdempotency: true });
    const quote = await quoteCollectFees(admin, ctx.userId, ctx.body);
    if (ctx.body.dry_run === true) {
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ dry_run: true, quote });
    }
    const idempotencyKey = `agent-liquidity-collect:${ctx.apiKeyId}:${ctx.idempotencyKey}`;
    const existing = await findExisting(admin, idempotencyKey);
    if (existing) {
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ action: existing, idempotent_replay: true });
    }
    const { data: action, error } = await admin
      .from("liquidity_actions")
      .insert({
        user_id: ctx.userId,
        action: "collect_liquidity_fees",
        status: "queued",
        wallet_address: quote.wallet_address,
        token_address: quote.token_address,
        token_symbol: quote.token_symbol,
        pool_address: quote.pool_address,
        pool_fee: quote.pool_fee,
        position_token_id: quote.position_token_id,
        tick_lower: quote.tick_lower,
        tick_upper: quote.tick_upper,
        liquidity_delta: "0",
        simulation: quote,
        source_surface: "agent_api",
        idempotency_key: idempotencyKey,
      })
      .select("*")
      .single();
    if (error) throw error;
    const result = await executeLiquidityAction(admin, action);
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({ result });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(() => {});
    return agentErrorResponse(error);
  }
});

async function findExisting(admin: any, idempotencyKey: string) {
  const { data, error } = await admin
    .from("liquidity_actions")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}
