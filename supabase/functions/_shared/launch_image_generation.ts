import {
  type CapturedImage,
  capturedImageFromBytes,
  readBounded,
} from "./bounded_media.ts";

const COMET_BASE_URL = "https://api.cometapi.com";
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_CHARS = 6 * 1024 * 1024;

export interface GeneratedLaunchImage {
  image: CapturedImage;
  provider: "comet_gemini" | "deterministic_fallback";
  model: string | null;
  fallbackReason: string | null;
}

export async function generateLaunchImage(args: {
  prompt: string;
  negativePrompt?: string | null;
  seed: string;
  allowFallback: boolean;
}): Promise<GeneratedLaunchImage> {
  try {
    const result = await generateWithComet(args.prompt, args.negativePrompt);
    return {
      image: result.image,
      provider: "comet_gemini",
      model: result.model,
      fallbackReason: null,
    };
  } catch (error) {
    if (!args.allowFallback) throw error;
    const bytes = await deterministicFallbackPng(args.seed);
    return {
      image: await capturedImageFromBytes(
        bytes,
        "image/png",
        "generated:deterministic_fallback",
      ),
      provider: "deterministic_fallback",
      model: null,
      fallbackReason: sanitizeError(error),
    };
  }
}

async function generateWithComet(
  prompt: string,
  negativePrompt?: string | null,
): Promise<{ image: CapturedImage; model: string }> {
  const key = Deno.env.get("COMET_API_KEY")?.trim();
  if (!key) throw new Error("image_provider_key_missing");
  const model = Deno.env.get("LINKR_IMAGE_MODEL")?.trim() ||
    "gemini-3-pro-image-preview";
  const fullPrompt = [
    String(prompt).trim().slice(0, 1000),
    negativePrompt
      ? `Avoid: ${String(negativePrompt).trim().slice(0, 500)}`
      : "",
    "Return one square token-logo image. Do not include text or watermarks.",
  ].filter(Boolean).join("\n");
  if (!fullPrompt) throw new Error("image_prompt_missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  try {
    response = await fetch(
      `${COMET_BASE_URL}/v1beta/models/${
        encodeURIComponent(model)
      }:generateContent`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "x-goog-api-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
          },
        }),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`image_provider_http_${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("image_provider_response_too_large");
  }
  if (!response.body) throw new Error("image_provider_body_missing");
  const bodyBytes = await readBounded(
    response.body,
    MAX_PROVIDER_RESPONSE_BYTES,
  );
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    throw new Error("image_provider_json_invalid");
  }
  const parts = extractParts(body);
  const inline = parts.find((part) => {
    const data = inlineData(part);
    return typeof data?.data === "string";
  });
  const encoded = inlineData(inline);
  if (!encoded || typeof encoded.data !== "string") {
    throw new Error("image_provider_image_missing");
  }
  if (encoded.data.length > MAX_BASE64_CHARS) {
    throw new Error("image_provider_image_too_large");
  }
  const bytes = decodeBase64Bounded(encoded.data);
  const contentType = String(
    encoded.mimeType ?? encoded.mime_type ?? "image/png",
  );
  return {
    image: await capturedImageFromBytes(
      bytes,
      contentType,
      "generated:comet_gemini",
    ),
    model,
  };
}

function extractParts(
  body: Record<string, unknown>,
): Record<string, unknown>[] {
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  return Array.isArray(content?.parts)
    ? content.parts.filter((part): part is Record<string, unknown> =>
      Boolean(part) && typeof part === "object" && !Array.isArray(part)
    )
    : [];
}

function inlineData(part: unknown): Record<string, unknown> | null {
  if (!part || typeof part !== "object" || Array.isArray(part)) return null;
  const value = (part as Record<string, unknown>).inlineData ??
    (part as Record<string, unknown>).inline_data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodeBase64Bounded(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("image_provider_base64_invalid");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let offset = 0; offset < value.length; offset += 32_768) {
    const binary = atob(value.slice(offset, offset + 32_768));
    const chunk = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    total += chunk.byteLength;
    if (total > 4 * 1024 * 1024) throw new Error("media_too_large");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function deterministicFallbackPng(
  seed: string,
): Promise<Uint8Array> {
  const width = 256;
  const height = 256;
  const hash = stableHash(seed);
  const raw = new Uint8Array(height * (1 + width * 4));
  const primary = [
    64 + (hash & 127),
    64 + ((hash >>> 8) & 127),
    64 + ((hash >>> 16) & 127),
  ];
  const secondary = [255 - primary[0], 255 - primary[1], 255 - primary[2]];
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const useSecondary = ((x >>> 5) + (y >>> 5) + (hash & 3)) % 2 === 0;
      const color = useSecondary ? secondary : primary;
      raw[offset++] = color[0];
      raw[offset++] = color[1];
      raw[offset++] = color[2];
      raw[offset++] = 255;
    }
  }
  const stream = new Blob([raw]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  const compressed = await readBounded(stream, 1024 * 1024);
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatBytes(
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  );
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(concatBytes(typeBytes, data)));
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function sanitizeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 120);
}
