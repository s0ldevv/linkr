// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { capturedImageFromBytes, storeCapturedImage } from "../_shared/bounded_media.ts";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 6 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "chat:write", { maxBodyBytes: MAX_JSON_BYTES });
    const mimeType = normalizeMimeType(ctx.body?.mime_type);
    if (!mimeType || !ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new AgentApiError("unsupported_media_type", 415);
    }
    const base64 = String(ctx.body?.image_base64 ?? "").trim();
    if (!base64 || base64.length > Math.ceil(MAX_UPLOAD_BYTES * 1.4)) {
      throw new AgentApiError("media_too_large", 413);
    }
    const bytes = decodeBase64(base64);
    if (bytes.byteLength <= 0) throw new AgentApiError("media_empty", 413);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new AgentApiError("media_too_large", 413);

    const captured = await capturedImageFromBytes(
      bytes,
      mimeType,
      `cli-upload:${ctx.userId}:${String(ctx.body?.filename ?? "image").slice(0, 80)}`,
    );
    const stored = await storeCapturedImage(admin, captured);
    await recordAgentRequest(admin, ctx, req, 201);
    return agentJsonResponse({
      source_url: stored.publicUrl,
      storage_path: stored.path,
      mime_type: captured.contentType,
      width: captured.width,
      height: captured.height,
      byte_length: captured.bytes.byteLength,
    }, { status: 201 });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});

function normalizeMimeType(value: unknown): string {
  const normalized = String(value ?? "").toLowerCase().split(";", 1)[0].trim();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function decodeBase64(value: string): Uint8Array {
  try {
    const normalized = value.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    const raw = atob(normalized);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
    return bytes;
  } catch {
    throw new AgentApiError("invalid_base64_image", 400);
  }
}
