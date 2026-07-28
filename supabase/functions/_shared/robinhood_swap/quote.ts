import { normalizeEvmAddress, ROBINHOOD_CHAIN_ID } from "../robinhood_chain.ts";
import {
  assertRobinhoodSwapChain,
  NATIVE_ETH_ADDRESS,
  readSwapDeadlineSeconds,
  readSwapMaxPriceImpactBps,
  readSwapQuoteTtlSeconds,
  readSwapRouterAddress,
  readUniswapApiKey,
  UNISWAP_ROUTER_VERSION,
  UNISWAP_TRADE_API_URL,
} from "./constants.ts";
import { SwapQuote, SwapRequest } from "./types.ts";

export async function quoteSwap(request: SwapRequest): Promise<SwapQuote> {
  const tokenIn =
    request.side === "buy" ? NATIVE_ETH_ADDRESS : normalizeEvmAddress(request.inputTokenAddress);
  const tokenOut =
    request.side === "buy" ? normalizeEvmAddress(request.outputTokenAddress) : NATIVE_ETH_ADDRESS;
  const amount = request.side === "buy" ? request.inputEthWei : request.inputTokenAmountWei;
  const body = {
    type: "EXACT_INPUT",
    amount,
    tokenInChainId: ROBINHOOD_CHAIN_ID,
    tokenOutChainId: ROBINHOOD_CHAIN_ID,
    tokenIn,
    tokenOut,
    swapper: normalizeEvmAddress(request.walletAddress),
    slippageTolerance: Math.max(0.01, request.slippageBps / 100),
    routingPreference: "BEST_PRICE",
    protocols: ["V2", "V3", "V4"],
  };
  const json = await uniswapPost("/quote", body);
  const quote = normalizeQuote(json, request);
  enforceQuotePolicy(quote);
  return quote;
}

export async function createSwapCalldata(quote: SwapQuote): Promise<any> {
  const deadline = Math.floor(Date.now() / 1000) + readSwapDeadlineSeconds();
  const json = await uniswapPost("/swap", {
    quote: (quote.raw as any)?.quote,
    permitData: (quote.raw as any)?.permitData ?? null,
    refreshGasPrice: true,
    simulateTransaction: true,
    safetyMode: "SAFE",
    deadline,
  });
  const swap = json?.swap;
  if (!swap?.to || !swap?.data) throw new Error("swap_missing_transaction");
  assertRobinhoodSwapChain(swap.chainId);
  const router = normalizeEvmAddress(readSwapRouterAddress());
  if (normalizeEvmAddress(swap.to).toLowerCase() !== router.toLowerCase())
    throw new Error("swap_router_mismatch");
  return json;
}

export async function checkApproval(args: {
  walletAddress: string;
  token: string;
  amount: string;
  tokenOut: string;
}): Promise<any> {
  return await uniswapPost("/check_approval", {
    walletAddress: normalizeEvmAddress(args.walletAddress),
    token: normalizeEvmAddress(args.token),
    amount: args.amount,
    chainId: ROBINHOOD_CHAIN_ID,
    tokenOut: args.tokenOut,
    tokenOutChainId: ROBINHOOD_CHAIN_ID,
    includeGasInfo: true,
  });
}

function normalizeQuote(json: any, request: SwapRequest): SwapQuote {
  const quote = json?.quote;
  if (!quote) throw new Error("swap_quote_invalid_response");
  const input = quote.input ?? quote.orderInfo?.input;
  const output = quote.output ?? quote.outputs?.[0] ?? quote.aggregatedOutputs?.[0];
  const inputAmount = stringValue(input?.amount ?? input?.startAmount ?? quote.inputAmount);
  const outputAmount = stringValue(output?.amount ?? output?.startAmount ?? quote.outputAmount);
  const minOutput = stringValue(output?.minimumAmount ?? output?.minAmount ?? outputAmount);
  if (!inputAmount || !outputAmount || !minOutput) throw new Error("swap_quote_missing_amounts");
  const routing = String(json.routing ?? quote.routing ?? "");
  if (!["CLASSIC", "WRAP", "UNWRAP", "BRIDGE"].includes(routing))
    throw new Error("swap_quote_unsupported_routing_" + routing);

  const priceImpactBps = priceImpactToBps(
    quote.priceImpact ?? quote.priceImpactBps ?? quote.priceImpactBasisPoints,
  );
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    side: request.side,
    inputToken:
      request.side === "buy" ? NATIVE_ETH_ADDRESS : normalizeEvmAddress(request.inputTokenAddress),
    outputToken:
      request.side === "buy" ? normalizeEvmAddress(request.outputTokenAddress) : NATIVE_ETH_ADDRESS,
    inputAmountWei: inputAmount,
    quotedOutputAmountWei: outputAmount,
    minOutputAmountWei: minOutput,
    routerAddress: normalizeEvmAddress(readSwapRouterAddress()),
    routeSource: "uniswap_api",
    quoteId: stringValue(quote.quoteId),
    requestId: stringValue(json.requestId),
    routing,
    priceImpactBps,
    gasEstimateWei: stringValue(quote.gasFee ?? quote.gasUseEstimate ?? json.gasFee),
    expiresAt: new Date(Date.now() + readSwapQuoteTtlSeconds() * 1000).toISOString(),
    raw: json,
  };
}

function enforceQuotePolicy(quote: SwapQuote): void {
  if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new Error("swap_quote_expired");
  const maxImpact = readSwapMaxPriceImpactBps();
  if (quote.priceImpactBps != null && quote.priceImpactBps > maxImpact)
    throw new Error("swap_quote_price_impact_too_high");
}

async function uniswapPost(path: string, body: any): Promise<any> {
  const apiKey = readUniswapApiKey();
  if (!apiKey) throw new Error("missing_uniswap_api_key");
  const res = await fetch(`${UNISWAP_TRADE_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": UNISWAP_ROUTER_VERSION,
      "x-permit2-disabled": "true",
      "x-erc20eth-enabled": "false",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`uniswap_api_${path.replace("/", "")}_${res.status}`);
  return json;
}

function stringValue(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function priceImpactToBps(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 100 ? Math.round(n) : Math.round(n * 100);
}
