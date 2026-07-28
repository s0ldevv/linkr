// deno-lint-ignore-file no-explicit-any

export async function recordHealthEvent(
  admin: any,
  source: string,
  status: "ok" | "degraded" | "down",
  startedAt: number,
  details: Record<string, unknown> = {},
) {
  const latencyMs = Math.max(0, Date.now() - startedAt);
  try {
    const sampleMinutes = readPositiveInt("SYSTEM_HEALTH_OK_SAMPLE_MINUTES", 15);
    const { error } = await admin.rpc("record_system_health_event", {
      p_source: source,
      p_status: status,
      p_latency_ms: latencyMs,
      p_details: details,
      p_sample_minutes: sampleMinutes,
    });
    if (!error) return;
  } catch (_) {
    // Fall through to legacy insert for deployments before the RPC exists.
  }

  try {
    await admin.from("system_health_events").insert({
      source,
      status,
      latency_ms: latencyMs,
      details,
    });
  } catch (_) {
    // Health logging must never break the job it observes.
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = Number(Deno.env.get(name));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}
