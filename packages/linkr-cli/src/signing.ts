import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

export type SignedRequest = {
  headers: Record<string, string>;
  body: string;
  canonicalPath: string;
};

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signRequest(args: {
  apiKey: string;
  method: string;
  url: URL;
  body?: unknown;
  idempotencyKey?: string | null;
  clientVersion: string;
  installId: string;
}): SignedRequest {
  const method = args.method.toUpperCase();
  const body = args.body === undefined ? "" : JSON.stringify(args.body);
  const bodyHash = sha256Hex(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `${randomUUID()}:${randomBytes(12).toString("hex")}`;
  const canonicalPath = `${args.url.pathname}${args.url.search}`;
  const idempotencyKey = args.idempotencyKey ?? "";
  const signaturePayload = [
    "LINKR-HMAC-SHA256",
    method,
    canonicalPath,
    bodyHash,
    timestamp,
    nonce,
    idempotencyKey,
  ].join("\n");
  const signature = createHmac("sha256", args.apiKey).update(signaturePayload).digest("hex");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.apiKey}`,
    "X-Linkr-Timestamp": timestamp,
    "X-Linkr-Nonce": nonce,
    "X-Linkr-Body-SHA256": bodyHash,
    "X-Linkr-Signature": signature,
    "X-Linkr-Canonical-Path": canonicalPath,
    "X-Linkr-Client-Version": args.clientVersion,
    "X-Linkr-Install-ID": args.installId,
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return { headers, body, canonicalPath };
}
