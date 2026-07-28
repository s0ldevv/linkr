import { jsonResponse } from "./cors.ts";

export class RequestBodyError extends Error {
  constructor(
    public readonly code: "request_body_too_large" | "invalid_json",
    public readonly status: number,
  ) {
    super(code);
  }
}

export async function readJsonBody(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const limit = Math.max(1, Math.floor(maxBytes));
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new RequestBodyError("request_body_too_large", 413);
  }
  if (!req.body) return {};

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel("request_body_too_large").catch(() => {});
      throw new RequestBodyError("request_body_too_large", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  } catch (_) {
    throw new RequestBodyError("invalid_json", 400);
  }
}

export function requestBodyErrorResponse(error: unknown): Response | null {
  return error instanceof RequestBodyError
    ? jsonResponse({ error: error.code }, { status: error.status })
    : null;
}

export function internalErrorResponse(
  error: unknown,
  context: Record<string, unknown> = {},
): Response {
  const bodyError = requestBodyErrorResponse(error);
  if (bodyError) return bodyError;
  const requestId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      event: "edge_function_error",
      request_id: requestId,
      ...context,
      error: serializeUnknownError(error),
    }),
  );
  return jsonResponse({ error: "internal_error", request_id: requestId }, { status: 500 });
}

export function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const serialized: Record<string, unknown> = {
      message: typeof value.message === "string" ? value.message : "unknown_error",
    };
    for (const key of ["code", "details", "hint"]) {
      if (value[key] !== undefined && value[key] !== null) serialized[key] = value[key];
    }
    return serialized;
  }
  return { message: String(error ?? "unknown_error") };
}

export function safeErrorResponse(
  error: unknown,
  options: {
    status?: number;
    functionName: string;
  },
): Response {
  const bodyError = requestBodyErrorResponse(error);
  if (bodyError) return bodyError;
  const message = error instanceof Error ? error.message : String(error);
  if (/^[a-z][a-z0-9_]{2,100}$/.test(message)) {
    return jsonResponse({ error: message }, { status: options.status ?? 400 });
  }
  return internalErrorResponse(error, { function: options.functionName });
}

export async function consumeRateLimit(
  admin: any,
  options: {
    subjectType: string;
    subjectId: string;
    windowSeconds: number;
    limit: number;
  },
): Promise<{ allowed: boolean; remaining: number; resetAt: string | null }> {
  const result = await admin.rpc("consume_linkr_rate_limit", {
    p_subject_type: options.subjectType,
    p_subject_id: options.subjectId,
    p_window_seconds: options.windowSeconds,
    p_limit: options.limit,
  });
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    allowed: Boolean(row?.allowed),
    remaining: Number(row?.remaining ?? 0),
    resetAt: row?.reset_at ?? null,
  };
}

export function rateLimitResponse(resetAt: string | null): Response {
  const retryAfter = resetAt
    ? Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000))
    : 60;
  return jsonResponse(
    { error: "rate_limit_exceeded", retry_after: retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
