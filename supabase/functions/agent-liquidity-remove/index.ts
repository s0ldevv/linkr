// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { requireRiskAcknowledged } from "../_shared/agent_api_schemas.ts";
import { executeLiquidityAction } from "../_shared/robinhood_liquidity/actions.ts";
import { isLiquidityEnabled } from "../_shared/robinhood_liquidity/constants.ts";
import { quoteRemoveLiquidity } from "../_shared/robinhood_liquidity/quote.ts";
import { quotePumpRemoveLiquidity } from "../_shared/pump_liquidity/actions.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    if (!isLiquidityEnabled()) throw new Error("liquidity_not_enabled");
    ctx = await requireAgentApiKey(req, admin, "liquidity:write", { requireIdempotency: true });
    requireRiskAcknowledged(ctx.body);
    const isPumpSwap = inferLiquidityChain(ctx.body) === "solana";
    const quote = isPumpSwap
      ? await quotePumpRemoveLiquidity(admin, ctx.userId, ctx.body)
      : await quoteRemoveLiquidity(admin, ctx.userId, ctx.body);
    if (ctx.body.dry_run === true) {
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ dry_run: true, quote });
    }
    const idempotencyKey = `agent-liquidity-remove:${ctx.apiKeyId}:${ctx.idempotencyKey}`;
    const existing = await findExisting(admin, idempotencyKey);
    if (existing) {
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ action: existing, idempotent_replay: true });
    }
    const { data: action, error } = await admin
      .from("liquidity_actions")
      .insert({
        user_id: ctx.userId,
        action: "remove_liquidity",
        status: "queued",
        chain: isPumpSwap ? "solana" : "robinhood",
        platform: isPumpSwap ? "pump_swap" : "robinhood_uniswap_v3",
        wallet_id: (quote as any).wallet_id ?? null,
        native_symbol: isPumpSwap ? "SOL" : "ETH",
        wallet_address: quote.wallet_address,
        token_address: quote.token_address,
        token_symbol: quote.token_symbol,
        pool_address: quote.pool_address,
        pool_fee: quote.pool_fee,
        position_token_id: (quote as any).position_token_id ?? (quote as any).lp_token_account,
        tick_lower: (quote as any).tick_lower ?? 0,
        tick_upper: (quote as any).tick_upper ?? 0,
        requested_percent: quote.requested_percent,
        liquidity_delta: (quote as any).liquidity_delta ?? (quote as any).lp_token_amount,
        requested_native_raw: (quote as any).sol_amount_lamports ?? null,
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
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
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

function inferLiquidityChain(body: any): "robinhood" | "solana" {
  const explicit = String(body?.chain ?? body?.network ?? body?.platform ?? "")
    .trim()
    .toLowerCase();
  if (
    ["sol", "solana", "pump", "pump.fun", "pumpfun", "pump_swap", "pumpswap"].includes(explicit)
  ) {
    return "solana";
  }
  const token = String(body?.token_mint ?? body?.mint ?? body?.token_address ?? body?.token ?? "");
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token.trim())) return "solana";
  return "robinhood";
}
