import { decryptSecret, encryptSecret } from "./crypto.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface StoredXToken {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encryptionSecret(): string {
  const secret = Deno.env.get("X_TOKEN_ENCRYPTION_SECRET");
  if (!secret) throw new Error("X_TOKEN_ENCRYPTION_SECRET is not configured");
  return secret;
}

export async function encryptXToken(plaintext: string): Promise<StoredXToken> {
  const encrypted = await encryptSecret(encryptionSecret(), encoder.encode(plaintext));
  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  };
}

export async function decryptXToken(blob: { ciphertext: string; iv: string }): Promise<string> {
  const plaintext = await decryptSecret(encryptionSecret(), blob);
  return decoder.decode(plaintext);
}
