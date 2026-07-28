// deno-lint-ignore-file no-explicit-any

import { TOKEN_LOGOS_BUCKET } from "./constants.ts";

const MAX_LOGO_BYTES = 4.5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export type LaunchImageAsset = {
  sourceUrl: string;
  bytes: Uint8Array;
  contentType: string;
  byteLength: number;
  extension: string;
  filename: string;
  storagePath: string;
};

export async function copyLaunchLogoToStorage(
  admin: any,
  args: {
    imageUrl: string;
    symbol: string;
    launchId?: string | null;
  },
): Promise<
  { publicUrl: string; path: string; contentType: string; byteLength: number }
> {
  const asset = await fetchLaunchImage(args);
  return await copyLaunchLogoBytesToStorage(admin, asset);
}

export async function fetchLaunchImage(args: {
  imageUrl: string;
  symbol: string;
  launchId?: string | null;
}): Promise<LaunchImageAsset> {
  const imageUrl = String(args.imageUrl ?? "").trim();
  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error("invalid_launch_image_url");
  }

  const response = await fetch(imageUrl, {
    headers: {
      Accept: "image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1",
      "User-Agent": "LinkrBot/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`launch_image_fetch_failed_${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_LOGO_BYTES) {
    throw new Error("launch_image_too_large");
  }

  const contentType = normalizeContentType(
    response.headers.get("content-type"),
  );
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    throw new Error("unsupported_launch_image_type");
  }

  const bytes = await readBoundedBody(response, MAX_LOGO_BYTES);
  if (bytes.byteLength <= 0) throw new Error("launch_image_empty");
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new Error("launch_image_too_large");
  }

  const safeSymbol = sanitizePathSegment(args.symbol || "token");
  const stableId = sanitizePathSegment(args.launchId || crypto.randomUUID());
  const extension = extensionForContentType(contentType);
  const filename = `image.${extension}`;
  const storagePath = `${safeSymbol}/${stableId}.${extension}`;

  return {
    sourceUrl: imageUrl,
    bytes,
    contentType,
    byteLength: bytes.byteLength,
    extension,
    filename,
    storagePath,
  };
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) throw new Error("launch_image_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("launch_image_too_large").catch(() => {});
        throw new Error("launch_image_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function copyLaunchLogoBytesToStorage(
  admin: any,
  asset: LaunchImageAsset,
): Promise<
  { publicUrl: string; path: string; contentType: string; byteLength: number }
> {
  const { error } = await admin.storage
    .from(TOKEN_LOGOS_BUCKET)
    .upload(asset.storagePath, asset.bytes, {
      contentType: asset.contentType,
      cacheControl: "31536000",
      upsert: true,
    });
  if (error) throw error;

  const { data } = admin.storage.from(TOKEN_LOGOS_BUCKET).getPublicUrl(
    asset.storagePath,
  );
  if (!data?.publicUrl) throw new Error("launch_logo_public_url_missing");

  return {
    publicUrl: data.publicUrl,
    path: asset.storagePath,
    contentType: asset.contentType,
    byteLength: asset.byteLength,
  };
}

function normalizeContentType(value: string | null): string {
  return String(value ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
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

function sanitizePathSegment(value: string): string {
  const safe = String(value ?? "")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "token";
}
