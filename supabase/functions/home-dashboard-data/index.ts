// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, getCallerUserId } from "../_shared/supabase.ts";
import { internalErrorResponse } from "../_shared/http.ts";
import {
  ROBINHOOD_CHAIN_ID,
  getAddressExplorerUrl,
  getErc20TokenBalances,
  getEthBalance,
} from "../_shared/robinhood_chain.ts";
import { getEthUsdPrice } from "../_shared/eth_price.ts";
import {
  loadPublicHomeData,
  readPublicHomeCache,
  writePublicHomeCache,
} from "../_shared/home_public_data.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });

  const admin = serviceClient();

  try {
    const userId = await getCallerUserId(req);
    const [publicData, viewer] = await Promise.all([
      loadCachedPublicHomeData(admin),
      userId ? loadViewerHomeData(admin, userId) : Promise.resolve(null),
    ]);

    return jsonResponse({
      public: publicData,
      viewer,
    });
  } catch (error) {
    return internalErrorResponse(error, { function: "home-dashboard-data" });
  }
});

async function loadCachedPublicHomeData(admin: any) {
  if (readBoolean("LINKR_HOME_CACHE_READ_ENABLED", true)) {
    const fresh = await safe(() => readPublicHomeCache(admin), null);
    if (fresh) return fresh;
  }

  const stale = await safe(() => readPublicHomeCache(admin, { allowStale: true }), null);
  try {
    const live = await loadPublicHomeData(admin);
    await safe(() => writePublicHomeCache(admin, live), null);
    return live;
  } catch (error) {
    if (stale) return stale;
    throw error;
  }
}

async function loadViewerHomeData(admin: any, userId: string) {
  const [
    profileResult,
    walletResult,
    pendingResult,
    transactionsResult,
    runsResult,
    launchesResult,
  ] = await Promise.all([
    admin.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("wallets")
      .select("public_key,address,chain_id,wallet_type,explorer_url")
      .eq("user_id", userId)
      .eq("wallet_type", "evm")
      .eq("chain_id", ROBINHOOD_CHAIN_ID)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("pending_actions")
      .select("id,tweet_id,intent,action_payload,confirmation_phrase,status,expires_at,created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("transactions")
      .select(
        "id,tweet_id,action,chain,input_mint,output_mint,amount_original,amount_original_unit,amount_eth,amount_sol,amount_usd,eth_price_usd,sol_price_usd,tx_hash,tx_signature,explorer_url,status,error,created_at,confirmed_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("agent_runs")
      .select(
        "id,tweet_id,intent,confidence,requires_confirmation,status,error,created_at,completed_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("coin_launches")
      .select(
        "id,tweet_id,name,symbol,description,image_url,mint,token_address,tx_signature,dev_buy_eth,dev_buy_sol,dev_buy_usd,status,created_at,chain,launch_platform",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  throwIfSupabaseError(profileResult.error);
  throwIfSupabaseError(walletResult.error);
  throwIfSupabaseError(pendingResult.error);
  throwIfSupabaseError(transactionsResult.error);
  throwIfSupabaseError(runsResult.error);
  throwIfSupabaseError(launchesResult.error);

  const profile = profileResult.data;
  const walletAddress = walletResult.data?.address ?? walletResult.data?.public_key ?? null;
  const ethPrice = await safe(() => getEthUsdPrice(admin), null);
  const wallet = walletAddress
    ? {
        publicKey: walletAddress,
        address: walletAddress,
        chainId: ROBINHOOD_CHAIN_ID,
        explorerUrl: walletResult.data?.explorer_url ?? getAddressExplorerUrl(walletAddress),
        ethBalance: await safe(() => getEthBalance(walletAddress), 0),
        ethUsdPrice: ethPrice?.price ?? null,
      }
    : null;
  const portfolio = wallet
    ? await buildPortfolio(wallet.publicKey, wallet.ethBalance, ethPrice?.price ?? null)
    : null;

  return {
    profile: profile
      ? {
          userId: profile.user_id,
          twitterUsername: profile.twitter_username,
          twitterName: profile.twitter_name,
          twitterProfileImageUrl: profile.twitter_profile_image_url,
          profileCompleted: Boolean(profile.profile_completed),
          requireConfirmationForAllTx: Boolean(profile.require_confirmation_for_all_tx),
          defaultSlippageBps: Number(profile.default_slippage_bps ?? 0),
          maxAutoBuyEth: Number(profile.max_auto_buy_eth ?? 0),
          maxAutoBuySol: Number(profile.max_auto_buy_sol ?? 0),
          maxAutoSellPercent: Number(profile.max_auto_sell_percent ?? 0),
          maxAutoTransferEth: Number(profile.max_auto_transfer_eth ?? 0),
          maxAutoTransferSol: Number(profile.max_auto_transfer_sol ?? 0),
          maxAutoDevBuyEth: Number(profile.max_auto_dev_buy_eth ?? 0),
          maxAutoDevBuySol: Number(profile.max_auto_dev_buy_sol ?? 0),
        }
      : null,
    wallet,
    portfolio,
    pendingActions: pendingResult.data ?? [],
    recentTransactions: transactionsResult.data ?? [],
    recentAgentRuns: runsResult.data ?? [],
    recentLaunches: launchesResult.data ?? [],
  };
}

async function buildPortfolio(publicKey: string, ethBalance: number, ethUsdPrice: number | null) {
  const tokenAccounts = await safe(() => getErc20TokenBalances(publicKey), [] as any[]);
  const held = tokenAccounts.filter((account: any) => Number(account.amount ?? 0) > 0).slice(0, 25);

  let knownUsd = ethUsdPrice != null ? ethBalance * ethUsdPrice : null;

  const holdings = held.map((account: any) => {
    const priceUsd = numberOrNull(account.priceUsd);
    const amount = Number(account.amount ?? 0);
    const valueUsd = priceUsd != null ? amount * priceUsd : null;
    if (valueUsd != null) knownUsd = (knownUsd ?? 0) + valueUsd;

    return {
      mint: account.mint ?? account.token_address,
      tokenAddress: account.token_address ?? account.mint,
      symbol: account.symbol ?? null,
      name: account.name ?? null,
      logoUrl: account.logoUrl ?? null,
      amount,
      decimals: Number(account.decimals ?? 0),
      priceUsd,
      valueUsd,
      priceChange24h: numberOrNull(account.priceChange24h),
    };
  });

  return {
    totalUsd: knownUsd,
    totalEthEquivalent: knownUsd != null && ethUsdPrice ? knownUsd / ethUsdPrice : null,
    change24hPercent: null,
    holdings,
  };
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function throwIfSupabaseError(error: unknown) {
  if (error) throw error;
}

function readBoolean(name: string, fallback: boolean) {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}
