// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse, withSensitiveCors } from "../_shared/cors.ts";
import { serviceClient, getCallerUserId } from "../_shared/supabase.ts";
import { indexMemory } from "../_shared/memory.ts";
import { readJsonBody, safeErrorResponse } from "../_shared/http.ts";

interface Body {
  default_slippage_bps?: number;
  max_auto_buy_eth?: number;
  max_auto_buy_sol?: number;
  max_auto_sell_percent?: number;
  max_auto_transfer_eth?: number;
  max_auto_transfer_sol?: number;
  max_auto_dev_buy_eth?: number;
  max_auto_dev_buy_sol?: number;
  default_dev_buy_eth?: number;
  default_dev_buy_sol?: number;
  require_confirmation_for_all_tx?: boolean;
}

Deno.serve(async (req) => withSensitiveCors(req, await handleSettings(req)));

async function handleSettings(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, { status: 405 });

  try {
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

    const body: Body = await readJsonBody(req, 64 * 1024);
    const update: Record<string, unknown> = {};

    if (body.default_slippage_bps != null) {
      const v = Math.round(Number(body.default_slippage_bps));
      if (!Number.isFinite(v) || v < 0 || v > 3000)
        return jsonResponse({ error: "slippage out of range" }, { status: 400 });
      update.default_slippage_bps = v;
    }
    if (body.max_auto_buy_eth != null) {
      const v = Number(body.max_auto_buy_eth);
      if (!Number.isFinite(v) || v < 0 || v > 100)
        return jsonResponse({ error: "max_auto_buy_eth invalid" }, { status: 400 });
      update.max_auto_buy_eth = v;
    }
    if (body.max_auto_buy_sol != null) {
      const v = Number(body.max_auto_buy_sol);
      if (!Number.isFinite(v) || v < 0 || v > 100)
        return jsonResponse({ error: "max_auto_buy_sol invalid" }, { status: 400 });
      update.max_auto_buy_sol = v;
    }
    if (body.max_auto_sell_percent != null) {
      const v = Number(body.max_auto_sell_percent);
      if (!Number.isFinite(v) || v < 0 || v > 100)
        return jsonResponse({ error: "max_auto_sell_percent invalid" }, { status: 400 });
      update.max_auto_sell_percent = v;
    }
    if (body.max_auto_transfer_eth != null) {
      const v = Number(body.max_auto_transfer_eth);
      if (!Number.isFinite(v) || v < 0 || v > 100)
        return jsonResponse({ error: "max_auto_transfer_eth invalid" }, { status: 400 });
      update.max_auto_transfer_eth = v;
    }
    if (body.max_auto_transfer_sol != null) {
      const v = Number(body.max_auto_transfer_sol);
      if (!Number.isFinite(v) || v < 0 || v > 100)
        return jsonResponse({ error: "max_auto_transfer_sol invalid" }, { status: 400 });
      update.max_auto_transfer_sol = v;
    }
    if (body.max_auto_dev_buy_eth != null) {
      const v = Number(body.max_auto_dev_buy_eth);
      if (!Number.isFinite(v) || v < 0 || v > 0.1)
        return jsonResponse({ error: "max_auto_dev_buy_eth invalid" }, { status: 400 });
      update.max_auto_dev_buy_eth = v;
    }
    if (body.max_auto_dev_buy_sol != null) {
      const v = Number(body.max_auto_dev_buy_sol);
      if (!Number.isFinite(v) || v < 0 || v > 5)
        return jsonResponse({ error: "max_auto_dev_buy_sol invalid" }, { status: 400 });
      update.max_auto_dev_buy_sol = v;
    }
    if (body.default_dev_buy_eth != null) {
      const v = Number(body.default_dev_buy_eth);
      if (!Number.isFinite(v) || v < 0 || v > 0.1)
        return jsonResponse({ error: "default_dev_buy_eth invalid" }, { status: 400 });
      update.default_dev_buy_eth = v;
    }
    if (body.default_dev_buy_sol != null) {
      const v = Number(body.default_dev_buy_sol);
      if (!Number.isFinite(v) || v < 0 || v > 5)
        return jsonResponse({ error: "default_dev_buy_sol invalid" }, { status: 400 });
      update.default_dev_buy_sol = v;
    }
    if (body.require_confirmation_for_all_tx != null) {
      update.require_confirmation_for_all_tx = Boolean(body.require_confirmation_for_all_tx);
    }

    const admin = serviceClient();
    if (update.default_dev_buy_eth != null || update.default_dev_buy_sol != null) {
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("max_auto_dev_buy_eth,max_auto_dev_buy_sol")
        .eq("user_id", userId).maybeSingle();
      if (profileError) throw profileError;
      const capEth = Number(update.max_auto_dev_buy_eth ?? profile?.max_auto_dev_buy_eth ?? 0);
      const capSol = Number(update.max_auto_dev_buy_sol ?? profile?.max_auto_dev_buy_sol ?? 0);
      if (update.default_dev_buy_eth != null && Number(update.default_dev_buy_eth) > capEth)
        return jsonResponse({ error: "default_dev_buy_eth exceeds max_auto_dev_buy_eth" }, { status: 400 });
      if (update.default_dev_buy_sol != null && Number(update.default_dev_buy_sol) > capSol)
        return jsonResponse({ error: "default_dev_buy_sol exceeds max_auto_dev_buy_sol" }, { status: 400 });
    }
    const { error } = await admin.from("profiles").update(update).eq("user_id", userId);
    if (error) throw error;

    await indexMemory(
      admin,
      userId,
      "settings_update",
      new Date().toISOString(),
      "Settings updated",
      "User updated risk settings: " + JSON.stringify(update),
      update,
    );

    return jsonResponse({ ok: true, updated: update });
  } catch (e) {
    return safeErrorResponse(e, { functionName: "update-user-settings" });
  }
}
