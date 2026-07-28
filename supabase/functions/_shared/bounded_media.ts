const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

const CONTENT_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export interface CapturedImage {
  bytes: Uint8Array;
  sha256: string;
  contentType: string;
  extension: string;
  width: number;
  height: number;
  sourceUrl: string;
}

export async function capturedImageFromBytes(
  bytes: Uint8Array,
  contentType: string,
  sourceUrl: string,
): Promise<CapturedImage> {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) {
    throw new Error(bytes.byteLength < 1 ? "media_empty" : "media_too_large");
  }
  const normalizedType = String(contentType).split(";", 1)[0].trim()
    .toLowerCase();
  const extension = CONTENT_TYPES.get(normalizedType);
  if (!extension) throw new Error("unsupported_media_type");
  const dimensions = imageDimensions(bytes, normalizedType);
  if (
    dimensions.width < 1 || dimensions.height < 1 ||
    dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION
  ) throw new Error("media_dimensions_invalid");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return {
    bytes,
    sha256: [...new Uint8Array(digest)].map((value) =>
      value.toString(16).padStart(2, "0")
    ).join(""),
    contentType: normalizedType,
    extension,
    width: dimensions.width,
    height: dimensions.height,
    sourceUrl,
  };
}

export async function captureBoundedXImage(
  sourceUrl: string,
): Promise<CapturedImage> {
  return await captureBoundedImage(sourceUrl, validateMediaUrl);
}

// Accept-time capture for authenticated non-X launch inputs. The worker-side
// allowlist (validateMediaUrl) stays strict; this validator instead blocks the
// SSRF-relevant shapes (non-https, credentials, ports, IP literals, loopback
// and internal hostnames) for one bounded authenticated fetch.
export async function captureBoundedExternalImage(
  sourceUrl: string,
): Promise<CapturedImage> {
  return await captureBoundedImage(sourceUrl, validateExternalImageUrl);
}

// Returns a URL on the trusted media hosts. External images are downloaded
// with bounds and re-hosted into token-logos storage so every later pipeline
// stage only ever fetches trusted hosts.
export async function rehostLaunchImageUrl(
  admin: unknown,
  sourceUrl: string,
): Promise<string> {
  try {
    return validateMediaUrl(sourceUrl);
  } catch {
    // Not already trusted; capture and re-host below.
  }
  const captured = await captureBoundedExternalImage(sourceUrl);
  const stored = await storeCapturedImage(admin, captured);
  captured.bytes.fill(0);
  return stored.publicUrl;
}

async function captureBoundedImage(
  sourceUrl: string,
  validate: (value: string) => string,
): Promise<CapturedImage> {
  let url = validate(sourceUrl);
  let response: Response | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "image/png,image/jpeg,image/webp,image/gif",
          "user-agent": "LinkrMediaCapture/1.0",
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirect === MAX_REDIRECTS) throw new Error("media_redirect_limit");
      const location = response.headers.get("location");
      if (!location) throw new Error("media_redirect_without_location");
      url = validate(new URL(location, url).toString());
    }
    if (!response?.ok) {
      throw new Error(`media_fetch_failed_${response?.status ?? 0}`);
    }
    const contentType = String(response.headers.get("content-type") ?? "")
      .split(";", 1)[0].trim().toLowerCase();
    const extension = CONTENT_TYPES.get(contentType);
    if (!extension) throw new Error("unsupported_media_type");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      throw new Error("media_too_large");
    }
    if (!response.body) throw new Error("media_body_missing");
    const bytes = await readBounded(response.body, MAX_BYTES);
    const dimensions = imageDimensions(bytes, contentType);
    if (
      dimensions.width < 1 || dimensions.height < 1 ||
      dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION
    ) throw new Error("media_dimensions_invalid");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(bytes).buffer,
    );
    return {
      bytes,
      sha256: [...new Uint8Array(digest)].map((value) =>
        value.toString(16).padStart(2, "0")
      ).join(""),
      contentType,
      extension,
      width: dimensions.width,
      height: dimensions.height,
      sourceUrl: url,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function storeCapturedImage(
  admin: any,
  image: CapturedImage,
): Promise<{ path: string; publicUrl: string }> {
  const path = `queue-launch/${image.sha256}.${image.extension}`;
  const { error } = await admin.storage.from("token-logos").upload(
    path,
    image.bytes,
    {
      contentType: image.contentType,
      cacheControl: "31536000",
      upsert: false,
    },
  );
  if (
    error && !/already exists|duplicate/i.test(String(error.message ?? error))
  ) throw error;
  const { data } = admin.storage.from("token-logos").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("controlled_media_url_missing");
  return { path, publicUrl: data.publicUrl };
}

export function validateMediaUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("invalid_media_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("invalid_media_url");
  }
  const host = url.hostname.toLowerCase();
  const projectHost =
    new URL(Deno.env.get("SUPABASE_URL") ?? "https://invalid.local").hostname;
  if (
    host !== "pbs.twimg.com" && host !== "video.twimg.com" &&
    host !== projectHost
  ) {
    throw new Error("untrusted_media_host");
  }
  return url.toString();
}

export function validateExternalImageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("invalid_media_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("invalid_media_url");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".") ||
    isIpLiteralHost(host)
  ) {
    throw new Error("untrusted_media_host");
  }
  return url.toString();
}

function isIpLiteralHost(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    return true;
  }
  // Reject exotic numeric forms (hex, octal, single-integer hosts).
  return /^(0x[0-9a-f]+|\d+)$/.test(host);
}

export async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel("media_too_large");
        throw new Error("media_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new Error("media_empty");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function imageDimensions(
  bytes: Uint8Array,
  contentType: string,
): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (contentType === "image/png" && bytes.length >= 24) {
    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
      throw new Error("invalid_png");
    }
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (contentType === "image/gif" && bytes.length >= 10) {
    const header = new TextDecoder().decode(bytes.subarray(0, 6));
    if (header !== "GIF87a" && header !== "GIF89a") {
      throw new Error("invalid_gif");
    }
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (contentType === "image/webp" && bytes.length >= 30) {
    const header = new TextDecoder().decode(bytes.subarray(0, 12));
    if (!header.startsWith("RIFF") || !header.endsWith("WEBP")) {
      throw new Error("invalid_webp");
    }
    const kind = new TextDecoder().decode(bytes.subarray(12, 16));
    if (kind === "VP8X") {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { width, height };
    }
    throw new Error("unsupported_webp_header");
  }
  if (contentType === "image/jpeg" && bytes.length >= 4) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("invalid_jpeg");
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if (
        [
          0xc0,
          0xc1,
          0xc2,
          0xc3,
          0xc5,
          0xc6,
          0xc7,
          0xc9,
          0xca,
          0xcb,
          0xcd,
          0xce,
          0xcf,
        ].includes(marker)
      ) {
        return {
          width: view.getUint16(offset + 7),
          height: view.getUint16(offset + 5),
        };
      }
      offset += 2 + segmentLength;
    }
    throw new Error("jpeg_dimensions_missing");
  }
  throw new Error("unsupported_media_type");
}
