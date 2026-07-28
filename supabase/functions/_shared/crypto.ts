// AES-256-GCM helpers for encrypting wallet private keys at rest.
// Key derivation: SHA-256(WALLET_ENCRYPTION_SECRET) → 32 bytes.

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export interface EncryptedBlob {
  ciphertext: string; // base64; includes 16-byte auth tag suffix per WebCrypto spec
  iv: string; // base64
  authTag: string; // base64 (last 16 bytes of ciphertext, surfaced for clarity)
}

export async function encryptSecret(secret: string, plaintext: Uint8Array): Promise<EncryptedBlob> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(plaintext),
    ),
  );
  const authTag = ct.slice(ct.length - 16);
  return {
    ciphertext: toBase64(ct),
    iv: toBase64(iv),
    authTag: toBase64(authTag),
  };
}

export async function decryptSecret(
  secret: string,
  blob: { ciphertext: string; iv: string },
): Promise<Uint8Array> {
  const key = await deriveKey(secret);
  const iv = fromBase64(blob.iv);
  const ct = fromBase64(blob.ciphertext);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct),
  );
  return new Uint8Array(pt);
}
