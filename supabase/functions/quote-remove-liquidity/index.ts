// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { isLiquidityEnabled } from "../_shared/robinhood_liquidity/constants.ts";
import { quoteCollectFees, quoteRemoveLiquidity } from "../_shared/robinhood_liquidity/quote.ts";
import { quotePumpRemoveLiquidity } from "../_shared/pump_liquidity/actions.ts";
import { readJsonBody, safeErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  try {
    if (!isLiquidityEnabled())
      return jsonResponse({ error: "liquidity_not_enabled" }, { status: 503 });
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });
    const body = await readJsonBody(req, 64 * 1024) as any;
    const admin = serviceClient();
    const quote =
      inferLiquidityChain(body) === "solana"
        ? await quotePumpRemoveLiquidity(admin, userId, body)
        : body.action === "collect_liquidity_fees"
          ? await quoteCollectFees(admin, userId, body)
          : await quoteRemoveLiquidity(admin, userId, body);
    return jsonResponse({ quote });
  } catch (e) {
    return safeErrorResponse(e, { status: 400, functionName: "quote-remove-liquidity" });
  }
});

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
