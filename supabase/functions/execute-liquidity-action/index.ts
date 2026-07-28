// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { executeLiquidityAction } from "../_shared/robinhood_liquidity/actions.ts";
import { isLiquidityEnabled } from "../_shared/robinhood_liquidity/constants.ts";
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
    const actionId = String(body.action_id ?? body.liquidity_action_id ?? "").trim();
    if (!actionId) return jsonResponse({ error: "missing_action_id" }, { status: 400 });
    const admin = serviceClient();
    const { data: action, error } = await admin
      .from("liquidity_actions")
      .select("*")
      .eq("id", actionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!action) return jsonResponse({ error: "liquidity_action_not_found" }, { status: 404 });
    if (!["pending_confirmation", "queued", "failed"].includes(action.status)) {
      return jsonResponse({ error: "liquidity_action_not_executable" }, { status: 409 });
    }
    const result = await executeLiquidityAction(admin, action);
    if (action.pending_action_id) {
      await admin
        .from("pending_actions")
        .update({ status: "executed", executed_at: new Date().toISOString() })
        .eq("id", action.pending_action_id);
    }
    return jsonResponse({ result });
  } catch (e) {
    return safeErrorResponse(e, { functionName: "execute-liquidity-action" });
  }
});
