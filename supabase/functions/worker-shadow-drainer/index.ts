import { jsonResponse } from "../_shared/cors.ts";
import { isCronAuthorized, unauthorizedCronResponse } from "../_shared/cron_auth.ts";
import { LINKR_QUEUE_STAGES } from "../_shared/queue_contracts.ts";
import { runStageWorker } from "../_shared/queue_worker.ts";
import {
  recordShadowReceipt,
  shadowQueueEnabled,
} from "../_shared/shadow_queue.ts";

Deno.serve((req) => {
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();
  if (!shadowQueueEnabled()) {
    return jsonResponse({ error: "shadow_consumer_disabled" }, { status: 503 });
  }
  return runStageWorker(req, {
    stages: LINKR_QUEUE_STAGES,
    functionName: "worker-shadow-drainer",
    visibilitySeconds: 120,
    process: async (claim, admin) => {
      await recordShadowReceipt(admin, claim);
      return {
        kind: "complete",
        state: "succeeded",
        resultRef: `shadow-receipt:${claim.work_item.id}`,
      };
    },
  });
});
