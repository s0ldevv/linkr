// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import {
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import {
  recordAgentRequest,
  requireAgentApiKey,
} from "../_shared/agent_api_auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "actions:read");
    const url = new URL(req.url);
    const id = String(
      url.searchParams.get("id") ??
        url.searchParams.get("action_id") ??
        url.pathname.split("/").filter(Boolean).at(-1) ??
        "",
    ).trim();
    if (!id || id === "agent-action-status") {
      throw new Error("missing_action_id");
    }

    const [launchResult, txResult, lpResult, pendingResult, burnResult] =
      await Promise.all([
        admin
          .from("coin_launches")
          .select(
            "id,status,token_address,mint,tx_hash,tx_signature,error,created_at,processed_at,updated_at",
          )
          .eq("id", id)
          .eq("user_id", ctx.userId)
          .maybeSingle(),
        admin
          .from("transactions")
          .select(
            "id,action,status,tx_hash,tx_signature,error,created_at,confirmed_at,failed_at",
          )
          .eq("id", id)
          .eq("user_id", ctx.userId)
          .maybeSingle(),
        admin
          .from("liquidity_actions")
          .select(
            "id,action,status,tx_hash,error,token_address,position_token_id,receipt,created_at,updated_at",
          )
          .eq("id", id)
          .eq("user_id", ctx.userId)
          .maybeSingle(),
        admin
          .from("linkr_pending_actions")
          .select(
            "id,action_type,status,summary,risk_summary,action_payload,expires_at,confirmed_at,cancelled_at,created_at,updated_at",
          )
          .eq("id", id)
          .eq("user_id", ctx.userId)
          .eq("surface", "agent_api")
          .maybeSingle(),
        admin
          .from("token_burn_executions")
          .select(
            "id,state,chain,token_address,amount_display,amount_raw,symbol,tx_hash,broadcast_at,confirmed_at,error_code,created_at,updated_at",
          )
          .eq("pending_action_id", id)
          .eq("user_id", ctx.userId)
          .maybeSingle(),
      ]);
    if (launchResult.error) throw launchResult.error;
    if (txResult.error) throw txResult.error;
    if (lpResult.error) throw lpResult.error;
    if (pendingResult.error) throw pendingResult.error;
    if (burnResult.error) throw burnResult.error;

    const row = launchResult.data
      ? {
        kind: "launch",
        ...launchResult.data,
        tx_hash: launchResult.data.tx_hash ?? launchResult.data.tx_signature,
      }
      : txResult.data
      ? {
        kind: "transaction",
        ...txResult.data,
        tx_hash: txResult.data.tx_hash ?? txResult.data.tx_signature,
      }
      : lpResult.data
      ? { kind: "liquidity", ...lpResult.data }
      : pendingResult.data
      ? {
        kind: "pending_action",
        ...pendingResult.data,
        action_payload: pendingResult.data.action_type === "burn_token"
          ? {
            chain: pendingResult.data.action_payload?.chain,
            token: pendingResult.data.action_payload?.token,
            amount: pendingResult.data.action_payload?.amount,
            irreversible: true,
          }
          : pendingResult.data.action_payload,
        burn_execution: burnResult.data ?? null,
        tx_hash: burnResult.data?.tx_hash ?? null,
      }
      : null;
    if (!row) {
      await recordAgentRequest(admin, ctx, req, 404);
      return agentJsonResponse({
        error: {
          code: "action_not_found",
          message: "Action not found.",
          details: {},
        },
      }, { status: 404 });
    }
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({ action: row });
  } catch (error) {
    await recordAgentRequest(
      admin,
      ctx ?? {},
      req,
      (error as any)?.status ?? 500,
      error,
    ).catch(() => {});
    return agentErrorResponse(error);
  }
});
