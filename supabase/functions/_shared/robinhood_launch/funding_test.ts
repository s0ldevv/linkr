import { ethers } from "https://esm.sh/ethers@6";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sha256Hex } from "../transaction_outbox.ts";
import { validateStoredFundingTransaction } from "./funding.ts";

Deno.test("stored Robinhood funding bytes must prove the exact transfer", async () => {
  const source = ethers.Wallet.createRandom();
  const destination = ethers.Wallet.createRandom();
  const signedHex = await source.signTransaction({
    to: destination.address,
    value: 12345n,
    chainId: 4663,
    nonce: 0,
    gasLimit: 21_000n,
    gasPrice: 1n,
    type: 0,
  });
  const signedBytes = ethers.getBytes(signedHex);
  const event = {
    signed_transaction_base64: toBase64(signedBytes),
    signed_transaction_hash: await sha256Hex(signedBytes),
    tx_hash: ethers.keccak256(signedHex),
  };

  const verified = await validateStoredFundingTransaction(
    event,
    source.address,
    destination.address,
    12345n,
  );
  if (verified.length !== signedBytes.length) {
    throw new Error("verified transaction bytes changed");
  }
  verified.fill(0);

  await assertRejects(
    () =>
      validateStoredFundingTransaction(
        event,
        source.address,
        ethers.Wallet.createRandom().address,
        12345n,
      ),
    Error,
    "funding_destination_mismatch",
  );
  signedBytes.fill(0);
});

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
