// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isCronAuthorized } from "../_shared/cron_auth.ts";
import {
  internalErrorResponse,
  readJsonBody,
  requestBodyErrorResponse,
  serializeUnknownError,
} from "../_shared/http.ts";
import { cancelPendingActionViaDispatch } from "../_shared/linkr_action_dispatch.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { getActiveBanForAuthUser } from "../_shared/x_bans.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const internal = isCronAuthorized(req);
  const callerUserId = internal ? null : await getCallerUserId(req);
  if (!internal && !callerUserId) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await readJsonBody(req, 32 * 1024);
  } catch (error) {
    return requestBodyErrorResponse(error) ??
      internalErrorResponse(error, {
        function: "terminal-action",
        phase: "body",
      });
  }

  const requestedUserId = String(body?.user_id ?? "").trim();
  const userId = internal ? requestedUserId : callerUserId!;
  if (!UUID_PATTERN.test(userId)) {
    return jsonResponse({ error: "invalid_user_id" }, { status: 400 });
  }

  const pendingActionId = String(body?.pending_action_id ?? "").trim();
  const action = String(body?.action ?? "").trim().toLowerCase();
  const executionOnly = internal && body?.execution_only === true;
  if (!UUID_PATTERN.test(pendingActionId)) {
    return jsonResponse({ error: "invalid_pending_action_id" }, {
      status: 400,
    });
  }
  if (!["confirm", "cancel"].includes(action)) {
    return jsonResponse({ error: "invalid_action" }, { status: 400 });
  }

  const admin = serviceClient();
  if (!internal) {
    const activeBan = (await getActiveBanForAuthUser(admin, userId)).ban;
    if (activeBan) {
      return jsonResponse(
        {
          error: "banned_x_user",
          message: "This X account is banned from Linkr.",
        },
        { status: 403 },
      );
    }
  }

  let assistantMessage: any = null;
  let run: any = null;
  try {
    const pending = await loadPending(admin, userId, pendingActionId);
    if (!pending) {
      return jsonResponse({ error: "pending_action_not_found" }, {
        status: 404,
      });
    }

    if (executionOnly) {
      const result = action === "cancel"
        ? await cancelPendingActionViaDispatch({
          admin,
          userId,
          pendingActionId,
        })
        : await executePendingAction(
          admin,
          userId,
          pendingActionId,
          body?.run_id,
        );
      const message = executionMessage(action, result);
      return jsonResponse({ message, ...result });
    }

    const conversationId = pending.terminal_conversation_id;
    if (!conversationId) {
      return jsonResponse({ error: "not_terminal_pending_action" }, {
        status: 400,
      });
    }

    const userMessage = await insertMessage(admin, {
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content: action === "confirm" ? pending.confirmation_phrase : "cancel",
      status: "completed",
      parts: [],
      metadata: { pending_action_id: pendingActionId, action },
    });
    assistantMessage = await insertMessage(admin, {
      conversation_id: conversationId,
      user_id: userId,
      role: "assistant",
      content: action === "confirm"
        ? "Running confirmed action..."
        : "Cancelling action...",
      status: "typing",
      parts: [{
        type: "tool_status",
        label: action === "confirm" ? "Executing" : "Cancelling",
        status: "running",
      }],
      metadata: { pending_action_id: pendingActionId, action },
    });
    run = await insertRun(
      admin,
      userId,
      conversationId,
      userMessage.id,
      assistantMessage.id,
      action,
    );

    if (action === "cancel") {
      const cancelled = await cancelPendingActionViaDispatch({
        admin,
        userId,
        pendingActionId,
      });
      const text = cancelled.cancelled
        ? "Cancelled. I will not run that action."
        : "That action was already handled.";
      await updateAssistant(admin, assistantMessage.id, userId, text, [{
        type: "system_notice",
        text,
        pending_action_id: pendingActionId,
      }], "completed");
      await finish(admin, run.id, userId, "cancelled", { cancelled });
      await refreshPendingCount(admin, userId, conversationId);
      return jsonResponse({
        status: "cancelled",
        message: text,
        pending_action: cancelled.pending ?? pending,
      });
    }

    const execution = await executePendingAction(
      admin,
      userId,
      pendingActionId,
      run.id,
    );
    const text = executionMessage(action, execution);
    await updateAssistant(admin, assistantMessage.id, userId, text, [{
      type: "transaction_receipt",
      receipt: execution.receipt,
      result: execution.result,
    }], "completed");
    await finish(admin, run.id, userId, "completed", execution);
    await refreshPendingCount(admin, userId, conversationId);
    return jsonResponse({ message: text, ...execution });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = statusForError(message);
    const safeMessage = userSafeError(message);
    console.error(JSON.stringify({
      event: "terminal_action_failed",
      user_id: userId,
      pending_action_id: pendingActionId,
      error: serializeUnknownError(error),
    }));

    if (assistantMessage?.id) {
      await updateAssistant(
        admin,
        assistantMessage.id,
        userId,
        safeMessage,
        [{ type: "error", text: safeMessage }],
        "failed",
      ).catch(() => {});
    }
    if (run?.id) {
      await finish(admin, run.id, userId, "failed", {
        error_code: stableErrorCode(message),
      }).catch(() => {});
    }

    if (status >= 500) {
      return internalErrorResponse(error, { function: "terminal-action" });
    }
    return jsonResponse(
      { error: stableErrorCode(message), message: safeMessage },
      { status },
    );
  }
});

async function executePendingAction(
  admin: any,
  userId: string,
  pendingActionId: string,
  runId: unknown,
) {
  // The chain engine is intentionally lazy-loaded. Ordinary terminal boot and
  // cancellation remain lightweight, while confirmations load only when needed.
  const { confirmAndExecuteLinkrPendingAction } = await import(
    "../_shared/linkr_action_runtime.ts"
  );
  return await confirmAndExecuteLinkrPendingAction({
    admin,
    userId,
    pendingActionId,
    runId: UUID_PATTERN.test(String(runId ?? "")) ? String(runId) : null,
  });
}

function executionMessage(action: string, result: any): string {
  if (action === "cancel") {
    return result?.cancelled
      ? "Cancelled. I will not run that action."
      : "That action was already handled.";
  }
  return String(
    result?.result?.summary ??
      (result?.status === "executed"
        ? "Confirmed. The action has been handled."
        : `That action is already ${
          String(result?.status ?? "being handled")
        }.`),
  );
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
      surface: "terminal",
      source_surface: "terminal",
      surface_conversation_id: conversationId,
      terminal_conversation_id: conversationId,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
      status: "running",
      started_at: new Date().toISOString(),
      idempotency_key: `terminal-action:${action}:${userMessageId}`,
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

async function refreshPendingCount(
  admin: any,
  userId: string,
  conversationId: string,
) {
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

function statusForError(message: string) {
  if (/not_found/.test(message)) return 404;
  if (/expired/.test(message)) return 410;
  if (/invalid|missing/.test(message)) return 400;
  if (
    /insufficient|not_enabled|disabled|wallet|conflict|already/.test(message)
  ) {
    return 409;
  }
  return 500;
}

function userSafeError(message: string) {
  if (
    /transfer_status_uncertain|submission_outcome_unknown|reconcil/i.test(
      message,
    )
  ) {
    return "The transaction outcome is not confirmed yet. Linkr blocked duplicate execution and marked it for reconciliation.";
  }
  if (/insufficient/i.test(message)) {
    return "The action could not run because the wallet balance is too low.";
  }
  if (/expired/i.test(message)) {
    return "That pending action expired. Prepare it again if you still want to do it.";
  }
  if (/wallet/i.test(message)) {
    return "I could not find the required Linkr wallet for that action.";
  }
  if (
    /no_rewards_claimable|fee-sharing|launch_not_found|launch_token_not_confirmed/
      .test(message)
  ) {
    return "I do not see claimable creator rewards for that launch yet.";
  }
  if (/already|conflict|executing|confirmed/.test(message)) {
    return "That action is already being handled. Linkr will not submit a duplicate transaction.";
  }
  return "The action failed before completion. No duplicate action will be attempted.";
}

function stableErrorCode(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "action_failed";
}
