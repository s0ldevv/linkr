// deno-lint-ignore-file no-explicit-any
// Idempotent server-side provisioning for X-backed Linkr accounts.

import { ethers } from "https://esm.sh/ethers@6";
import { encryptSecret } from "./crypto.ts";
import {
  getAddressExplorerUrl,
  privateKeyHexToBytes,
  ROBINHOOD_CHAIN_ID,
} from "./robinhood_chain.ts";
import {
  generateSolanaWallet,
  getSolanaAccountExplorerUrl,
  SOLANA_WALLET_TYPE,
  solanaPublicKeyFromSecretKey,
} from "./solana_chain.ts";
import { getActiveXBan } from "./x_bans.ts";

export const DEFAULT_LINKR_RULES = {
  default_slippage_bps: 2500,
  max_auto_buy_eth: 0.1,
  max_auto_transfer_eth: 0,
  max_auto_sell_percent: 100,
  max_auto_dev_buy_eth: 0,
  max_auto_buy_sol: 0.1,
  max_auto_transfer_sol: 0.1,
  max_auto_transfer_usdc: 0,
  max_auto_dev_buy_sol: 0,
  default_dev_buy_eth: 0,
  default_dev_buy_sol: 0,
  solana_priority_fee_lamports: 1_000_000,
  require_confirmation_for_all_tx: false,
} as const;

export type ProvisioningSource =
  | "tweet_mention"
  | "x_login"
  | "auth_session"
  | "manual_wallet";

export interface XProvisioningInput {
  twitterId: string;
  username?: string | null;
  name?: string | null;
  profileImageUrl?: string | null;
  source: ProvisioningSource;
  sourceTweetId?: string | null;
}

export interface ProvisionedUser {
  userId: string;
  profile: any;
  wallet: {
    public_key: string;
    address?: string | null;
    chain_id?: number | null;
  };
  solanaWallet: {
    public_key: string;
    address?: string | null;
    chain_id?: number | null;
  };
  createdAuthUser: boolean;
  createdProfile: boolean;
  createdWallet: boolean;
  createdSolanaWallet: boolean;
  initializedDefaultRules: boolean;
}

const PROFILE_COLUMNS = [
  "user_id",
  "twitter_id",
  "twitter_username",
  "twitter_name",
  "twitter_profile_image_url",
  "profile_completed",
  "default_slippage_bps",
  "max_auto_sell_percent",
  "max_auto_buy_eth",
  "max_auto_transfer_eth",
  "max_auto_dev_buy_eth",
  "max_auto_buy_sol",
  "max_auto_transfer_sol",
  "max_auto_transfer_usdc",
  "max_auto_dev_buy_sol",
  "default_dev_buy_eth",
  "default_dev_buy_sol",
  "solana_priority_fee_lamports",
  "require_confirmation_for_all_tx",
  "default_rules_initialized_at",
  "auto_provisioned_at",
  "provisioned_source",
].join(",");

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTwitterId(value: string): string {
  const id = String(value ?? "").trim();
  if (!id) throw new Error("twitter_id_required");
  return id;
}

function normalizeUsername(value: string | null | undefined): string | null {
  const username = String(value ?? "")
    .trim()
    .replace(/^@+/, "");
  return username ? username.toLowerCase() : null;
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function syntheticEmail(twitterId: string): string {
  return `x-${normalizeTwitterId(twitterId)}@x.linkr.cash`;
}

function isUniqueViolation(error: any): boolean {
  return (
    error?.code === "23505" ||
    /duplicate key|already exists|unique/i.test(
      String(error?.message ?? error ?? ""),
    )
  );
}

function isAlreadyExistsAuthError(error: any): boolean {
  return /already|registered|exists/i.test(
    String(error?.message ?? error ?? ""),
  );
}

function shouldInitializeRules(profile: any): boolean {
  return (
    !profile?.default_rules_initialized_at &&
    Number(profile?.default_slippage_bps ?? 0) === 0 &&
    Number(profile?.max_auto_buy_eth ?? 0) === 0 &&
    Number(profile?.max_auto_buy_sol ?? 0) === 0 &&
    Number(profile?.max_auto_sell_percent ?? 0) === 0 &&
    Number(profile?.max_auto_dev_buy_eth ?? 0) === 0 &&
    Number(profile?.max_auto_dev_buy_sol ?? 0) === 0
  );
}

function generateEvmWallet(): {
  address: string;
  privateKeyBytes: Uint8Array;
  privateKeyHex: string;
} {
  const wallet = ethers.Wallet.createRandom();
  const privateKeyHex = wallet.privateKey;
  return {
    address: wallet.address,
    privateKeyHex,
    privateKeyBytes: privateKeyHexToBytes(privateKeyHex),
  };
}

function buildXMetadata(input: XProvisioningInput): Record<string, unknown> {
  const username = normalizeUsername(input.username);
  const name = normalizeNullableText(input.name) ?? username;
  const image = normalizeNullableText(input.profileImageUrl);
  return {
    provider: "x",
    provider_id: input.twitterId,
    sub: input.twitterId,
    user_name: username,
    preferred_username: username,
    full_name: name,
    name,
    avatar_url: image,
    picture: image,
    linkr_auto_provisioned: input.source === "tweet_mention",
  };
}

function profilePayloadForX(
  userId: string,
  input: XProvisioningInput,
  initializeRules: boolean,
): Record<string, unknown> {
  const sourceNow = nowIso();
  const payload: Record<string, unknown> = {
    user_id: userId,
    twitter_id: normalizeTwitterId(input.twitterId),
    twitter_username: normalizeUsername(input.username),
    twitter_name: normalizeNullableText(input.name) ??
      normalizeUsername(input.username),
    twitter_profile_image_url: normalizeNullableText(input.profileImageUrl),
    profile_completed: initializeRules ? true : undefined,
    provisioned_source: input.source,
  };

  if (input.source === "tweet_mention") payload.auto_provisioned_at = sourceNow;

  if (initializeRules) {
    Object.assign(payload, DEFAULT_LINKR_RULES, {
      profile_completed: true,
      default_rules_initialized_at: sourceNow,
    });
  }

  return dropUndefined(payload);
}

function profilePayloadForAuthUser(
  userId: string,
  twitterId: string | null,
  username: string | null,
  name: string | null,
  image: string | null,
  source: ProvisioningSource,
  initializeRules: boolean,
): Record<string, unknown> {
  const sourceNow = nowIso();
  const payload: Record<string, unknown> = {
    user_id: userId,
    twitter_id: twitterId,
    twitter_username: username,
    twitter_name: name ?? username,
    twitter_profile_image_url: image,
    profile_completed: initializeRules ? true : undefined,
    provisioned_source: source,
  };

  if (initializeRules) {
    Object.assign(payload, DEFAULT_LINKR_RULES, {
      profile_completed: true,
      default_rules_initialized_at: sourceNow,
    });
  }

  return dropUndefined(payload);
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

async function selectProfileByTwitterId(
  admin: any,
  twitterId: string,
): Promise<any | null> {
  const { data, error } = await admin
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("twitter_id", normalizeTwitterId(twitterId))
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function selectProfileByUserId(
  admin: any,
  userId: string,
): Promise<any | null> {
  const { data, error } = await admin
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function selectWalletPublicKey(
  admin: any,
  userId: string,
): Promise<
  | { public_key: string; address?: string | null; chain_id?: number | null }
  | null
> {
  const { data, error } = await admin
    .from("wallets")
    .select("public_key,address,chain_id,wallet_type")
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function selectSolanaWalletPublicKey(
  admin: any,
  userId: string,
): Promise<
  | { public_key: string; address?: string | null; chain_id?: number | null }
  | null
> {
  const { data, error } = await admin
    .from("wallets")
    .select("public_key,address,chain_id,wallet_type")
    .eq("user_id", userId)
    .eq("wallet_type", SOLANA_WALLET_TYPE)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function lookupAuthUserIdByEmail(
  admin: any,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("lookup_linkr_auth_user_by_email", {
    p_email: email,
  });
  if (error) throw error;
  return data ?? null;
}

async function findOrCreateAuthUserForX(
  admin: any,
  input: XProvisioningInput,
): Promise<{ userId: string; created: boolean }> {
  const existingProfile = await selectProfileByTwitterId(
    admin,
    input.twitterId,
  );
  if (existingProfile?.user_id) {
    return { userId: existingProfile.user_id, created: false };
  }

  const email = syntheticEmail(input.twitterId);
  const existingUserId = await lookupAuthUserIdByEmail(admin, email);
  if (existingUserId) return { userId: existingUserId, created: false };

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: buildXMetadata(input),
  });

  if (error) {
    if (isAlreadyExistsAuthError(error)) {
      const racedUserId = await lookupAuthUserIdByEmail(admin, email);
      if (racedUserId) return { userId: racedUserId, created: false };
    }
    throw error;
  }

  const userId = data?.user?.id;
  if (!userId) {
    const lookupUserId = await lookupAuthUserIdByEmail(admin, email);
    if (lookupUserId) return { userId: lookupUserId, created: false };
    throw new Error("auth_user_create_returned_no_id");
  }

  return { userId, created: true };
}

async function applyDefaultRulesIfNeeded(
  admin: any,
  profile: any,
  source: ProvisioningSource,
): Promise<{ profile: any; initialized: boolean }> {
  if (!profile?.user_id || !shouldInitializeRules(profile)) {
    return { profile, initialized: false };
  }

  const { data, error } = await admin
    .from("profiles")
    .update({
      ...DEFAULT_LINKR_RULES,
      profile_completed: true,
      default_rules_initialized_at: nowIso(),
      provisioned_source: profile.provisioned_source ?? source,
    })
    .eq("user_id", profile.user_id)
    .is("default_rules_initialized_at", null)
    .eq("default_slippage_bps", 0)
    .or("max_auto_buy_eth.is.null,max_auto_buy_eth.eq.0")
    .or("max_auto_buy_sol.is.null,max_auto_buy_sol.eq.0")
    .eq("max_auto_sell_percent", 0)
    .or("max_auto_dev_buy_eth.is.null,max_auto_dev_buy_eth.eq.0")
    .or("max_auto_dev_buy_sol.is.null,max_auto_dev_buy_sol.eq.0")
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  return {
    profile: data ?? (await selectProfileByUserId(admin, profile.user_id)),
    initialized: !!data,
  };
}

async function upsertProfileForX(
  admin: any,
  userId: string,
  input: XProvisioningInput,
): Promise<
  { profile: any; created: boolean; initializedDefaultRules: boolean }
> {
  const existingByTwitter = await selectProfileByTwitterId(
    admin,
    input.twitterId,
  );
  if (existingByTwitter) {
    if (existingByTwitter.user_id !== userId) {
      throw new Error("twitter_profile_user_conflict");
    }

    const { data, error } = await admin
      .from("profiles")
      .update(
        dropUndefined({
          twitter_username: normalizeUsername(input.username) ??
            existingByTwitter.twitter_username,
          twitter_name: normalizeNullableText(input.name) ??
            existingByTwitter.twitter_name,
          twitter_profile_image_url:
            normalizeNullableText(input.profileImageUrl) ??
              existingByTwitter.twitter_profile_image_url,
          auto_provisioned_at: input.source === "tweet_mention"
            ? (existingByTwitter.auto_provisioned_at ?? nowIso())
            : existingByTwitter.auto_provisioned_at,
          provisioned_source: existingByTwitter.provisioned_source ??
            input.source,
        }),
      )
      .eq("user_id", userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw error;
    const applied = await applyDefaultRulesIfNeeded(admin, data, input.source);
    return {
      profile: applied.profile,
      created: false,
      initializedDefaultRules: applied.initialized,
    };
  }

  const existingByUser = await selectProfileByUserId(admin, userId);
  if (existingByUser) {
    if (
      existingByUser.twitter_id && existingByUser.twitter_id !== input.twitterId
    ) {
      throw new Error("auth_user_twitter_id_conflict");
    }

    const { data, error } = await admin
      .from("profiles")
      .update(
        dropUndefined({
          twitter_id: input.twitterId,
          twitter_username: normalizeUsername(input.username) ??
            existingByUser.twitter_username,
          twitter_name: normalizeNullableText(input.name) ??
            existingByUser.twitter_name,
          twitter_profile_image_url:
            normalizeNullableText(input.profileImageUrl) ??
              existingByUser.twitter_profile_image_url,
          auto_provisioned_at: input.source === "tweet_mention"
            ? (existingByUser.auto_provisioned_at ?? nowIso())
            : existingByUser.auto_provisioned_at,
          provisioned_source: existingByUser.provisioned_source ?? input.source,
        }),
      )
      .eq("user_id", userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const raced = await selectProfileByTwitterId(admin, input.twitterId);
        if (raced?.user_id === userId) {
          const applied = await applyDefaultRulesIfNeeded(
            admin,
            raced,
            input.source,
          );
          return {
            profile: applied.profile,
            created: false,
            initializedDefaultRules: applied.initialized,
          };
        }
      }
      throw error;
    }
    const applied = await applyDefaultRulesIfNeeded(admin, data, input.source);
    return {
      profile: applied.profile,
      created: false,
      initializedDefaultRules: applied.initialized,
    };
  }

  const { data, error } = await admin
    .from("profiles")
    .insert(profilePayloadForX(userId, input, true))
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await selectProfileByTwitterId(admin, input.twitterId);
      if (raced?.user_id === userId) {
        const applied = await applyDefaultRulesIfNeeded(
          admin,
          raced,
          input.source,
        );
        return {
          profile: applied.profile,
          created: false,
          initializedDefaultRules: applied.initialized,
        };
      }
      const byUser = await selectProfileByUserId(admin, userId);
      if (byUser) {
        const applied = await applyDefaultRulesIfNeeded(
          admin,
          byUser,
          input.source,
        );
        return {
          profile: applied.profile,
          created: false,
          initializedDefaultRules: applied.initialized,
        };
      }
    }
    throw error;
  }

  return { profile: data, created: true, initializedDefaultRules: true };
}

async function extractAuthXIdentity(
  admin: any,
  userId: string,
): Promise<{
  twitterId: string | null;
  username: string | null;
  name: string | null;
  profileImageUrl: string | null;
}> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;

  const user = data?.user;
  const meta = user?.user_metadata ?? {};
  const identity =
    user?.identities?.find((item: any) =>
      item.provider === "twitter" || item.provider === "x"
    ) ??
      user?.identities?.[0];
  const identityData = identity?.identity_data ?? {};
  const email = String(user?.email ?? "");
  const emailMatch = /^x-([^@]+)@x\.linkr\.cash$/i.exec(email);

  const twitterId = normalizeNullableText(
    meta.provider_id ??
      identityData.provider_id ??
      meta.sub ??
      identityData.sub ??
      identity?.id ??
      emailMatch?.[1] ??
      null,
  );
  const username = normalizeUsername(
    meta.user_name ??
      meta.preferred_username ??
      identityData.user_name ??
      identityData.preferred_username ??
      null,
  );
  const name = normalizeNullableText(
    meta.full_name ?? meta.name ?? identityData.full_name ??
      identityData.name ?? username,
  );
  const profileImageUrl = normalizeNullableText(
    meta.avatar_url ?? meta.picture ?? identityData.avatar_url ??
      identityData.picture ?? null,
  );

  return { twitterId, username, name, profileImageUrl };
}

async function upsertProfileForAuthUser(
  admin: any,
  userId: string,
  source: ProvisioningSource,
): Promise<
  { profile: any; created: boolean; initializedDefaultRules: boolean }
> {
  const existingByUser = await selectProfileByUserId(admin, userId);
  const identity = await extractAuthXIdentity(admin, userId);
  const twitterId = existingByUser?.twitter_id ?? identity.twitterId;

  if (twitterId) {
    const byTwitter = await selectProfileByTwitterId(admin, twitterId);
    if (byTwitter && byTwitter.user_id !== userId) {
      throw new Error("twitter_profile_user_conflict");
    }
  }

  if (existingByUser) {
    const { data, error } = await admin
      .from("profiles")
      .update(
        dropUndefined({
          twitter_id: twitterId ?? existingByUser.twitter_id,
          twitter_username: identity.username ??
            existingByUser.twitter_username,
          twitter_name: identity.name ?? existingByUser.twitter_name,
          twitter_profile_image_url: identity.profileImageUrl ??
            existingByUser.twitter_profile_image_url,
          provisioned_source: existingByUser.provisioned_source ?? source,
        }),
      )
      .eq("user_id", userId)
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw error;
    const applied = await applyDefaultRulesIfNeeded(admin, data, source);
    return {
      profile: applied.profile,
      created: false,
      initializedDefaultRules: applied.initialized,
    };
  }

  const { data, error } = await admin
    .from("profiles")
    .insert(
      profilePayloadForAuthUser(
        userId,
        twitterId,
        identity.username,
        identity.name,
        identity.profileImageUrl,
        source,
        true,
      ),
    )
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await selectProfileByUserId(admin, userId);
      if (raced) {
        const applied = await applyDefaultRulesIfNeeded(admin, raced, source);
        return {
          profile: applied.profile,
          created: false,
          initializedDefaultRules: applied.initialized,
        };
      }
    }
    throw error;
  }

  return { profile: data, created: true, initializedDefaultRules: true };
}

export async function ensureWalletForUser(
  admin: any,
  userId: string,
): Promise<{
  wallet: {
    public_key: string;
    address?: string | null;
    chain_id?: number | null;
  };
  solanaWallet: {
    public_key: string;
    address?: string | null;
    chain_id?: number | null;
  };
  created: boolean;
  createdSolana: boolean;
}> {
  const existing = await selectWalletPublicKey(admin, userId);
  const evmWallet = existing?.public_key
    ? existing
    : await createWalletForUser(admin, userId, { makePrimary: true });
  const solana = await ensureSolanaWalletForUser(admin, userId);

  return {
    wallet: {
      public_key: evmWallet.public_key,
      address: evmWallet.address,
      chain_id: evmWallet.chain_id,
    },
    solanaWallet: solana.wallet,
    created: !existing?.public_key,
    createdSolana: solana.created,
  };
}

export async function createWalletForUser(
  admin: any,
  userId: string,
  options: { makePrimary?: boolean } = {},
): Promise<{
  id: string;
  public_key: string;
  address: string;
  chain_id: number;
  wallet_type: string;
  explorer_url: string;
  is_primary: boolean;
  created_at: string;
}> {
  const encSecret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!encSecret) throw new Error("WALLET_ENCRYPTION_SECRET missing");

  const existingEvmWallet = await selectWalletPublicKey(admin, userId);
  const shouldBePrimary = options.makePrimary === true || !existingEvmWallet;
  const generated = generateEvmWallet();
  const blob = await encryptSecret(encSecret, generated.privateKeyBytes);
  const publicKey = generated.address;

  const { data, error } = await admin
    .from("wallets")
    .insert({
      user_id: userId,
      public_key: publicKey,
      address: publicKey,
      wallet_type: "evm",
      chain_id: ROBINHOOD_CHAIN_ID,
      explorer_url: getAddressExplorerUrl(publicKey),
      encrypted_private_key: blob.ciphertext,
      encryption_iv: blob.iv,
      encryption_auth_tag: blob.authTag,
      is_primary: false,
    })
    .select(
      "id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at",
    )
    .single();

  if (error) throw error;

  if (!shouldBePrimary) return data;

  const { error: clearError } = await admin
    .from("wallets")
    .update({ is_primary: false })
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .neq("id", data.id);
  if (clearError) throw clearError;

  const { data: primary, error: primaryError } = await admin
    .from("wallets")
    .update({ is_primary: true })
    .eq("user_id", userId)
    .eq("id", data.id)
    .select(
      "id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at",
    )
    .single();
  if (primaryError) throw primaryError;

  return primary;
}

export async function importWalletForUser(
  admin: any,
  userId: string,
  privateKeyBytes: Uint8Array,
): Promise<any> {
  if (privateKeyBytes.length !== 32) throw new Error("invalid_evm_private_key");
  const publicKey = ethers.computeAddress(ethers.hexlify(privateKeyBytes));
  return storeImportedWallet(admin, userId, {
    publicKey,
    privateKeyBytes,
    walletType: "evm",
    chainId: ROBINHOOD_CHAIN_ID,
    explorerUrl: getAddressExplorerUrl(publicKey),
  });
}

export async function ensureSolanaWalletForUser(
  admin: any,
  userId: string,
): Promise<{
  wallet: {
    public_key: string;
    address?: string | null;
    chain_id?: number | null;
  };
  created: boolean;
}> {
  const existing = await selectSolanaWalletPublicKey(admin, userId);
  if (existing?.public_key) return { wallet: existing, created: false };

  const wallet = await createSolanaWalletForUser(admin, userId, {
    makePrimary: true,
  });
  return {
    wallet: {
      public_key: wallet.public_key,
      address: wallet.address,
      chain_id: wallet.chain_id,
    },
    created: true,
  };
}

export async function createSolanaWalletForUser(
  admin: any,
  userId: string,
  options: { makePrimary?: boolean } = {},
): Promise<{
  id: string;
  public_key: string;
  address: string;
  chain_id: null;
  wallet_type: string;
  explorer_url: string;
  is_primary: boolean;
  created_at: string;
}> {
  const encSecret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!encSecret) throw new Error("WALLET_ENCRYPTION_SECRET missing");

  const existingSolanaWallet = await selectSolanaWalletPublicKey(admin, userId);
  const shouldBePrimary = options.makePrimary === true || !existingSolanaWallet;
  const generated = generateSolanaWallet();
  const blob = await encryptSecret(encSecret, generated.secretKeyBytes);

  const { data, error } = await admin
    .from("wallets")
    .insert({
      user_id: userId,
      public_key: generated.publicKey,
      address: generated.publicKey,
      wallet_type: SOLANA_WALLET_TYPE,
      chain_id: null,
      explorer_url: getSolanaAccountExplorerUrl(generated.publicKey),
      encrypted_private_key: blob.ciphertext,
      encryption_iv: blob.iv,
      encryption_auth_tag: blob.authTag,
      is_primary: false,
    })
    .select(
      "id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at",
    )
    .single();

  if (error) throw error;
  if (!shouldBePrimary) return data;

  const { error: clearError } = await admin
    .from("wallets")
    .update({ is_primary: false })
    .eq("user_id", userId)
    .eq("wallet_type", SOLANA_WALLET_TYPE)
    .neq("id", data.id);
  if (clearError) throw clearError;

  const { data: primary, error: primaryError } = await admin
    .from("wallets")
    .update({ is_primary: true })
    .eq("user_id", userId)
    .eq("id", data.id)
    .select(
      "id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at",
    )
    .single();
  if (primaryError) throw primaryError;

  return primary;
}

export async function importSolanaWalletForUser(
  admin: any,
  userId: string,
  secretKeyBytes: Uint8Array,
): Promise<any> {
  const publicKey = solanaPublicKeyFromSecretKey(secretKeyBytes);
  return storeImportedWallet(admin, userId, {
    publicKey,
    privateKeyBytes: secretKeyBytes,
    walletType: SOLANA_WALLET_TYPE,
    chainId: null,
    explorerUrl: getSolanaAccountExplorerUrl(publicKey),
  });
}

async function storeImportedWallet(
  admin: any,
  userId: string,
  input: {
    publicKey: string;
    privateKeyBytes: Uint8Array;
    walletType: "evm" | "solana";
    chainId: number | null;
    explorerUrl: string;
  },
): Promise<any> {
  const encSecret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!encSecret) throw new Error("WALLET_ENCRYPTION_SECRET missing");

  let existingQuery = admin
    .from("wallets")
    .select("id")
    .eq("user_id", userId)
    .eq("wallet_type", input.walletType)
    .eq("public_key", input.publicKey)
    .limit(1);
  existingQuery = input.chainId == null
    ? existingQuery.is("chain_id", null)
    : existingQuery.eq("chain_id", input.chainId);
  const { data: existing, error: existingError } = await existingQuery
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw new Error("wallet_already_imported");

  const primaryQuery = input.chainId == null
    ? admin
      .from("wallets")
      .select("id")
      .eq("user_id", userId)
      .eq("wallet_type", input.walletType)
      .is("chain_id", null)
      .limit(1)
    : admin
      .from("wallets")
      .select("id")
      .eq("user_id", userId)
      .eq("wallet_type", input.walletType)
      .eq("chain_id", input.chainId)
      .limit(1);
  const { data: primaryCandidate, error: primaryError } = await primaryQuery
    .maybeSingle();
  if (primaryError) throw primaryError;

  const blob = await encryptSecret(encSecret, input.privateKeyBytes);
  const { data, error } = await admin
    .from("wallets")
    .insert({
      user_id: userId,
      public_key: input.publicKey,
      address: input.publicKey,
      wallet_type: input.walletType,
      chain_id: input.chainId,
      explorer_url: input.explorerUrl,
      encrypted_private_key: blob.ciphertext,
      encryption_iv: blob.iv,
      encryption_auth_tag: blob.authTag,
      is_primary: !primaryCandidate,
    })
    .select(
      "id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at",
    )
    .single();
  if (error) {
    if (isUniqueViolation(error)) throw new Error("wallet_already_imported");
    throw error;
  }
  return data;
}

export async function setPrimaryWalletForUser(
  admin: any,
  userId: string,
  walletId: string,
): Promise<{
  id: string;
  public_key: string;
  address: string;
  chain_id: number;
  wallet_type: string;
  explorer_url: string;
  is_primary: boolean;
  created_at: string;
}> {
  const { data: wallet, error: walletError } = await admin
    .from("wallets")
    .select(
      "id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at",
    )
    .eq("id", walletId)
    .eq("user_id", userId)
    .maybeSingle();
  if (walletError) throw walletError;
  if (!wallet) throw new Error("wallet_not_found");

  let clearQuery = admin
    .from("wallets")
    .update({ is_primary: false })
    .eq("user_id", userId)
    .eq("wallet_type", wallet.wallet_type)
    .neq("id", walletId);
  clearQuery = wallet.chain_id == null
    ? clearQuery.is("chain_id", null)
    : clearQuery.eq("chain_id", wallet.chain_id);
  const { error: clearError } = await clearQuery;
  if (clearError) throw clearError;

  const { data: primary, error: primaryError } = await admin
    .from("wallets")
    .update({ is_primary: true })
    .eq("id", walletId)
    .eq("user_id", userId)
    .select(
      "id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at",
    )
    .single();
  if (primaryError) throw primaryError;

  return primary;
}

export async function ensureProvisionedXUser(
  admin: any,
  input: XProvisioningInput,
): Promise<ProvisionedUser> {
  const normalizedInput: XProvisioningInput = {
    ...input,
    twitterId: normalizeTwitterId(input.twitterId),
    username: normalizeUsername(input.username),
    name: normalizeNullableText(input.name),
    profileImageUrl: normalizeNullableText(input.profileImageUrl),
  };

  const activeBan = await getActiveXBan(admin, normalizedInput.twitterId);
  if (activeBan) throw new Error("banned_x_user");

  const auth = await findOrCreateAuthUserForX(admin, normalizedInput);
  const profile = await upsertProfileForX(admin, auth.userId, normalizedInput);
  const wallet = await ensureWalletForUser(admin, auth.userId);

  return {
    userId: auth.userId,
    profile: profile.profile,
    wallet: wallet.wallet,
    solanaWallet: wallet.solanaWallet,
    createdAuthUser: auth.created,
    createdProfile: profile.created,
    createdWallet: wallet.created,
    createdSolanaWallet: wallet.createdSolana,
    initializedDefaultRules: profile.initializedDefaultRules,
  };
}

export async function ensureProvisionedAuthUser(
  admin: any,
  userId: string,
  source: ProvisioningSource = "auth_session",
): Promise<ProvisionedUser> {
  const profile = await upsertProfileForAuthUser(admin, userId, source);
  const wallet = await ensureWalletForUser(admin, userId);

  return {
    userId,
    profile: profile.profile,
    wallet: wallet.wallet,
    solanaWallet: wallet.solanaWallet,
    createdAuthUser: false,
    createdProfile: profile.created,
    createdWallet: wallet.created,
    createdSolanaWallet: wallet.createdSolana,
    initializedDefaultRules: profile.initializedDefaultRules,
  };
}
