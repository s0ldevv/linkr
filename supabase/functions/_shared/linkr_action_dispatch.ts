// deno-lint-ignore-file no-explicit-any
// Lightweight dispatch seam between conversational surfaces and isolated
// value-moving executors. No chain SDK is imported here.

export type DispatchConfirmResult = {
  status: string;
  pending_action_id: string;
  message: string;
  pending?: any;
  job?: any;
  receipt?: any;
  result?: any;
};

export async function cancelPendingActionViaDispatch(args: {
  admin: any;
  userId: string;
  pendingActionId: string;
}): Promise<{ cancelled: boolean; status: string; pending?: any }> {
  const { admin, userId, pendingActionId } = args;
  const { data: pending, error: loadErr } = await admin
    .from("linkr_pending_actions")
    .select("*")
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!pending) throw new Error("pending_action_not_found");
  if (pending.status !== "pending") {
    return {
      cancelled: false,
      status: String(pending.status),
      pending,
    };
  }
  const { data, error } = await admin
    .from("linkr_pending_actions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const current = await admin
      .from("linkr_pending_actions")
      .select("*")
      .eq("id", pendingActionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (current.error) throw current.error;
    return {
      cancelled: false,
      status: String(current.data?.status ?? "unknown"),
      pending: current.data ?? pending,
    };
  }
  return { cancelled: true, status: "cancelled", pending: data };
}

/**
 * Confirm a pending action through terminal-action's execution-only internal
 * path. The pending row remains the idempotency fence: a timeout or retry can
 * never claim and submit the same action twice.
 */
export async function confirmActionViaDispatch(args: {
  admin: any;
  userId: string;
  pendingActionId: string;
  runId?: string | null;
}): Promise<DispatchConfirmResult> {
  const { admin, userId, pendingActionId, runId } = args;
  const { data: pending, error } = await admin
    .from("linkr_pending_actions")
    .select("id,status,expires_at")
    .eq("id", pendingActionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!pending) throw new Error("pending_action_not_found");

  const expiresAt = pending.expires_at ? Date.parse(pending.expires_at) : NaN;
  if (
    pending.status === "pending" &&
    Number.isFinite(expiresAt) &&
    expiresAt < Date.now()
  ) {
    const expired = await admin
      .from("linkr_pending_actions")
      .update({ status: "expired" })
      .eq("id", pendingActionId)
      .eq("user_id", userId)
      .eq("status", "pending");
    if (expired.error) throw expired.error;
    throw new Error("pending_action_expired");
  }

  const baseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const internalKey = String(Deno.env.get("LINKR_INTERNAL_KEY") ?? "").trim();
  if (!baseUrl || !serviceKey) throw new Error("action_executor_not_configured");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
    "X-Request-ID": crypto.randomUUID(),
  };
  if (internalKey) headers["X-Linkr-Internal-Key"] = internalKey;

  const timeoutMs = positiveIntegerEnv("LINKR_ACTION_EXECUTOR_TIMEOUT_MS", 240_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/functions/v1/terminal-action`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        execution_only: true,
        action: "confirm",
        user_id: userId,
        pending_action_id: pendingActionId,
        run_id: runId ?? null,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("action_executor_timeout");
    }
    throw new Error("action_executor_unavailable");
  }

  const payload = await readBoundedJson(response, 512 * 1024);
  if (!response.ok) {
    const code = stableCode(payload?.error ?? payload?.message);
    throw new Error(code || `action_executor_http_${response.status}`);
  }

  const status = String(payload?.status ?? payload?.pending?.status ?? "executed");
  const message = String(
    payload?.message ??
      payload?.result?.summary ??
      (status === "executed"
        ? "Confirmed. The action has been handled."
        : `That action is ${status}.`),
  );
  return {
    ...payload,
    status,
    pending_action_id: pendingActionId,
    message,
  } as DispatchConfirmResult;
}

export type WalletContext = {
  evmWallet: { address: string; explorer_url: string } | null;
  solWallet: { address: string; explorer_url: string } | null;
  eth?: number | null;
  sol?: number | null;
  evmTokens?: any[];
  solTokens?: any[];
};

export async function readWalletContext(
  userId: string,
  scope: "wallet" | "portfolio",
): Promise<WalletContext> {
  const empty: WalletContext = { evmWallet: null, solWallet: null };
  try {
    const baseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    const internalKey = String(Deno.env.get("LINKR_INTERNAL_KEY") ?? "").trim();
    if (!baseUrl || !serviceKey) return empty;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    };
    if (internalKey) headers["X-Linkr-Internal-Key"] = internalKey;
    const res = await fetch(`${baseUrl}/functions/v1/linkr-agent-wallet-read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: userId, scope }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return empty;
    const data = await readBoundedJson(res, 512 * 1024).catch(() => null);
    if (!data || typeof data !== "object") return empty;
    return data as WalletContext;
  } catch {
    return empty;
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<any> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("action_executor_response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("action_executor_response_too_large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!combined.byteLength) return {};
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new Error("action_executor_invalid_response");
  }
}

function stableCode(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/^[a-z][a-z0-9_]{2,100}$/.test(text)) return text;
  return "action_executor_failed";
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Math.floor(Number(Deno.env.get(name) ?? fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
