// Solana wallet helpers for Linkr-managed app wallets.

import { Connection, Keypair, PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { decryptSecret } from "./crypto.ts";
import {
  providerPoolEnabled,
  providerRpcFetchAdapter,
  readProviderEndpoints,
} from "./provider_pool.ts";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const SOLANA_WALLET_TYPE = "solana";
export const SOLANA_EXPLORER_BASE_URL = "https://solscan.io";
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SOLANA_NATIVE_ASSET_ID = "So11111111111111111111111111111111111111112";
export const SOLANA_NATIVE_SYMBOL = "SOL";

export interface GeneratedSolanaWallet {
  publicKey: string;
  secretKeyBytes: Uint8Array;
  secretKeyBase58: string;
}

export interface LoadedSolanaWallet {
  id: string;
  user_id: string;
  address: string;
  public_key: string;
  secret_key: Uint8Array;
  secret_key_base58: string;
  wallet_type: "solana";
  chain_id: null;
  explorer_url: string;
}

export function requiredSolanaRpcUrl(): string {
  const helius = Deno.env.get("HELIUS_RPC_URL")?.trim();
  if (helius && /^https?:\/\//i.test(helius)) return helius;
  const heliusKey = Deno.env.get("HELIUS_API_KEY")?.trim();
  if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  const value = Deno.env.get("SOLANA_RPC_URL")?.trim();
  if (!value) throw new Error("SOLANA_RPC_URL missing");
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("SOLANA_RPC_URL must be an http(s) URL");
  }
  return value;
}

export function solanaConnection(): Connection {
  const legacyUrl = requiredSolanaRpcUrl();
  if (!providerPoolEnabled()) return new Connection(legacyUrl, "confirmed");
  const endpoints = readProviderEndpoints("SOLANA_RPC_ENDPOINTS_JSON", legacyUrl);
  const sendEndpoints = readProviderEndpoints("SOLANA_SEND_ENDPOINTS_JSON", endpoints[0].url);
  return new Connection(endpoints[0].url, {
    commitment: "confirmed",
    fetch: providerRpcFetchAdapter(endpoints, sendEndpoints),
  });
}

export function getSolanaAccountExplorerUrl(address: string): string {
  const publicKey = normalizeSolanaPublicKey(address);
  return `${SOLANA_EXPLORER_BASE_URL}/account/${publicKey}`;
}

export function getSolanaTxExplorerUrl(signature: string): string {
  return `${SOLANA_EXPLORER_BASE_URL}/tx/${encodeURIComponent(String(signature).trim())}`;
}

export function normalizeSolanaPublicKey(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("solana_public_key_required");
  return new PublicKey(text).toBase58();
}

export function generateSolanaWallet(): GeneratedSolanaWallet {
  const keypair = Keypair.generate();
  const secretKeyBytes = keypair.secretKey;
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKeyBytes,
    secretKeyBase58: base58Encode(secretKeyBytes),
  };
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const value = digits[i] * 256 + carry;
      digits[i] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

export function base58Decode(value: string): Uint8Array {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("invalid_solana_private_key");

  const bytes = [0];
  for (const character of text) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("invalid_solana_private_key");
    let carry = digit;
    for (let index = 0; index < bytes.length; index++) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const character of text) {
    if (character !== BASE58_ALPHABET[0]) break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function parseSolanaPrivateKey(value: string): Uint8Array {
  const text = String(value ?? "").trim();
  if (!text || text.length > 2_048) throw new Error("invalid_solana_private_key");

  let secretKey: Uint8Array;
  if (text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error("invalid_solana_private_key");
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 64 ||
      parsed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) {
      throw new Error("invalid_solana_private_key");
    }
    secretKey = Uint8Array.from(parsed as number[]);
  } else {
    secretKey = base58Decode(text);
  }

  if (secretKey.length !== 64) throw new Error("invalid_solana_private_key");
  try {
    Keypair.fromSecretKey(secretKey);
  } catch (_) {
    throw new Error("invalid_solana_private_key");
  }
  return secretKey;
}

export function solanaPublicKeyFromSecretKey(secretKey: Uint8Array): string {
  if (secretKey.length !== 64) throw new Error("invalid_solana_private_key");
  try {
    return Keypair.fromSecretKey(secretKey).publicKey.toBase58();
  } catch (_) {
    throw new Error("invalid_solana_private_key");
  }
}

export async function loadSolanaWalletById(
  admin: any,
  walletId: string,
  expectedUserId?: string | null,
): Promise<LoadedSolanaWallet | null> {
  const query = admin
    .from("wallets")
    .select(
      "id,user_id,public_key,address,wallet_type,chain_id,explorer_url,encrypted_private_key,encryption_iv",
    )
    .eq("id", walletId)
    .eq("wallet_type", SOLANA_WALLET_TYPE)
    .limit(1);
  if (expectedUserId) query.eq("user_id", expectedUserId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const secret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!secret) throw new Error("WALLET_ENCRYPTION_SECRET missing");
  const raw = await decryptSecret(secret, {
    ciphertext: data.encrypted_private_key,
    iv: data.encryption_iv,
  });
  if (raw.length !== 64) {
    throw new Error(`unsupported_solana_secret_key_length_${raw.length}`);
  }

  const publicKey = verifiedSolanaWalletAddress(raw, data.address ?? data.public_key);
  return {
    id: data.id,
    user_id: data.user_id,
    address: publicKey,
    public_key: publicKey,
    secret_key: raw,
    secret_key_base58: base58Encode(raw),
    wallet_type: "solana",
    chain_id: null,
    explorer_url: data.explorer_url ?? getSolanaAccountExplorerUrl(publicKey),
  };
}

export async function loadSolanaWallet(
  admin: any,
  userId: string,
): Promise<LoadedSolanaWallet | null> {
  const { data, error } = await admin
    .from("wallets")
    .select(
      "id,user_id,public_key,address,wallet_type,chain_id,explorer_url,encrypted_private_key,encryption_iv",
    )
    .eq("user_id", userId)
    .eq("wallet_type", SOLANA_WALLET_TYPE)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const secret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!secret) throw new Error("WALLET_ENCRYPTION_SECRET missing");
  const raw = await decryptSecret(secret, {
    ciphertext: data.encrypted_private_key,
    iv: data.encryption_iv,
  });
  if (raw.length !== 64) {
    throw new Error(`unsupported_solana_secret_key_length_${raw.length}`);
  }

  const publicKey = verifiedSolanaWalletAddress(raw, data.address ?? data.public_key);
  return {
    id: data.id,
    user_id: data.user_id,
    address: publicKey,
    public_key: publicKey,
    secret_key: raw,
    secret_key_base58: base58Encode(raw),
    wallet_type: "solana",
    chain_id: null,
    explorer_url: data.explorer_url ?? getSolanaAccountExplorerUrl(publicKey),
  };
}

export function verifiedSolanaWalletAddress(secretKey: Uint8Array, storedAddress: string): string {
  if (secretKey.length !== 64) {
    throw new Error(`unsupported_solana_secret_key_length_${secretKey.length}`);
  }
  const normalizedStored = normalizeSolanaPublicKey(storedAddress);
  let derived: string;
  try {
    derived = Keypair.fromSecretKey(secretKey).publicKey.toBase58();
  } catch (_) {
    throw new Error("invalid_solana_secret_key");
  }
  if (derived !== normalizedStored) {
    throw new Error("wallet_key_address_mismatch");
  }
  return normalizedStored;
}
