// Legacy compatibility endpoint. Launch execution is owned exclusively by
// the fenced queue workers; this endpoint is status-only.
import { jsonResponse } from "../_shared/cors.ts";
import {
  isCronAuthorized,
  unauthorizedCronResponse,
} from "../_shared/cron_auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null);
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();

  try {
    const admin = serviceClient();
    const readiness = await admin.rpc("get_linkr_route_readiness_v1");
    if (readiness.error) throw readiness.error;
    return jsonResponse({
      compatibility_endpoint: true,
      legacy_executor_retired: true,
      readiness: readiness.data,
    });
  } catch (error) {
    return jsonResponse({
      error: "legacy_launch_compatibility_failed",
      detail: String(error instanceof Error ? error.message : error).slice(
        0,
        240,
      ),
    }, { status: 500 });
  }
});
