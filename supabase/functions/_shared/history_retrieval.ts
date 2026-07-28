// deno-lint-ignore-file no-explicit-any
import { extractFromText } from "./extract.ts";
import {
  type HistoryTimeRange,
  parseHistoryTimeRange,
} from "./history_time.ts";
import {
  getErc20TokenBalances,
  getEthBalance,
  isEvmAddress,
  normalizeEvmAddress,
} from "./robinhood_chain.ts";

export type HistoryScope =
  | "profile_settings"
  | "wallet_balance"
  | "portfolio_holdings"
  | "pending_actions"
  | "transactions_recent"
  | "transactions_search"
  | "transactions_by_token"
  | "transactions_by_time"
  | "launches_recent"
  | "launches_search"
  | "launches_by_symbol"
  | "launches_by_time"
  | "coin_settings_updates"
  | "agent_runs_recent"
  | "agent_runs_search"
  | "twitter_replies_recent"
  | "thread_context"
  | "memory_search";

export interface HistoryQuery {
  token_symbol?: string | null;
  token_address?: string | null;
  token_mint?: string | null;
  action?: string | null;
  text?: string | null;
  time_range?: HistoryTimeRange | null;
  limit?: number;
  sort?: "recent" | "oldest" | "largest_eth" | "largest_usd";
}

export interface HistoryRetrievalRequest {
  scopes: HistoryScope[];
  query: HistoryQuery;
  reason: string;
}

export interface HistoryRetrievalResult {
  request: HistoryRetrievalRequest;
  results: Record<string, any>;
  summary: string;
}

const VALID_SCOPES = new Set<HistoryScope>([
  "profile_settings",
  "wallet_balance",
  "portfolio_holdings",
  "pending_actions",
  "transactions_recent",
  "transactions_search",
  "transactions_by_token",
  "transactions_by_time",
  "launches_recent",
  "launches_search",
  "launches_by_symbol",
  "launches_by_time",
  "coin_settings_updates",
  "agent_runs_recent",
  "agent_runs_search",
  "twitter_replies_recent",
  "thread_context",
  "memory_search",
]);

function clampLimit(value: unknown, fallback = 10) {
  const n = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(50, n);
}

function uniqueScopes(scopes: unknown[]): HistoryScope[] {
  const out: HistoryScope[] = [];
  for (const scope of scopes) {
    if (
      VALID_SCOPES.has(scope as HistoryScope) &&
      !out.includes(scope as HistoryScope)
    ) {
      out.push(scope as HistoryScope);
    }
  }
  return out;
}

function shortSig(value: string | null | undefined) {
  if (!value) return null;
  return value.length > 12
    ? value.slice(0, 4) + "..." + value.slice(-4)
    : value;
}

function firstTokenAddress(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (isEvmAddress(text)) return normalizeEvmAddress(text);
  }
  return null;
}

function truncate(value: unknown, max = 500) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

function sanitizeTransaction(row: any) {
  return {
    id: row.id,
    tweet_id: row.tweet_id,
    action: row.action,
    chain: row.chain,
    input_mint: row.input_mint,
    output_mint: row.output_mint,
    amount_original: row.amount_original,
    amount_original_unit: row.amount_original_unit,
    amount_eth: row.amount_eth,
    amount_sol: row.amount_sol,
    amount_usd: row.amount_usd,
    eth_price_usd: row.eth_price_usd,
    slippage_bps: row.slippage_bps,
    tx_hash: row.tx_hash ?? row.tx_signature,
    tx_hash_short: shortSig(row.tx_hash ?? row.tx_signature),
    status: row.status,
    created_at: row.created_at,
    confirmed_at: row.confirmed_at,
  };
}

function sanitizeLaunch(row: any) {
  return {
    id: row.id,
    tweet_id: row.tweet_id,
    name: row.name,
    symbol: row.symbol,
    description: truncate(row.description, 300),
    image_url: row.image_url,
    mint: row.mint,
    tx_signature: row.tx_signature,
    tx_signature_short: shortSig(row.tx_signature),
    dev_buy_original_amount: row.dev_buy_original_amount,
    dev_buy_original_unit: row.dev_buy_original_unit,
    chain: row.chain ?? "robinhood",
    launch_platform: row.launch_platform ?? null,
    dev_buy_eth: row.dev_buy_eth,
    dev_buy_sol: row.dev_buy_sol,
    dev_buy_usd: row.dev_buy_usd,
    status: row.status,
    created_at: row.created_at,
  };
}

function applyTimeRange(
  query: any,
  range: HistoryTimeRange | null | undefined,
) {
  let q = query;
  if (range?.after) q = q.gte("created_at", range.after);
  if (range?.before) q = q.lt("created_at", range.before);
  return q;
}

function orderTransactions(query: any, sort: HistoryQuery["sort"]) {
  if (sort === "oldest") return query.order("created_at", { ascending: true });
  if (sort === "largest_eth") {
    return query.order("amount_eth", { ascending: false, nullsFirst: false });
  }
  if (sort === "largest_usd") {
    return query.order("amount_usd", { ascending: false, nullsFirst: false });
  }
  return query.order("created_at", { ascending: false });
}

export function buildHistoryPlan(
  intent: string,
  classification: any,
  tweetText: string,
  thread: any,
): HistoryRetrievalRequest {
  const text = String(tweetText ?? "") + "\n" +
    String(thread?.flattened_context ?? "");
  const lower = text.toLowerCase();
  const extracted = extractFromText(text);
  const requested = uniqueScopes(
    Array.isArray(classification?.history_scopes)
      ? classification.history_scopes
      : [],
  );
  const scopes = new Set<HistoryScope>(requested);
  const timeRange = parseHistoryTimeRange(tweetText ?? "");

  const hasHistoryWords =
    /\b(last|previous|history|again|same as|usual|biggest|largest|first|when did i|what did i|did i|my last)\b/
      .test(
        lower,
      );
  const hasTxWords =
    /\b(tx|transaction|bought|buy|sold|sell|burn|burned|transfer|sent|received)\b/
      .test(lower);
  const hasLaunchWords =
    /\b(launch|launched|coin i made|my coin|ticker|dev buy)\b/.test(lower);
  const hasInquiryWords = /\b(asked|told me|replied|what did you say|inquiry)\b/
    .test(lower);

  switch (intent) {
    case "confirm_action":
    case "cancel_action":
      scopes.add("pending_actions");
      break;
    case "wallet_balance":
      scopes.add("wallet_balance");
      break;
    case "portfolio":
      scopes.add("portfolio_holdings");
      if (hasHistoryWords || hasTxWords) scopes.add("transactions_by_token");
      break;
    case "recent_activity":
      scopes.add("transactions_recent");
      scopes.add("launches_recent");
      scopes.add("agent_runs_recent");
      scopes.add("coin_settings_updates");
      break;
    case "buy_token":
      if (hasHistoryWords) scopes.add("transactions_recent");
      if (hasLaunchWords) scopes.add("launches_search");
      break;
    case "sell_token":
      scopes.add("portfolio_holdings");
      if (hasHistoryWords) scopes.add("transactions_by_token");
      break;
    case "launch_coin":
      if (hasHistoryWords) scopes.add("launches_recent");
      if (extracted.symbols.length > 0) scopes.add("launches_by_symbol");
      if (/\b(settings|same)\b/.test(lower)) {
        scopes.add("coin_settings_updates");
      }
      break;
    case "claim_creator_rewards":
      scopes.add(hasHistoryWords ? "launches_recent" : "launches_search");
      if (extracted.symbols.length > 0) scopes.add("launches_by_symbol");
      break;
    case "update_coin_settings":
      scopes.add("launches_search");
      scopes.add("coin_settings_updates");
      if (/\blast\b|\brecent\b/.test(lower)) scopes.add("launches_recent");
      break;
    case "general_inquiry":
    case "coin_inquiry":
      if (hasTxWords && hasHistoryWords) scopes.add("transactions_search");
      if (hasLaunchWords && hasHistoryWords) scopes.add("launches_search");
      if (hasInquiryWords) {
        scopes.add("agent_runs_search");
        scopes.add("twitter_replies_recent");
      }
      if (hasHistoryWords) scopes.add("memory_search");
      break;
    case "transaction_history":
      scopes.add(timeRange ? "transactions_by_time" : "transactions_search");
      break;
    case "launch_history":
      scopes.add(timeRange ? "launches_by_time" : "launches_search");
      break;
    case "settings_history":
      scopes.add("coin_settings_updates");
      break;
    case "agent_history":
      scopes.add("agent_runs_search");
      scopes.add("twitter_replies_recent");
      break;
  }

  const historyQuery = classification?.history_query ?? {};
  const tokenAddress = firstTokenAddress(
    historyQuery.token_address,
    historyQuery.token_mint,
    extracted.mints[0],
    thread?.detected_mints?.[0],
  );
  const tokenSymbol = historyQuery.token_symbol ?? extracted.symbols[0] ??
    thread?.detected_symbols?.[0] ?? null;

  return {
    scopes: [...scopes],
    query: {
      token_symbol: tokenSymbol,
      token_address: tokenAddress,
      token_mint: tokenAddress,
      action: historyQuery.action ?? null,
      text: historyQuery.text ?? tweetText ?? null,
      time_range: historyQuery.time_range ?? timeRange,
      limit: clampLimit(historyQuery.limit, 10),
      sort: historyQuery.sort ??
        (/(biggest|largest)/i.test(tweetText ?? "") ? "largest_usd" : "recent"),
    },
    reason: classification?.reason ?? "history plan for " + intent,
  };
}

export async function retrieveUserHistory(
  admin: any,
  userId: string,
  request: HistoryRetrievalRequest,
  options: { walletPublicKey?: string | null } = {},
): Promise<HistoryRetrievalResult> {
  const scopes = uniqueScopes(request.scopes);
  const query = {
    ...request.query,
    limit: clampLimit(request.query?.limit, 10),
  };
  const results: Record<string, any> = {};

  if (scopes.includes("wallet_balance") && options.walletPublicKey) {
    results.wallet_balance = {
      eth: await safe(() => getEthBalance(options.walletPublicKey!), null),
    };
  }

  if (scopes.includes("portfolio_holdings") && options.walletPublicKey) {
    const [eth, tokenAccounts] = await Promise.all([
      safe(() => getEthBalance(options.walletPublicKey!), null),
      safe(() => getErc20TokenBalances(options.walletPublicKey!), [] as any[]),
    ]);
    results.portfolio_holdings = {
      eth,
      tokens: tokenAccounts.filter((a: any) => Number(a.amount ?? 0) > 0).slice(
        0,
        50,
      ),
    };
  }

  if (scopes.includes("pending_actions")) {
    const { data } = await admin
      .from("pending_actions")
      .select(
        "id,tweet_id,intent,action_payload,confirmation_phrase,expires_at,status,created_at",
      )
      .eq("user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(query.limit);
    results.pending_actions = data ?? [];
  }

  if (scopes.some((s) => s.startsWith("transactions_"))) {
    results.transactions = await retrieveTransactions(
      admin,
      userId,
      scopes,
      query,
    );
  }

  if (scopes.some((s) => s.startsWith("launches_"))) {
    results.launches = await retrieveLaunches(admin, userId, scopes, query);
  }

  if (scopes.includes("coin_settings_updates")) {
    const { data } = await admin
      .from("coin_settings_updates")
      .select(
        "id,coin_launch_id,tweet_id,new_config,tx_signature,status,created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(query.limit);
    results.coin_settings_updates = data ?? [];
  }

  if (
    scopes.includes("agent_runs_recent") || scopes.includes("agent_runs_search")
  ) {
    let q = admin
      .from("agent_runs")
      .select(
        "id,tweet_id,intent,classification,extraction,confidence,requires_confirmation,status,error,created_at,completed_at",
      )
      .eq("user_id", userId);
    q = applyTimeRange(q, query.time_range);
    const { data } = await q.order("created_at", { ascending: false }).limit(
      query.limit,
    );
    results.agent_runs = data ?? [];
  }

  if (scopes.includes("twitter_replies_recent")) {
    results.twitter_replies = await retrieveTwitterReplies(
      admin,
      userId,
      query.limit,
    );
  }

  if (scopes.includes("memory_search")) {
    results.memory = await searchMemory(
      admin,
      userId,
      query.text ?? "",
      query.limit,
    );
  }

  const normalizedRequest = { ...request, scopes, query };
  const result = { request: normalizedRequest, results, summary: "" };
  result.summary = summarizeRetrievedHistory(result);
  return result;
}

async function retrieveTransactions(
  admin: any,
  userId: string,
  scopes: HistoryScope[],
  query: HistoryQuery,
) {
  let q = admin
    .from("transactions")
    .select(
      "id,tweet_id,action,chain,input_mint,output_mint,amount_original,amount_original_unit,amount_eth,amount_sol,amount_usd,eth_price_usd,slippage_bps,tx_hash,tx_signature,status,created_at,confirmed_at",
    )
    .eq("user_id", userId);

  const tokenAddress = query.token_address ?? query.token_mint;
  if (scopes.includes("transactions_by_token") && tokenAddress) {
    q = q.or(
      "input_mint.eq." + tokenAddress + ",output_mint.eq." + tokenAddress,
    );
  }
  if (
    query.action && ["buy", "sell", "burn", "transfer"].includes(query.action)
  ) {
    q = q.eq("action", query.action);
  }
  q = applyTimeRange(q, query.time_range);
  q = orderTransactions(q, query.sort);
  const { data } = await q.limit(clampLimit(query.limit));
  return (data ?? []).map(sanitizeTransaction);
}

async function retrieveLaunches(
  admin: any,
  userId: string,
  scopes: HistoryScope[],
  query: HistoryQuery,
) {
  let q = admin
    .from("coin_launches")
    .select(
      "id,tweet_id,name,symbol,description,image_url,mint,token_address,tx_signature,dev_buy_original_amount,dev_buy_original_unit,dev_buy_eth,dev_buy_sol,dev_buy_usd,status,created_at,chain,launch_platform",
    )
    .eq("user_id", userId);

  if (scopes.includes("launches_by_symbol") && query.token_symbol) {
    q = q.ilike("symbol", query.token_symbol.replace(/^\$/, ""));
  } else if (scopes.includes("launches_search") && query.text) {
    const term = query.token_symbol?.replace(/^\$/, "") ||
      query.text.split(/\s+/).find((w) => w.length > 2) ||
      "";
    if (term) {
      q = q.or(
        "symbol.ilike.%" + term + "%,name.ilike.%" + term +
          "%,description.ilike.%" + term + "%",
      );
    }
  }
  q = applyTimeRange(q, query.time_range);
  const { data } = await q
    .order("created_at", { ascending: query.sort === "oldest" })
    .limit(clampLimit(query.limit));
  return (data ?? []).map(sanitizeLaunch);
}

async function retrieveTwitterReplies(
  admin: any,
  userId: string,
  limit: number,
) {
  const { data: profile } = await admin
    .from("profiles")
    .select("twitter_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.twitter_id) return [];
  const { data: tweets } = await admin
    .from("tweets_inbox")
    .select("tweet_id")
    .eq("author_twitter_id", profile.twitter_id)
    .limit(50);
  const ids = (tweets ?? []).map((t: any) => t.tweet_id);
  if (ids.length === 0) return [];
  const { data } = await admin
    .from("twitter_replies")
    .select("tweet_id,reply_text,reply_tweet_id,status,posted_at,created_at")
    .in("tweet_id", ids)
    .order("created_at", { ascending: false })
    .limit(clampLimit(limit));
  return (data ?? []).map((r: any) => ({
    ...r,
    reply_text: truncate(r.reply_text, 500),
  }));
}

async function searchMemory(
  admin: any,
  userId: string,
  text: string,
  limit: number,
) {
  const cleaned = text.trim().slice(0, 180);
  if (!cleaned) {
    const { data } = await admin
      .from("user_memory_index")
      .select("source_type,source_id,title,searchable_text,metadata,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(clampLimit(limit));
    return (data ?? []).map((r: any) => ({
      ...r,
      searchable_text: truncate(r.searchable_text),
    }));
  }

  const { data, error } = await admin
    .from("user_memory_index")
    .select("source_type,source_id,title,searchable_text,metadata,created_at")
    .eq("user_id", userId)
    .textSearch("searchable_text", cleaned, {
      type: "plain",
      config: "english",
    })
    .order("created_at", { ascending: false })
    .limit(clampLimit(limit));

  if (!error && data?.length) {
    return data.map((r: any) => ({
      ...r,
      searchable_text: truncate(r.searchable_text),
    }));
  }

  const term = cleaned.split(/\s+/).find((w) => w.length > 3) ??
    cleaned.split(/\s+/)[0];
  const fallback = await admin
    .from("user_memory_index")
    .select("source_type,source_id,title,searchable_text,metadata,created_at")
    .eq("user_id", userId)
    .ilike("searchable_text", "%" + term + "%")
    .order("created_at", { ascending: false })
    .limit(clampLimit(limit));
  return (fallback.data ?? []).map((r: any) => ({
    ...r,
    searchable_text: truncate(r.searchable_text),
  }));
}

export function summarizeRetrievedHistory(
  result: HistoryRetrievalResult,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(result.results ?? {})) {
    if (Array.isArray(value)) parts.push(key + ": " + value.length);
    else if (value && typeof value === "object") {
      const count = Array.isArray((value as any).tokens)
        ? (value as any).tokens.length
        : 1;
      parts.push(key + ": " + count);
    }
  }
  return parts.length ? parts.join(" | ") : "no user history retrieved";
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}
