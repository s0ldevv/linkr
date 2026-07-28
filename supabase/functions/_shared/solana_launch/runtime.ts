// Solana launch-only runtime. The bundled HTTP client stays isolated from
// legacy API graphs and is loaded only after a durable queue claim.
// deno-lint-ignore-file no-explicit-any
import {
  Connection,
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?bundle&target=deno";
import { decryptSecret } from "../crypto.ts";
import {
  providerPoolEnabled,
  providerRpcFetchAdapter,
  readProviderEndpoints,
} from "../provider_pool.ts";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export interface LoadedSolanaWallet {
  id: string;
  user_id: string;
  address: string;
  public_key: string;
  secret_key: Uint8Array;
}

export interface SolanaWalletIdentity {
  id: string;
  user_id: string;
  address: string;
  public_key: string;
}

export { Keypair, PublicKey, SystemInstruction, SystemProgram, Transaction };

export function requiredSolanaRpcUrl(): string {
  const value = Deno.env.get("SOLANA_RPC_URL")?.trim();
  if (!value || !/^https:\/\//i.test(value)) {
    throw new Error("SOLANA_RPC_URL_missing_or_insecure");
  }
  return value;
}

export function solanaConnection(): Connection {
  const legacyUrl = requiredSolanaRpcUrl();
  if (!providerPoolEnabled()) return new Connection(legacyUrl, "confirmed");
  const endpoints = readProviderEndpoints(
    "SOLANA_RPC_ENDPOINTS_JSON",
    legacyUrl,
  );
  const sendEndpoints = readProviderEndpoints(
    "SOLANA_SEND_ENDPOINTS_JSON",
    endpoints[0].url,
  );
  return new Connection(endpoints[0].url, {
    commitment: "confirmed",
    fetch: providerRpcFetchAdapter(endpoints, sendEndpoints),
  });
}

export function normalizeSolanaPublicKey(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("solana_public_key_required");
  return new PublicKey(text).toBase58();
}

export function getSolanaTxExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${
    encodeURIComponent(String(signature).trim())
  }`;
}

export async function getSolBalanceLamports(address: string): Promise<number> {
  return await solanaConnection().getBalance(
    new PublicKey(normalizeSolanaPublicKey(address)),
    "confirmed",
  );
}

export async function loadSolanaWalletById(
  admin: any,
  walletId: string,
  expectedUserId?: string | null,
): Promise<LoadedSolanaWallet | null> {
  const query = admin.from("wallets").select(
    "id,user_id,public_key,address,wallet_type,encrypted_private_key,encryption_iv",
  ).eq("id", walletId).eq("wallet_type", "solana").limit(1);
  if (expectedUserId) query.eq("user_id", expectedUserId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const secret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!secret) throw new Error("WALLET_ENCRYPTION_SECRET_missing");
  const raw = await decryptSecret(secret, {
    ciphertext: data.encrypted_private_key,
    iv: data.encryption_iv,
  });
  if (raw.length !== 64) {
    raw.fill(0);
    throw new Error(`unsupported_solana_secret_key_length_${raw.length}`);
  }
  const expected = normalizeSolanaPublicKey(data.address ?? data.public_key);
  const derived = Keypair.fromSecretKey(raw).publicKey.toBase58();
  if (derived !== expected) {
    raw.fill(0);
    throw new Error("wallet_key_address_mismatch");
  }
  return {
    id: data.id,
    user_id: data.user_id,
    address: expected,
    public_key: expected,
    secret_key: raw,
  };
}

export async function loadSolanaWalletIdentityById(
  admin: any,
  walletId: string,
  expectedUserId?: string | null,
): Promise<SolanaWalletIdentity | null> {
  const query = admin.from("wallets").select(
    "id,user_id,public_key,address,wallet_type",
  ).eq("id", walletId).eq("wallet_type", "solana").limit(1);
  if (expectedUserId) query.eq("user_id", expectedUserId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const address = normalizeSolanaPublicKey(data.address ?? data.public_key);
  return {
    id: data.id,
    user_id: data.user_id,
    address,
    public_key: address,
  };
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index++) {
      const value = digits[index] * 256 + carry;
      digits[index] = value % 58;
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
  for (let index = digits.length - 1; index >= 0; index--) {
    result += BASE58_ALPHABET[digits[index]];
  }
  return result;
}
