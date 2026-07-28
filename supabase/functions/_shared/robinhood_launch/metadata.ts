// deno-lint-ignore-file no-explicit-any

import { TOKEN_METADATA_BUCKET } from "./constants.ts";

const ROBINHOOD_LAUNCH_CHAIN_ID = 4663;

export type LaunchMetadataInput = {
  launchId: string;
  name: string;
  symbol: string;
  description?: string | null;
  image: string;
  imageHash?: string | null;
  imageMime?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageGatewayUrl?: string | null;
  externalUrl?: string | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  storageProvider?: string | null;
  ipfsImageCid?: string | null;
  ipfsImageUri?: string | null;
  filebaseImageObjectKey?: string | null;
};

export async function createLaunchMetadataUri(
  admin: any,
  input: LaunchMetadataInput,
): Promise<
  { uri: string; path: string; metadata: Record<string, unknown>; hash: string }
> {
  const safeSymbol = sanitizePathSegment(input.symbol || "token");
  const safeLaunchId = sanitizePathSegment(
    input.launchId || crypto.randomUUID(),
  );
  const metadata = buildLaunchMetadata(input);
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  const hash = await sha256Hex(bytes);
  return await uploadLaunchMetadata(
    admin,
    metadata,
    bytes,
    `${safeSymbol}/${safeLaunchId}-${hash}.json`,
  );
}

export async function createLaunchMetadataUriAtPath(
  admin: any,
  input: LaunchMetadataInput,
  path: string,
): Promise<
  { uri: string; path: string; metadata: Record<string, unknown>; hash: string }
> {
  const metadata = buildLaunchMetadata(input);
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  return await uploadLaunchMetadata(
    admin,
    metadata,
    bytes,
    normalizeMetadataPath(path),
  );
}

async function uploadLaunchMetadata(
  admin: any,
  metadata: Record<string, unknown>,
  bytes: Uint8Array,
  path: string,
): Promise<{
  uri: string;
  path: string;
  metadata: Record<string, unknown>;
  hash: string;
}> {
  const hash = await sha256Hex(bytes);
  const { error } = await admin.storage.from(TOKEN_METADATA_BUCKET).upload(
    path,
    bytes,
    {
      contentType: "application/json",
      cacheControl: "31536000",
      upsert: true,
    },
  );
  if (error) throw error;

  const { data } = admin.storage.from(TOKEN_METADATA_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("launch_metadata_public_url_missing");

  return { uri: data.publicUrl, path, metadata, hash: `sha256://${hash}` };
}

export function buildLaunchMetadata(
  input: LaunchMetadataInput,
): Record<string, unknown> {
  const metadata = pruneEmpty({
    name: requiredString(input.name, "metadata_name_required"),
    symbol: requiredString(input.symbol, "metadata_symbol_required")
      .toUpperCase(),
    description: String(input.description ?? "").trim(),
    image: requiredMetadataUri(input.image, "metadata_image_required"),
    image_url: normalizeOptionalUrl(input.imageGatewayUrl),
    imageHash: input.imageHash,
    imageMime: input.imageMime,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    external_url: normalizeOptionalUrl(input.externalUrl),
    website: normalizeOptionalUrl(input.website),
    twitter: normalizeOptionalUrl(input.twitter),
    telegram: normalizeOptionalUrl(input.telegram),
    chainId: ROBINHOOD_LAUNCH_CHAIN_ID,
    storage_provider: normalizeOptionalText(input.storageProvider),
    ipfs_image_cid: normalizeOptionalText(input.ipfsImageCid),
    ipfs_image_uri: normalizeOptionalIpfsUri(input.ipfsImageUri),
    filebase_image_object_key: normalizeOptionalText(
      input.filebaseImageObjectKey,
    ),
  });
  return metadata;
}

function pruneEmpty(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) =>
      item !== null && item !== undefined && item !== ""
    ),
  );
}

function requiredString(value: unknown, error: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(error);
  return text;
}

function requiredMetadataUri(value: unknown, error: string): string {
  const text = requiredString(value, error);
  if (!/^(https?:\/\/|ipfs:\/\/)/i.test(text)) throw new Error(error);
  return text;
}

function normalizeOptionalUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : null;
}

function normalizeOptionalIpfsUri(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return /^ipfs:\/\//i.test(text) ? text : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function sanitizePathSegment(value: string): string {
  const safe = String(value ?? "")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "token";
}

function normalizeMetadataPath(path: string): string {
  const text = String(path ?? "").trim().replace(/^\/+/, "");
  if (
    !/^[a-z0-9][a-z0-9/_\-.]{1,240}\.json$/i.test(text) ||
    text.includes("..") ||
    text.includes("//")
  ) {
    throw new Error("launch_metadata_path_invalid");
  }
  return text;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
