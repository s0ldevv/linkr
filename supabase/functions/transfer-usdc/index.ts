// deno-lint-ignore-file no-explicit-any
// User-initiated native Solana USDC transfer from the dashboard.

import { corsHeaders, jsonResponse, withSensitiveCors } from "../_shared/cors.ts";
import { readJsonBody, internalErrorResponse, serializeUnknownError } from "../_shared/http.ts";
import { indexMemory } from "../_shared/memory.ts";
import { loadSolanaWallet } from "../_shared/solana_chain.ts";
import {
  estimateUsdcTransferBalancePreflight,
  formatUsdcRaw,
  parseUsdcToRaw,
  SOLANA_USDC_MINT,
  SOLANA_USDC_SYMBOL,
  transferUsdc,
} from "../_shared/solana_usdc.ts";
import {
  resolveSolanaRecipient,
  verifySolanaRecipientSnapshot,
} from "../_shared/solana_recipient.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => withSensitiveCors(req, await handleTransfer(req)));

async function handleTransfer(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  try {
    const userId = await getCallerUserId(req);
    if (!userId) {
      return jsonResponse({ error: "unauthorized" }, { status: 401 });
    }
    const body = await readJsonBody(req, 64 * 1024) as Record<string, any>;
    const idempotencyInput = String(body.idempotency_key ?? "").trim();
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(idempotencyInput)) {
      return jsonResponse({ error: "invalid_idempotency_key" }, {
        status: 400,
      });
    }
    const amountRaw = parseUsdcToRaw(body.amount_usdc ?? body.amount);
    const amountUsdc = Number(formatUsdcRaw(amountRaw));
    const admin = serviceClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("max_auto_transfer_usdc")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const cap = Number(profile?.max_auto_transfer_usdc ?? 0);
    if (!Number.isFinite(cap) || cap <= 0) {
      return jsonResponse({ error: "usdc_transfer_disabled" }, { status: 400 });
    }
    if (amountUsdc > cap) {
      return jsonResponse({ error: "max_auto_transfer_usdc_exceeded" }, {
        status: 400,
      });
    }

    const idempotencyKey =
      `dashboard-usdc-transfer:${userId}:${idempotencyInput}`;
    const { data: existing } = await admin
      .from("transactions")
      .select(
        "status,tx_hash,tx_signature,explorer_url,output_mint,amount_original",
      )
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing?.tx_hash) {
      return jsonResponse({ ...existing, idempotent_replay: true });
    }
    if (existing) {
      return jsonResponse(
        { error: "transfer_already_in_progress", status: existing.status },
        { status: 409 },
      );
    }

    const loaded = await loadSolanaWallet(admin, userId);
    if (!loaded) {
      return jsonResponse({ error: "no_solana_wallet" }, { status: 400 });
    }
    const recipient = await resolveSolanaRecipient(
      admin,
      body.recipient,
      "dashboard",
    );
    const verifiedAddress = await verifySolanaRecipientSnapshot(
      admin,
      recipient,
    );
    if (verifiedAddress === loaded.address) {
      return jsonResponse({ error: "recipient_matches_sender" }, {
        status: 400,
      });
    }
    const preflight = await estimateUsdcTransferBalancePreflight({
      from_address: loaded.address,
      recipient: verifiedAddress,
      amount_usdc: amountUsdc,
    });
    if (preflight.balanceRaw < amountRaw) {
      return jsonResponse(
        {
          error: "insufficient_usdc",
          balance_usdc: formatUsdcRaw(preflight.balanceRaw),
          required_usdc: formatUsdcRaw(amountRaw),
        },
        { status: 400 },
      );
    }
    if (preflight.solBalanceLamports < preflight.requiredSolLamports) {
      return jsonResponse(
        {
          error: "insufficient_sol_for_usdc_transfer_fee",
          balance_lamports: preflight.solBalanceLamports.toString(),
          required_lamports: preflight.requiredSolLamports.toString(),
        },
        { status: 400 },
      );
    }

    const reservation = await admin
      .from("transactions")
      .insert({
        user_id: userId,
        action: "transfer",
        chain: "solana",
        input_mint: SOLANA_USDC_MINT,
        output_mint: verifiedAddress,
        amount_original: amountUsdc,
        amount_original_unit: "usdc",
        input_amount_wei: amountRaw.toString(),
        input_token_decimals: 6,
        input_token_symbol: SOLANA_USDC_SYMBOL,
        native_symbol: SOLANA_USDC_SYMBOL,
        wallet_id: loaded.id,
        wallet_address: loaded.address,
        status: "preparing",
        source_surface: "dashboard",
        raw_request: {
          recipient,
          amount_raw: amountRaw.toString(),
          source: "dashboard",
        },
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .maybeSingle();
    if (reservation.error) {
      if (String(reservation.error.code ?? "") === "23505") {
        return jsonResponse({ error: "transfer_already_in_progress" }, {
          status: 409,
        });
      }
      throw reservation.error;
    }

    let result;
    try {
      result = await transferUsdc({
        secret_key: loaded.secret_key,
        expected_from_address: loaded.address,
        recipient: verifiedAddress,
        amount_usdc: formatUsdcRaw(amountRaw),
      });
    } catch (submissionError) {
      console.error(JSON.stringify({
        event: "dashboard_usdc_transfer_outcome_uncertain",
        user_id: userId,
        transaction_id: reservation.data?.id ?? null,
        error: serializeUnknownError(submissionError),
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
    const persisted = await admin
      .from("transactions")
      .update({
        tx_hash: result.tx_hash,
        tx_signature: result.signature,
        explorer_url: result.explorer_url,
        status: "confirmed",
        raw_result: result,
        confirmed_at: new Date().toISOString(),
      })
      .eq("idempotency_key", idempotencyKey);
    if (persisted.error) {
      console.error(JSON.stringify({
        event: "dashboard_usdc_transfer_persistence_failed",
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
      `in-app transfer ${formatUsdcRaw(amountRaw)} USDC`,
      `transfer ${formatUsdcRaw(amountRaw)} USDC to ${recipient.label}`,
      { recipient, explorer_url: result.explorer_url },
    ).catch((error) => {
      console.error(JSON.stringify({
        event: "dashboard_usdc_transfer_memory_failed",
        user_id: userId,
        tx_hash: result.tx_hash,
        error: serializeUnknownError(error),
      }));
    });
    return jsonResponse({
      tx_hash: result.tx_hash,
      signature: result.signature,
      confirmed: true,
      explorer_url: result.explorer_url,
      amount_usdc: formatUsdcRaw(amountRaw),
      recipient: recipient.label,
      recipient_address: verifiedAddress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^(invalid_|amount_|recipient_|insufficient_|usdc_)/.test(message)) {
      return jsonResponse({ error: message }, { status: 400 });
    }
    return internalErrorResponse(error, { function: "transfer-usdc" });
  }
}
