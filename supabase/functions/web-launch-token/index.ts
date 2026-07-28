// Thin dashboard launch acceptance. It validates/authenticates, stores a
// bounded input image, atomically enqueues one durable item per chain, and
// returns 202. It never imports a chain SDK or reads wallet secrets.
// deno-lint-ignore-file no-explicit-any
import { rehostLaunchImageUrl } from "../_shared/bounded_media.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { readJsonBody, RequestBodyError } from "../_shared/http.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";

type LaunchChain = "robinhood" | "solana";
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const REQUEST_MAX_BYTES = 6 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  try {
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });
    const admin = serviceClient();
    if (req.method === "GET") {
      return jsonResponse(await launcherContext(admin, userId));
    }
    const body = await readJsonBody(req, REQUEST_MAX_BYTES) as any;
    const name = cleanText(body.name);
    const symbol = cleanSymbol(body.symbol);
    const description = cleanText(body.description);
    const requests = normalizeRequests(body);
    for (const request of requests) {
      validateText(request.chain, name, symbol, description);
    }
    const rawIdempotency = normalizeIdempotency(body.idempotency_key);
    const baseKey = `web-launch:${userId}:${rawIdempotency}`;
    const imageUrl = await resolveImage(admin, userId, baseKey, body);
    const profile = await admin.from("profiles").select(
      "max_auto_dev_buy_eth,max_auto_dev_buy_sol",
    ).eq("user_id", userId).maybeSingle();
    if (profile.error) throw profile.error;

    const results = [];
    for (const request of requests) {
      const walletId = requiredUuid(
        request.body.wallet_id ?? request.body.walletId,
        "missing_wallet_id",
      );
      const wallet = await loadWallet(admin, userId, walletId, request.chain);
      const amount = initialBuy(request.body, request.chain);
      enforceWebCap(amount, request.chain, profile.data);
      const childKey = requests.length === 1
        ? baseKey
        : `${baseKey}:chain:${request.chain}`;
      const creatorRewardsConfig = request.chain === "solana"
        ? await solanaRewards(admin, userId, wallet, request.body)
        : robinhoodRewards(wallet, request.body);
      const payload = {
        schema_version: 1,
        name,
        symbol,
        description,
        image_url: imageUrl,
        chain: request.chain,
        wallet_id: wallet.id,
        ...(request.chain === "solana"
          ? { dev_buy_sol: amount }
          : { dev_buy_eth: amount }),
        creator_rewards_config: creatorRewardsConfig,
        website_url: optionalHttps(body.website_url ?? body.website),
        twitter_url: optionalHttps(
          body.twitter_url ?? body.twitter ?? body.x_url ?? body.x,
        ),
        telegram_url: optionalHttps(body.telegram_url ?? body.telegram),
      };
      const accepted = await admin.rpc("accept_linkr_launch_request_v1", {
        p_user_id: userId,
        p_source_surface: "dashboard",
        p_source_event_id: childKey,
        p_idempotency_key: childKey,
        p_chain: request.chain,
        p_wallet_id: wallet.id,
        p_payload: payload,
      });
      if (accepted.error) throw accepted.error;
      results.push(accepted.data);
    }
    const response = requests.length === 1
      ? results[0]
      : { status: "queued", batch_id: baseKey, results };
    return jsonResponse(response, { status: 202 });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return jsonResponse({ error: error.code }, { status: error.status });
    }
    const message = String(error instanceof Error ? error.message : error)
      .slice(0, 240);
    return jsonResponse({ error: message }, { status: errorStatus(message) });
  }
});

async function launcherContext(admin: any, userId: string) {
  const result = await admin.from("wallets").select(
    "id,public_key,address,wallet_type,chain_id,explorer_url,is_primary,created_at",
  ).eq("user_id", userId).in("wallet_type", ["evm", "solana"])
    .order("wallet_type").order("is_primary", { ascending: false })
    .order("created_at");
  if (result.error) throw result.error;
  const wallets = (result.data ?? []).filter((wallet: any) =>
    wallet.wallet_type === "solana" ||
    (wallet.wallet_type === "evm" && Number(wallet.chain_id) === 4663)
  ).map((wallet: any) => {
    const chain = wallet.wallet_type === "solana" ? "solana" : "robinhood";
    const address = String(wallet.address ?? wallet.public_key ?? "");
    return {
      id: wallet.id,
      chain,
      public_key: address,
      address,
      is_primary: Boolean(wallet.is_primary),
      created_at: wallet.created_at,
      explorer_url: wallet.explorer_url ?? null,
      native_symbol: chain === "solana" ? "SOL" : "ETH",
      balance: null,
    };
  });
  return {
    wallets,
    limits: {
      robinhood: { name_max: 60, symbol_max: 20, native_symbol: "ETH" },
      solana: { name_max: 32, symbol_max: 10, native_symbol: "SOL" },
    },
  };
}

function normalizeRequests(body: any) {
  const raw = Array.isArray(body.launches) && body.launches.length
    ? body.launches
    : [{ ...body, chain: body.chain }];
  if (raw.length > 2) throw new Error("too_many_launch_chains");
  const seen = new Set<LaunchChain>();
  return raw.map((item: any) => {
    const chain = normalizeChain(item?.chain ?? body.chain);
    if (seen.has(chain)) throw new Error("duplicate_launch_chain");
    seen.add(chain);
    return { chain, body: { ...body, ...(item ?? {}), chain } };
  });
}

function normalizeChain(value: unknown): LaunchChain {
  const text = String(value ?? "robinhood").trim().toLowerCase();
  if (["sol", "solana", "pump", "pump_fun", "pump.fun"].includes(text)) {
    return "solana";
  }
  if (["robinhood", "robinhood_chain", "evm", "eth"].includes(text)) {
    return "robinhood";
  }
  throw new Error("unsupported_chain");
}

function validateText(
  chain: LaunchChain,
  name: string,
  symbol: string,
  description: string,
) {
  const nameMax = chain === "solana" ? 32 : 60;
  const symbolMax = chain === "solana" ? 10 : 20;
  if (!name || name.length > nameMax) throw new Error("invalid_name");
  if (!symbol || symbol.length > symbolMax || !/^[A-Z0-9]+$/.test(symbol)) {
    throw new Error("invalid_symbol");
  }
  if (!description || description.length > 512) {
    throw new Error("invalid_description");
  }
}

async function loadWallet(
  admin: any,
  userId: string,
  walletId: string,
  chain: LaunchChain,
) {
  const query = admin.from("wallets").select(
    "id,user_id,address,public_key,wallet_type,chain_id,is_primary",
  ).eq("id", walletId).eq("user_id", userId);
  if (chain === "solana") query.eq("wallet_type", "solana");
  else query.eq("wallet_type", "evm").eq("chain_id", 4663);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("wallet_not_found");
  return result.data;
}

function initialBuy(body: any, chain: LaunchChain): number {
  const raw = chain === "solana"
    ? body.dev_buy_sol ?? body.initial_buy_sol ?? "0"
    : body.dev_buy_eth ?? body.initial_buy_eth ?? "0";
  const text = String(raw).trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(text)) {
    throw new Error("invalid_initial_buy");
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("invalid_initial_buy");
  return amount;
}

function enforceWebCap(amount: number, chain: LaunchChain, profile: any) {
  const profileCap = Number(
    chain === "solana"
      ? profile?.max_auto_dev_buy_sol ?? 0
      : profile?.max_auto_dev_buy_eth ?? 0,
  );
  const allowed = Math.min(
    chain === "solana" ? 5 : 0.1,
    Number.isFinite(profileCap) ? Math.max(0, profileCap) : 0,
  );
  if (amount > allowed) throw new Error("launch_cap_exceeded");
}

async function resolveImage(admin: any, userId: string, key: string, body: any) {
  const direct = cleanText(body.image_url ?? body.imageUrl);
  // External URLs are re-hosted into trusted storage so the media-capture
  // worker's strict host allowlist can always fetch the launch image.
  if (direct) {
    return await rehostLaunchImageUrl(
      admin,
      requiredHttps(direct, "invalid_image_url"),
    );
  }
  const value = String(body.image_data_url ?? body.imageDataUrl ?? "");
  const match = value.match(
    /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=\s]+)$/i,
  );
  if (!match) throw new Error("invalid_image_data_url");
  const binary = atob(match[2].replace(/\s+/g, ""));
  if (!binary.length || binary.length > IMAGE_MAX_BYTES) {
    throw new Error("image_size_invalid");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const hash = bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
  const type = match[1].toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : match[1].toLowerCase();
  const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
  const safeKey = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
    ),
  );
  const path = `queue-inputs/${userId}/${safeKey}/${hash}.${extension}`;
  const stored = await admin.storage.from("token-logos").upload(path, bytes, {
    contentType: type,
    upsert: true,
  });
  bytes.fill(0);
  if (stored.error) throw stored.error;
  const publicUrl = admin.storage.from("token-logos").getPublicUrl(path).data
    ?.publicUrl;
  if (!publicUrl) throw new Error("image_public_url_failed");
  return publicUrl;
}

function robinhoodRewards(wallet: any, body: any) {
  const creator = String(wallet.address ?? wallet.public_key ?? "");
  const requested = String(body.creator_reward_recipient ?? "").trim();
  const destination = /^0x[a-fA-F0-9]{40}$/.test(requested)
    ? requested
    : creator;
  return {
    source: "dashboard",
    chain: "robinhood",
    selected_wallet_id: wallet.id,
    creator_address: creator,
    mode: "fixed_contract_creator_share",
    contract_creator_share_bps: 8000,
    effective_creator_share_bps: 8000,
    configurable_on_chain: false,
    claim_destination_address: destination,
    redirect_enabled: destination.toLowerCase() !== creator.toLowerCase(),
    recipients: [{
      address: destination,
      label: "Creator rewards",
      role: "creator",
      shareBps: 8000,
      sharePercent: 80,
      source: destination === creator ? "creator_wallet" : "wallet_address",
    }],
  };
}

async function solanaRewards(admin: any, userId: string, wallet: any, body: any) {
  const creator = String(wallet.address ?? wallet.public_key ?? "");
  const cashback = body.pump_cashback === true || body.pump_reward_mode === "cashback";
  const target = String(body.creator_reward_recipient ?? "").trim();
  let recipient: any = null;
  if (target) recipient = await resolveSolanaRecipient(admin, target);
  const share = recipient
    ? boundedInteger(body.creator_reward_share_bps ?? 2500, 1, 10_000)
    : 0;
  const recipients = recipient && recipient.address !== creator
    ? [
      rewardRow(creator, 10_000 - share, "creator_wallet", { userId, walletId: wallet.id }),
      rewardRow(recipient.address, share, recipient.source, recipient),
    ].filter((row) => row.shareBps > 0)
    : [rewardRow(creator, 10_000, "creator_wallet", { userId, walletId: wallet.id })];
  return {
    version: 1,
    source: "dashboard",
    chain: "solana",
    platform: "pump_fun",
    mode: cashback ? "cashback" : "creator_rewards",
    pump_reward_mode: cashback ? "cashback" : "creator",
    pump_cashback_enabled: cashback,
    selected_wallet_id: wallet.id,
    creator_address: creator,
    creator_wallet_id: wallet.id,
    requested_recipient_share_bps: share,
    creator_share_bps: 10_000 - share,
    configurable_on_chain: true,
    should_update_on_chain: Boolean(recipient && recipient.address !== creator),
    recipients,
    share_request: {
      target: target ? { kind: "wallet", address: recipient?.address ?? target } : null,
      explicit: Boolean(target),
      share_bps: recipient ? share : null,
      share_percent: recipient ? share / 100 : null,
      defaulted_to_100_percent: false,
    },
    notes: "Resolved by thin dashboard launch acceptance.",
  };
}

async function resolveSolanaRecipient(admin: any, target: string) {
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(target)) {
    return { address: target, source: "wallet_address" };
  }
  const handle = target.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    throw new Error("creator_rewards_recipient_invalid");
  }
  const profile = await admin.from("profiles").select(
    "user_id,twitter_username,twitter_id",
  ).ilike("twitter_username", handle).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) throw new Error("creator_rewards_recipient_not_found");
  const wallet = await admin.from("wallets").select("id,address,public_key")
    .eq("user_id", profile.data.user_id).eq("wallet_type", "solana")
    .order("is_primary", { ascending: false }).order("created_at")
    .limit(1).maybeSingle();
  if (wallet.error) throw wallet.error;
  if (!wallet.data) throw new Error("creator_rewards_wallet_not_found");
  return {
    address: wallet.data.address ?? wallet.data.public_key,
    source: "x_handle",
    userId: profile.data.user_id,
    walletId: wallet.data.id,
    twitterUsername: profile.data.twitter_username,
    twitterId: profile.data.twitter_id,
  };
}

function rewardRow(address: string, shareBps: number, source: string, row: any) {
  return {
    address,
    label: source === "creator_wallet" ? "Creator" : "Shared creator rewards",
    role: source === "creator_wallet" ? "creator" : "shared_creator_rewards",
    shareBps,
    sharePercent: shareBps / 100,
    source,
    userId: row.userId ?? null,
    walletId: row.walletId ?? null,
    twitterUsername: row.twitterUsername ?? null,
    twitterId: row.twitterId ?? null,
  };
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error("creator_reward_share_invalid");
  }
  return number;
}

function optionalHttps(value: unknown): string | null {
  const text = cleanText(value);
  return text ? requiredHttps(text, "invalid_metadata_url") : null;
}

function requiredHttps(value: unknown, code: string): string {
  const text = cleanText(value);
  if (text.length > 2048 || !/^https:\/\//i.test(text)) throw new Error(code);
  return text;
}

function requiredUuid(value: unknown, code: string): string {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(code);
  }
  return text;
}

function normalizeIdempotency(value: unknown): string {
  const text = cleanText(value);
  if (!text) throw new Error("missing_idempotency_key");
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(text)) {
    throw new Error("invalid_idempotency_key");
  }
  return text;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function cleanSymbol(value: unknown): string {
  return String(value ?? "").replace(/^\$/, "").replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorStatus(message: string): number {
  if (message === "unauthorized") return 401;
  if (/not_found/.test(message)) return 404;
  if (/paused|disabled/.test(message)) return 503;
  if (/invalid|missing|unsupported|duplicate|too_|cap_|wallet|image|idempotency/.test(message)) {
    return 400;
  }
  return 500;
}
