// Legacy compatibility endpoint. This function may accept durable X pointers
// and request a wake, but it must never classify, sign, or execute work.
import { jsonResponse } from "../_shared/cors.ts";
import {
  isCronAuthorized,
  unauthorizedCronResponse,
} from "../_shared/cron_auth.ts";
import {
  readJsonBody,
  requestBodyErrorResponse,
} from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";

const MAX_BODY_BYTES = 16 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();

  try {
    const admin = serviceClient();
    const tweetIds = req.method === "POST"
      ? normalizeTweetIds(await readJsonBody(req, MAX_BODY_BYTES))
      : [];
    const accepted = tweetIds.length > 0
      ? await admin.rpc("accept_linkr_x_page_v1", {
        p_tweet_ids: tweetIds,
        p_execution_generation: 1,
      })
      : { data: null, error: null };
    if (accepted.error) throw accepted.error;
    const wake = await admin.rpc("request_linkr_stage_wake", {
      p_stage: "x_ingress",
    });
    if (wake.error) throw wake.error;
    const readiness = await admin.rpc("get_linkr_route_readiness_v1");
    if (readiness.error) throw readiness.error;
    return jsonResponse({
      compatibility_endpoint: true,
      legacy_executor_retired: true,
      accepted: accepted.data,
      wake: wake.data,
      readiness: readiness.data,
    });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return jsonResponse({
      error: "legacy_x_compatibility_failed",
      detail: sanitizeError(error),
    }, { status: 500 });
  }
});

function normalizeTweetIds(body: unknown): string[] {
  const value = body && typeof body === "object"
    ? (body as Record<string, unknown>).tweet_ids
    : null;
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("invalid_tweet_ids");
  }
  return [...new Set(value.map(String))].filter((id) => /^\d{1,32}$/.test(id));
}

function sanitizeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 240);
}
