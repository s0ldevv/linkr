// deno-lint-ignore-file no-explicit-any
// Exact-input SOL <-> native Solana USDC dashboard swaps through Jupiter.

import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { readJsonBody, internalErrorResponse } from "../_shared/http.ts";
import {
  LAMPORTS_PER_SOL,
  loadSolanaWallet,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { parseSolToLamports } from "../_shared/solana_transfer.ts";
import {
  executeSolanaBuySwap,
  executeSolanaSellSwap,
} from "../_shared/solana_swap/execute.ts";
import {
  readSolanaSwapEnabled,
  solanaSwapFeeReserveLamports,
} from "../_shared/solana_swap/constants.ts";
import {
  getUsdcBalanceRaw,
  parseUsdcToRaw,
  SOLANA_USDC_MINT,
} from "../_shared/solana_usdc.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
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
    if (!readSolanaSwapEnabled()) {
      return jsonResponse({ error: "solana_swap_not_enabled" }, {
        status: 503,
      });
    }
    const body = await readJsonBody(req, 64 * 1024) as any;
    const direction = String(body.direction ?? "")
      .trim()
      .toLowerCase();
    if (direction !== "sol_to_usdc" && direction !== "usdc_to_sol") {
      return jsonResponse({ error: "invalid_swap_direction" }, { status: 400 });
    }
    const idempotencyInput = String(body.idempotency_key ?? "").trim();
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(idempotencyInput)) {
      return jsonResponse({ error: "invalid_idempotency_key" }, {
        status: 400,
      });
    }
    const admin = serviceClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select(
        "default_slippage_bps,max_auto_buy_sol,max_auto_sell_percent,solana_priority_fee_lamports",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const slippageBps = Number(profile?.default_slippage_bps ?? 0);
    if (
      !Number.isInteger(slippageBps) || slippageBps <= 0 || slippageBps > 3000
    ) {
      return jsonResponse({ error: "solana_swap_disabled_by_slippage_rule" }, {
        status: 400,
      });
    }
    const priorityFeeLamports = Number(
      profile?.solana_priority_fee_lamports ?? 1_000_000,
    );
    const wallet = await loadSolanaWallet(admin, userId);
    if (!wallet) {
      return jsonResponse({ error: "no_solana_wallet" }, { status: 400 });
    }
    const idempotencyKey =
      `dashboard-sol-usdc-swap:${userId}:${idempotencyInput}`;
    const { data: existing } = await admin
      .from("transactions")
      .select("status,tx_hash,tx_signature,explorer_url,input_mint,output_mint")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing?.tx_hash) {
      return jsonResponse({ ...existing, idempotent_replay: true });
    }

    const common = {
      userId,
      walletId: wallet.id,
      walletAddress: wallet.address,
      slippageBps,
      priorityFeeLamports,
      idempotencyKey,
      sourceTweetId: `dashboard:${idempotencyInput}`,
      sourceSurface: "dashboard",
    };
    const result = direction === "sol_to_usdc"
      ? await swapSolToUsdc(profile, wallet.address, body.amount, admin, common)
      : await swapUsdcToSol(
        profile,
        wallet.address,
        body.amount,
        admin,
        common,
      );
    return jsonResponse({
      direction,
      status: result.status,
      tx_hash: result.txHash,
      signature: result.signature,
      explorer_url: result.explorerUrl,
      quoted_output_amount: result.quotedOutputAmount,
      min_output_amount: result.minOutputAmount,
      slippage_bps: slippageBps,
      priority_fee_lamports: priorityFeeLamports,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /^(invalid_|amount_|insufficient_|no_token_|solana_|swap_|jupiter_)/.test(
        message,
      )
    ) {
      return jsonResponse({ error: message }, { status: 400 });
    }
    return internalErrorResponse(error, { function: "swap-sol-usdc" });
  }
});

async function swapSolToUsdc(
  profile: any,
  address: string,
  amount: unknown,
  admin: any,
  common: any,
) {
  const inputLamports = parseSolToLamports(String(amount ?? ""));
  const amountSol = Number(inputLamports) / LAMPORTS_PER_SOL;
  const cap = Number(profile?.max_auto_buy_sol ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error("solana_swap_disabled_by_buy_rule");
  }
  if (amountSol > cap) throw new Error("max_auto_buy_sol_exceeded");
  const balance = BigInt(
    await solanaConnection().getBalance(new PublicKey(address), "confirmed"),
  );
  if (
    balance <
      inputLamports +
        solanaSwapFeeReserveLamports(common.priorityFeeLamports, true)
  ) {
    throw new Error("insufficient_sol");
  }
  return await executeSolanaBuySwap(admin, {
    ...common,
    side: "buy",
    inputLamports: inputLamports.toString(),
    outputMint: SOLANA_USDC_MINT,
  });
}

async function swapUsdcToSol(
  profile: any,
  address: string,
  amount: unknown,
  admin: any,
  common: any,
) {
  const inputRaw = parseUsdcToRaw(String(amount ?? ""));
  const balanceRaw = await getUsdcBalanceRaw(address);
  if (inputRaw > balanceRaw) throw new Error("insufficient_usdc");
  const maxSellPercent = Number(profile?.max_auto_sell_percent ?? 0);
  const requestedPercent = balanceRaw > 0n
    ? Number((inputRaw * 1_000_000n) / balanceRaw) / 10_000
    : 0;
  if (!Number.isFinite(maxSellPercent) || maxSellPercent <= 0) {
    throw new Error("solana_swap_disabled_by_sell_rule");
  }
  if (requestedPercent > maxSellPercent + 0.0001) {
    throw new Error("max_auto_sell_percent_exceeded");
  }
  const solBalance = BigInt(
    await solanaConnection().getBalance(new PublicKey(address), "confirmed"),
  );
  if (
    solBalance < solanaSwapFeeReserveLamports(common.priorityFeeLamports, false)
  ) {
    throw new Error("insufficient_sol_for_swap_fee");
  }
  return await executeSolanaSellSwap(admin, {
    ...common,
    side: "sell",
    inputMint: SOLANA_USDC_MINT,
    inputTokenAmount: inputRaw.toString(),
  });
}
