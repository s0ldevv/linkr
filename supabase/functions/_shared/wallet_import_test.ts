import {
  base58Encode,
  generateSolanaWallet,
  parseSolanaPrivateKey,
  solanaPublicKeyFromSecretKey,
} from "./solana_chain.ts";

Deno.test("Solana private-key import accepts base58 and JSON formats", () => {
  const generated = generateSolanaWallet();
  const fromBase58 = parseSolanaPrivateKey(base58Encode(generated.secretKeyBytes));
  const fromJson = parseSolanaPrivateKey(JSON.stringify([...generated.secretKeyBytes]));

  if (solanaPublicKeyFromSecretKey(fromBase58) !== generated.publicKey) {
    throw new Error("base58 import derived the wrong public key");
  }
  if (solanaPublicKeyFromSecretKey(fromJson) !== generated.publicKey) {
    throw new Error("JSON import derived the wrong public key");
  }
});

Deno.test("Solana private-key import rejects malformed values", () => {
  for (const value of ["", "not-a-private-key", "[1,2,3]", JSON.stringify(Array(64).fill(999))]) {
    let rejected = false;
    try {
      parseSolanaPrivateKey(value);
    } catch (error) {
      rejected = error instanceof Error && error.message === "invalid_solana_private_key";
    }
    if (!rejected) throw new Error(`expected malformed key to be rejected: ${value}`);
  }
});
