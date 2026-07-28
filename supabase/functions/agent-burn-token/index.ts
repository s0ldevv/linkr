// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import {
  recordAgentRequest,
  requireAgentApiKey,
} from "../_shared/agent_api_auth.ts";
import { stableIdempotencyKey } from "../_shared/linkr_idempotency.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  executeTokenBurn,
  previewTokenBurn,
  tokenBurnConfirmationText,
} from "../_shared/token_burn.ts";

const IRREVERSIBLE_ACKNOWLEDGEMENT = "IRREVERSIBLE_TOKEN_BURN";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "burn:write", {
      requireIdempotency: true,
    });
    const operation = String(
      ctx.body?.action ?? ctx.body?.operation ?? "prepare",
    )
      .trim()
      .toLowerCase();
    const response = operation === "confirm"
      ? await confirmBurn(admin, ctx)
      : operation === "cancel"
      ? await cancelBurn(admin, ctx)
      : operation === "prepare"
      ? await prepareBurn(admin, ctx)
      : (() => {
        throw new AgentApiError(
          "invalid_burn_operation",
          400,
          "action must be prepare, confirm, or cancel.",
        );
      })();
    await recordAgentRequest(admin, ctx, req, response.status);
    return response;
  } catch (error) {
    const mapped = mapBurnError(error);
    await recordAgentRequest(
      admin,
      ctx ?? {},
      req,
      (mapped as any)?.status ?? 500,
      mapped,
    ).catch(
      () => {},
    );
    return agentErrorResponse(mapped);
  }
});

async function prepareBurn(admin: any, ctx: any): Promise<Response> {
  if (
    ctx.body?.confirm === true || ctx.body?.execute === true ||
    ctx.body?.dry_run === false
  ) {
    throw new AgentApiError(
      "burn_single_call_execution_forbidden",
      400,
      "A burn cannot be prepared and executed in one request. Prepare it first, show the confirmation to the user, then send a separate confirm request.",
    );
  }
  const chain = String(ctx.body?.chain ?? "").trim();
  const token = String(
    ctx.body?.token_address ?? ctx.body?.token_mint ?? ctx.body?.token ?? "",
  ).trim();
  const amount = String(ctx.body?.amount ?? ctx.body?.token_amount ?? "")
    .trim();
  if (!chain) {
    throw new AgentApiError(
      "burn_chain_required",
      400,
      "chain is required and must be robinhood or solana.",
    );
  }
  if (!token) {
    throw new AgentApiError(
      "burn_token_required",
      400,
      "A full token contract address or Solana mint is required.",
    );
  }
  if (!amount) {
    throw new AgentApiError(
      "burn_amount_required",
      400,
      "An exact token amount or all is required.",
    );
  }

  const preview = await previewTokenBurn(admin, {
    userId: ctx.userId,
    walletId: ctx.walletId,
    chain,
    token,
    amount,
  });
  const idempotencyKey = stableIdempotencyKey(
    "agent-api-burn-pending",
    ctx.apiKeyId,
    ctx.idempotencyKey,
  );
  const row = {
    user_id: ctx.userId,
    surface: "agent_api",
    source_surface: "agent_api",
    surface_conversation_id: `agent-api:${ctx.apiKeyId}`,
    action_type: "burn_token",
    status: "pending",
    confirmation_phrase: "confirm burn",
    summary: `Permanently burn ${preview.amount}${
      preview.symbol ? ` ${preview.symbol}` : " tokens"
    } on ${preview.chain}.`,
    action_payload: {
      chain: preview.chain,
      token: preview.token,
      amount: preview.amount,
      burn_preview: preview,
      irreversible: true,
      agent_api_key_id: ctx.apiKeyId,
    },
    risk_summary: [
      {
        level: "critical",
        text:
          "This permanently destroys the exact token amount shown. It cannot be reversed or recovered.",
      },
    ],
    deterministic_validation: {
      schema: "token-burn-v1",
      api_key_id: ctx.apiKeyId,
      request_hash: ctx.requestHash,
      validated_at: new Date().toISOString(),
    },
    idempotency_key: idempotencyKey,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const inserted = await admin.from("linkr_pending_actions").insert(row).select(
    "*",
  ).maybeSingle();
  let pending = inserted.data;
  if (inserted.error) {
    if (String(inserted.error.code) !== "23505") throw inserted.error;
    const existing = await admin
      .from("linkr_pending_actions")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error || !existing.data) {
      throw existing.error ?? new Error("burn_pending_not_found");
    }
    pending = existing.data;
  }
  const responsePreview = pending.action_payload?.burn_preview;
  if (!responsePreview) throw new Error("invalid_burn_preview");
  const confirmation = tokenBurnConfirmationText(responsePreview);
  return agentJsonResponse(
    {
      status: "awaiting_confirmation",
      confirmation_required: true,
      action: {
        id: pending.id,
        type: "burn_token",
        status: pending.status,
        expires_at: pending.expires_at,
        preview: responsePreview,
      },
      confirmation: {
        message: confirmation,
        confirm_request: {
          action: "confirm",
          pending_action_id: pending.id,
          acknowledgement: IRREVERSIBLE_ACKNOWLEDGEMENT,
        },
        cancel_request: { action: "cancel", pending_action_id: pending.id },
      },
    },
    { status: 202 },
  );
}

async function confirmBurn(admin: any, ctx: any): Promise<Response> {
  const pendingActionId = requiredPendingActionId(ctx.body);
  if (ctx.body?.acknowledgement !== IRREVERSIBLE_ACKNOWLEDGEMENT) {
    throw new AgentApiError(
      "burn_acknowledgement_required",
      400,
      `acknowledgement must equal ${IRREVERSIBLE_ACKNOWLEDGEMENT}.`,
    );
  }
  const pending = await loadOwnedBurnPending(admin, ctx, pendingActionId);
  if (pending.status === "executed") {
    return burnReplayResponse(admin, ctx, pending);
  }
  if (pending.status === "executing" || pending.status === "confirmed") {
    return burnPendingResponse(admin, ctx, pending);
  }
  if (pending.status !== "pending") {
    throw new AgentApiError(
      "burn_action_not_pending",
      409,
      `Burn action is ${pending.status}.`,
    );
  }
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await admin.from("linkr_pending_actions").update({ status: "expired" }).eq(
      "id",
      pending.id,
    ).eq("status", "pending");
    throw new AgentApiError(
      "burn_action_expired",
      410,
      "The burn confirmation expired. Prepare it again.",
    );
  }
  const claimed = await admin
    .from("linkr_pending_actions")
    .update({ status: "executing", confirmed_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("user_id", ctx.userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) {
    const current = await loadOwnedBurnPending(admin, ctx, pendingActionId);
    if (current.status === "executed") {
      return burnReplayResponse(admin, ctx, current);
    }
    throw new AgentApiError(
      "burn_confirmation_conflict",
      409,
      "This burn is already being handled.",
    );
  }
  try {
    const result = await executeTokenBurn({
      admin,
      userId: ctx.userId,
      preview: claimed.data.action_payload.burn_preview,
      idempotencyKey: `agent-api-burn:${claimed.data.id}`,
      sourceSurface: "agent_api",
      pendingActionId: claimed.data.id,
      agentApiKeyId: ctx.apiKeyId,
    });
    await admin
      .from("linkr_pending_actions")
      .update({ status: "executed" })
      .eq("id", claimed.data.id)
      .eq("user_id", ctx.userId);
    return agentJsonResponse({
      status: "confirmed",
      action_id: claimed.data.id,
      result,
    });
  } catch (error) {
    const execution = await admin
      .from("token_burn_executions")
      .select(
        "id,state,chain,token_address,amount_display,amount_raw,symbol,tx_hash,confirmed_at",
      )
      .eq("pending_action_id", claimed.data.id)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (
      execution.data &&
      ["signed", "broadcast", "reconciling"].includes(execution.data.state)
    ) {
      return agentJsonResponse(
        {
          status: "awaiting_chain_confirmation",
          action_id: claimed.data.id,
          result: execution.data,
          message:
            "The signed burn transaction is awaiting chain confirmation. Linkr will reconcile this same transaction and will not create a second burn.",
        },
        { status: 202 },
      );
    }
    await admin
      .from("linkr_pending_actions")
      .update({ status: "failed" })
      .eq("id", claimed.data.id)
      .eq("user_id", ctx.userId);
    throw error;
  }
}

async function burnPendingResponse(
  admin: any,
  ctx: any,
  pending: any,
): Promise<Response> {
  const execution = await admin
    .from("token_burn_executions")
    .select(
      "id,state,chain,token_address,amount_display,amount_raw,symbol,tx_hash,confirmed_at",
    )
    .eq("pending_action_id", pending.id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (execution.error) throw execution.error;
  if (execution.data?.state === "confirmed") {
    await admin
      .from("linkr_pending_actions")
      .update({ status: "executed" })
      .eq("id", pending.id)
      .eq("user_id", ctx.userId);
    return agentJsonResponse({
      status: "executed",
      action_id: pending.id,
      result: execution.data,
      idempotent_replay: true,
    });
  }
  if (execution.data?.state === "failed") {
    await admin
      .from("linkr_pending_actions")
      .update({ status: "failed" })
      .eq("id", pending.id)
      .eq("user_id", ctx.userId);
    throw new AgentApiError(
      "token_burn_failed",
      409,
      "The burn transaction failed.",
    );
  }
  return agentJsonResponse(
    {
      status: "awaiting_chain_confirmation",
      action_id: pending.id,
      result: execution.data,
      idempotent_replay: true,
    },
    { status: 202 },
  );
}

async function cancelBurn(admin: any, ctx: any): Promise<Response> {
  const pendingActionId = requiredPendingActionId(ctx.body);
  const pending = await loadOwnedBurnPending(admin, ctx, pendingActionId);
  if (pending.status !== "pending") {
    return agentJsonResponse({
      status: pending.status,
      action_id: pending.id,
      cancelled: false,
    });
  }
  const cancelled = await admin
    .from("linkr_pending_actions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("user_id", ctx.userId)
    .eq("status", "pending")
    .select("id,status")
    .maybeSingle();
  if (cancelled.error) throw cancelled.error;
  return agentJsonResponse({
    status: "cancelled",
    action_id: pending.id,
    cancelled: Boolean(cancelled.data),
  });
}

function requiredPendingActionId(body: any): string {
  const id = String(body?.pending_action_id ?? body?.action_id ?? "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(id)
  ) {
    throw new AgentApiError(
      "invalid_pending_action_id",
      400,
      "A valid pending_action_id is required.",
    );
  }
  return id;
}

async function loadOwnedBurnPending(admin: any, ctx: any, id: string) {
  const result = await admin
    .from("linkr_pending_actions")
    .select("*")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("surface", "agent_api")
    .eq("action_type", "burn_token")
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new AgentApiError(
      "burn_action_not_found",
      404,
      "Burn action not found.",
    );
  }
  if (result.data.action_payload?.agent_api_key_id !== ctx.apiKeyId) {
    throw new AgentApiError(
      "burn_action_key_mismatch",
      403,
      "The burn must be confirmed by the API key that prepared it.",
    );
  }
  return result.data;
}

async function burnReplayResponse(
  admin: any,
  ctx: any,
  pending: any,
): Promise<Response> {
  const execution = await admin
    .from("token_burn_executions")
    .select(
      "id,state,chain,token_address,amount_display,amount_raw,symbol,tx_hash,confirmed_at",
    )
    .eq("pending_action_id", pending.id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (execution.error) throw execution.error;
  return agentJsonResponse({
    status: pending.status,
    action_id: pending.id,
    result: execution.data,
    idempotent_replay: true,
  });
}

function mapBurnError(error: unknown): unknown {
  if (error instanceof AgentApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const known: Record<string, [number, string]> = {
    burn_chain_required: [
      400,
      "An explicit robinhood or solana chain is required.",
    ],
    invalid_evm_address: [
      400,
      "Expected a full Robinhood Chain token contract address.",
    ],
    invalid_burn_amount: [
      400,
      "Burn amount must be an exact positive token amount or all.",
    ],
    burn_amount_must_be_positive: [400, "Burn amount must be positive."],
    burn_amount_exceeds_token_precision: [
      400,
      "Burn amount has more decimal places than the token supports.",
    ],
    insufficient_token_balance: [
      400,
      "The Linkr wallet does not hold enough of this token.",
    ],
    no_token_balance: [400, "The Linkr wallet does not hold this token."],
    insufficient_native_balance_for_burn_gas: [
      400,
      "The Linkr wallet does not have enough native ETH for burn transaction gas.",
    ],
    evm_burn_verification_unavailable: [
      503,
      "The verified contract ABI could not be checked, so the burn was not prepared. Try again later.",
    ],
    evm_token_burn_not_supported: [
      400,
      "This token does not support the standard holder burn function.",
    ],
    solana_token_burn_simulation_failed: [
      400,
      "The Solana burn failed simulation; no confirmation was created.",
    ],
    unsupported_solana_token_program: [
      400,
      "The mint is not owned by the supported SPL Token or Token-2022 program.",
    ],
  };
  const match = Object.keys(known).find((code) => message.includes(code));
  if (!match) return error;
  return new AgentApiError(match, known[match][0], known[match][1]);
}
