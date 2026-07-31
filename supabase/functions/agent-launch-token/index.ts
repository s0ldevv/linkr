// Thin authenticated launch acceptance. Chain SDKs, wallet secrets, media
// capture, signing, and broadcast are exclusively owned by queue workers.
// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import {
  recordAgentRequest,
  requireAgentApiKey,
} from "../_shared/agent_api_auth.ts";
import { stringField } from "../_shared/agent_api_core.ts";
import { rehostLaunchImageUrl } from "../_shared/bounded_media.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { readLaunchCooldown } from "../_shared/launch_cooldown.ts";

type LaunchChain = "robinhood" | "solana";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());

  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "launch:write", {
      requireIdempotency: true,
    });
    const chain = normalizeChain(ctx.body.chain);
    const limits = chain === "solana"
      ? { name: 32, symbol: 10 }
      : { name: 60, symbol: 20 };
    const name = stringField(ctx.body, ["name"], {
      required: true,
      max: limits.name,
    })!;
    const symbol = stringField(ctx.body, ["symbol"], {
      required: true,
      max: limits.symbol,
    })!.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (!symbol) throw badRequest("invalid_symbol");
    const description = stringField(ctx.body, ["description"], {
      required: true,
      max: 512,
    })!;
    const requestedImageUrl = requiredHttps(
      stringField(ctx.body, ["image_url", "image"], {
        required: true,
        max: 2048,
      }),
      "invalid_image_url",
    );
    if (ctx.body.dry_run !== true) {
      const cooldown = await readLaunchCooldown(admin, ctx.userId);
      if (!cooldown.allowed) {
        throw new AgentApiError(
          "launch_cooldown_active",
          429,
          "You already launched a coin recently.",
          {
            retry_after_seconds: cooldown.retry_after_seconds,
            cooldown_until: cooldown.cooldown_until,
          },
        );
      }
    }
    // Re-host external images into trusted storage now so the media-capture
    // worker (which only fetches trusted hosts) can always process the launch.
    let imageUrl: string;
    try {
      imageUrl = await rehostLaunchImageUrl(admin, requestedImageUrl);
    } catch (error) {
      throw badRequest(
        `image_unusable:${
          String((error as Error)?.message ?? error).slice(0, 80)
        }`,
      );
    }
    const wallet = await selectWallet(admin, ctx, chain);
    const amount = readInitialBuy(ctx.body, chain);
    enforceAmountCap(ctx, chain, amount);
    const creatorRewardsConfig = chain === "solana"
      ? await resolveCreatorRewards(admin, ctx, wallet, ctx.body)
      : null;
    const payload = {
      schema_version: 1,
      name,
      symbol,
      description,
      image_url: imageUrl,
      chain,
      wallet_id: wallet.id,
      ...(chain === "solana"
        ? { dev_buy_sol: amount, creator_rewards_config: creatorRewardsConfig }
        : { dev_buy_eth: amount }),
      website_url: optionalHttps(ctx.body.website_url ?? ctx.body.website),
      twitter_url: optionalHttps(
        ctx.body.twitter_url ?? ctx.body.twitter ?? ctx.body.x_url ??
          ctx.body.x,
      ),
      telegram_url: optionalHttps(ctx.body.telegram_url ?? ctx.body.telegram),
      source_url: optionalHttps(ctx.body.source_url),
    };

    if (ctx.body.dry_run === true) {
      const solanaCost = chain === "solana"
        ? await solanaLaunchDryRunCost({
          wallet,
          name,
          symbol,
          description,
          imageUrl,
          amount,
          creatorRewardsConfig,
          body: ctx.body,
        })
        : null;
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({
        dry_run: true,
        validation_only: true,
        chain,
        wallet_id: wallet.id,
        wallet_address: wallet.address ?? wallet.public_key,
        initial_buy: amount,
        ...(solanaCost ?? {}),
        execution_model: "durable_async_queue",
      });
    }

    const accepted = await admin.rpc("accept_linkr_launch_request_v1", {
      p_user_id: ctx.userId,
      p_source_surface: "agent_api",
      p_source_event_id: ctx.nonce,
      p_idempotency_key: `${ctx.apiKeyId}:${ctx.idempotencyKey}`,
      p_chain: chain,
      p_wallet_id: wallet.id,
      p_payload: payload,
    });
    if (accepted.error) throw accepted.error;
    await recordAgentRequest(admin, ctx, req, 202);
    return agentJsonResponse({
      ...accepted.data,
      status_url: `https://linkr.cash/api/actions/${accepted.data.action_id}`,
    }, { status: 202 });
  } catch (error) {
    await recordAgentRequest(
      admin,
      ctx ?? {},
      req,
      (error as any)?.status ?? 500,
      error,
    ).catch(() => {});
    return agentErrorResponse(error);
  }
});

function normalizeChain(value: unknown): LaunchChain {
  const chain = String(value ?? "robinhood").trim().toLowerCase();
  if (chain === "robinhood" || chain === "evm" || chain === "4663") {
    return "robinhood";
  }
  if (chain === "solana" || chain === "sol" || chain === "pump_fun") {
    return "solana";
  }
  throw badRequest("unsupported_chain");
}

async function selectWallet(admin: any, ctx: any, chain: LaunchChain) {
  if (chain === "robinhood") {
    if (
      !ctx.wallet || ctx.wallet.wallet_type !== "evm" ||
      Number(ctx.wallet.chain_id) !== 4663
    ) throw badRequest("robinhood_wallet_not_bound");
    return ctx.wallet;
  }
  const result = await admin.from("wallets").select(
    "id,user_id,public_key,address,wallet_type,chain_id,is_primary",
  ).eq("user_id", ctx.userId).eq("wallet_type", "solana")
    .order("is_primary", { ascending: false }).order("created_at", {
      ascending: true,
    }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw badRequest("solana_wallet_not_found");
  return result.data;
}

function readInitialBuy(body: any, chain: LaunchChain): number {
  const value = chain === "solana"
    ? body.initial_buy_sol ?? body.dev_buy_sol ?? "0"
    : body.initial_buy_eth ?? body.dev_buy_eth ?? "0";
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(text)) {
    throw badRequest("invalid_initial_buy");
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) {
    throw badRequest("invalid_initial_buy");
  }
  return amount;
}

function enforceAmountCap(ctx: any, chain: LaunchChain, amount: number) {
  const profileCap = Number(
    chain === "solana"
      ? ctx.profile?.max_auto_dev_buy_sol ?? 0
      : ctx.profile?.max_auto_dev_buy_eth ?? 0,
  );
  const keyCap = Number(
    chain === "solana"
      ? ctx.apiKey.max_launch_initial_buy_sol ?? profileCap
      : ctx.apiKey.max_launch_initial_buy_eth ?? profileCap,
  );
  const absoluteCap = chain === "solana" ? 5 : 0.1;
  const allowed = Math.min(
    absoluteCap,
    Number.isFinite(profileCap) ? Math.max(0, profileCap) : 0,
    Number.isFinite(keyCap) ? Math.max(0, keyCap) : 0,
  );
  if (amount > allowed) {
    throw new AgentApiError(
      "launch_cap_exceeded",
      400,
      `Initial buy exceeds the configured ${
        chain === "solana" ? "SOL" : "ETH"
      } limit.`,
      { maximum: allowed },
    );
  }
}

async function solanaLaunchDryRunCost(args: {
  wallet: any;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  amount: number;
  creatorRewardsConfig: any;
  body: any;
}): Promise<Record<string, unknown>> {
  try {
    const pump = await import("../_shared/solana_launch/pump_adapter.ts");
    const estimate = await pump.estimatePumpFunLaunchFundingLamports(
      {
        launchId: "agent-api-dry-run",
        name: args.name,
        symbol: args.symbol,
        description: args.description,
        imageUrl: args.imageUrl,
        initialBuySol: 0,
        cashback: args.creatorRewardsConfig?.pump_cashback_enabled === true,
        creatorRewardsConfig: args.creatorRewardsConfig ?? null,
        websiteUrl: optionalHttps(args.body.website_url ?? args.body.website),
        twitterUrl: optionalHttps(
          args.body.twitter_url ?? args.body.twitter ?? args.body.x_url ??
            args.body.x,
        ),
        telegramUrl: optionalHttps(
          args.body.telegram_url ?? args.body.telegram,
        ),
        mayhemMode: Boolean(args.body.mayhem_mode),
      },
      {
        creatorWalletAddress: String(
          args.wallet.address ?? args.wallet.public_key ?? "",
        ),
      },
    );
    const initialBuyLamports = solToLamports(args.amount);
    const requiredBalanceLamports = estimate.fundingTargetLamports +
      initialBuyLamports;
    return {
      launch_cost_estimate_status: estimate.source,
      launch_cost_estimator_version: estimate.estimatorVersion,
      minimum_launch_cost_lamports: estimate.minimumLaunchLamports.toString(),
      minimum_launch_cost_sol: lamportsToSol(estimate.minimumLaunchLamports),
      funding_buffer_lamports: estimate.bufferLamports.toString(),
      funding_target_lamports: estimate.fundingTargetLamports.toString(),
      funding_target_sol: lamportsToSol(estimate.fundingTargetLamports),
      initial_buy_lamports: initialBuyLamports.toString(),
      required_balance_lamports: requiredBalanceLamports.toString(),
      required_balance_sol: lamportsToSol(requiredBalanceLamports),
      dev_buy_excluded_from_linkr_funding: true,
    };
  } catch (error) {
    return {
      launch_cost_estimate_status: "unavailable",
      launch_cost_estimate_error: String(
        error instanceof Error ? error.message : error,
      ).slice(0, 160),
      dev_buy_excluded_from_linkr_funding: true,
    };
  }
}

async function resolveCreatorRewards(
  admin: any,
  ctx: any,
  wallet: any,
  body: any,
) {
  const creator = String(wallet.address ?? wallet.public_key ?? "").trim();
  const mode =
    body.pump_cashback === true || body.pump_reward_mode === "cashback"
      ? "cashback"
      : "creator_rewards";
  const target = String(
    body.creator_reward_recipient ?? body.creator_rewards_recipient ?? "",
  ).trim();
  let recipient: any = null;
  if (target) recipient = await resolveSolanaRecipient(admin, target);
  const requestedBps = recipient
    ? boundedInteger(body.creator_reward_share_bps ?? 2500, 1, 10_000)
    : 0;
  const recipients = recipient && recipient.address !== creator
    ? [
      rewardRow(creator, 10_000 - requestedBps, "creator_wallet", ctx),
      rewardRow(recipient.address, requestedBps, recipient.source, recipient),
    ].filter((row) => row.shareBps > 0)
    : [rewardRow(creator, 10_000, "creator_wallet", ctx)];
  return {
    version: 1,
    source: "agent_api",
    chain: "solana",
    platform: "pump_fun",
    mode,
    pump_reward_mode: mode === "cashback" ? "cashback" : "creator",
    pump_cashback_enabled: mode === "cashback",
    selected_wallet_id: wallet.id,
    creator_address: creator,
    creator_wallet_id: wallet.id,
    requested_recipient_share_bps: requestedBps,
    creator_share_bps: 10_000 - requestedBps,
    configurable_on_chain: true,
    should_update_on_chain: Boolean(recipient && recipient.address !== creator),
    recipients,
    share_request: {
      target: target
        ? (/^@/.test(target)
          ? { kind: "x_handle", handle: target.replace(/^@/, "") }
          : { kind: "wallet", address: target })
        : null,
      explicit: Boolean(target),
      share_bps: recipient ? requestedBps : null,
      share_percent: recipient ? requestedBps / 100 : null,
      defaulted_to_100_percent: false,
    },
    notes: "Resolved by thin agent launch acceptance.",
  };
}

async function resolveSolanaRecipient(admin: any, target: string) {
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(target)) {
    return { address: target, source: "wallet_address" };
  }
  const handle = target.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    throw badRequest("creator_rewards_recipient_invalid");
  }
  const profile = await admin.from("profiles").select(
    "user_id,twitter_username,twitter_id",
  ).ilike("twitter_username", handle).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) throw badRequest("creator_rewards_recipient_not_found");
  const wallet = await admin.from("wallets").select("id,address,public_key")
    .eq("user_id", profile.data.user_id).eq("wallet_type", "solana")
    .order("is_primary", { ascending: false }).order("created_at", {
      ascending: true,
    }).limit(1).maybeSingle();
  if (wallet.error) throw wallet.error;
  if (!wallet.data) throw badRequest("creator_rewards_wallet_not_found");
  return {
    address: wallet.data.address ?? wallet.data.public_key,
    source: "x_handle",
    userId: profile.data.user_id,
    walletId: wallet.data.id,
    twitterUsername: profile.data.twitter_username,
    twitterId: profile.data.twitter_id,
  };
}

function rewardRow(
  address: string,
  shareBps: number,
  source: string,
  row: any,
) {
  return {
    address,
    label: source === "creator_wallet" ? "Creator" : "Shared creator rewards",
    role: source === "creator_wallet" ? "creator" : "shared_creator_rewards",
    shareBps,
    sharePercent: shareBps / 100,
    source,
    userId: row.userId ?? row.user_id ?? null,
    walletId: row.walletId ?? row.id ?? null,
    twitterUsername: row.twitterUsername ?? null,
    twitterId: row.twitterId ?? null,
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw badRequest("creator_reward_share_invalid");
  }
  return number;
}

function solToLamports(value: number): bigint {
  const text = value.toFixed(9);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 1_000_000_000n +
    BigInt((fraction + "0".repeat(9)).slice(0, 9));
}

function lamportsToSol(value: bigint): number {
  return Number(value) / 1_000_000_000;
}

function requiredHttps(value: unknown, code: string): string {
  const text = String(value ?? "").trim();
  if (!/^https:\/\//i.test(text)) throw badRequest(code);
  return text;
}

function optionalHttps(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 2048 || !/^https:\/\//i.test(text)) {
    throw badRequest("invalid_metadata_url");
  }
  return text;
}

function badRequest(code: string): AgentApiError {
  return new AgentApiError(code, 400);
}
