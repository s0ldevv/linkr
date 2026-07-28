import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ethers } from "https://esm.sh/ethers@6";
import { Keypair } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { verifiedEvmWalletAddress } from "./wallet.ts";
import { verifiedSolanaWalletAddress } from "./solana_chain.ts";

Deno.test("verifiedEvmWalletAddress accepts the matching key and address", () => {
  const key = ethers.getBytes(
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  );
  assertEquals(
    verifiedEvmWalletAddress(key, "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"),
    "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  );
});

Deno.test("verifiedEvmWalletAddress rejects a swapped address", () => {
  const key = ethers.getBytes(
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  );
  assertThrows(
    () =>
      verifiedEvmWalletAddress(
        key,
        "0x0000000000000000000000000000000000000001",
      ),
    Error,
    "wallet_key_address_mismatch",
  );
});

Deno.test("verifiedSolanaWalletAddress accepts the matching secret", () => {
  const wallet = Keypair.fromSeed(new Uint8Array(32).fill(7));
  assertEquals(
    verifiedSolanaWalletAddress(wallet.secretKey, wallet.publicKey.toBase58()),
    wallet.publicKey.toBase58(),
  );
});

Deno.test("verifiedSolanaWalletAddress rejects a swapped address", () => {
  const wallet = Keypair.fromSeed(new Uint8Array(32).fill(7));
  const other = Keypair.fromSeed(new Uint8Array(32).fill(8));
  assertThrows(
    () =>
      verifiedSolanaWalletAddress(wallet.secretKey, other.publicKey.toBase58()),
    Error,
    "wallet_key_address_mismatch",
  );
});
