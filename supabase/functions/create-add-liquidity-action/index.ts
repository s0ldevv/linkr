// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { isLiquidityEnabled } from "../_shared/robinhood_liquidity/constants.ts";
import { addLiquidityConfirmationText } from "../_shared/robinhood_liquidity/format.ts";
import { quoteAddLiquidity } from "../_shared/robinhood_liquidity/quote.ts";
import { quotePumpAddLiquidity } from "../_shared/pump_liquidity/actions.ts";
import { readJsonBody, safeErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  try {
    if (!isLiquidityEnabled())
      return jsonResponse({ error: "liquidity_not_enabled" }, { status: 503 });
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });
    const admin = serviceClient();
    const body = await readJsonBody(req, 64 * 1024) as any;
    const isPumpSwap = inferLiquidityChain(body) === "solana";
    const quote = isPumpSwap
      ? await quotePumpAddLiquidity(admin, userId, body)
      : await quoteAddLiquidity(admin, userId, body);
    const { data: action, error: actionError } = await admin
      .from("liquidity_actions")
      .insert({
        user_id: userId,
        action: "add_liquidity",
        status: "pending_confirmation",
        chain: isPumpSwap ? "solana" : "robinhood",
        platform: isPumpSwap ? "pump_swap" : "robinhood_uniswap_v3",
        wallet_id: (quote as any).wallet_id ?? null,
        native_symbol: isPumpSwap ? "SOL" : "ETH",
        wallet_address: quote.wallet_address,
        token_address: quote.token_address,
        token_symbol: quote.token_symbol,
        pool_address: quote.pool_address,
        pool_fee: quote.pool_fee,
        tick_lower: (quote as any).tick_lower ?? 0,
        tick_upper: (quote as any).tick_upper ?? 0,
        requested_eth_wei: (quote as any).eth_amount_wei ?? (quote as any).sol_amount_lamports,
        requested_token_wei: (quote as any).token_amount_wei ?? (quote as any).token_amount_raw,
        requested_native_raw: (quote as any).sol_amount_lamports ?? null,
        source_surface: "dashboard",
        simulation: quote,
      })
      .select("*")
      .single();
    if (actionError) throw actionError;

    const confirmationPhrase = "confirm add liquidity";
    const { data: pending, error: pendingError } = await admin
      .from("pending_actions")
      .insert({
        user_id: userId,
        intent: "add_liquidity",
        action_payload: {
          ...quote,
          liquidity_action_id: action.id,
          risk_acknowledged: Boolean(body.risk_acknowledged),
          source: "dashboard",
          source_surface: "dashboard",
        },
        confirmation_phrase: confirmationPhrase,
        status: "pending",
        source_surface: "dashboard",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
      .select("*")
      .single();
    if (pendingError) throw pendingError;
    await admin
      .from("liquidity_actions")
      .update({ pending_action_id: pending.id })
      .eq("id", action.id);

    return jsonResponse({
      action: { ...action, pending_action_id: pending.id },
      pending_action: pending,
      confirmation_text: isPumpSwap
        ? pumpAddLiquidityConfirmationText(quote as any)
        : addLiquidityConfirmationText(quote as any),
    });
  } catch (e) {
    return safeErrorResponse(e, { status: 400, functionName: "create-add-liquidity-action" });
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

function pumpAddLiquidityConfirmationText(quote: any): string {
  const symbol = quote.token_symbol ?? "Pump token";
  return [
    `Add PumpSwap liquidity to ${symbol}?`,
    "",
    `Input: ${formatRaw(quote.token_amount_raw, quote.token_decimals, 6)} ${symbol} + ${formatRaw(quote.sol_amount_lamports, 9, 6)} SOL`,
    "Pool: PumpSwap TOKEN/SOL",
    "Risk: LP value can fall vs holding.",
    "",
    "Reply: confirm add liquidity",
  ].join("\n");
}

function formatRaw(raw: string, decimals: number, max = 6): string {
  const value = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}
