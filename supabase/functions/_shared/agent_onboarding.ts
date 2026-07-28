// deno-lint-ignore-file no-explicit-any
import { type AgentScope, normalizeScopes } from "./agent_api_core.ts";
import { AgentApiError } from "./agent_api_errors.ts";
import { ensureProvisionedAuthUser } from "./provisioning.ts";

const DEFAULT_KEY_SCOPES: AgentScope[] = [
  "profile:read",
  "coins:read",
  "coin:read",
  "actions:read",
];

export type AgentPepperVersion = "legacy" | "v2";

export function getAgentApiPepper(
  version: AgentPepperVersion = "legacy",
): string {
  if (version === "v2") {
    return Deno.env.get("AGENT_API_KEY_PEPPER_V2")?.trim() ?? "";
  }
  return Deno.env.get("AGENT_API_KEY_PEPPER")?.trim() ||
    Deno.env.get("WALLET_ENCRYPTION_SECRET")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
}

export async function hashSecret(
  secret: string,
  version: AgentPepperVersion = "legacy",
): Promise<string> {
  const pepper = getAgentApiPepper(version);
  if (!pepper) {
    throw new Error(
      version === "v2"
        ? "AGENT_API_KEY_PEPPER_V2 missing"
        : "legacy_agent_api_key_pepper_missing",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(secret),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

function cleanName(value: unknown, fallback = "Linkr Agent"): string {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, 80);
}

function normalizeLimits(limits: any) {
  const numberOrNull = (value: unknown) => {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    max_buy_eth: numberOrNull(limits?.max_buy_eth),
    max_buy_sol: numberOrNull(limits?.max_buy_sol),
    max_sell_percent: numberOrNull(limits?.max_sell_percent),
    max_transfer_eth: numberOrNull(limits?.max_transfer_eth),
    max_transfer_sol: numberOrNull(limits?.max_transfer_sol),
    max_launch_initial_buy_eth: numberOrNull(
      limits?.max_launch_initial_buy_eth,
    ),
    max_liquidity_eth: numberOrNull(limits?.max_liquidity_eth),
  };
}

async function findPrimaryWallet(admin: any, userId: string) {
  const { data, error } = await admin
    .from("wallets")
    .select(
      "id,user_id,public_key,address,chain_id,wallet_type,explorer_url,is_primary",
    )
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", 4663)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new AgentApiError(
      "wallet_not_found",
      500,
      "Agent wallet was not provisioned.",
    );
  }
  return data;
}

export async function createAgentCredential(
  admin: any,
  args: {
    userId: string;
    agentName?: unknown;
    agentType?: unknown;
    publicContact?: unknown;
    requestedScopes?: unknown;
    limits?: any;
    metadata?: Record<string, unknown>;
  },
) {
  const provisioned = await ensureProvisionedAuthUser(
    admin,
    args.userId,
    "auth_session",
  );
  const wallet = await findPrimaryWallet(admin, args.userId);
  const scopes = normalizeScopes(args.requestedScopes, DEFAULT_KEY_SCOPES);
  const limits = normalizeLimits(args.limits);

  const { data: profile, error: profileError } = await admin
    .from("agent_profiles")
    .insert({
      user_id: args.userId,
      wallet_id: wallet.id,
      name: cleanName(args.agentName),
      agent_type: String(args.agentType ?? "ai_agent").trim() || "ai_agent",
      public_contact: String(args.publicContact ?? "").trim() || null,
      terms_accepted_at: new Date().toISOString(),
      metadata: {
        ...(args.metadata ?? {}),
        provisioned_created_profile: provisioned.createdProfile,
        provisioned_created_wallet: provisioned.createdWallet,
        provisioned_created_solana_wallet: provisioned.createdSolanaWallet,
      },
    })
    .select("*")
    .single();
  if (profileError) throw profileError;

  const key = await createApiKeyForAgent(admin, {
    userId: args.userId,
    agentProfileId: profile.id,
    walletId: wallet.id,
    name: "Default API key",
    scopes,
    limits,
  });

  return {
    agentProfile: profile,
    wallet,
    apiKey: key,
  };
}

export async function createApiKeyForAgent(
  admin: any,
  args: {
    userId: string;
    agentProfileId: string;
    walletId: string | null;
    name?: string;
    scopes?: AgentScope[];
    limits?: Record<string, number | null>;
    expiresAt?: string | null;
  },
) {
  const prefix = randomHex(5);
  const secret = randomHex(32);
  const plaintext = `linkr_live_${prefix}_${secret}`;
  const keyHash = await hashSecret(plaintext, "v2");
  const scopes = normalizeScopes(args.scopes, DEFAULT_KEY_SCOPES);
  const { data, error } = await admin
    .from("agent_api_keys")
    .insert({
      agent_profile_id: args.agentProfileId,
      user_id: args.userId,
      wallet_id: args.walletId,
      name: args.name ?? "API key",
      key_prefix: prefix,
      key_hash: keyHash,
      hmac_secret_hash: keyHash,
      pepper_version: "v2",
      scopes,
      expires_at: args.expiresAt ?? null,
      ...(args.limits ?? {}),
    })
    .select(
      "id,agent_profile_id,user_id,wallet_id,name,key_prefix,scopes,status,require_hmac,max_buy_eth,max_buy_sol,max_sell_percent,max_transfer_eth,max_transfer_sol,max_launch_initial_buy_eth,max_liquidity_eth,expires_at,created_at",
    )
    .single();
  if (error) throw error;
  return { row: data, plaintext };
}

export async function createOnboardingToken(
  admin: any,
  args: {
    userId: string;
    requestedScopes?: unknown;
    ttlMinutes?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const token = `linkr_onboard_${randomHex(32)}`;
  const tokenHash = await hashSecret(token, "v2");
  const ttl = Math.max(5, Math.min(args.ttlMinutes ?? 60, 24 * 60));
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const scopes = normalizeScopes(args.requestedScopes, DEFAULT_KEY_SCOPES);
  const { data, error } = await admin
    .from("agent_onboarding_tokens")
    .insert({
      user_id: args.userId,
      token_hash: tokenHash,
      pepper_version: "v2",
      requested_scopes: scopes,
      expires_at: expiresAt,
      metadata: args.metadata ?? {},
    })
    .select("id,user_id,requested_scopes,status,expires_at,created_at")
    .single();
  if (error) throw error;
  return { row: data, token };
}

export async function redeemOnboardingToken(admin: any, token: string) {
  const legacyHash = await hashSecret(token, "legacy");
  const v2PepperAvailable = Boolean(getAgentApiPepper("v2"));
  const candidateHashes = [legacyHash];
  if (v2PepperAvailable) candidateHashes.push(await hashSecret(token, "v2"));
  const { data, error } = await admin
    .from("agent_onboarding_tokens")
    .select("*")
    .in("token_hash", candidateHashes)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AgentApiError("invalid_onboarding_token", 401);
  const expectedVersion = data.pepper_version === "v2" ? "v2" : "legacy";
  const expectedHash = await hashSecret(token, expectedVersion);
  if (expectedHash !== data.token_hash) {
    throw new AgentApiError("invalid_onboarding_token", 401);
  }
  if (data.status !== "active") {
    throw new AgentApiError("onboarding_token_not_active", 401);
  }
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await admin.from("agent_onboarding_tokens").update({ status: "expired" })
      .eq("id", data.id);
    throw new AgentApiError("onboarding_token_expired", 401);
  }

  const { error: updateError } = await admin
    .from("agent_onboarding_tokens")
    .update({ status: "used", used_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("status", "active");
  if (updateError) throw updateError;
  return data;
}
