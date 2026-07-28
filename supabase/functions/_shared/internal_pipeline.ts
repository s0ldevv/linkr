export type PipelineFunctionName =
  | "cron-process-tweets"
  | "cron-post-replies"
  | "worker-x-ingress";

export interface InternalInvocationResult {
  attempted: boolean;
  ok: boolean;
  status?: number;
  error?: string;
}

export async function invokeInternalPipelineFunction(
  functionName: PipelineFunctionName,
  body: Record<string, unknown>,
): Promise<InternalInvocationResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const internalKey = Deno.env.get("X_INTERNAL_CRON_KEY")?.trim();
  if (!supabaseUrl || !internalKey) {
    return {
      attempted: false,
      ok: false,
      error: "internal_pipeline_configuration_missing",
    };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-key": internalKey,
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      return {
        attempted: true,
        ok: false,
        status: response.status,
        error: `internal_pipeline_http_${response.status}`,
      };
    }
    return { attempted: true, ok: true, status: response.status };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Fast cross-stage handoff is opt-in. Default OFF preserves today's behavior
// exactly: stage transitions fall back to the pg_cron queue controller. Enable
// with LINKR_FAST_HANDOFF_ENABLED=true once measured in staging.
export function isLinkrFastHandoffEnabled(): boolean {
  const raw = Deno.env.get("LINKR_FAST_HANDOFF_ENABLED");
  if (raw == null || raw.trim() === "") return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

type StageWakeResult = {
  requested?: boolean;
  wake_generation?: number;
  consumer_version?: string;
};

// PromiseLike (not Promise) so the Supabase PostgrestFilterBuilder — which is
// awaitable but not a real Promise — is structurally accepted.
type StageWakeClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

// Wake a downstream stage and, only if the wake is granted, invoke its worker so
// the enqueued work item runs immediately instead of waiting for the ~60s pg_cron
// controller tick. Safety properties:
//   - request_linkr_stage_wake self-gates: it returns requested=false when the
//     stage is disabled, its circuit is open, or a dispatch is already in flight,
//     so this never piles onto a busy stage or bypasses a breaker.
//   - The work item is already durably enqueued in PGMQ before this runs; the
//     pg_cron controller remains the recovery path if this best-effort call fails.
//   - Adds no DB polling and no pg_net traffic: dispatch is a direct edge fetch.
// It never throws; failures are reported in the result and swallowed by callers.
export async function wakeAndDispatchStage(
  admin: StageWakeClient,
  stage: string,
  functionName: string,
): Promise<InternalInvocationResult> {
  try {
    const wake = await admin.rpc("request_linkr_stage_wake", {
      p_stage: stage,
    });
    if (wake.error) {
      return {
        attempted: false,
        ok: false,
        error: `stage_wake_failed:${String(
          (wake.error as { message?: string } | null)?.message ?? wake.error,
        ).slice(0, 200)}`,
      };
    }
    const data = wake.data as StageWakeResult | null;
    if (!data || data.requested !== true) {
      return { attempted: false, ok: false, error: "wake_not_requested" };
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
    const internalKey = Deno.env.get("X_INTERNAL_CRON_KEY")?.trim();
    if (!supabaseUrl || !internalKey) {
      return {
        attempted: false,
        ok: false,
        error: "internal_pipeline_configuration_missing",
      };
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-key": internalKey,
        },
        body: JSON.stringify({
          stage,
          wake_generation: data.wake_generation,
          continuation: true,
          ...(data.consumer_version
            ? { consumer_version: data.consumer_version }
            : {}),
        }),
      },
    );
    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      ...(response.ok ? {} : { error: `dispatch_http_${response.status}` }),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function scheduleBackgroundTask(task: Promise<unknown>): boolean {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (!runtime?.waitUntil) return false;
  runtime.waitUntil(task);
  return true;
}

export function normalizeChainedTweetIds(value: unknown, limit = 50): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item) && item !== "0");
  return [...new Set(ids)].slice(0, Math.max(0, limit));
}
