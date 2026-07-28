// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { internalErrorResponse } from "../_shared/http.ts";
import {
  ROBINHOOD_CHAIN_ID,
  getAddressExplorerUrl,
  getEthBalance,
} from "../_shared/robinhood_chain.ts";
import { getEthUsdPrice } from "../_shared/eth_price.ts";
import { getSolUsdPrice } from "../_shared/sol_price.ts";

const LAMPORTS_PER_SOL = 1_000_000_000;

const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const X_USER_CACHE_TTL_MS = 15 * 60 * 1000;
const X_USER_FIELDS =
  "id,username,name,description,profile_image_url,profile_banner_url,public_metrics,created_at,location,url,verified,verified_type,protected";
const X_USER_FIELDS_MINIMAL =
  "id,username,name,description,profile_image_url,public_metrics,created_at,location,url,verified,protected";

const INQUIRY_INTENTS = [
  "coin_inquiry",
  "general_inquiry",
  "help",
  "wallet_balance",
  "portfolio",
  "transaction_history",
  "launch_history",
  "settings_history",
  "agent_history",
  "recent_activity",
  "deposit_address",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });

  const username = (new URL(req.url).searchParams.get("username") ?? "").trim().replace(/^@/, "");
  if (!USERNAME_PATTERN.test(username)) {
    return jsonResponse({ error: "invalid_username" }, { status: 400 });
  }

  const admin = serviceClient();

  try {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select(
        "user_id,twitter_id,twitter_username,twitter_name,twitter_profile_image_url,created_at",
      )
      .ilike("twitter_username", username)
      .maybeSingle();
    if (profileError) throw profileError;

    const twitter = await loadTwitterInfo(admin, username, profile);
    if (!profile && !twitter) {
      return jsonResponse({ error: "user_not_found" }, { status: 404 });
    }

    const authorTwitterId = profile?.twitter_id ?? twitter?.id ?? null;

    const [posts, launches, trades, inquiries, statsResult, wallet, solWallet, comments] = await Promise.all([
      loadPosts(admin, authorTwitterId, username),
      profile ? loadLaunches(admin, profile.user_id) : Promise.resolve([]),
      profile ? loadTrades(admin, profile.user_id) : Promise.resolve([]),
      profile ? loadInquiries(admin, profile.user_id) : Promise.resolve([]),
      profile
        ? safe<any>(async () => await admin.rpc("get_user_profile_stats", { p_user_id: profile.user_id }), {
            data: null,
          })
        : Promise.resolve({ data: null }),
      profile ? loadWallet(admin, profile.user_id) : Promise.resolve(null),
      profile ? loadSolWallet(admin, profile.user_id) : Promise.resolve(null),
      profile ? loadComments(admin, profile.user_id) : Promise.resolve([]),
    ]);

    return jsonResponse({
      username: profile?.twitter_username ?? twitter?.username ?? username,
      isLinkrUser: Boolean(profile),
      profile: profile
        ? {
            userId: profile.user_id,
            username: profile.twitter_username,
            name: profile.twitter_name,
            avatarUrl: profile.twitter_profile_image_url,
            joinedLinkrAt: profile.created_at,
          }
        : null,
      twitter,
      wallet,
      solWallet,
      posts,
      launches,
      trades,
      inquiries,
      comments,
      stats: statsResult?.data ?? null,
    });
  } catch (error) {
    return internalErrorResponse(error, { function: "user-profile-data" });
  }
});

async function loadTwitterInfo(admin: any, username: string, profile: any) {
  const cacheKey = `x_user_profile:${username.toLowerCase()}`;
  const cached = await safe(async () => {
    const { data } = await admin
      .from("app_state")
      .select("value")
      .eq("key", cacheKey)
      .maybeSingle();
    return data?.value ?? null;
  }, null);

  const cachedAt = cached?.fetched_at ? new Date(cached.fetched_at).getTime() : 0;
  if (cached?.user && Date.now() - cachedAt < X_USER_CACHE_TTL_MS) {
    return { ...cached.user, source: "cached" };
  }

  const live = await safe(() => fetchXUser(username), null);
  if (live) {
    await safe(
      () =>
        admin
          .from("app_state")
          .upsert(
            { key: cacheKey, value: { user: live, fetched_at: new Date().toISOString() } },
            { onConflict: "key" },
          ),
      null,
    );
    return { ...live, source: "live" };
  }

  // Stale cache beats nothing when the X API is unavailable or rate limited.
  if (cached?.user) return { ...cached.user, source: "cached" };

  if (!profile) return null;
  return {
    id: profile.twitter_id,
    username: profile.twitter_username ?? username,
    name: profile.twitter_name,
    bio: null,
    avatarUrl: upscaleXAvatar(profile.twitter_profile_image_url),
    bannerUrl: null,
    location: null,
    url: null,
    verified: false,
    protected: false,
    createdAt: null,
    followers: null,
    following: null,
    tweetCount: null,
    listedCount: null,
    source: "stored",
  };
}

async function fetchXUser(username: string) {
  const bearer = Deno.env.get("X_BEARER_TOKEN");
  if (!bearer) return null;

  const request = (fields: string) =>
    fetch(
      `https://api.x.com/2/users/by/username/${username}?user.fields=${encodeURIComponent(fields)}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );

  let response = await request(X_USER_FIELDS);
  if (response.status === 400) {
    response = await request(X_USER_FIELDS_MINIMAL);
  }
  if (!response.ok) return null;

  const body = await response.json();
  const user = body?.data;
  if (!user?.id) return null;

  const metrics = user.public_metrics ?? {};
  return {
    id: String(user.id),
    username: user.username ?? username,
    name: user.name ?? null,
    bio: user.description || null,
    avatarUrl: upscaleXAvatar(user.profile_image_url),
    bannerUrl: user.profile_banner_url ?? null,
    location: user.location || null,
    url: user.url || null,
    verified: Boolean(user.verified) || (user.verified_type && user.verified_type !== "none"),
    protected: Boolean(user.protected),
    createdAt: user.created_at ?? null,
    followers: numberOrNull(metrics.followers_count),
    following: numberOrNull(metrics.following_count),
    tweetCount: numberOrNull(metrics.tweet_count),
    listedCount: numberOrNull(metrics.listed_count),
  };
}

async function loadPosts(admin: any, authorTwitterId: string | null, username: string) {
  let query = admin
    .from("tweets_inbox")
    .select("id,tweet_id,text,tweet_url,status,has_media,media_url,created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  query = authorTwitterId
    ? query.eq("author_twitter_id", authorTwitterId)
    : query.ilike("author_username", username);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];

  const intents = await safe(async () => {
    const tweetIds = rows.map((row: any) => row.tweet_id).filter(Boolean);
    if (tweetIds.length === 0) return new Map<string, string>();
    const { data: runs } = await admin
      .from("agent_runs")
      .select("tweet_id,intent")
      .in("tweet_id", tweetIds);
    return new Map<string, string>(
      (runs ?? [])
        .filter((run: any) => run.tweet_id && run.intent)
        .map((run: any) => [String(run.tweet_id), String(run.intent)]),
    );
  }, new Map<string, string>());

  return rows.map((row: any) => ({
    id: row.id,
    tweetId: row.tweet_id,
    text: row.text,
    url: row.tweet_url ?? (row.tweet_id ? `https://x.com/i/web/status/${row.tweet_id}` : null),
    status: row.status,
    hasMedia: Boolean(row.has_media),
    mediaUrl: row.media_url,
    createdAt: row.created_at,
    intent: intents.get(String(row.tweet_id)) ?? null,
  }));
}

async function loadLaunches(admin: any, userId: string) {
  const { data, error } = await admin
    .from("coin_launches")
    .select(
      "id,name,symbol,description,image_url,mint,token_address,status,dev_buy_eth,dev_buy_sol,dev_buy_usd,created_at,chain,launch_platform",
    )
    .eq("user_id", userId)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    description: row.description,
    imageUrl: row.image_url,
    mint: row.mint,
    tokenAddress: row.token_address ?? row.mint,
    status: row.status,
    chain: row.chain ?? "robinhood",
    launchPlatform: row.launch_platform ?? null,
    devBuyEth: numberOrNull(row.dev_buy_eth),
    devBuySol: numberOrNull(row.dev_buy_sol),
    devBuyUsd: numberOrNull(row.dev_buy_usd),
    createdAt: row.created_at,
  }));
}

async function loadTrades(admin: any, userId: string) {
  const { data, error } = await admin
    .from("transactions")
    .select(
      "id,action,input_mint,output_mint,amount_original,amount_original_unit,amount_eth,amount_usd,tx_hash,tx_signature,explorer_url,status,created_at",
    )
    .eq("user_id", userId)
    .in("action", ["buy", "sell", "transfer"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    action: row.action,
    inputMint: row.input_mint,
    outputMint: row.output_mint,
    amountOriginal: numberOrNull(row.amount_original),
    amountOriginalUnit: row.amount_original_unit,
    amountEth: numberOrNull(row.amount_eth),
    amountUsd: numberOrNull(row.amount_usd),
    txHash: row.tx_hash ?? row.tx_signature,
    txSignature: row.tx_hash ?? row.tx_signature,
    explorerUrl: row.explorer_url ?? null,
    status: row.status,
    createdAt: row.created_at,
  }));
}

async function loadInquiries(admin: any, userId: string) {
  const { data, error } = await admin
    .from("agent_runs")
    .select("id,tweet_id,intent,status,created_at")
    .eq("user_id", userId)
    .in("intent", INQUIRY_INTENTS)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  const rows = data ?? [];

  const texts = await safe(async () => {
    const tweetIds = rows.map((row: any) => row.tweet_id).filter(Boolean);
    if (tweetIds.length === 0) return new Map<string, string>();
    const { data: tweets } = await admin
      .from("tweets_inbox")
      .select("tweet_id,text")
      .in("tweet_id", tweetIds);
    return new Map<string, string>(
      (tweets ?? []).map((tweet: any) => [String(tweet.tweet_id), String(tweet.text ?? "")]),
    );
  }, new Map<string, string>());

  return rows.map((row: any) => ({
    id: row.id,
    intent: row.intent,
    status: row.status,
    tweetId: row.tweet_id,
    text: row.tweet_id ? (texts.get(String(row.tweet_id)) ?? null) : null,
    createdAt: row.created_at,
  }));
}

async function loadWallet(admin: any, userId: string) {
  const { data, error } = await admin
    .from("wallets")
    .select("public_key,address,chain_id,wallet_type,explorer_url")
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const address = data?.address ?? data?.public_key;
  if (!address) return null;

  const [ethBalance, ethPrice] = await Promise.all([
    safe(() => getEthBalance(address), null),
    safe(() => getEthUsdPrice(admin), null),
  ]);

  return {
    publicKey: address,
    address,
    chainId: ROBINHOOD_CHAIN_ID,
    explorerUrl: data.explorer_url ?? getAddressExplorerUrl(address),
    ethBalance,
    ethUsdPrice: ethPrice?.price ?? null,
    usdValue: ethBalance != null && ethPrice?.price != null ? ethBalance * ethPrice.price : null,
  };
}

function upscaleXAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace("_normal.", "_400x400.");
}

async function loadSolWallet(admin: any, userId: string) {
  const { data, error } = await admin
    .from("wallets")
    .select("public_key,wallet_type,explorer_url")
    .eq("user_id", userId)
    .eq("wallet_type", "solana")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const address = data?.public_key;
  if (!address) return null;

  const [lamports, priceInfo] = await Promise.all([
    safe(() => fetchSolBalanceLamports(address), null as number | null),
    safe(() => getSolUsdPrice(admin), null as { price: number; source: string } | null),
  ]);
  const solBalance = lamports != null ? lamports / LAMPORTS_PER_SOL : null;
  const solPrice = priceInfo?.price ?? null;

  return {
    publicKey: address,
    address,
    explorerUrl: data.explorer_url ?? `https://solscan.io/account/${encodeURIComponent(address)}`,
    solBalance,
    solUsdPrice: solPrice,
    usdValue: solBalance != null && solPrice != null ? solBalance * solPrice : null,
  };
}

async function fetchSolBalanceLamports(address: string): Promise<number | null> {
  const candidates = [
    Deno.env.get("HELIUS_RPC_URL")?.trim(),
    Deno.env.get("SOLANA_RPC_URL")?.trim(),
    "https://api.mainnet-beta.solana.com",
  ].filter((url): url is string => Boolean(url));
  for (const rpc of candidates) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [address, { commitment: "confirmed" }],
        }),
      });
      if (!response.ok) continue;
      const json = await response.json();
      const value = json?.result?.value;
      if (typeof value === "number") return value;
    } catch (_) {
      continue;
    }
  }
  return null;
}

async function loadComments(admin: any, userId: string) {
  const [coinRowsRes, nftRowsRes] = await Promise.all([
    admin
      .from("coin_comments")
      .select("id,mint,chain,body,like_count,reply_count,parent_id,created_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(15),
    admin
      .from("nft_collection_comments")
      .select("id,collection_id,body,like_count,reply_count,parent_id,created_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);
  if (coinRowsRes.error) throw coinRowsRes.error;
  if (nftRowsRes.error && nftRowsRes.error.code !== "42P01") throw nftRowsRes.error;

  const coinRows = coinRowsRes.data ?? [];
  const nftRows = nftRowsRes.data ?? [];

  const mints = Array.from(new Set(coinRows.map((r: any) => r.mint).filter(Boolean)));
  const launchInfo = await safe(async () => {
    if (mints.length === 0) return new Map<string, any>();
    const { data: launches } = await admin
      .from("coin_launches")
      .select("mint,name,symbol,image_url")
      .in("mint", mints);
    return new Map<string, any>((launches ?? []).map((l: any) => [String(l.mint), l]));
  }, new Map<string, any>());

  const collectionIds = Array.from(
    new Set(nftRows.map((r: any) => r.collection_id).filter(Boolean)),
  );
  const collectionInfo = await safe(async () => {
    if (collectionIds.length === 0) return new Map<string, any>();
    const { data: cols } = await admin
      .from("nft_collections")
      .select("id,name,symbol,image_url")
      .in("id", collectionIds);
    return new Map<string, any>((cols ?? []).map((c: any) => [String(c.id), c]));
  }, new Map<string, any>());

  const coinComments = coinRows.map((row: any) => {
    const coin = launchInfo.get(String(row.mint));
    return {
      id: row.id,
      target: "coin" as const,
      subjectId: row.mint,
      chain: row.chain,
      body: row.body,
      likeCount: numberOrNull(row.like_count) ?? 0,
      replyCount: numberOrNull(row.reply_count) ?? 0,
      isReply: Boolean(row.parent_id),
      createdAt: row.created_at,
      // Kept for backward compatibility with older clients:
      mint: row.mint,
      coinName: coin?.name ?? null,
      coinSymbol: coin?.symbol ?? null,
      coinImageUrl: coin?.image_url ?? null,
      subjectName: coin?.name ?? null,
      subjectSymbol: coin?.symbol ?? null,
      subjectImageUrl: coin?.image_url ?? null,
    };
  });

  const nftComments = nftRows.map((row: any) => {
    const col = collectionInfo.get(String(row.collection_id));
    return {
      id: row.id,
      target: "nft_collection" as const,
      subjectId: row.collection_id,
      chain: "solana",
      body: row.body,
      likeCount: numberOrNull(row.like_count) ?? 0,
      replyCount: numberOrNull(row.reply_count) ?? 0,
      isReply: Boolean(row.parent_id),
      createdAt: row.created_at,
      mint: null,
      coinName: null,
      coinSymbol: null,
      coinImageUrl: null,
      subjectName: col?.name ?? null,
      subjectSymbol: col?.symbol ?? null,
      subjectImageUrl: col?.image_url ?? null,
    };
  });

  return [...coinComments, ...nftComments]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20);
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}
