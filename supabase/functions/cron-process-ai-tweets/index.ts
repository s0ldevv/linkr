import {
  isCronAuthorized,
  unauthorizedCronResponse,
} from "../_shared/cron_auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Permanent tombstone: queue-owned X requests must never be claimed by the
// retired pre-queue executor. Keep this endpoint cheap because stale external
// schedulers may continue calling it until they are removed.
Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();
  console.warn(JSON.stringify({
    event: "retired_executor_invoked",
    function: "cron-process-ai-tweets",
    replacement: "worker-x-ingress",
  }));
  return jsonResponse({
    retired: true,
    error: "legacy_x_ai_executor_retired",
    replacement: "worker-x-ingress",
  }, { status: 410 });
});
