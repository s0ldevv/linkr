// deno-lint-ignore-file no-explicit-any
// User-initiated SOL transfer from the in-app /app/wallet page.

import { corsHeaders, jsonResponse, withSensitiveCors } from "../_shared/cors.ts";
import { internalErrorResponse, readJsonBody, serializeUnknownError } from "../_shared/http.ts";
import { indexMemory } from "../_shared/memory.ts";
import {
  SOLANA_NATIVE_ASSET_ID,
  SOLANA_NATIVE_SYMBOL,
  loadSolanaWallet,
  normalizeSolanaPublicKey,
} from "../_shared/solana_chain.ts";
import {
  estimateSolTransferBalancePreflight,
  parseSolToLamports,
  transferSol,
} from "../_shared/solana_transfer.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { claimTransferGuard } from "../_shared/transfer_replay_guard.ts";
import {
  insufficientNativeBalanceReply,
  insufficientNativeBalanceReplyFromError,
} from "../_shared/wallet_balance_reply.ts";

Deno.serve(async (req) => withSensitiveCors(req, await handleTransfer(req)));

async function handleTransfer(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

    const body = await readJsonBody(req, 64 * 1024) as Record<string, any>;
    let recipient: string;
    try {
      recipient = normalizeSolanaPublicKey(String(body.recipient ?? "").trim());
    } catch (_) {
      return jsonResponse({ error: "invalid_recipient" }, { status: 400 });
    }
    const amountSolRaw = body.amount_sol ?? body.amount;
    const lamports = parseSolToLamports(amountSolRaw);
    const amountSol = Number(lamports) / 1_000_000_000;

    if (amountSol > 100) {
      return jsonResponse({ error: "amount_too_large" }, { status: 400 });
    }

    const admin = serviceClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("max_auto_transfer_sol")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;

    const maxTransferSol = Number(profile?.max_auto_transfer_sol ?? 0);
    if (!Number.isFinite(maxTransferSol) || maxTransferSol <= 0) {
      return jsonResponse({ error: "transfer_disabled" }, { status: 400 });
    }
    if (amountSol > maxTransferSol) {
      return jsonResponse({ error: "max_auto_transfer_sol_exceeded" }, { status: 400 });
    }

    const wallet = await loadSolanaWallet(admin, userId);
    if (!wallet) return jsonResponse({ error: "no_solana_wallet" }, { status: 400 });
    const preflight = await estimateSolTransferBalancePreflight({
      from_address: wallet.address,
      recipient,
      amount_sol: amountSol,
    });
    if (preflight.balanceLamports < preflight.requiredLamports) {
      return jsonResponse(
        {
          error: "insufficient_sol",
          message: insufficientNativeBalanceReply({
            symbol: "SOL",
            currentBalance: Number(preflight.balanceLamports) / 1_000_000_000,
            requiredAmount: Number(preflight.requiredLamports) / 1_000_000_000,
          }),
          wallet_balance_lamports: preflight.balanceLamports.toString(),
          required_lamports: preflight.requiredLamports.toString(),
          fee_lamports: preflight.feeLamports.toString(),
          transfer_lamports: lamports.toString(),
        },
        { status: 400 },
      );
    }

    const guard = await claimTransferGuard(admin, {
      userId,
      chain: "solana",
      asset: "SOL",
      recipient,
      amountText: String(amountSolRaw),
      idempotencyKey: body.idempotency_key,
    });
    if (!guard.ok) return guard.response;

    const idempotencyKey = `dashboard-sol-transfer:${userId}:${guard.requestId}`;
    const reservation = await admin
      .from("transactions")
      .insert({
        user_id: userId,
        action: "transfer",
        chain: "solana",
        input_mint: SOLANA_NATIVE_ASSET_ID,
        output_mint: recipient,
        amount_original: amountSol,
        amount_original_unit: "sol",
        amount_sol: amountSol,
        chain_id: null,
        native_symbol: SOLANA_NATIVE_SYMBOL,
        wallet_id: wallet.id,
        wallet_address: wallet.address,
        status: "preparing",
        source_surface: "dashboard",
        raw_request: {
          recipient,
          amount_lamports: lamports.toString(),
          source: "dashboard",
          origin: "in_app",
        },
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .maybeSingle();
    if (reservation.error) {
      await guard.settle("failed");
      throw reservation.error;
    }

    let result: any;
    try {
      result = await transferSol({
        secret_key: wallet.secret_key,
        expected_from_address: wallet.address,
        recipient,
        amount_sol: String(amountSolRaw),
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "dashboard_sol_transfer_outcome_uncertain",
        user_id: userId,
        transaction_id: reservation.data?.id ?? null,
        error: serializeUnknownError(error),
      }));
      await admin
        .from("transactions")
        .update({
          status: "reconciliation_required",
          error: "submission_outcome_unknown",
          raw_result: { submission_outcome: "uncertain" },
        })
        .eq("idempotency_key", idempotencyKey);
      return jsonResponse(
        { error: "transfer_status_uncertain", retry_with_same_key: false },
        { status: 502 },
      );
    }

    const responsePayload = {
      tx_hash: result.tx_hash,
      signature: result.signature,
      confirmed: result.confirmed,
      explorer_url: result.explorer_url,
    };
    await guard.settle("succeeded", result.tx_hash ?? result.signature, responsePayload);

    const persisted = await admin
      .from("transactions")
      .update({
        tx_hash: result.tx_hash,
        tx_signature: result.signature,
        explorer_url: result.explorer_url,
        status: result.confirmed ? "confirmed" : "submitted",
        raw_result: {
          signature: result.signature,
          confirmed: result.confirmed,
          recipient,
          source: "in_app",
        },
        confirmed_at: result.confirmed ? new Date().toISOString() : null,
      })
      .eq("idempotency_key", idempotencyKey);
    if (persisted.error) {
      console.error(JSON.stringify({
        event: "dashboard_sol_transfer_persistence_failed",
        user_id: userId,
        transaction_id: reservation.data?.id ?? null,
        tx_hash: result.tx_hash,
        error: serializeUnknownError(persisted.error),
      }));
    }

    await indexMemory(
      admin,
      userId,
      "transaction",
      result.signature,
      `in-app transfer ${amountSol} SOL`,
      `transfer ${amountSol} SOL to ${recipient}`,
      {
        source: "in_app",
        recipient,
        native_symbol: SOLANA_NATIVE_SYMBOL,
        explorer_url: result.explorer_url,
      },
    ).catch((error) => {
      console.error(JSON.stringify({
        event: "dashboard_sol_transfer_memory_failed",
        user_id: userId,
        tx_hash: result.tx_hash,
        error: serializeUnknownError(error),
      }));
    });

    return jsonResponse(responsePayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const balanceReply = insufficientNativeBalanceReplyFromError(error);
    if (balanceReply) {
      return jsonResponse({ error: "insufficient_sol", message: balanceReply }, { status: 400 });
    }
    const status = message === "invalid_amount" || message === "amount_must_be_positive" ? 400 : 500;
    if (status >= 500) return internalErrorResponse(error, { function: "transfer-sol" });
    return jsonResponse({ error: message }, { status });
  }
}
