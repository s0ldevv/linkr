// Thin, switch-based Linkr read tools. No model-supplied table names or SQL.

import type { LinkrToolResult } from "./linkr_types.ts";

export type LinkrDataTool =
  | "activity.query"
  | "launch.query"
  | "transaction.query"
  | "liquidity.position_query"
  | "liquidity.action_query"
  | "agent.history_query"
  | "draft.status_query"
  | "public.user_lookup";

export interface LinkrDataQuery {
  tool: LinkrDataTool;
  scope: "self" | "public";
  user_id?: string | null;
  twitter_id?: string | null;
  handle?: string | null;
  action?: string | null;
  status?: string | null;
  token?: string | null;
  sort?: "recent" | "oldest" | "amount_desc" | "amount_asc";
  limit?: number;
}

export async function queryLinkrDataAccess(
  admin: any,
  query: LinkrDataQuery,
): Promise<LinkrToolResult<Record<string, unknown>>> {
  try {
    switch (query.tool) {
      case "activity.query":
        return ok(query.tool, { launches: await publicLaunches(admin, query), activity: [] }, "Public Linkr activity summary");
      case "launch.query":
        return ok(query.tool, { launches: await launches(admin, query) }, "Launch query results");
      case "transaction.query":
        if (query.scope !== "self") return denied(query.tool, "Private transaction history is only available for the current user.");
        return ok(query.tool, { transactions: await transactions(admin, query) }, "User transaction query results", "user_private");
      case "liquidity.position_query":
        if (query.scope !== "self") return denied(query.tool, "LP positions are private to the current user.");
        return ok(query.tool, { positions: await liquidityPositions(admin, query) }, "User LP position query results", "user_private");
      case "liquidity.action_query":
        if (query.scope !== "self") return denied(query.tool, "Liquidity actions are private to the current user.");
        return ok(query.tool, { actions: await liquidityActions(admin, query) }, "User liquidity action query results", "user_private");
      case "agent.history_query":
        if (query.scope !== "self") return denied(query.tool, "Agent history is private to the current user.");
        return ok(query.tool, { runs: await agentRuns(admin, query) }, "User Linkr agent history", "user_private");
      case "draft.status_query":
        if (query.scope !== "self") return denied(query.tool, "Drafts are private to the current user.");
        return ok(query.tool, { drafts: await drafts(admin, query) }, "User draft status", "user_private");
      case "public.user_lookup":
        return ok(query.tool, { users: await publicUserLookup(admin, query) }, "Public Linkr user lookup", "recipient_public");
    }
  } catch (e) {
    return {
      tool: query.tool,
      ok: false,
      facts: {},
      summary: "Tool failed",
      freshness: "unknown",
      confidence: 0,
      privacy: query.scope === "self" ? "user_private" : "public",
      redactions: [],
      answerable: false,
      error: String(e),
    };
  }
}

async function launches(admin: any, query: LinkrDataQuery) {
  let q = admin
    .from("coin_launches")
    .select("id,tweet_id,user_id,name,symbol,mint,token_address,chain,launch_platform,status,dev_buy_eth,dev_buy_sol,dev_buy_usd,created_at")
    .order("created_at", { ascending: query.sort === "oldest" })
    .limit(limit(query.limit));
  if (query.scope === "self") q = q.eq("user_id", query.user_id);
  if (query.status) q = q.eq("status", query.status);
  if (query.token) q = q.or(`symbol.ilike.%${query.token}%,mint.eq.${query.token},token_address.eq.${query.token}`);
  const { data } = await q;
  return data ?? [];
}

async function publicLaunches(admin: any, query: LinkrDataQuery) {
  let q = admin
    .from("coin_launches")
    .select("id,tweet_id,name,symbol,mint,token_address,chain,launch_platform,status,created_at")
    .eq("status", "confirmed")
    .order("created_at", { ascending: query.sort === "oldest" })
    .limit(limit(query.limit));
  if (query.token) q = q.ilike("symbol", `%${query.token.replace(/^\$/, "")}%`);
  const { data } = await q;
  return data ?? [];
}

async function transactions(admin: any, query: LinkrDataQuery) {
  let q = admin
    .from("transactions")
    .select("id,tweet_id,action,input_mint,output_mint,amount_original,amount_original_unit,amount_eth,amount_sol,amount_usd,status,tx_hash,tx_signature,created_at,confirmed_at")
    .eq("user_id", query.user_id)
    .limit(limit(query.limit));
  if (query.action) q = q.eq("action", query.action);
  if (query.status) q = q.eq("status", query.status);
  if (query.token) q = q.or(`input_mint.eq.${query.token},output_mint.eq.${query.token}`);
  q = orderAmountOrDate(q, query.sort);
  const { data } = await q;
  return data ?? [];
}

async function liquidityPositions(admin: any, query: LinkrDataQuery) {
  let q = admin
    .from("liquidity_positions")
    .select("id,chain,platform,token_address,token_mint,token_symbol,status,liquidity_token_balance,token_amount,native_amount,created_at,updated_at")
    .eq("user_id", query.user_id)
    .order("updated_at", { ascending: query.sort === "oldest" })
    .limit(limit(query.limit));
  if (query.status) q = q.eq("status", query.status);
  if (query.token) q = q.or(`token_address.eq.${query.token},token_mint.eq.${query.token},token_symbol.ilike.%${query.token}%`);
  const { data } = await q;
  return data ?? [];
}

async function liquidityActions(admin: any, query: LinkrDataQuery) {
  let q = admin
    .from("liquidity_actions")
    .select("id,action_type,chain,platform,token_address,token_mint,status,pending_action_id,created_at,executed_at")
    .eq("user_id", query.user_id)
    .order("created_at", { ascending: query.sort === "oldest" })
    .limit(limit(query.limit));
  if (query.status) q = q.eq("status", query.status);
  const { data } = await q;
  return data ?? [];
}

async function agentRuns(admin: any, query: LinkrDataQuery) {
  const { data } = await admin
    .from("agent_runs")
    .select("id,tweet_id,intent,status,error,route_decision,outcome,created_at,completed_at")
    .eq("user_id", query.user_id)
    .order("created_at", { ascending: query.sort === "oldest" })
    .limit(limit(query.limit));
  return data ?? [];
}

async function drafts(admin: any, query: LinkrDataQuery) {
  const { data } = await admin
    .from("linkr_action_drafts")
    .select("id,conversation_id,source_tweet_id,action_type,status,required_fields,filled_fields,expires_at,created_at,updated_at")
    .eq("user_id", query.user_id)
    .in("status", ["open", "awaiting_clarification"])
    .order("updated_at", { ascending: false })
    .limit(limit(query.limit));
  return data ?? [];
}

async function publicUserLookup(admin: any, query: LinkrDataQuery) {
  const handle = String(query.handle ?? "").replace(/^@/, "").toLowerCase();
  let q = admin
    .from("profiles")
    .select("user_id,twitter_id,twitter_username,display_name")
    .limit(limit(query.limit, 5));
  if (handle) q = q.ilike("twitter_username", handle);
  else if (query.twitter_id) q = q.eq("twitter_id", query.twitter_id);
  const { data } = await q;
  return data ?? [];
}

function ok(
  tool: string,
  facts: Record<string, unknown>,
  summary: string,
  privacy: LinkrToolResult["privacy"] = "public",
): LinkrToolResult<Record<string, unknown>> {
  return { tool, ok: true, facts, summary, freshness: "live", confidence: 0.85, privacy, redactions: [], answerable: true };
}

function denied(tool: string, summary: string): LinkrToolResult<Record<string, unknown>> {
  return { tool, ok: false, facts: {}, summary, freshness: "live", confidence: 1, privacy: "user_private", redactions: ["private_cross_user_data"], answerable: false };
}

function limit(value: unknown, fallback = 10): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(50, n) : fallback;
}

function orderAmountOrDate(q: any, sort: LinkrDataQuery["sort"]) {
  if (sort === "amount_desc") return q.order("amount_usd", { ascending: false, nullsFirst: false });
  if (sort === "amount_asc") return q.order("amount_usd", { ascending: true, nullsFirst: false });
  return q.order("created_at", { ascending: sort === "oldest" });
}
