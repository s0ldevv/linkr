// deno-lint-ignore-file no-explicit-any
import { isCronAuthorized, unauthorizedCronResponse } from "./cron_auth.ts";
import { jsonResponse } from "./cors.ts";
import {
  internalErrorResponse,
  readJsonBody,
  requestBodyErrorResponse,
} from "./http.ts";
import {
  isLinkrFastHandoffEnabled,
  scheduleBackgroundTask,
  wakeAndDispatchStage,
} from "./internal_pipeline.ts";
import {
  isLinkrQueueStage,
  LINKR_STAGE_WORKER_FUNCTIONS,
  type LinkrQueueStage,
  linkrQueueForRoute,
  type StageClaim,
  type StageSlot,
} from "./queue_contracts.ts";
import { serviceClient } from "./supabase.ts";

export type StageOutcome =
  | {
    kind: "complete";
    state: string;
    nextRoute?: string | null;
    resultRef?: string | null;
  }
  | { kind: "retry"; errorCode: string; delaySeconds: number }
  | { kind: "dead_letter"; reasonCode: string; fingerprint?: string | null };

export interface StageWorkerOptions {
  /** Exactly one fixed stage, or an allowlist for priority-lane workers. */
  stage?: LinkrQueueStage;
  stages?: readonly LinkrQueueStage[];
  functionName: string;
  consumerVersion?: string;
  visibilitySeconds: number;
  process: (
    claim: StageClaim,
    admin: any,
    context: StageExecutionContext,
  ) => Promise<StageOutcome>;
}

export interface StageExecutionContext {
  workerId: string;
  stage: LinkrQueueStage;
  slot: StageSlot;
}

export async function runStageWorker(
  req: Request,
  options: StageWorkerOptions,
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  // Authenticate before reading the body. These functions intentionally disable
  // Supabase JWT verification because they are internal queue consumers.
  if (!isCronAuthorized(req)) return unauthorizedCronResponse();

  const allowedStages = options.stages ?? (options.stage ? [options.stage] : []);
  if (allowedStages.length === 0) {
    return internalErrorResponse(new Error("worker_stage_configuration_missing"), {
      function: options.functionName,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req, 16 * 1024)) as Record<string, unknown>;
  } catch (error) {
    return requestBodyErrorResponse(error) ??
      internalErrorResponse(error, { function: options.functionName });
  }
  if (!isLinkrQueueStage(body.stage) || !allowedStages.includes(body.stage)) {
    return jsonResponse({ error: "invalid_stage" }, { status: 400 });
  }
  if (
    options.consumerVersion &&
    body.consumer_version !== options.consumerVersion
  ) {
    return jsonResponse({ error: "consumer_version_mismatch" }, { status: 409 });
  }
  const stage = body.stage;
  const wakeGeneration = Number(body.wake_generation);
  if (!Number.isSafeInteger(wakeGeneration) || wakeGeneration < 1) {
    return jsonResponse({ error: "invalid_wake_generation" }, { status: 400 });
  }

  const admin = serviceClient();
  const workerId = `${options.functionName}:${crypto.randomUUID()}`;
  const started = await admin.rpc("mark_linkr_dispatch_started", {
    p_stage: stage,
    p_wake_generation: wakeGeneration,
    p_worker_id: workerId,
    p_lease_seconds: options.visibilitySeconds,
  });
  if (started.error) {
    return internalErrorResponse(started.error, {
      function: options.functionName,
      phase: "start",
    });
  }
  if (started.data !== true) return jsonResponse({ skipped: "stale_dispatch" });

  try {
    const claimed = await admin.rpc("claim_linkr_stage_work", {
      p_queue_name: stage,
      p_worker_id: workerId,
      p_visibility_seconds: options.visibilitySeconds,
      p_batch_quantity: 1,
    });
    if (claimed.error) throw claimed.error;
    const claim = (claimed.data?.claims?.[0] ?? null) as StageClaim | null;
    const slot = (claimed.data?.slot ?? null) as StageSlot | null;
    if (!claim || !slot) {
      await finishDispatch(
        admin,
        stage,
        wakeGeneration,
        workerId,
        false,
      );
      return jsonResponse({ processed: 0, empty: true });
    }

    const outcome = await options.process(claim, admin, {
      workerId,
      stage,
      slot,
    });
    if (outcome.kind === "complete") {
      const result = await admin.rpc("complete_linkr_stage_work", {
        p_queue_name: stage,
        p_message_id: claim.message_id,
        p_work_item_id: claim.work_item.id,
        p_worker_id: workerId,
        p_slot_number: slot.slot_number,
        p_slot_fencing_token: slot.fencing_token,
        p_resource_fencing_token: claim.resource_fencing_token,
        p_expected_state_version: claim.work_item.state_version,
        p_new_state: outcome.state,
        p_next_route: outcome.nextRoute ?? null,
        p_result_ref: outcome.resultRef ?? null,
      });
      if (result.error) throw result.error;
    } else if (outcome.kind === "retry") {
      const result = await admin.rpc("retry_linkr_stage_work", {
        p_queue_name: stage,
        p_message_id: claim.message_id,
        p_work_item_id: claim.work_item.id,
        p_worker_id: workerId,
        p_slot_number: slot.slot_number,
        p_slot_fencing_token: slot.fencing_token,
        p_resource_fencing_token: claim.resource_fencing_token,
        p_expected_state_version: claim.work_item.state_version,
        p_error_code: outcome.errorCode,
        p_delay_seconds: outcome.delaySeconds,
      });
      if (result.error) throw result.error;
    } else {
      const result = await admin.rpc("dead_letter_linkr_stage_work", {
        p_queue_name: stage,
        p_message_id: claim.message_id,
        p_work_item_id: claim.work_item.id,
        p_worker_id: workerId,
        p_slot_number: slot.slot_number,
        p_slot_fencing_token: slot.fencing_token,
        p_resource_fencing_token: claim.resource_fencing_token,
        p_expected_state_version: claim.work_item.state_version,
        p_reason_code: outcome.reasonCode,
        p_error_fingerprint: outcome.fingerprint ?? null,
      });
      if (result.error) throw result.error;
    }

    await finishDispatch(admin, stage, wakeGeneration, workerId, false);
    const continuation = requestContinuation(
      admin,
      stage,
      options.functionName,
      options.consumerVersion,
    );
    if (!scheduleBackgroundTask(continuation)) await continuation;

    // Fast cross-stage handoff (opt-in via LINKR_FAST_HANDOFF_ENABLED). When this
    // stage completed with a non-terminal route, the item was just enqueued into
    // the downstream stage's PGMQ queue by complete_linkr_stage_work. Wake and
    // invoke that stage now instead of waiting for the ~60s pg_cron controller.
    // The wake self-gates against in-flight dispatch and open circuits, so this is
    // a safe no-op when the next stage is already running. Best-effort: the
    // controller remains the durable recovery path.
    if (
      isLinkrFastHandoffEnabled() && outcome.kind === "complete" &&
      outcome.nextRoute
    ) {
      const nextStage = linkrQueueForRoute(
        outcome.nextRoute,
        claim.work_item.priority,
      );
      if (nextStage) {
        const handoff = wakeAndDispatchStage(
          admin,
          nextStage,
          LINKR_STAGE_WORKER_FUNCTIONS[nextStage],
        );
        if (!scheduleBackgroundTask(handoff)) await handoff;
      }
    }

    // Side-enqueued work (X replies, launch work items created by RPCs such as
    // finalize_linkr_coin_launch_v2 / enqueue_linkr_x_reply_v1) is not a
    // nextRoute transition, so the handoff above cannot see it. A throttled
    // sweep reuses the exact same dispatcher the pg_cron controller calls, so
    // capacity slots, circuit breakers and platform pause modes all still
    // apply. It is advisory-locked and rate-limited in SQL, so concurrent
    // workers cannot stampede Postgres.
    if (isLinkrFastHandoffEnabled()) {
      const sweep = fastDispatchSweep(admin);
      if (!scheduleBackgroundTask(sweep)) await sweep;
    }
    return jsonResponse({
      processed: 1,
      work_item_id: claim.work_item.id,
      outcome: outcome.kind,
    });
  } catch (error) {
    await finishDispatch(admin, stage, wakeGeneration, workerId, false)
      .catch(() => {});
    return internalErrorResponse(error, {
      function: options.functionName,
      stage,
    });
  }
}

async function finishDispatch(
  admin: any,
  stage: LinkrQueueStage,
  generation: number,
  workerId: string,
  backlogRemains: boolean,
) {
  const result = await admin.rpc("mark_linkr_dispatch_finished", {
    p_stage: stage,
    p_wake_generation: generation,
    p_worker_id: workerId,
    p_backlog_remains: backlogRemains,
  });
  if (result.error) throw result.error;
}

async function fastDispatchSweep(admin: any) {
  try {
    await admin.rpc("linkr_fast_dispatch_sweep_v1", {
      p_limit: 8,
      p_min_interval_ms: 750,
    });
  } catch {
    // Best effort only: the pg_cron controller remains the durable path.
  }
}

async function requestContinuation(
  admin: any,
  stage: LinkrQueueStage,
  functionName: string,
  consumerVersion?: string,
) {
  const wake = await admin.rpc("request_linkr_stage_wake", { p_stage: stage });
  if (wake.error || wake.data?.requested !== true) return;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const internalKey = Deno.env.get("X_INTERNAL_CRON_KEY")?.trim();
  if (!supabaseUrl || !internalKey) return;
  await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": internalKey,
    },
    body: JSON.stringify(
      buildContinuationBody(
        stage,
        wake.data.wake_generation,
        consumerVersion,
      ),
    ),
  });
}

export function buildContinuationBody(
  stage: LinkrQueueStage,
  wakeGeneration: number,
  consumerVersion?: string,
): Record<string, unknown> {
  return {
    stage,
    wake_generation: wakeGeneration,
    continuation: true,
    ...(consumerVersion ? { consumer_version: consumerVersion } : {}),
  };
}
