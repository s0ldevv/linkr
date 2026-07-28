// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { type AgentScope } from "../_shared/agent_api_core.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { cancelPendingActionViaDispatch } from "../_shared/linkr_action_dispatch.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());

  const admin = serviceClient();
  let ctx: any = null;
  let statusCode = 500;
  try {
    ctx = await requireAgentApiKey(req, admin, "chat:write");
    const pendingActionId = String(ctx.body?.pending_action_id ?? "").trim();
    const action = String(ctx.body?.action ?? "").trim().toLowerCase();
    if (!UUID_PATTERN.test(pendingActionId)) {
      throw new AgentApiError("invalid_pending_action_id", 400);
    }
    if (!["confirm", "cancel"].includes(action)) {
      throw new AgentApiError("invalid_action", 400);
    }
    if (action === "confirm" && !ctx.idempotencyKey) {
      throw new AgentApiError("idempotency_required", 400, "Idempotency-Key is required.");
    }

    const pending = await loadPending(admin, ctx.userId, pendingActionId);
    if (!pending) throw new AgentApiError("pending_action_not_found", 404);
    if (!pending.terminal_conversation_id) {
      throw new AgentApiError("not_terminal_pending_action", 400);
    }

    if (action === "confirm") {
      requireConfirmationPhrase(ctx.body?.confirmation_phrase, pending);
      requireScopes(ctx, requiredScopesForPending(pending));
      enforceApiKeyCaps(ctx, pending);
    }

    const userMessage = await insertMessage(admin, {
      conversation_id: pending.terminal_conversation_id,
      user_id: ctx.userId,
      role: "user",
      content: action === "confirm" ? pending.confirmation_phrase : "cancel",
      status: "completed",
      parts: [],
      metadata: {
        pending_action_id: pendingActionId,
        action,
        source_surface: "cli",
        api_key_id: ctx.apiKeyId,
      },
    });
    const assistantMessage = await insertMessage(admin, {
      conversation_id: pending.terminal_conversation_id,
      user_id: ctx.userId,
      role: "assistant",
      content: action === "confirm" ? "Running confirmed action..." : "Cancelling action...",
      status: "typing",
      parts: [{
        type: "tool_status",
        label: action === "confirm" ? "Executing" : "Cancelling",
        status: "running",
      }],
      metadata: {
        pending_action_id: pendingActionId,
        action,
        source_surface: "cli",
        api_key_id: ctx.apiKeyId,
      },
    });
    const run = await insertRun(
      admin,
      ctx.userId,
      pending.terminal_conversation_id,
      userMessage.id,
      assistantMessage.id,
      action,
    );

    if (action === "cancel") {
      const cancelled = await cancelPendingActionViaDispatch({
        admin,
        userId: ctx.userId,
        pendingActionId,
      });
      const text = cancelled.cancelled
        ? "Cancelled. I will not run that action."
        : "That action was already handled.";
      await updateAssistant(admin, assistantMessage.id, ctx.userId, text, [{
        type: "system_notice",
        text,
        pending_action_id: pendingActionId,
      }], "completed");
      await finish(admin, run.id, ctx.userId, "cancelled", { cancelled });
      await refreshPendingCount(admin, ctx.userId, pending.terminal_conversation_id);
      statusCode = 200;
      await recordAgentRequest(admin, ctx, req, statusCode);
      return agentJsonResponse({
        status: "cancelled",
        message: text,
        pending_action: cancelled.pending ?? pending,
      });
    }

    const execution = await executePendingAction(admin, ctx.userId, pendingActionId, run.id);
    const text = executionMessage(execution);
    await updateAssistant(admin, assistantMessage.id, ctx.userId, text, [{
      type: "transaction_receipt",
      receipt: execution.receipt,
      result: execution.result,
    }], "completed");
    await finish(admin, run.id, ctx.userId, "completed", execution);
    await refreshPendingCount(admin, ctx.userId, pending.terminal_conversation_id);
    statusCode = 200;
    await recordAgentRequest(admin, ctx, req, statusCode);
    return agentJsonResponse({ message: text, ...execution });
  } catch (error) {
    statusCode = (error as any)?.status ?? statusForError(error);
    await recordAgentRequest(admin, ctx ?? {}, req, statusCode, error).catch(() => {});
    return agentErrorResponse(error);
  }
});

async function executePendingAction(
  admin: any,
  userId: string,
  pendingActionId: string,
  runId: string,
) {
  const { confirmAndExecuteLinkrPendingAction } = await import(
    "../_shared/linkr_action_runtime.ts"
  );
  return await confirmAndExecuteLinkrPendingAction({
    admin,
    userId,
    pendingActionId,
    runId,
  });
}

async function loadPending(admin: any, userId: string, id: string) {
  const { data, error } = await admin
    .from("linkr_pending_actions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function requireConfirmationPhrase(rawPhrase: unknown, pending: any) {
  const expected = String(pending.confirmation_phrase ?? "").trim();
  const supplied = String(rawPhrase ?? "").trim();
  if (!expected || supplied !== expected) {
    throw new AgentApiError(
      "confirmation_phrase_required",
      403,
      "Type the exact confirmation phrase to run this action.",
    );
  }
}

function requireScopes(ctx: any, scopes: AgentScope[]) {
  const owned = new Set(Array.isArray(ctx.scopes) ? ctx.scopes : []);
  for (const scope of scopes) {
    if (!owned.has(scope)) {
      throw new AgentApiError("forbidden_scope", 403, `Missing required scope: ${scope}`);
    }
  }
}

function requiredScopesForPending(pending: any): AgentScope[] {
  const payload = pending.action_payload ?? {};
  switch (String(pending.action_type ?? "")) {
    case "buy":
      return ["trade:buy"];
    case "sell":
      return ["trade:sell"];
    case "transfer":
      return ["transfer:write"];
    case "swap":
      return swapDirection(payload) === "usdc_to_sol" ? ["trade:buy"] : ["trade:sell"];
    case "burn_token":
      return ["burn:write"];
    case "add_liquidity":
    case "remove_liquidity":
    case "collect_liquidity_fees":
      return ["liquidity:write"];
    case "claim_creator_rewards":
      return ["rewards:claim"];
    case "launch_coin":
      return ["launch:write"];
    case "schedule_action":
      return uniqueScopes(["schedule:write", ...scheduledActionScopes(payload)]);
    default:
      throw new AgentApiError("unsupported_action_type", 400);
  }
}

function scheduledActionScopes(payload: any): AgentScope[] {
  switch (String(payload?.action_type ?? "").trim()) {
    case "buy":
      return ["trade:buy"];
    case "sell":
      return ["trade:sell"];
    case "transfer":
      return ["transfer:write"];
    case "launch_coin":
      return ["launch:write"];
    case "claim_creator_rewards":
      return ["rewards:claim"];
    case "add_liquidity":
    case "remove_liquidity":
    case "collect_liquidity_fees":
      return ["liquidity:write"];
    default:
      return [];
  }
}

function uniqueScopes(scopes: AgentScope[]): AgentScope[] {
  return [...new Set(scopes)];
}

function enforceApiKeyCaps(ctx: any, pending: any) {
  const payload = pending.action_payload ?? {};
  const actionType = String(pending.action_type ?? "");
  if (actionType === "schedule_action") {
    enforceScheduledCaps(ctx, payload);
    return;
  }
  enforceCapsForPayload(ctx, actionType, payload);
}

function enforceScheduledCaps(ctx: any, payload: any) {
  enforceCapsForPayload(ctx, String(payload?.action_type ?? ""), payload);
}

function enforceCapsForPayload(ctx: any, actionType: string, payload: any) {
  const chain = normalizeChain(payload);
  if (actionType === "buy") {
    if (chain === "solana") {
      assertCap(ctx, "max_buy_sol", numeric(payload.amount_sol ?? payload.amount), "max_buy_sol_exceeded");
    } else {
      assertCap(ctx, "max_buy_eth", numeric(payload.amount_eth ?? payload.amount), "max_buy_eth_exceeded");
    }
    return;
  }
  if (actionType === "sell") {
    assertCap(ctx, "max_sell_percent", numeric(payload.percent ?? payload.amount_pct), "max_sell_percent_exceeded");
    return;
  }
  if (actionType === "transfer") {
    if (chain === "solana") {
      assertCap(ctx, "max_transfer_sol", numeric(payload.amount_sol ?? payload.amount), "max_transfer_sol_exceeded");
    } else {
      assertCap(ctx, "max_transfer_eth", numeric(payload.amount_eth ?? payload.amount), "max_transfer_eth_exceeded");
    }
    return;
  }
  if (actionType === "launch_coin") {
    if (chain === "solana") {
      assertCap(ctx, "max_launch_initial_buy_sol", numeric(payload.initial_buy_sol), "max_launch_initial_buy_sol_exceeded");
    } else {
      assertCap(ctx, "max_launch_initial_buy_eth", numeric(payload.initial_buy_eth), "max_launch_initial_buy_eth_exceeded");
    }
    return;
  }
  if (actionType === "add_liquidity" && chain !== "solana") {
    assertCap(
      ctx,
      "max_liquidity_eth",
      numeric(payload.eth_amount ?? payload.amount_eth ?? payload.native_amount),
      "max_liquidity_eth_exceeded",
    );
  }
}

function assertCap(ctx: any, field: string, amount: number | null, code: string) {
  if (amount == null) return;
  const cap = Number(ctx.apiKey?.[field]);
  if (!Number.isFinite(cap) || cap < 0) return;
  if (amount > cap) {
    throw new AgentApiError(code, 403, "Action exceeds this CLI key's configured cap.");
  }
}

function numeric(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeChain(payload: any): "solana" | "robinhood" {
  const raw = String(payload?.chain ?? "").trim().toLowerCase();
  if (["sol", "solana", "pump", "pump.fun", "pump_swap"].includes(raw)) return "solana";
  return "robinhood";
}

function swapDirection(payload: any): string {
  return String(payload?.direction ?? payload?.swap_direction ?? "").trim().toLowerCase();
}

function executionMessage(result: any): string {
  return String(
    result?.result?.summary ??
      (result?.status === "executed"
        ? "Confirmed. The action has been handled."
        : `That action is already ${String(result?.status ?? "being handled")}.`),
  );
}

async function insertMessage(admin: any, row: Record<string, unknown>) {
  const { data, error } = await admin
    .from("linkr_terminal_messages")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function insertRun(
  admin: any,
  userId: string,
  conversationId: string,
  userMessageId: string,
  assistantMessageId: string,
  action: string,
) {
  const { data, error } = await admin
    .from("linkr_agent_runs")
    .insert({
      user_id: userId,
      surface: "cli",
      source_surface: "cli",
      surface_conversation_id: conversationId,
      terminal_conversation_id: conversationId,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
      status: "running",
      started_at: new Date().toISOString(),
      idempotency_key: `cli-action:${action}:${userMessageId}`,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function updateAssistant(
  admin: any,
  messageId: string,
  userId: string,
  content: string,
  parts: any[],
  status: string,
) {
  const { error } = await admin
    .from("linkr_terminal_messages")
    .update({ content, parts, status })
    .eq("id", messageId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function finish(
  admin: any,
  runId: string,
  userId: string,
  status: string,
  outcome: any,
) {
  const { error } = await admin
    .from("linkr_agent_runs")
    .update({ status, outcome, completed_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function refreshPendingCount(admin: any, userId: string, conversationId: string) {
  const result = await admin
    .from("linkr_pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("terminal_conversation_id", conversationId)
    .eq("status", "pending");
  if (result.error) throw result.error;
  const update = await admin
    .from("linkr_terminal_conversations")
    .update({
      pending_action_count: result.count ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (update.error) throw update.error;
}

function statusForError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not_found/.test(message)) return 404;
  if (/expired/.test(message)) return 410;
  if (/invalid|missing|required/.test(message)) return 400;
  if (/forbidden|scope|cap|exceeded|confirmation/.test(message)) return 403;
  if (/insufficient|not_enabled|disabled|wallet|conflict|already/.test(message)) return 409;
  return 500;
}
