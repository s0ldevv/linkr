// deno-lint-ignore-file no-explicit-any
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  ensureProvisionedXUser,
  ensureSolanaWalletForUser,
  ensureWalletForUser,
  type ProvisioningSource,
} from "./provisioning.ts";
import { normalizeEvmAddress } from "./robinhood_chain.ts";

type ShareTarget = { kind: "wallet"; address: string } | { kind: "x_handle"; handle: string };

type PumpRewardMode = "cashback" | "creator_rewards";

export type PumpCreatorRewardsConfig = {
  version: 1;
  source: string;
  chain: "solana";
  platform: "pump_fun";
  mode: PumpRewardMode;
  pump_reward_mode: "cashback" | "creator";
  pump_cashback_enabled: boolean;
  selected_wallet_id: string | null;
  creator_address: string;
  creator_wallet_id: string | null;
  requested_recipient_share_bps: number;
  creator_share_bps: number;
  configurable_on_chain: boolean;
  should_update_on_chain: boolean;
  recipients: Array<{
    address: string;
    label: string;
    role: "creator" | "shared_creator_rewards";
    shareBps: number;
    sharePercent: number;
    source: "creator_wallet" | "wallet_address" | "x_handle";
    userId?: string | null;
    walletId?: string | null;
    twitterUsername?: string | null;
    twitterId?: string | null;
  }>;
  share_request: {
    target: ShareTarget | null;
    explicit: boolean;
    share_bps: number | null;
    share_percent: number | null;
    defaulted_to_100_percent: boolean;
  };
  notes: string;
};

export type RobinhoodCreatorRewardsRecipient = {
  address: string;
  userId: string;
  walletId: string | null;
  twitterUsername: string;
  twitterId: string | null;
  shareBps: 10_000;
  sharePercent: 100;
};

export async function resolveRobinhoodCreatorRewardsRecipient(
  admin: any,
  args: { handle: string; source: string },
): Promise<RobinhoodCreatorRewardsRecipient> {
  const handle = normalizeHandle(args.handle);
  if (!handle) throw new Error("creator_rewards_recipient_handle_missing");

  const existing = await profileByHandle(admin, handle);
  if (existing?.user_id) {
    await ensureWalletForUser(admin, existing.user_id);
    const wallet = await evmWalletByUser(admin, existing.user_id);
    if (!wallet?.public_key && !wallet?.address) {
      throw new Error("creator_rewards_recipient_wallet_create_failed");
    }
    return {
      address: normalizeEvmAddress(wallet.address ?? wallet.public_key),
      userId: existing.user_id,
      walletId: wallet.id ?? null,
      twitterUsername: normalizeHandle(existing.twitter_username ?? handle),
      twitterId: existing.twitter_id ?? null,
      shareBps: 10_000,
      sharePercent: 100,
    };
  }

  const xUser = await fetchXUserByUsername(handle);
  if (!xUser?.id) throw new Error("creator_rewards_recipient_x_user_not_found");
  const provisioned = await ensureProvisionedXUser(admin, {
    twitterId: xUser.id,
    username: xUser.username ?? handle,
    name: xUser.name ?? handle,
    profileImageUrl: xUser.profileImageUrl ?? null,
    source: provisioningSourceFor(args.source),
  });
  const wallet = await evmWalletByUser(admin, provisioned.userId);
  const address = wallet?.address ?? wallet?.public_key ??
    provisioned.wallet.public_key;
  return {
    address: normalizeEvmAddress(address),
    userId: provisioned.userId,
    walletId: wallet?.id ?? null,
    twitterUsername: normalizeHandle(xUser.username ?? handle),
    twitterId: xUser.id,
    shareBps: 10_000,
    sharePercent: 100,
  };
}

export function parsePumpCreatorRewardsShareRequest(args: { body?: any; text?: string | null }): {
  target: ShareTarget | null;
  shareBps: number | null;
  explicit: boolean;
} {
  const body = args.body ?? {};
  const bodyTarget = targetFromBody(body);
  const textTarget = bodyTarget ? null : targetFromText(args.text);
  const target = bodyTarget ?? textTarget;
  const bodyShare = shareBpsFromBody(body, target);
  const textShare = bodyShare == null ? shareBpsFromText(args.text, target) : null;
  const shareBps = bodyShare ?? textShare ?? (target ? 10_000 : null);

  return {
    target,
    shareBps,
    explicit: Boolean(target || bodyShare != null || textShare != null),
  };
}

export async function resolvePumpCreatorRewardsConfig(
  admin: any,
  args: {
    body?: any;
    creatorWalletAddress: string;
    creatorWalletId?: string | null;
    source: string;
    text?: string | null;
    userId?: string | null;
  },
): Promise<PumpCreatorRewardsConfig> {
  const creatorAddress = normalizeSolanaAddress(
    args.creatorWalletAddress,
    "invalid_creator_wallet",
  );
  const request = parsePumpCreatorRewardsShareRequest({ body: args.body, text: args.text });
  const rewardMode = resolvePumpRewardMode(args.body, request);
  const cashbackEnabled = rewardMode === "cashback";
  const requestedShareBps =
    !cashbackEnabled && request.target ? requiredShareBps(request.shareBps) : 0;

  const base = (
    recipients: PumpCreatorRewardsConfig["recipients"],
    target: ShareTarget | null,
  ): PumpCreatorRewardsConfig => {
    const effectiveRecipients = cashbackEnabled ? [] : recipients;
    const creatorShareBps =
      effectiveRecipients.find((item) => item.role === "creator")?.shareBps ??
      (cashbackEnabled ? 0 : 10_000);
    return {
      version: 1 as const,
      source: args.source,
      chain: "solana" as const,
      platform: "pump_fun" as const,
      mode: rewardMode,
      pump_reward_mode: cashbackEnabled ? "cashback" : "creator",
      pump_cashback_enabled: cashbackEnabled,
      selected_wallet_id: args.creatorWalletId ?? null,
      creator_address: creatorAddress,
      creator_wallet_id: args.creatorWalletId ?? null,
      requested_recipient_share_bps: requestedShareBps,
      creator_share_bps: creatorShareBps,
      configurable_on_chain: !cashbackEnabled,
      should_update_on_chain:
        !cashbackEnabled && shouldUpdateShareholders(effectiveRecipients, creatorAddress),
      recipients: effectiveRecipients,
      share_request: {
        target: cashbackEnabled ? null : target,
        explicit: request.explicit || cashbackEnabled,
        share_bps: cashbackEnabled ? null : request.shareBps,
        share_percent: !cashbackEnabled && request.shareBps != null ? request.shareBps / 100 : null,
        defaulted_to_100_percent:
          !cashbackEnabled && Boolean(request.target && request.shareBps === 10_000),
      },
      notes: cashbackEnabled
        ? "Pump.fun launch is created in trader cashback mode."
        : target
          ? "Pump.fun launch keeps creator fees enabled and applies a Pump fee-sharing config during launch execution."
          : "Pump.fun launch keeps creator fees with the creator wallet.",
    };
  };

  if (cashbackEnabled || !request.target) {
    return base(
      [creatorRecipient(creatorAddress, args.creatorWalletId ?? null, args.userId ?? null, 10_000)],
      null,
    );
  }

  const recipient = await resolveShareRecipient(admin, request.target, args.source);
  if (recipient.address === creatorAddress) {
    throw new Error("creator_reward_recipient_matches_creator");
  }

  const creatorShareBps = 10_000 - requestedShareBps;
  const recipients: PumpCreatorRewardsConfig["recipients"] = [
    ...(creatorShareBps > 0
      ? [
          creatorRecipient(
            creatorAddress,
            args.creatorWalletId ?? null,
            args.userId ?? null,
            creatorShareBps,
          ),
        ]
      : []),
    {
      address: recipient.address,
      label: recipient.label,
      role: "shared_creator_rewards",
      shareBps: requestedShareBps,
      sharePercent: requestedShareBps / 100,
      source: recipient.source,
      userId: recipient.userId,
      walletId: recipient.walletId,
      twitterUsername: recipient.twitterUsername,
      twitterId: recipient.twitterId,
    },
  ];

  return base(recipients, request.target);
}

function resolvePumpRewardMode(body: any, request: { target: ShareTarget | null }): PumpRewardMode {
  const mode = readString(body, [
    "pump_reward_mode",
    "pumpRewardMode",
    "reward_mode",
    "rewardMode",
  ])?.toLowerCase();
  if (mode) {
    if (["cashback", "trader_cashback", "trader-cashback"].includes(mode)) return "cashback";
    if (["creator", "creator_rewards", "creator-rewards", "fees", "creator_fees"].includes(mode)) {
      return "creator_rewards";
    }
    throw new Error("invalid_pump_reward_mode");
  }

  const cashback = readBoolean(body, ["pump_cashback", "pumpCashback", "cashback"]);
  if (cashback != null) return cashback ? "cashback" : "creator_rewards";

  const feeShareEnabled = readBoolean(body, [
    "pump_fee_share_enabled",
    "pumpFeeShareEnabled",
    "creator_rewards_enabled",
    "creatorRewardsEnabled",
  ]);
  if (feeShareEnabled === true || request.target) return "creator_rewards";
  return "creator_rewards";
}

export function pumpCreatorRewardsShareholders(
  config: any,
  creatorAddress: string,
): Array<{ address: string; shareBps: number }> {
  const creator = normalizeSolanaAddress(creatorAddress, "invalid_creator_wallet");
  const rows = Array.isArray(config?.recipients) ? config.recipients : [];
  const merged = new Map<string, number>();

  for (const row of rows) {
    const shareBps = Number(row?.shareBps ?? row?.share_bps ?? 0);
    if (!Number.isFinite(shareBps) || shareBps <= 0) continue;
    const address = normalizeSolanaAddress(row?.address, "invalid_creator_rewards_recipient");
    merged.set(address, (merged.get(address) ?? 0) + Math.floor(shareBps));
  }

  if (merged.size === 0) merged.set(creator, 10_000);
  const shareholders = [...merged.entries()].map(([address, shareBps]) => ({ address, shareBps }));
  const total = shareholders.reduce((sum, row) => sum + row.shareBps, 0);
  if (shareholders.length > 10) throw new Error("too_many_creator_reward_shareholders");
  if (total !== 10_000) throw new Error("invalid_creator_reward_share_total");
  return shareholders;
}

export function shouldUpdatePumpCreatorRewards(config: any, creatorAddress: string): boolean {
  if (!config?.should_update_on_chain) return false;
  return shouldUpdateShareholders(
    pumpCreatorRewardsShareholders(config, creatorAddress).map((row) => ({
      address: row.address,
      role:
        row.address === normalizeSolanaAddress(creatorAddress, "invalid_creator_wallet")
          ? "creator"
          : "shared_creator_rewards",
      shareBps: row.shareBps,
    })),
    creatorAddress,
  );
}

export function pumpCreatorRewardsSummary(config: any): string | null {
  const shared = Array.isArray(config?.recipients)
    ? config.recipients.find((item: any) => item?.role === "shared_creator_rewards")
    : null;
  if (!shared) return null;
  const label = shared.twitterUsername
    ? `@${shared.twitterUsername}`
    : shortAddress(String(shared.address ?? ""));
  const share = Number(shared.shareBps ?? 0) / 100;
  const creatorShare = Number(config?.creator_share_bps ?? 0) / 100;
  return creatorShare > 0
    ? `Creator rewards: ${formatPercent(share)} to ${label}, ${formatPercent(creatorShare)} stays with you.`
    : `Creator rewards: ${formatPercent(share)} to ${label}.`;
}

function creatorRecipient(
  address: string,
  walletId: string | null,
  userId: string | null,
  shareBps: number,
): PumpCreatorRewardsConfig["recipients"][number] {
  return {
    address,
    label: "Creator",
    role: "creator",
    shareBps,
    sharePercent: shareBps / 100,
    source: "creator_wallet",
    userId,
    walletId,
  };
}

async function resolveShareRecipient(
  admin: any,
  target: ShareTarget,
  source: string,
): Promise<{
  address: string;
  label: string;
  source: "wallet_address" | "x_handle";
  userId: string | null;
  walletId: string | null;
  twitterUsername: string | null;
  twitterId: string | null;
}> {
  if (target.kind === "wallet") {
    return {
      address: normalizeSolanaAddress(target.address, "invalid_creator_rewards_wallet"),
      label: "Reward wallet",
      source: "wallet_address",
      userId: null,
      walletId: null,
      twitterUsername: null,
      twitterId: null,
    };
  }

  const handle = normalizeHandle(target.handle);
  const existing = await profileByHandle(admin, handle);
  if (existing?.user_id) {
    await ensureSolanaWalletForUser(admin, existing.user_id);
    const wallet = await solanaWalletByUser(admin, existing.user_id);
    if (!wallet?.public_key) throw new Error("creator_rewards_recipient_wallet_create_failed");
    return {
      address: normalizeSolanaAddress(wallet.public_key, "invalid_creator_rewards_wallet"),
      label: `@${handle}`,
      source: "x_handle",
      userId: existing.user_id,
      walletId: wallet.id ?? null,
      twitterUsername: existing.twitter_username ?? handle,
      twitterId: existing.twitter_id ?? null,
    };
  }

  const xUser = await fetchXUserByUsername(handle);
  if (!xUser?.id) throw new Error("creator_rewards_recipient_x_user_not_found");
  const provisioned = await ensureProvisionedXUser(admin, {
    twitterId: xUser.id,
    username: xUser.username ?? handle,
    name: xUser.name ?? handle,
    profileImageUrl: xUser.profileImageUrl ?? null,
    source: provisioningSourceFor(source),
  });
  const wallet = await solanaWalletByUser(admin, provisioned.userId);
  return {
    address: normalizeSolanaAddress(
      wallet?.public_key ?? provisioned.solanaWallet.public_key,
      "invalid_creator_rewards_wallet",
    ),
    label: `@${normalizeHandle(xUser.username ?? handle)}`,
    source: "x_handle",
    userId: provisioned.userId,
    walletId: wallet?.id ?? null,
    twitterUsername: normalizeHandle(xUser.username ?? handle),
    twitterId: xUser.id,
  };
}

function targetFromBody(body: any): ShareTarget | null {
  const wallet = readString(body, [
    "creator_rewards_recipient_wallet",
    "creatorRewardsRecipientWallet",
    "creator_reward_recipient_wallet",
    "creatorRewardRecipientWallet",
    "reward_recipient_wallet",
    "rewardRecipientWallet",
  ]);
  if (wallet) return { kind: "wallet", address: wallet };

  const handle = readString(body, [
    "creator_rewards_recipient_handle",
    "creatorRewardsRecipientHandle",
    "creator_reward_recipient_handle",
    "creatorRewardRecipientHandle",
    "reward_recipient_handle",
    "rewardRecipientHandle",
    "creator_rewards_recipient_x",
    "creatorRewardsRecipientX",
  ]);
  if (handle) return { kind: "x_handle", handle: normalizeHandle(handle) };

  const target = readString(body, [
    "creator_rewards_recipient",
    "creatorRewardsRecipient",
    "creator_reward_recipient",
    "creatorRewardRecipient",
    "share_creator_rewards_with",
    "shareCreatorRewardsWith",
  ]);
  if (!target) return null;
  const normalizedHandle = maybeHandle(target);
  if (normalizedHandle) return { kind: "x_handle", handle: normalizedHandle };
  return { kind: "wallet", address: target };
}

function targetFromText(text: string | null | undefined): ShareTarget | null {
  const raw = String(text ?? "");
  if (!hasCreatorRewardsShareIntent(raw)) return null;
  const withoutUrls = raw.replace(/https?:\/\/\S+/gi, " ");
  const handles = [...withoutUrls.matchAll(/@([a-zA-Z0-9_]{1,15})\b/g)]
    .map((match) => normalizeHandle(match[1]))
    .filter((handle) => handle && !ignoredHandle(handle));
  if (handles.length > 0) return { kind: "x_handle", handle: handles[handles.length - 1] };

  const scoped =
    withoutUrls.match(
      /\b(?:share|split|give|send|route|pay)\b[\s\S]{0,180}\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/i,
    ) ??
    withoutUrls.match(
      /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b[\s\S]{0,180}\b(?:creator\s+)?(?:rewards?|fees?|cashback)\b/i,
    );
  if (scoped?.[1]) return { kind: "wallet", address: scoped[1] };
  return null;
}

function shareBpsFromBody(body: any, target: ShareTarget | null): number | null {
  const directBps = readNumber(body, [
    "creator_rewards_share_bps",
    "creatorRewardsShareBps",
    "creator_reward_share_bps",
    "creatorRewardShareBps",
    "recipient_share_bps",
    "recipientShareBps",
    "reward_share_bps",
    "rewardShareBps",
  ]);
  if (directBps != null) return requiredShareBps(directBps);

  const directPercent = readNumber(body, [
    "creator_rewards_share_percent",
    "creatorRewardsSharePercent",
    "creator_reward_share_percent",
    "creatorRewardSharePercent",
    "recipient_share_percent",
    "recipientSharePercent",
    "reward_share_percent",
    "rewardSharePercent",
  ]);
  if (directPercent != null) return percentToBps(directPercent);

  const creatorBps = target
    ? readNumber(body, ["creator_share_bps", "creatorShareBps", "requested_creator_share_bps"])
    : null;
  if (creatorBps != null) return requiredShareBps(10_000 - Math.floor(creatorBps));
  return null;
}

function shareBpsFromText(
  text: string | null | undefined,
  target: ShareTarget | null,
): number | null {
  const raw = String(text ?? "");
  if (!target || !hasCreatorRewardsShareIntent(raw)) return null;
  const lower = raw.toLowerCase();
  if (/\b(all|everything|full|100\s*%)\b/.test(lower)) return 10_000;
  if (/\bhalf\b/.test(lower)) return 5_000;
  const percent =
    lower.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\b/) ?? lower.match(/\bshare\s+(\d+(?:\.\d+)?)\b/);
  return percent?.[1] ? percentToBps(Number(percent[1])) : null;
}

function hasCreatorRewardsShareIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const reward = /\b(?:creator\s+)?(?:rewards?|fees?)\b|\bcashback\b/.test(lower);
  const share = /\b(?:share|split|give|send|route|pay|with|to)\b/.test(lower);
  return reward && share;
}

async function profileByHandle(admin: any, handle: string): Promise<any | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("user_id,twitter_id,twitter_username,twitter_name,twitter_profile_image_url")
    .ilike("twitter_username", handle)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function solanaWalletByUser(admin: any, userId: string): Promise<any | null> {
  const { data, error } = await admin
    .from("wallets")
    .select("id,public_key,address,wallet_type,chain_id")
    .eq("user_id", userId)
    .eq("wallet_type", "solana")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function evmWalletByUser(admin: any, userId: string): Promise<any | null> {
  const { data, error } = await admin
    .from("wallets")
    .select("id,public_key,address,wallet_type,chain_id")
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function fetchXUserByUsername(username: string): Promise<{
  id: string;
  username: string | null;
  name: string | null;
  profileImageUrl: string | null;
} | null> {
  const bearer = Deno.env.get("X_BEARER_TOKEN");
  if (!bearer) throw new Error("X_BEARER_TOKEN is not configured");
  const fields = encodeURIComponent("id,username,name,profile_image_url");
  const response = await fetch(
    `https://api.x.com/2/users/by/username/${username}?user.fields=${fields}`,
    {
      headers: { Authorization: `Bearer ${bearer}` },
    },
  );
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const user = body?.data;
  if (!user?.id) return null;
  return {
    id: String(user.id),
    username: user.username ? normalizeHandle(user.username) : null,
    name: user.name ?? null,
    profileImageUrl: user.profile_image_url ?? null,
  };
}

function shouldUpdateShareholders(
  recipients: Array<{ address: string; role?: string; shareBps: number }>,
  creator: string,
) {
  return !(
    recipients.length === 1 &&
    recipients[0].address === creator &&
    recipients[0].shareBps === 10_000
  );
}

function requiredShareBps(value: unknown): number {
  const bps = Math.floor(Number(value));
  if (!Number.isFinite(bps) || bps <= 0 || bps > 10_000) {
    throw new Error("invalid_creator_reward_share_bps");
  }
  return bps;
}

function percentToBps(value: number): number {
  return requiredShareBps(Math.round(value * 100));
}

function normalizeSolanaAddress(value: unknown, error: string): string {
  try {
    return new PublicKey(String(value ?? "").trim()).toBase58();
  } catch (_) {
    throw new Error(error);
  }
}

function normalizeHandle(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function maybeHandle(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const handle = /^@?([a-zA-Z0-9_]{1,15})$/.exec(text)?.[1];
  return handle ? normalizeHandle(handle) : null;
}

function ignoredHandle(handle: string): boolean {
  return ["linkr", "linkrbot", "linkr_cash"].includes(handle.toLowerCase());
}

function readString(body: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(body: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = body?.[key];
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function readBoolean(body: any, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = body?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") continue;
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) return true;
    if (["0", "false", "no", "off"].includes(text)) return false;
  }
  return null;
}

function provisioningSourceFor(source: string): ProvisioningSource {
  return source.startsWith("x_") ? "tweet_mention" : "manual_wallet";
}

function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

function formatPercent(value: number): string {
  return Number.isInteger(value)
    ? `${value}%`
    : `${value.toFixed(2).replace(/0+$/g, "").replace(/\.$/, "")}%`;
}
