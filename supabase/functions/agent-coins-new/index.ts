// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { getMarketDataBundle } from "../_shared/market_data/index.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "coins:read");
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 25), 100));
    const status = url.searchParams.get("status") ?? "confirmed";
    let query = admin
      .from("coin_launches")
      .select(
        "id,name,symbol,description,image_url,mint,token_address,status,created_at,tx_hash,tx_signature,pool,position_id,dev_buy_eth,dev_buy_sol,dev_buy_usd,chain,launch_platform",
      )
      .not("token_address", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    const rows = await Promise.all(
      (data ?? []).map(async (launch: any) => {
        const token = launch.token_address ?? launch.mint;
        const market = token
          ? await getMarketDataBundle(admin, {
              mint: token,
              chain: launch.chain === "solana" ? "solana" : "robinhood",
              includeDexscreener: true,
              includeMoralis: launch.chain !== "solana",
              includeBlockscout: false,
              includeAnalytics: false,
            }).catch(() => null)
          : null;
        return {
          id: launch.id,
          token_address: token,
          name: launch.name,
          symbol: launch.symbol,
          description: launch.description,
          image_url: launch.image_url,
          status: launch.status,
          created_at: launch.created_at,
          tx_hash: launch.tx_hash ?? launch.tx_signature,
          chain: launch.chain ?? "robinhood",
          launch_platform: launch.launch_platform ?? null,
          pool: launch.pool,
          position_id: launch.position_id,
          dev_buy_eth: launch.dev_buy_eth,
          dev_buy_sol: launch.dev_buy_sol,
          dev_buy_usd: launch.dev_buy_usd,
          market: market
            ? {
                price_usd: market.price?.usd ?? null,
                market_cap_usd: market.valuation?.marketCapUsd ?? market.valuation?.fdvUsd ?? null,
                liquidity_usd: market.liquidity?.usd ?? null,
                volume_24h_usd: market.volume?.h24 ?? null,
                price_change_24h: market.price?.change24h ?? null,
              }
            : null,
        };
      }),
    );
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({ data: rows, next_cursor: rows.at(-1)?.created_at ?? null });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});
