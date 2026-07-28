// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { refreshStoredPosition } from "../_shared/robinhood_liquidity/positions.ts";
import { safeErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  try {
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });
    const admin = serviceClient();
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "true";
    const token = url.searchParams.get("token");
    let query = admin
      .from("liquidity_positions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (token)
      query = query.or(`token_address.eq.${token},token_symbol.ilike.${token.replace(/^\$/, "")}`);
    const { data, error } = await query;
    if (error) throw error;

    let positions = data ?? [];
    if (refresh) {
      positions = await Promise.all(
        positions.map((position: any) =>
          position.chain === "solana"
            ? position
            : refreshStoredPosition(admin, position, position.wallet_address).catch(() => position),
        ),
      );
    }

    const active = positions.filter(
      (p: any) => p.status === "active" || p.status === "partially_removed",
    );
    const robinhoodActive = active.filter((p: any) => p.chain !== "solana");
    const solanaActive = active.filter((p: any) => p.chain === "solana");
    const totalValueUsd = positions.reduce(
      (sum: number, p: any) => sum + (Number(p.value_usd) || 0),
      0,
    );
    return jsonResponse({
      positions,
      summary: {
        activeCount: active.length,
        robinhoodActiveCount: robinhoodActive.length,
        solanaActiveCount: solanaActive.length,
        totalValueUsd: totalValueUsd > 0 ? totalValueUsd : null,
        uncollectedFeesUsd: null,
        inRangeCount: robinhoodActive.filter((p: any) => p.in_range !== false).length,
      },
    });
  } catch (e) {
    return safeErrorResponse(e, { functionName: "liquidity-positions" });
  }
});
