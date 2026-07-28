// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  robinhoodProvider,
} from "../robinhood_chain.ts";
import { loadWallet } from "../wallet.ts";
import { ERC20_ABI } from "./abi.ts";
import { ensureEnoughEthForBuy } from "./amount.ts";
import {
  NATIVE_ETH_ADDRESS,
  readSwapConfirmationBlocks,
  readSwapGasPaddingBps,
  readSwapRouterAddress,
} from "./constants.ts";
import { checkApproval, createSwapCalldata, quoteSwap } from "./quote.ts";
import {
  BuySwapRequest,
  SellSwapRequest,
  SwapExecutionResult,
  SwapRequest,
  TokenInfo,
} from "./types.ts";

export async function executeBuySwap(
  admin: any,
  request: BuySwapRequest,
): Promise<SwapExecutionResult> {
  return executeSwap(admin, request);
}

export async function executeSellSwap(
  admin: any,
  request: SellSwapRequest,
): Promise<SwapExecutionResult> {
  return executeSwap(admin, request);
}

async function executeSwap(
  admin: any,
  request: SwapRequest,
): Promise<SwapExecutionResult> {
  const wallet = await loadWallet(admin, request.userId);
  if (!wallet) throw new Error("no_wallet");
  if (wallet.id !== request.walletId) {
    throw new Error("wallet_changed_before_swap");
  }
  if (
    normalizeEvmAddress(wallet.address).toLowerCase() !==
      normalizeEvmAddress(request.walletAddress).toLowerCase()
  ) {
    throw new Error("wallet_address_changed_before_swap");
  }

  const existing = await findExistingTransaction(admin, request.idempotencyKey);
  if (existing?.tx_hash && existing.status === "confirmed") {
    throw new Error("swap_already_confirmed");
  }
  if (existing?.tx_hash && existing.status === "submitted") {
    throw new Error("swap_already_submitted");
  }

  const provider = robinhoodProvider();
  const signer = new ethers.Wallet(wallet.private_key_hex, provider);
  const quote = await quoteSwap(request);
  const inputToken = await readTokenInfo(provider, quote.inputToken);
  const outputToken = await readTokenInfo(provider, quote.outputToken);
  const outputBalanceBefore = request.side === "buy"
    ? await readErc20Balance(provider, quote.outputToken, wallet.address).catch(
      () => null,
    )
    : null;
  let approvalTxHash: string | null = null;

  if (request.side === "sell") {
    approvalTxHash = await executeApprovalIfNeeded({
      provider,
      signer,
      walletAddress: wallet.address,
      tokenAddress: request.inputTokenAddress,
      amountWei: request.inputTokenAmountWei,
      tokenOut: NATIVE_ETH_ADDRESS,
    });
  }

  const swapResponse = await createSwapCalldata(quote);
  const txRequest = normalizeTxRequest(swapResponse.swap, wallet.address);
  if (request.side === "buy") {
    const balanceWei = await provider.getBalance(wallet.address);
    const estimatedGasWei = gasCostWei(txRequest);
    ensureEnoughEthForBuy({
      balanceWei,
      inputWei: BigInt(request.inputEthWei),
      estimatedGasWei,
      gasPaddingBps: readSwapGasPaddingBps(),
    });
  }

  await upsertSubmittedTransaction(
    admin,
    request,
    quote,
    inputToken,
    outputToken,
    swapResponse,
  );
  const sent = await signer.sendTransaction(txRequest);
  await admin
    .from("transactions")
    .update({
      tx_hash: sent.hash,
      tx_signature: sent.hash,
      explorer_url: getTxExplorerUrl(sent.hash),
    })
    .eq("idempotency_key", request.idempotencyKey);
  const receipt = await sent.wait(readSwapConfirmationBlocks());
  if (!receipt || receipt.status !== 1) throw new Error("swap_tx_reverted");

  const outputAmountWei = await inferOutputAmountWei(
    provider,
    request,
    quote,
    wallet.address,
    outputBalanceBefore,
  );
  const gasUsedWei = receipt.gasUsed != null && receipt.gasPrice != null
    ? (BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice)).toString()
    : null;
  const effectiveGasPriceWei = receipt.gasPrice == null
    ? null
    : BigInt(receipt.gasPrice).toString();
  const result: SwapExecutionResult = {
    txHash: sent.hash,
    status: "confirmed",
    inputAmountWei: quote.inputAmountWei,
    outputAmountWei,
    quotedOutputAmountWei: quote.quotedOutputAmountWei,
    minOutputAmountWei: quote.minOutputAmountWei,
    gasUsedWei,
    effectiveGasPriceWei,
    explorerUrl: getTxExplorerUrl(sent.hash),
    quote,
    inputToken,
    outputToken,
    receipt,
    approvalTxHash,
  };
  await admin
    .from("transactions")
    .update({
      status: "confirmed",
      tx_hash: sent.hash,
      tx_signature: sent.hash,
      explorer_url: result.explorerUrl,
      output_amount_wei: outputAmountWei,
      gas_used_wei: gasUsedWei,
      effective_gas_price_wei: effectiveGasPriceWei,
      raw_result: {
        txHash: result.txHash,
        inputAmountWei: result.inputAmountWei,
        outputAmountWei: result.outputAmountWei,
        quotedOutputAmountWei: result.quotedOutputAmountWei,
        minOutputAmountWei: result.minOutputAmountWei,
        gasUsedWei: result.gasUsedWei,
        effectiveGasPriceWei: result.effectiveGasPriceWei,
        approvalTxHash: result.approvalTxHash ?? null,
      },
      confirmed_at: new Date().toISOString(),
    })
    .eq("idempotency_key", request.idempotencyKey);
  return result;
}

async function executeApprovalIfNeeded(args: {
  provider: ethers.AbstractProvider;
  signer: ethers.Wallet;
  walletAddress: string;
  tokenAddress: string;
  amountWei: string;
  tokenOut: string;
}): Promise<string | null> {
  const approval = await checkApproval({
    walletAddress: args.walletAddress,
    token: args.tokenAddress,
    amount: args.amountWei,
    tokenOut: args.tokenOut,
  });
  for (const key of ["cancel", "approval"]) {
    const tx = approval?.[key];
    if (!tx) continue;
    const sent = await args.signer.sendTransaction(
      normalizeTxRequest(tx, args.walletAddress),
    );
    const receipt = await sent.wait(readSwapConfirmationBlocks());
    if (!receipt || receipt.status !== 1) {
      throw new Error(`swap_${key}_tx_failed`);
    }
    if (key === "approval") return sent.hash;
  }
  return null;
}

async function readTokenInfo(
  provider: ethers.AbstractProvider,
  address: string,
): Promise<TokenInfo> {
  if (address.toLowerCase() === NATIVE_ETH_ADDRESS.toLowerCase()) {
    return { address: NATIVE_ETH_ADDRESS, symbol: "ETH", decimals: 18 };
  }
  const tokenAddress = normalizeEvmAddress(address);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([
    token.symbol().catch(() => null),
    token.decimals().catch(() => 18),
  ]);
  return {
    address: tokenAddress,
    symbol: symbol == null ? null : String(symbol),
    decimals: Number(decimals),
  };
}

async function readErc20Balance(
  provider: ethers.AbstractProvider,
  tokenAddress: string,
  walletAddress: string,
): Promise<bigint> {
  const token = new ethers.Contract(
    normalizeEvmAddress(tokenAddress),
    ERC20_ABI,
    provider,
  );
  return BigInt(await token.balanceOf(walletAddress));
}

function normalizeTxRequest(
  tx: any,
  expectedFrom: string,
): ethers.TransactionRequest {
  if (!tx?.to || !tx?.data) throw new Error("swap_missing_transaction_fields");
  if (
    tx.from &&
    normalizeEvmAddress(tx.from).toLowerCase() !==
      normalizeEvmAddress(expectedFrom).toLowerCase()
  ) {
    throw new Error("swap_from_mismatch");
  }
  const out: ethers.TransactionRequest = {
    to: normalizeEvmAddress(tx.to),
    data: String(tx.data),
    value: tx.value == null || tx.value === "" ? 0n : BigInt(tx.value),
  };
  if (tx.gasLimit != null) out.gasLimit = BigInt(tx.gasLimit);
  if (tx.maxFeePerGas != null) out.maxFeePerGas = BigInt(tx.maxFeePerGas);
  if (tx.maxPriorityFeePerGas != null) {
    out.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
  }
  if (tx.gasPrice != null && out.maxFeePerGas == null) {
    out.gasPrice = BigInt(tx.gasPrice);
  }
  return out;
}

function gasCostWei(tx: ethers.TransactionRequest): bigint | null {
  const gasLimit = tx.gasLimit == null ? null : BigInt(tx.gasLimit);
  const gasPrice = tx.maxFeePerGas == null
    ? tx.gasPrice == null ? null : BigInt(tx.gasPrice)
    : BigInt(tx.maxFeePerGas);
  if (gasLimit == null || gasPrice == null) return null;
  return gasLimit * gasPrice;
}

async function inferOutputAmountWei(
  provider: ethers.AbstractProvider,
  request: SwapRequest,
  quote: { outputToken: string; quotedOutputAmountWei: string },
  walletAddress: string,
  outputBalanceBefore: bigint | null,
): Promise<string | null> {
  if (request.side === "buy") {
    const balance = await readErc20Balance(
      provider,
      quote.outputToken,
      walletAddress,
    ).catch(
      () => null,
    );
    if (
      balance == null || outputBalanceBefore == null ||
      balance < outputBalanceBefore
    ) {
      return quote.quotedOutputAmountWei;
    }
    return (balance - outputBalanceBefore).toString();
  }
  return quote.quotedOutputAmountWei;
}

async function findExistingTransaction(
  admin: any,
  idempotencyKey: string,
): Promise<any | null> {
  const { data } = await admin
    .from("transactions")
    .select("id,status,tx_hash")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return data ?? null;
}

async function upsertSubmittedTransaction(
  admin: any,
  request: SwapRequest,
  quote: any,
  inputToken: TokenInfo,
  outputToken: TokenInfo,
  swapResponse: any,
) {
  const isBuy = request.side === "buy";
  await admin.from("transactions").upsert(
    {
      user_id: request.userId,
      tweet_id: request.sourceTweetId,
      action: request.side,
      chain: "robinhood",
      input_mint: isBuy ? "native:eth" : request.inputTokenAddress,
      output_mint: isBuy ? request.outputTokenAddress : "native:eth",
      amount_original_unit: isBuy ? "eth" : "token",
      amount_eth: isBuy
        ? Number(ethers.formatEther(BigInt(request.inputEthWei)))
        : null,
      slippage_bps: request.slippageBps,
      chain_id: 4663,
      native_symbol: "ETH",
      wallet_id: request.walletId,
      wallet_address: request.walletAddress,
      input_amount_wei: quote.inputAmountWei,
      quoted_output_amount_wei: quote.quotedOutputAmountWei,
      min_output_amount_wei: quote.minOutputAmountWei,
      input_token_decimals: inputToken.decimals,
      output_token_decimals: outputToken.decimals,
      input_token_symbol: inputToken.symbol,
      output_token_symbol: outputToken.symbol,
      router_address: quote.routerAddress,
      route_source: quote.routeSource,
      quote_id: quote.quoteId,
      quote_payload: quote.raw as any,
      execution_payload: swapResponse as any,
      raw_request: { request, quote } as any,
      source_surface: request.sourceSurface ?? null,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      idempotency_key: request.idempotencyKey,
    },
    { onConflict: "idempotency_key" },
  );
}
