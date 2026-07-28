// deno-lint-ignore-file no-explicit-any
// Load + decrypt a user's Robinhood Chain EVM wallet. Never returns the key to the client.

import { decryptSecret } from "./crypto.ts";
import {
  getAddressExplorerUrl,
  normalizeEvmAddress,
  privateKeyBytesToHex,
  ROBINHOOD_CHAIN_ID,
} from "./robinhood_chain.ts";
import { ethers } from "https://esm.sh/ethers@6";

export interface LoadedWallet {
  id: string;
  user_id: string;
  address: string;
  public_key: string;
  private_key: Uint8Array;
  private_key_hex: string;
  wallet_type: "evm";
  chain_id: 4663;
  explorer_url: string;
}

export async function loadWallet(
  admin: any,
  userId: string,
): Promise<LoadedWallet | null> {
  const { data } = await admin
    .from("wallets")
    .select(
      "id,user_id,public_key,address,wallet_type,chain_id,explorer_url,encrypted_private_key,encryption_iv",
    )
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const secret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!secret) throw new Error("WALLET_ENCRYPTION_SECRET missing");
  const raw = await decryptSecret(secret, {
    ciphertext: data.encrypted_private_key,
    iv: data.encryption_iv,
  });
  if (raw.length !== 32) {
    throw new Error(`unsupported_evm_private_key_length_${raw.length}`);
  }
  const address = verifiedEvmWalletAddress(
    raw,
    data.address ?? data.public_key,
  );
  return {
    id: data.id,
    user_id: data.user_id,
    address,
    public_key: address,
    private_key: raw,
    private_key_hex: privateKeyBytesToHex(raw),
    wallet_type: "evm",
    chain_id: ROBINHOOD_CHAIN_ID,
    explorer_url: data.explorer_url ?? getAddressExplorerUrl(address),
  };
}

export async function loadWalletById(
  admin: any,
  walletId: string,
  expectedUserId?: string | null,
): Promise<LoadedWallet | null> {
  const query = admin
    .from("wallets")
    .select(
      "id,user_id,public_key,address,wallet_type,chain_id,explorer_url,encrypted_private_key,encryption_iv",
    )
    .eq("id", walletId)
    .eq("wallet_type", "evm")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .limit(1);
  if (expectedUserId) query.eq("user_id", expectedUserId);

  const { data } = await query.maybeSingle();
  if (!data) return null;
  const secret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!secret) throw new Error("WALLET_ENCRYPTION_SECRET missing");
  const raw = await decryptSecret(secret, {
    ciphertext: data.encrypted_private_key,
    iv: data.encryption_iv,
  });
  if (raw.length !== 32) {
    throw new Error(`unsupported_evm_private_key_length_${raw.length}`);
  }
  const address = verifiedEvmWalletAddress(
    raw,
    data.address ?? data.public_key,
  );
  return {
    id: data.id,
    user_id: data.user_id,
    address,
    public_key: address,
    private_key: raw,
    private_key_hex: privateKeyBytesToHex(raw),
    wallet_type: "evm",
    chain_id: ROBINHOOD_CHAIN_ID,
    explorer_url: data.explorer_url ?? getAddressExplorerUrl(address),
  };
}

export function verifiedEvmWalletAddress(
  privateKey: Uint8Array,
  storedAddress: string,
): string {
  if (privateKey.length !== 32) {
    throw new Error(`unsupported_evm_private_key_length_${privateKey.length}`);
  }
  const normalizedStored = normalizeEvmAddress(storedAddress);
  const derived = normalizeEvmAddress(
    ethers.computeAddress(privateKeyBytesToHex(privateKey)),
  );
  if (derived !== normalizedStored) {
    throw new Error("wallet_key_address_mismatch");
  }
  return normalizedStored;
}
