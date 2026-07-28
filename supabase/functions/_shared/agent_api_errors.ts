// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "./cors.ts";
import { RequestBodyError, serializeUnknownError } from "./http.ts";

export class AgentApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(code: string, status = 400, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? code);
    this.name = "AgentApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function agentJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function agentErrorResponse(error: unknown, requestId?: string | null): Response {
  const resolvedRequestId = requestId ?? crypto.randomUUID();
  let apiError: AgentApiError;
  if (error instanceof AgentApiError) {
    apiError = error;
  } else if (error instanceof RequestBodyError) {
    apiError = new AgentApiError(error.code, error.status, error.code);
  } else {
    console.error(JSON.stringify({
      event: "agent_api_internal_error",
      request_id: resolvedRequestId,
      error: serializeUnknownError(error),
    }));
    apiError = new AgentApiError(
      "internal_error",
      500,
      "Linkr could not complete this request.",
    );
  }
  return agentJsonResponse(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        details: apiError.details,
      },
      request_id: resolvedRequestId,
    },
    { status: apiError.status },
  );
}

export function methodNotAllowed() {
  return new AgentApiError("method_not_allowed", 405);
}

export function unauthorized(code = "unauthorized", message?: string) {
  return new AgentApiError(code, 401, message);
}

export function forbidden(code = "forbidden", message?: string) {
  return new AgentApiError(code, 403, message);
}
