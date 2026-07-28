// deno-lint-ignore-file no-explicit-any

export type IpfsUploadResult = {
  cid: string;
  uri: string;
  gatewayUrl: string;
  provider: "filebase";
  objectKey: string;
  bucket: string;
  raw?: Record<string, unknown>;
};

const DEFAULT_FILEBASE_ENDPOINT = "https://s3.filebase.com";
const DEFAULT_FILEBASE_REGION = "us-east-1";
const DEFAULT_IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function ipfsUploadEnabled(): boolean {
  return readBoolean("IPFS_UPLOAD_ENABLED", false);
}

export function ipfsUploadRequired(): boolean {
  return readBoolean("IPFS_UPLOAD_REQUIRED", false);
}

export function toIpfsUri(cidOrUri: string): string {
  const cid = normalizeCid(cidOrUri);
  if (!cid) throw new Error("missing_ipfs_cid");
  return `ipfs://${cid}`;
}

export function toGatewayUrl(uriOrCid: string): string {
  const cid = normalizeCid(uriOrCid);
  if (!cid) throw new Error("missing_ipfs_cid");
  const gateway = (Deno.env.get("IPFS_GATEWAY_URL")?.trim() || DEFAULT_IPFS_GATEWAY).replace(
    /\/+$/,
    "",
  );
  return `${gateway}/${cid}`;
}

export async function uploadLaunchImageToIpfs(args: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  launchId: string;
  symbol: string;
}): Promise<IpfsUploadResult> {
  assertIpfsConfigured();
  const extension =
    extensionFromFilename(args.filename) || extensionForContentType(args.contentType);
  return await putObjectAndReadCid({
    key: `launches/${sanitizePathSegment(args.launchId)}/image.${extension}`,
    bytes: args.bytes,
    contentType: args.contentType,
  });
}

export async function uploadLaunchMetadataToIpfs(args: {
  metadata: Record<string, unknown>;
  filename: string;
  launchId: string;
  symbol: string;
}): Promise<IpfsUploadResult> {
  assertIpfsConfigured();
  const bytes = new TextEncoder().encode(JSON.stringify(args.metadata));
  return await putObjectAndReadCid({
    key: `launches/${sanitizePathSegment(args.launchId)}/${sanitizeFilename(args.filename || "metadata.json")}`,
    bytes,
    contentType: "application/json",
  });
}

function assertIpfsConfigured() {
  if (!ipfsUploadEnabled()) throw new Error("ipfs_disabled");
  const provider = (Deno.env.get("IPFS_PROVIDER")?.trim() || "filebase").toLowerCase();
  if (provider !== "filebase") throw new Error(`unsupported_ipfs_provider:${provider}`);
  requiredEnv("FILEBASE_IPFS_BUCKET");
  requiredEnv("FILEBASE_S3_ACCESS_KEY_ID");
  requiredEnv("FILEBASE_S3_SECRET_ACCESS_KEY");
}

async function putObjectAndReadCid(args: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<IpfsUploadResult> {
  const bucket = requiredEnv("FILEBASE_IPFS_BUCKET");
  const put = await signedFilebaseRequest({
    method: "PUT",
    bucket,
    key: args.key,
    body: args.bytes,
    contentType: args.contentType,
  });

  if (!put.ok) {
    throw new Error(`filebase_put_failed:${put.status}:${await safeResponseText(put)}`);
  }

  let cid = normalizeCid(put.headers.get("x-amz-meta-cid") ?? "");
  if (!cid) {
    const head = await signedFilebaseRequest({ method: "HEAD", bucket, key: args.key });
    if (!head.ok) throw new Error(`filebase_head_failed:${head.status}`);
    cid = normalizeCid(head.headers.get("x-amz-meta-cid") ?? "");
  }

  if (!cid) throw new Error("filebase_upload_missing_cid");

  return {
    cid,
    uri: toIpfsUri(cid),
    gatewayUrl: toGatewayUrl(cid),
    provider: "filebase",
    objectKey: args.key,
    bucket,
  };
}

async function signedFilebaseRequest(args: {
  method: "PUT" | "HEAD";
  bucket: string;
  key: string;
  body?: Uint8Array;
  contentType?: string;
}): Promise<Response> {
  const endpoint = (
    Deno.env.get("FILEBASE_S3_ENDPOINT")?.trim() || DEFAULT_FILEBASE_ENDPOINT
  ).replace(/\/+$/, "");
  const region = Deno.env.get("FILEBASE_S3_REGION")?.trim() || DEFAULT_FILEBASE_REGION;
  const accessKey = requiredEnv("FILEBASE_S3_ACCESS_KEY_ID");
  const secretKey = requiredEnv("FILEBASE_S3_SECRET_ACCESS_KEY");
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const service = "s3";
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const body = args.method === "PUT" ? (args.body ?? new Uint8Array()) : new Uint8Array();
  const payloadHash = args.method === "HEAD" ? EMPTY_SHA256 : await sha256Hex(body);
  const objectPath = encodePath(`${args.bucket}/${args.key}`);
  const url = `${endpoint}/${objectPath}`;
  const host = new URL(url).host;

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (args.method === "PUT") {
    headers["content-type"] = args.contentType || "application/octet-stream";
  }

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders =
    Object.keys(headers)
      .sort()
      .map((key) => `${key}:${headers[key].trim().replace(/\s+/g, " ")}`)
      .join("\n") + "\n";
  const canonicalRequest = [
    args.method,
    `/${objectPath}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const signingKey = await deriveSigningKey(secretKey, dateStamp, region, service);
  const signature = bytesToHex(new Uint8Array(await hmacSha256(signingKey, stringToSign)));
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) requestHeaders.set(key, value);
  requestHeaders.set("Authorization", authorization);

  return await fetch(url, {
    method: args.method,
    headers: requestHeaders,
    body: args.method === "PUT" ? toArrayBuffer(body) : undefined,
  });
}

async function sha256Hex(bytesOrText: Uint8Array | string): Promise<string> {
  const bytes =
    typeof bytesOrText === "string" ? new TextEncoder().encode(bytesOrText) : bytesOrText;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? toArrayBuffer(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveSigningKey(
  secret: string,
  date: string,
  region: string,
  service: "s3",
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secret}`), date);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return await hmacSha256(kService, "aws4_request");
}

function normalizeCid(cidOrUri: string): string {
  let value = String(cidOrUri ?? "").trim();
  if (!value) return "";
  value = value.replace(/^ipfs:\/\//i, "");
  value = value.replace(/^ipfs\//i, "");
  value = value.replace(/^\/+/, "");
  return value.split(/[/?#]/)[0] ?? "";
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.replace(/\s+/g, " ").slice(0, 300);
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function extensionFromFilename(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? sanitizePathSegment(match[1]) : "";
}

function extensionForContentType(contentType: string): string {
  switch (String(contentType).toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function sanitizeFilename(value: string): string {
  const filename =
    String(value ?? "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "metadata.json";
  const safe = filename
    .replace(/[^a-z0-9._-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "metadata.json";
}

function sanitizePathSegment(value: string): string {
  const safe = String(value ?? "")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "item";
}
