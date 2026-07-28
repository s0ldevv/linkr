// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { agentErrorResponse, agentJsonResponse, methodNotAllowed } from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { isEvmAddress, normalizeEvmAddress } from "../_shared/robinhood_chain.ts";
import { normalizeSolanaAddress } from "../_shared/market_data/chains.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "actions:read");
    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get("limit"), 25);
    const token = String(url.searchParams.get("token") ?? url.searchParams.get("token_address") ?? url.searchParams.get("mint") ?? "").trim();
    const status = normalizeStatus(url.searchParams.get("status"));
    const chain = normalizeChain(url.searchParams.get("chain") ?? url.searchParams.get("platform"));

    let query = admin
      .from("liquidity_positions")
      .select(
        "id,chain,platform,wallet_id,wallet_address,native_symbol,token_address,token_symbol,token_name,pool_address,pool_fee,position_token_id,lp_mint,tick_lower,tick_upper,liquidity,status,amount_token_wei,amount_weth_wei,amount_token_raw,amount_native_raw,uncollected_token_fees_wei,uncollected_weth_fees_wei,value_usd,in_range,owner_address,last_chain_refresh_at,opened_tx_hash,closed_tx_hash,last_tx_hash,metadata,created_at,updated_at",
      )
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    else if (url.searchParams.get("include_closed") !== "true") {
      query = query.in("status", ["active", "partially_removed"]);
    }
    if (chain) query = query.eq("chain", chain);
    query = applyTokenFilter(query, token);

    const { data, error } = await query;
    if (error) throw error;

    const positions = data ?? [];
    const active = positions.filter((p: any) => p.status === "active" || p.status === "partially_removed");
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({
      positions,
      summary: {
        count: positions.length,
        active_count: active.length,
        robinhood_active_count: active.filter((p: any) => p.chain !== "solana").length,
        solana_active_count: active.filter((p: any) => p.chain === "solana").length,
      },
    });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(() => {});
    return agentErrorResponse(error);
  }
});

function applyTokenFilter(query: any, token: string) {
  if (!token) return query;
  if (isEvmAddress(token)) return query.eq("token_address", normalizeEvmAddress(token));
  const solana = normalizeSolanaAddress(token);
  if (solana) return query.eq("token_address", solana);
  const symbol = token.replace(/^\$/, "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return symbol ? query.ilike("token_symbol", symbol) : query;
}

function normalizeStatus(value: string | null): string | null {
  const status = String(value ?? "").trim();
  if (!status) return null;
  return [
    "active",
    "partially_removed",
    "closed",
    "transferred_out",
    "stale",
    "failed_refresh",
  ].includes(status)
    ? status
    : null;
}

function normalizeChain(value: string | null): "robinhood" | "solana" | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (["rh", "robinhood", "evm", "eth", "robinhood_uniswap_v3", "uniswap_v3"].includes(text)) {
    return "robinhood";
  }
  if (["sol", "solana", "pump", "pump.fun", "pumpfun", "pump_swap", "pumpswap"].includes(text)) {
    return "solana";
  }
  return null;
}

function clampLimit(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : fallback;
}
