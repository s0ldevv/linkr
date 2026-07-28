// deno-lint-ignore-file no-explicit-any
import { capturedImageFromBytes, storeCapturedImage } from "../_shared/bounded_media.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const userId = await getCallerUserId(req);
  if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });
  if (!req.body) return jsonResponse({ error: "missing_body" }, { status: 400 });

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return jsonResponse({ error: "invalid_content_type" }, { status: 415 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (_error) {
    return jsonResponse({ error: "invalid_form_data" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "image_missing" }, { status: 400 });
  }

  const normalizedType = normalizeMimeType(file.type);
  if (!normalizedType || !ALLOWED_IMAGE_TYPES.has(normalizedType)) {
    return jsonResponse({ error: "unsupported_media_type" }, { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return jsonResponse(
      { error: file.size <= 0 ? "media_empty" : "media_too_large" },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const bytesLength = bytes.byteLength;
  if (bytesLength <= 0 || bytesLength > MAX_UPLOAD_BYTES) {
    return jsonResponse(
      { error: bytesLength <= 0 ? "media_empty" : "media_too_large" },
      { status: 413 },
    );
  }

  try {
    const captured = await capturedImageFromBytes(
      bytes,
      normalizedType,
      `terminal-upload:${userId}:${file.name || "image"}`,
    );
    const stored = await storeCapturedImage(serviceClient(), captured);
    return jsonResponse({
      source_url: stored.publicUrl,
      storage_path: stored.path,
      mime_type: captured.contentType,
      width: captured.width,
      height: captured.height,
      byte_length: captured.bytes.byteLength,
    }, { status: 201 });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (/media_|unsupported_media_type|unsupported_webp/.test(message)) {
      return jsonResponse({ error: message }, { status: 400 });
    }
    return jsonResponse({ error: "upload_failed" }, { status: 500 });
  }
});

function normalizeMimeType(value: string): string {
  const normalized = String(value ?? "").toLowerCase().split(";", 1)[0].trim();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

