// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { capExceeded, normalizeAddressField, parseEthWei } from "../_shared/agent_api_schemas.ts";
import { estimateEthTransferBalancePreflight, transferEth } from "../_shared/eth_transfer.ts";
import { ROBINHOOD_CHAIN_ID } from "../_shared/robinhood_chain.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { loadWallet } from "../_shared/wallet.ts";
import {
  SOLANA_NATIVE_ASSET_ID,
  SOLANA_NATIVE_SYMBOL,
  loadSolanaWallet,
  loadSolanaWalletById,
} from "../_shared/solana_chain.ts";
import {
  estimateSolTransferBalancePreflight,
  parseSolToLamports,
  transferSol,
} from "../_shared/solana_transfer.ts";
import { normalizeSolanaAddress } from "../_shared/market_data/chains.ts";
import {
  insufficientNativeBalanceReply,
  insufficientNativeBalanceReplyFromError,
} from "../_shared/wallet_balance_reply.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "transfer:write", { requireIdempotency: true });
    const chain = inferTransferChain(ctx.body);
    if (chain === "solana") return await handleSolanaTransfer(admin, ctx, req);
    return await handleRobinhoodTransfer(admin, ctx, req);
  } catch (error) {
    const balanceReply = insufficientNativeBalanceReplyFromError(error);
    const responseError = balanceReply
      ? new AgentApiError("insufficient_native_balance", 400, balanceReply)
      : error;
    await recordAgentRequest(
      admin,
      ctx ?? {},
      req,
      (responseError as any)?.status ?? 500,
      responseError,
    ).catch(() => {});
    return agentErrorResponse(responseError);
  }
});

async function handleRobinhoodTransfer(admin: any, ctx: any, req: Request) {
  const body = ctx.body;
  if (ctx.wallet.wallet_type !== "evm" || Number(ctx.wallet.chain_id) !== ROBINHOOD_CHAIN_ID) {
    throw new AgentApiError("wallet_chain_mismatch", 403, "API key is not bound to an EVM wallet.");
  }
  const recipient = normalizeAddressField(body, ["recipient", "to"], true)!;
  const amountWei = parseEthWei(body.amount_eth ?? body.eth_amount, "amount_eth");
  enforceEthTransferCap(
    amountWei,
    ctx.apiKey.max_transfer_eth ?? ctx.profile?.max_auto_transfer_eth,
  );
  const walletAddress = ctx.wallet.address ?? ctx.wallet.public_key;
  const preflight = await estimateEthTransferBalancePreflight({
    from_address: walletAddress,
    recipient,
    amount_eth: ethers.formatEther(amountWei),
  });
  if (preflight.balanceWei < preflight.requiredBalanceWei) {
    throw new AgentApiError(
      "insufficient_eth",
      400,
      insufficientNativeBalanceReply({
        symbol: "ETH",
        currentBalance: Number(ethers.formatEther(preflight.balanceWei)),
        requiredAmount: Number(ethers.formatEther(preflight.requiredBalanceWei)),
      }),
      {
        wallet_balance_wei: preflight.balanceWei.toString(),
        required_wei: preflight.requiredBalanceWei.toString(),
        transfer_value_wei: amountWei.toString(),
        estimated_gas_cost_wei: preflight.estimatedGasCostWei.toString(),
      },
    );
  }

  if (body.dry_run === true) {
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({
      dry_run: true,
      chain: "robinhood",
      recipient,
      amount_wei: amountWei.toString(),
      wallet_address: walletAddress,
      wallet_balance_wei: preflight.balanceWei.toString(),
      required_balance_wei: preflight.requiredBalanceWei.toString(),
    });
  }

  const idempotencyKey = `agent-transfer:${ctx.apiKeyId}:${ctx.idempotencyKey}`;
  const existing = await findExistingTransfer(admin, idempotencyKey);
  if (existing?.tx_hash) {
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({
      chain: "robinhood",
      status: existing.status,
      tx_hash: existing.tx_hash,
      amount_eth: existing.amount_eth,
      recipient: existing.output_mint,
      idempotent_replay: true,
    });
  }

  const loaded = await loadWallet(admin, ctx.userId);
  if (!loaded || loaded.id !== ctx.wallet.id) {
    throw new AgentApiError("wallet_changed_before_transfer", 409);
  }
  const result = await transferEth({
    private_key_hex: loaded.private_key_hex,
    expected_from_address: walletAddress,
    recipient,
    amount_eth: ethers.formatEther(amountWei),
  });
  await admin.from("transactions").insert({
    user_id: ctx.userId,
    action: "transfer",
    chain: "robinhood",
    input_mint: "native:eth",
    output_mint: recipient,
    amount_eth: Number(ethers.formatEther(amountWei)),
    chain_id: ROBINHOOD_CHAIN_ID,
    native_symbol: "ETH",
    wallet_id: ctx.wallet.id,
    wallet_address: walletAddress,
    tx_hash: result.tx_hash,
    tx_signature: result.tx_hash,
    explorer_url: result.explorer_url,
    status: result.confirmed ? "confirmed" : "submitted",
    raw_request: { recipient, amount_wei: amountWei.toString(), source: "agent_api" },
    raw_result: result,
    source_surface: "agent_api",
    confirmed_at: result.confirmed ? new Date().toISOString() : null,
    idempotency_key: idempotencyKey,
  });
  await recordAgentRequest(admin, ctx, req, 200);
  return agentJsonResponse({
    chain: "robinhood",
    status: result.confirmed ? "confirmed" : "submitted",
    tx_hash: result.tx_hash,
    amount_eth: ethers.formatEther(amountWei),
    recipient,
  });
}

async function handleSolanaTransfer(admin: any, ctx: any, req: Request) {
  const body = ctx.body;
  const wallet = await loadAgentSolanaWallet(ctx, admin);
  const recipient = normalizeSolanaAddress(body.recipient ?? body.to);
  if (!recipient) {
    throw new AgentApiError("invalid_solana_recipient", 400, "Expected a full Solana recipient.");
  }
  const lamports = parseSolToLamports(body.amount_sol ?? body.sol_amount);
  const amountSol = Number(lamports) / 1_000_000_000;
  enforceSolTransferCap(
    amountSol,
    ctx.apiKey.max_transfer_sol ?? ctx.profile?.max_auto_transfer_sol,
  );
  const preflight = await estimateSolTransferBalancePreflight({
    from_address: wallet.address,
    recipient,
    amount_sol: amountSol,
  });
  if (preflight.balanceLamports < preflight.requiredLamports) {
    throw new AgentApiError(
      "insufficient_sol",
      400,
      insufficientNativeBalanceReply({
        symbol: "SOL",
        currentBalance: Number(preflight.balanceLamports) / 1_000_000_000,
        requiredAmount: Number(preflight.requiredLamports) / 1_000_000_000,
      }),
      {
        wallet_balance_lamports: preflight.balanceLamports.toString(),
        required_lamports: preflight.requiredLamports.toString(),
        transfer_lamports: lamports.toString(),
        fee_lamports: preflight.feeLamports.toString(),
      },
    );
  }

  if (body.dry_run === true) {
    await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
    return agentJsonResponse({
      dry_run: true,
      chain: "solana",
      recipient,
      amount_lamports: lamports.toString(),
      wallet_address: wallet.address,
      wallet_balance_lamports: preflight.balanceLamports.toString(),
      required_lamports: preflight.requiredLamports.toString(),
    });
  }

  const idempotencyKey = `agent-sol-transfer:${ctx.apiKeyId}:${ctx.idempotencyKey}`;
  const existing = await findExistingTransfer(admin, idempotencyKey);
  if (existing?.tx_hash) {
    await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
    return agentJsonResponse({
      chain: "solana",
      status: existing.status,
      tx_hash: existing.tx_hash,
      signature: existing.tx_signature,
      amount_sol: existing.amount_sol,
      recipient: existing.output_mint,
      idempotent_replay: true,
    });
  }

  const result = await transferSol({
    secret_key: wallet.secret_key,
    expected_from_address: wallet.address,
    recipient,
    amount_sol: amountSol,
  });
  await admin.from("transactions").insert({
    user_id: ctx.userId,
    action: "transfer",
    chain: "solana",
    input_mint: SOLANA_NATIVE_ASSET_ID,
    output_mint: recipient,
    amount_sol: amountSol,
    chain_id: null,
    native_symbol: SOLANA_NATIVE_SYMBOL,
    wallet_id: wallet.id,
    wallet_address: wallet.address,
    tx_hash: result.tx_hash,
    tx_signature: result.signature,
    explorer_url: result.explorer_url,
    status: result.confirmed ? "confirmed" : "submitted",
    raw_request: {
      recipient,
      amount_lamports: lamports.toString(),
      source: "agent_api",
    },
    raw_result: result,
    source_surface: "agent_api",
    confirmed_at: result.confirmed ? new Date().toISOString() : null,
    idempotency_key: idempotencyKey,
  });
  await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
  return agentJsonResponse({
    chain: "solana",
    status: result.confirmed ? "confirmed" : "submitted",
    tx_hash: result.tx_hash,
    signature: result.signature,
    amount_sol: amountSol,
    amount_lamports: lamports.toString(),
    recipient,
  });
}

function inferTransferChain(body: any): "robinhood" | "solana" {
  const explicit = String(body?.chain ?? body?.network ?? "")
    .trim()
    .toLowerCase();
  if (["sol", "solana"].includes(explicit)) return "solana";
  if (["eth", "evm", "robinhood", "rhood"].includes(explicit)) return "robinhood";
  if (body?.amount_sol != null || body?.sol_amount != null) return "solana";
  return normalizeSolanaAddress(body?.recipient ?? body?.to) ? "solana" : "robinhood";
}

async function loadAgentSolanaWallet(ctx: any, admin: any) {
  if (ctx.walletId) {
    const wallet = await loadSolanaWalletById(admin, ctx.walletId, ctx.userId);
    if (!wallet) {
      throw new AgentApiError(
        "wallet_chain_mismatch",
        403,
        "API key is not bound to a Solana wallet.",
      );
    }
    return wallet;
  }
  const wallet = await loadSolanaWallet(admin, ctx.userId);
  if (!wallet) throw new AgentApiError("wallet_not_found", 403, "No Solana wallet is available.");
  return wallet;
}

async function findExistingTransfer(admin: any, idempotencyKey: string): Promise<any | null> {
  const { data, error } = await admin
    .from("transactions")
    .select("status,tx_hash,tx_signature,amount_eth,amount_sol,output_mint")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function enforceEthTransferCap(amountWei: bigint, cap: unknown) {
  const capNumber = Number(cap ?? 0);
  if (!Number.isFinite(capNumber) || capNumber <= 0)
    throw capExceeded("transfer_disabled", "Transfers are disabled.");
  if (Number(ethers.formatEther(amountWei)) > capNumber) {
    throw capExceeded("max_transfer_eth_exceeded", "Transfer exceeds the configured cap.");
  }
}

function enforceSolTransferCap(amountSol: number, cap: unknown) {
  const capNumber = Number(cap ?? 0);
  if (!Number.isFinite(capNumber) || capNumber <= 0)
    throw capExceeded("transfer_disabled", "Transfers are disabled.");
  if (amountSol > capNumber) {
    throw capExceeded("max_transfer_sol_exceeded", "Transfer exceeds the configured cap.");
  }
}
