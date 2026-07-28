// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { agentErrorResponse, agentJsonResponse, methodNotAllowed } from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { retrieveUserHistory, type HistoryScope } from "../_shared/history_retrieval.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "actions:read");
    const url = new URL(req.url);
    const kind = String(url.searchParams.get("kind") ?? "recent").trim().toLowerCase();
    const scopes = scopesForKind(kind);
    const walletPublicKey = ctx.wallet.address ?? ctx.wallet.public_key ?? null;
    const timeRange = timeRangeFromUrl(url);
    const history = await retrieveUserHistory(
      admin,
      ctx.userId,
      {
        scopes,
        query: {
          token_symbol: url.searchParams.get("symbol"),
          token_address: url.searchParams.get("token_address") ?? url.searchParams.get("token"),
          token_mint: url.searchParams.get("mint") ?? url.searchParams.get("token"),
          action: url.searchParams.get("action"),
          text: url.searchParams.get("q") ?? "",
          time_range: timeRange,
          limit: clampLimit(url.searchParams.get("limit"), 20),
          sort: normalizeSort(url.searchParams.get("sort")),
        },
        reason: `agent_api_history:${kind}`,
      },
      { walletPublicKey },
    );
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({ kind, history });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(() => {});
    return agentErrorResponse(error);
  }
});

function scopesForKind(kind: string): HistoryScope[] {
  switch (kind) {
    case "transaction":
    case "transactions":
    case "transaction_history":
      return ["transactions_search"];
    case "launch":
    case "launches":
    case "launch_history":
      return ["launches_search"];
    case "settings":
    case "settings_history":
      return ["coin_settings_updates"];
    case "agent":
    case "agent_history":
      return ["agent_runs_search", "twitter_replies_recent"];
    case "portfolio":
      return ["wallet_balance", "portfolio_holdings"];
    case "pending":
    case "drafts":
      return ["pending_actions"];
    case "all":
      return [
        "wallet_balance",
        "portfolio_holdings",
        "pending_actions",
        "transactions_recent",
        "launches_recent",
        "coin_settings_updates",
        "agent_runs_recent",
        "twitter_replies_recent",
      ];
    case "recent":
    case "recent_activity":
    default:
      return ["transactions_recent", "launches_recent", "coin_settings_updates", "agent_runs_recent"];
  }
}

function timeRangeFromUrl(url: URL) {
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  if (!after && !before) return null;
  return { label: null, after, before };
}

function normalizeSort(value: string | null): "recent" | "oldest" | "largest_eth" | "largest_usd" {
  if (value === "oldest" || value === "largest_eth" || value === "largest_usd") return value;
  return "recent";
}

function clampLimit(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(50, n) : fallback;
}
