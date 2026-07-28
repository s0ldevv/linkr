// deno-lint-ignore-file no-explicit-any
// Resolve an explicit Solana wallet address or X handle to a stable wallet snapshot.

import { ensureProvisionedXUser, ensureWalletForUser } from "./provisioning.ts";
import { normalizeSolanaPublicKey } from "./solana_chain.ts";

export type ResolvedSolanaRecipient = {
  address: string;
  label: string;
  source: "wallet_address" | "x_handle";
  userId: string | null;
  walletId: string | null;
  twitterId: string | null;
  twitterUsername: string | null;
  input: string;
};

export async function resolveSolanaRecipient(
  admin: any,
  input: unknown,
  source: string,
): Promise<ResolvedSolanaRecipient> {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("recipient_required");
  const handle = explicitHandle(raw);
  if (!handle) {
    return {
      address: normalizeSolanaPublicKey(raw),
      label: shortAddress(raw),
      source: "wallet_address",
      userId: null,
      walletId: null,
      twitterId: null,
      twitterUsername: null,
      input: raw,
    };
  }

  let profile = await profileByHandle(admin, handle);
  if (!profile?.user_id) {
    const xUser = await fetchXUserByUsername(handle);
    if (!xUser) throw new Error("recipient_x_user_not_found");
    const provisioned = await ensureProvisionedXUser(admin, {
      twitterId: xUser.id,
      username: xUser.username ?? handle,
      name: xUser.name ?? xUser.username ?? handle,
      profileImageUrl: xUser.profileImageUrl,
      source: source === "x" ? "tweet_mention" : "manual_wallet",
    });
    profile = {
      user_id: provisioned.userId,
      twitter_id: xUser.id,
      twitter_username: xUser.username ?? handle,
    };
  }

  // This is intentionally the all-wallet provisioning helper: a recipient created from a
  // transfer must have the same EVM + Solana wallet pair as a normal first-time Linkr user.
  await ensureWalletForUser(admin, profile.user_id);
  const wallet = await solanaWalletByUser(admin, profile.user_id);
  if (!wallet?.public_key) {
    throw new Error("recipient_solana_wallet_create_failed");
  }
  return {
    address: normalizeSolanaPublicKey(wallet.address ?? wallet.public_key),
    label: `@${normalizeHandle(profile.twitter_username ?? handle)}`,
    source: "x_handle",
    userId: profile.user_id,
    walletId: wallet.id ?? null,
    twitterId: profile.twitter_id ?? null,
    twitterUsername: normalizeHandle(profile.twitter_username ?? handle),
    input: raw,
  };
}

export async function verifySolanaRecipientSnapshot(
  admin: any,
  snapshot: Partial<ResolvedSolanaRecipient> & { address: string },
): Promise<string> {
  const expected = normalizeSolanaPublicKey(snapshot.address);
  if (snapshot.source !== "x_handle") return expected;
  if (!snapshot.userId) throw new Error("recipient_snapshot_missing_user");
  const wallet = await solanaWalletByUser(admin, snapshot.userId);
  if (!wallet?.public_key) throw new Error("recipient_solana_wallet_missing");
  const current = normalizeSolanaPublicKey(wallet.address ?? wallet.public_key);
  if (current !== expected) {
    throw new Error("recipient_wallet_changed_before_transfer");
  }
  return current;
}

export function explicitHandle(value: string): string | null {
  const match = /^@([A-Za-z0-9_]{1,15})$/.exec(String(value ?? "").trim());
  return match ? normalizeHandle(match[1]) : null;
}

function normalizeHandle(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

async function profileByHandle(
  admin: any,
  handle: string,
): Promise<any | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("user_id,twitter_id,twitter_username")
    .ilike("twitter_username", handle)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function solanaWalletByUser(
  admin: any,
  userId: string,
): Promise<any | null> {
  const { data, error } = await admin
    .from("wallets")
    .select("id,public_key,address")
    .eq("user_id", userId)
    .eq("wallet_type", "solana")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function fetchXUserByUsername(username: string): Promise<
  {
    id: string;
    username: string | null;
    name: string | null;
    profileImageUrl: string | null;
  } | null
> {
  const bearer = Deno.env.get("X_BEARER_TOKEN")?.trim();
  if (!bearer) throw new Error("X_BEARER_TOKEN is not configured");
  const fields = encodeURIComponent("id,username,name,profile_image_url");
  const response = await fetch(
    `https://api.x.com/2/users/by/username/${
      encodeURIComponent(username)
    }?user.fields=${fields}`,
    { headers: { Authorization: `Bearer ${bearer}` } },
  );
  if (response.status === 404) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`x_recipient_lookup_${response.status}`);
  if (!body?.data?.id) return null;
  return {
    id: String(body.data.id),
    username: body.data.username ? normalizeHandle(body.data.username) : null,
    name: body.data.name ?? null,
    profileImageUrl: body.data.profile_image_url ?? null,
  };
}

function shortAddress(value: string): string {
  const normalized = normalizeSolanaPublicKey(value);
  return `${normalized.slice(0, 5)}…${normalized.slice(-5)}`;
}
