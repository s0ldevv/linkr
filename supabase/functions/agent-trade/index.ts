// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.2?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import {
  capExceeded,
  normalizeAddressField,
  parseEthWei,
  parsePositiveNumber,
  parseSlippageBps,
  stringField,
} from "../_shared/agent_api_schemas.ts";
import { getErc20TokenBalances, getEthBalanceWei } from "../_shared/robinhood_chain.ts";
import { amountFromPercent } from "../_shared/robinhood_swap/amount.ts";
import { isSwapEnabled } from "../_shared/robinhood_swap/constants.ts";
import { executeBuySwap, executeSellSwap } from "../_shared/robinhood_swap/execute.ts";
import { quoteSwap } from "../_shared/robinhood_swap/quote.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  loadSolanaWallet,
  loadSolanaWalletById,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { parseSolToLamports } from "../_shared/solana_transfer.ts";
import { readSolanaSwapEnabled } from "../_shared/solana_swap/constants.ts";
import {
  executeSolanaBuySwap,
  executeSolanaSellSwap,
  getSolanaTokenBalanceRaw,
} from "../_shared/solana_swap/execute.ts";
import { amountFromPercent as solanaAmountFromPercent } from "../_shared/solana_swap/amount.ts";
import { quoteSolanaSwap } from "../_shared/solana_swap/quote.ts";
import { normalizeSolanaAddress } from "../_shared/market_data/chains.ts";
import {
  insufficientNativeBalanceReply,
  insufficientNativeBalanceReplyFromError,
  nativeAmountWithReserve,
  readNativeBalanceReserve,
} from "../_shared/wallet_balance_reply.ts";

function requiredEthForBuy(amountEth: unknown): number {
  return nativeAmountWithReserve(
    amountEth,
    readNativeBalanceReserve("ROBINHOOD_SWAP_BALANCE_RESERVE_ETH", 0.00001),
  );
}

function requiredSolForBuy(amountSol: unknown): number {
  return nativeAmountWithReserve(
    amountSol,
    readNativeBalanceReserve("SOLANA_SWAP_BALANCE_RESERVE_SOL", 0.002),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    const bodyText = await req.clone().text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch (_) {
      throw new AgentApiError("invalid_json", 400, "Request body must be valid JSON.");
    }
    const side = String(parsed?.side ?? "").toLowerCase() === "sell" ? "sell" : "buy";
    ctx = await requireAgentApiKey(req, admin, side === "buy" ? "trade:buy" : "trade:sell", {
      requireIdempotency: true,
    });
    const body = ctx.body;
    const chain = inferTradeChain(body);
    if (chain === "solana") {
      return await handleSolanaTrade(admin, ctx, req, side);
    }
    return await handleRobinhoodTrade(admin, ctx, req, side);
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

async function handleRobinhoodTrade(admin: any, ctx: any, req: Request, side: "buy" | "sell") {
  if (!isSwapEnabled()) throw new AgentApiError("swap_not_enabled", 503);
  const body = ctx.body;
  const walletAddress = ctx.wallet.address ?? ctx.wallet.public_key;
  if (ctx.wallet.wallet_type !== "evm" || Number(ctx.wallet.chain_id) !== 4663) {
    throw new AgentApiError("wallet_chain_mismatch", 403, "API key is not bound to an EVM wallet.");
  }
  const tokenAddress = normalizeAddressField(body, ["token_address", "token"], true)!;
  const slippageBps = parseSlippageBps(
    body.slippage_bps ?? body.slippageBps,
    Number(ctx.profile?.default_slippage_bps ?? 100),
  );
  const idempotencyKey = `agent-trade:${ctx.apiKeyId}:${ctx.idempotencyKey}`;

  if (side === "buy") {
    const inputEthWei = parseEthWei(body.amount_eth ?? body.eth_amount, "amount_eth");
    enforceEthCap(
      "max_buy_eth",
      inputEthWei,
      ctx.apiKey.max_buy_eth ?? ctx.profile?.max_auto_buy_eth,
    );
    const requiredWei = ethers.parseEther(
      String(requiredEthForBuy(ethers.formatEther(inputEthWei))),
    );
    const balanceWei = await getEthBalanceWei(walletAddress);
    if (balanceWei < requiredWei) {
      throw new AgentApiError(
        "insufficient_eth",
        400,
        insufficientNativeBalanceReply({
          symbol: "ETH",
          currentBalance: Number(ethers.formatEther(balanceWei)),
          requiredAmount: Number(ethers.formatEther(requiredWei)),
        }),
        {
          wallet_balance_wei: balanceWei.toString(),
          required_wei: requiredWei.toString(),
          input_wei: inputEthWei.toString(),
        },
      );
    }
    const request = {
      side: "buy" as const,
      userId: ctx.userId,
      walletId: ctx.wallet.id,
      walletAddress,
      inputEthWei: inputEthWei.toString(),
      outputTokenAddress: tokenAddress,
      slippageBps,
      idempotencyKey,
      sourceTweetId: `agent:${ctx.idempotencyKey}`,
      sourceSurface: "agent_api",
    };
    if (body.dry_run === true) {
      const quote = await quoteSwap(request);
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ dry_run: true, chain: "robinhood", quote });
    }
    const result = await executeBuySwap(admin, request);
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse(normalizeEvmSwapResult(result, side));
  }

  const balances = await getErc20TokenBalances(walletAddress);
  const holding = balances.find(
    (item: any) =>
      String(item.token_address ?? item.mint).toLowerCase() === tokenAddress.toLowerCase(),
  );
  const balanceWei = holding?.raw_value == null ? 0n : BigInt(holding.raw_value);
  const percent = parsePositiveNumber(body.percent ?? body.sell_percent ?? 0, "percent", 100);
  enforcePercentCap(percent, ctx.apiKey.max_sell_percent ?? ctx.profile?.max_auto_sell_percent);
  const amountWei = amountFromPercent(balanceWei, percent);
  if (amountWei <= 0n) throw new AgentApiError("no_token_balance", 400);
  const request = {
    side: "sell" as const,
    userId: ctx.userId,
    walletId: ctx.wallet.id,
    walletAddress,
    inputTokenAddress: tokenAddress,
    inputTokenAmountWei: amountWei.toString(),
    slippageBps,
    idempotencyKey,
    sourceTweetId: `agent:${ctx.idempotencyKey}`,
    sourceSurface: "agent_api",
  };
  if (body.dry_run === true) {
    const quote = await quoteSwap(request);
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({ dry_run: true, chain: "robinhood", quote });
  }
  const result = await executeSellSwap(admin, request);
  await recordAgentRequest(admin, ctx, req, 200);
  return agentJsonResponse(normalizeEvmSwapResult(result, side));
}

async function handleSolanaTrade(admin: any, ctx: any, req: Request, side: "buy" | "sell") {
  if (!readSolanaSwapEnabled()) throw new AgentApiError("solana_swap_not_enabled", 503);
  const body = ctx.body;
  const wallet = await loadAgentSolanaWallet(admin, ctx);
  const tokenMint = normalizeSolanaAddress(
    stringField(body, ["token_mint", "mint", "token_address", "token"], { required: true }),
  );
  if (!tokenMint) {
    throw new AgentApiError("invalid_solana_mint", 400, "Expected a full Solana token mint.");
  }
  const slippageBps = parseSlippageBps(
    body.slippage_bps ?? body.slippageBps,
    Number(ctx.profile?.default_slippage_bps ?? 100),
  );
  const idempotencyKey = `agent-sol-trade:${ctx.apiKeyId}:${ctx.idempotencyKey}`;

  if (side === "buy") {
    const inputLamportsBigint = parseSolToLamports(body.amount_sol ?? body.sol_amount);
    const amountSol = Number(inputLamportsBigint) / 1_000_000_000;
    const inputLamports = inputLamportsBigint.toString();
    enforceSolCap(
      "max_buy_sol",
      amountSol,
      ctx.apiKey.max_buy_sol ?? ctx.profile?.max_auto_buy_sol,
    );
    const requiredLamports = parseSolToLamports(requiredSolForBuy(amountSol).toFixed(9));
    const balanceLamports = BigInt(
      await solanaConnection().getBalance(new PublicKey(wallet.address), "confirmed"),
    );
    if (balanceLamports < requiredLamports) {
      throw new AgentApiError(
        "insufficient_sol",
        400,
        insufficientNativeBalanceReply({
          symbol: "SOL",
          currentBalance: Number(balanceLamports) / 1_000_000_000,
          requiredAmount: Number(requiredLamports) / 1_000_000_000,
        }),
        {
          wallet_balance_lamports: balanceLamports.toString(),
          required_lamports: requiredLamports.toString(),
          input_lamports: inputLamportsBigint.toString(),
        },
      );
    }
    const request = {
      side: "buy" as const,
      userId: ctx.userId,
      walletId: wallet.id,
      walletAddress: wallet.address,
      inputLamports,
      outputMint: tokenMint,
      slippageBps,
      idempotencyKey,
      sourceTweetId: `agent:${ctx.idempotencyKey}`,
      sourceSurface: "agent_api",
    };
    if (body.dry_run === true) {
      const quote = await quoteSolanaSwap(request);
      await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
      return agentJsonResponse({ dry_run: true, chain: "solana", quote });
    }
    const result = await executeSolanaBuySwap(admin, request);
    await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
    return agentJsonResponse(normalizeSolanaSwapResult(result, side));
  }

  const balance = await getSolanaTokenBalanceRaw({ owner: wallet.address, mint: tokenMint });
  const percent = parsePositiveNumber(body.percent ?? body.sell_percent ?? 0, "percent", 100);
  enforcePercentCap(percent, ctx.profile?.max_auto_sell_percent);
  const amount = solanaAmountFromPercent(balance.amount, percent);
  if (amount <= 0n) throw new AgentApiError("no_token_balance", 400);
  const request = {
    side: "sell" as const,
    userId: ctx.userId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputMint: tokenMint,
    inputTokenAmount: amount.toString(),
    slippageBps,
    idempotencyKey,
    sourceTweetId: `agent:${ctx.idempotencyKey}`,
    sourceSurface: "agent_api",
  };
  if (body.dry_run === true) {
    const quote = await quoteSolanaSwap(request);
    await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
    return agentJsonResponse({ dry_run: true, chain: "solana", quote });
  }
  const result = await executeSolanaSellSwap(admin, request);
  await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
  return agentJsonResponse(normalizeSolanaSwapResult(result, side));
}

function inferTradeChain(body: any): "robinhood" | "solana" {
  const explicit = String(body?.chain ?? body?.network ?? "")
    .trim()
    .toLowerCase();
  if (["sol", "solana"].includes(explicit)) return "solana";
  if (["eth", "evm", "robinhood", "rhood"].includes(explicit)) return "robinhood";
  const candidate = body?.token_mint ?? body?.mint ?? body?.token_address ?? body?.token;
  return normalizeSolanaAddress(candidate) ? "solana" : "robinhood";
}

async function loadAgentSolanaWallet(admin: any, ctx: any) {
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

function enforceEthCap(kind: string, amountWei: bigint, cap: unknown) {
  const capNumber = Number(cap ?? 0);
  if (!Number.isFinite(capNumber) || capNumber <= 0)
    throw capExceeded(`${kind}_disabled`, `${kind} is disabled.`);
  if (Number(ethers.formatEther(amountWei)) > capNumber) {
    throw capExceeded(`${kind}_exceeded`, `${kind} exceeded.`);
  }
}

function enforceSolCap(kind: string, amountSol: number, cap: unknown) {
  const capNumber = Number(cap ?? 0);
  if (!Number.isFinite(capNumber) || capNumber <= 0)
    throw capExceeded(`${kind}_disabled`, `${kind} is disabled.`);
  if (amountSol > capNumber) throw capExceeded(`${kind}_exceeded`, `${kind} exceeded.`);
}

function enforcePercentCap(percent: number, cap: unknown) {
  const capNumber = Number(cap ?? 0);
  if (!Number.isFinite(capNumber) || capNumber <= 0)
    throw capExceeded("sell_disabled", "Selling is disabled.");
  if (percent > capNumber) {
    throw capExceeded("max_sell_percent_exceeded", "Sell percent exceeds the configured cap.");
  }
}

function normalizeEvmSwapResult(result: any, side: "buy" | "sell") {
  return {
    chain: "robinhood",
    status: result.status,
    tx_hash: result.txHash,
    side,
    input_amount_wei: result.inputAmountWei,
    output_amount_wei: result.outputAmountWei,
    quoted_output_amount_wei: result.quotedOutputAmountWei,
    min_output_amount_wei: result.minOutputAmountWei,
    gas_used_wei: result.gasUsedWei,
    approval_tx_hash: result.approvalTxHash ?? null,
    input_token: result.inputToken,
    output_token: result.outputToken,
  };
}

function normalizeSolanaSwapResult(result: any, side: "buy" | "sell") {
  return {
    chain: "solana",
    status: result.status,
    tx_hash: result.txHash,
    signature: result.signature,
    side,
    input_amount: result.inputAmount,
    output_amount: result.outputAmount,
    quoted_output_amount: result.quotedOutputAmount,
    min_output_amount: result.minOutputAmount,
    input_token: result.inputToken,
    output_token: result.outputToken,
    explorer_url: result.explorerUrl,
  };
}
