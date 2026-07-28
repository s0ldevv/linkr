// deno-lint-ignore-file no-explicit-any
// User-initiated ETH transfer from the in-app /app/wallet page.

import { corsHeaders, jsonResponse, withSensitiveCors } from "../_shared/cors.ts";
import { getEthUsdPrice } from "../_shared/eth_price.ts";
import { estimateEthTransferBalancePreflight, transferEth } from "../_shared/eth_transfer.ts";
import { readJsonBody, safeErrorResponse, serializeUnknownError } from "../_shared/http.ts";
import { indexMemory } from "../_shared/memory.ts";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_ASSET_ID,
  ROBINHOOD_NATIVE_SYMBOL,
  getTxExplorerUrl,
  isEvmAddress,
} from "../_shared/robinhood_chain.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { claimTransferGuard } from "../_shared/transfer_replay_guard.ts";
import { loadWallet } from "../_shared/wallet.ts";
import {
  insufficientNativeBalanceReply,
  insufficientNativeBalanceReplyFromError,
} from "../_shared/wallet_balance_reply.ts";
import { ethers } from "https://esm.sh/ethers@6";

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
    const recipient = String(body.recipient ?? "").trim();
    const amountEthRaw = body.amount_eth ?? body.amount;
    const amountEth = Number(amountEthRaw);

    if (!isEvmAddress(recipient)) {
      return jsonResponse({ error: "invalid_recipient" }, { status: 400 });
    }
    if (!(amountEth > 0)) {
      return jsonResponse({ error: "invalid_amount" }, { status: 400 });
    }
    if (amountEth > 100) {
      return jsonResponse({ error: "amount_too_large" }, { status: 400 });
    }

    const admin = serviceClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("max_auto_transfer_eth")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;

    const maxTransferEth = Number(profile?.max_auto_transfer_eth ?? 0);
    if (!Number.isFinite(maxTransferEth) || maxTransferEth <= 0) {
      return jsonResponse({ error: "transfer_disabled" }, { status: 400 });
    }
    if (amountEth > maxTransferEth) {
      return jsonResponse({ error: "max_auto_transfer_eth_exceeded" }, { status: 400 });
    }

    const wallet = await loadWallet(admin, userId);
    if (!wallet) return jsonResponse({ error: "no_wallet" }, { status: 400 });
    const preflight = await estimateEthTransferBalancePreflight({
      from_address: wallet.address,
      recipient,
      amount_eth: amountEth,
    });
    if (preflight.balanceWei < preflight.requiredBalanceWei) {
      return jsonResponse(
        {
          error: "insufficient_eth",
          message: insufficientNativeBalanceReply({
            symbol: "ETH",
            currentBalance: Number(ethers.formatEther(preflight.balanceWei)),
            requiredAmount: Number(ethers.formatEther(preflight.requiredBalanceWei)),
          }),
          wallet_balance_wei: preflight.balanceWei.toString(),
          required_wei: preflight.requiredBalanceWei.toString(),
          estimated_gas_cost_wei: preflight.estimatedGasCostWei.toString(),
        },
        { status: 400 },
      );
    }

    const guard = await claimTransferGuard(admin, {
      userId,
      chain: "robinhood",
      asset: "ETH",
      recipient,
      amountText: String(amountEthRaw),
      idempotencyKey: body.idempotency_key,
    });
    if (!guard.ok) return guard.response;

    const idempotencyKey = `dashboard-eth-transfer:${userId}:${guard.requestId}`;
    const reservation = await admin
      .from("transactions")
      .insert({
        user_id: userId,
        action: "transfer",
        chain: "robinhood",
        input_mint: ROBINHOOD_NATIVE_ASSET_ID,
        output_mint: recipient,
        amount_original: amountEth,
        amount_original_unit: "eth",
        amount_eth: amountEth,
        chain_id: ROBINHOOD_CHAIN_ID,
        native_symbol: ROBINHOOD_NATIVE_SYMBOL,
        wallet_id: wallet.id,
        wallet_address: wallet.address,
        status: "preparing",
        source_surface: "dashboard",
        raw_request: {
          recipient,
          amount_eth: amountEth,
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
    let ethPrice: any;
    try {
      [result, ethPrice] = await Promise.all([
        transferEth({
          private_key_hex: wallet.private_key_hex,
          expected_from_address: wallet.address,
          recipient,
          amount_eth: amountEth,
        }),
        getEthUsdPrice(admin).catch(() => null),
      ]);
    } catch (error) {
      console.error(JSON.stringify({
        event: "dashboard_eth_transfer_outcome_uncertain",
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
      // Keep the explicit guard in-flight. Re-executing after an ambiguous
      // broadcast is less safe than requiring reconciliation.
      return jsonResponse(
        { error: "transfer_status_uncertain", retry_with_same_key: false },
        { status: 502 },
      );
    }

    const explorerUrl = result.explorer_url ?? getTxExplorerUrl(result.tx_hash);
    const amountUsd = ethPrice?.price ? amountEth * ethPrice.price : null;
    const responsePayload = {
      tx_hash: result.tx_hash,
      signature: result.tx_hash,
      confirmed: result.confirmed,
      explorer_url: explorerUrl,
    };
    await guard.settle("succeeded", result.tx_hash, responsePayload);

    const persisted = await admin
      .from("transactions")
      .update({
        amount_usd: amountUsd,
        eth_price_usd: ethPrice?.price ?? null,
        tx_hash: result.tx_hash,
        tx_signature: result.tx_hash,
        explorer_url: explorerUrl,
        status: result.confirmed ? "confirmed" : "submitted",
        raw_result: {
          tx_hash: result.tx_hash,
          confirmed: result.confirmed,
          recipient,
          block_number: result.block_number,
          source: "in_app",
        },
        confirmed_at: result.confirmed ? new Date().toISOString() : null,
      })
      .eq("idempotency_key", idempotencyKey);
    if (persisted.error) {
      console.error(JSON.stringify({
        event: "dashboard_eth_transfer_persistence_failed",
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
      result.tx_hash,
      `in-app transfer ${amountEth} ETH`,
      `transfer ${amountEth} ETH to ${recipient}`,
      {
        source: "in_app",
        recipient,
        chain_id: ROBINHOOD_CHAIN_ID,
        explorer_url: explorerUrl,
      },
    ).catch((error) => {
      console.error(JSON.stringify({
        event: "dashboard_eth_transfer_memory_failed",
        user_id: userId,
        tx_hash: result.tx_hash,
        error: serializeUnknownError(error),
      }));
    });

    return jsonResponse(responsePayload);
  } catch (error) {
    const balanceReply = insufficientNativeBalanceReplyFromError(error);
    if (balanceReply) {
      return jsonResponse({ error: "insufficient_eth", message: balanceReply }, { status: 400 });
    }
    return safeErrorResponse(error, { functionName: "transfer-eth" });
  }
}
