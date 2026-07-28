export type SwapSide = "buy" | "sell";

export interface TokenInfo {
  address: string;
  symbol: string | null;
  decimals: number;
}

export interface BuySwapRequest {
  side: "buy";
  userId: string;
  walletId: string;
  walletAddress: string;
  inputEthWei: string;
  outputTokenAddress: string;
  slippageBps: number;
  idempotencyKey: string;
  sourceTweetId: string;
  sourceSurface?: string | null;
}

export interface SellSwapRequest {
  side: "sell";
  userId: string;
  walletId: string;
  walletAddress: string;
  inputTokenAddress: string;
  inputTokenAmountWei: string;
  slippageBps: number;
  idempotencyKey: string;
  sourceTweetId: string;
  sourceSurface?: string | null;
}

export type SwapRequest = BuySwapRequest | SellSwapRequest;

export interface SwapQuote {
  chainId: 4663;
  side: SwapSide;
  inputToken: string;
  outputToken: string;
  inputAmountWei: string;
  quotedOutputAmountWei: string;
  minOutputAmountWei: string;
  routerAddress: string;
  routeSource: "uniswap_api";
  quoteId: string | null;
  requestId: string | null;
  routing: string;
  priceImpactBps: number | null;
  gasEstimateWei: string | null;
  expiresAt: string;
  raw: unknown;
}

export interface SwapExecutionResult {
  txHash: string;
  status: "confirmed";
  inputAmountWei: string;
  outputAmountWei: string | null;
  quotedOutputAmountWei: string;
  minOutputAmountWei: string;
  gasUsedWei: string | null;
  effectiveGasPriceWei: string | null;
  explorerUrl: string;
  quote: SwapQuote;
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  receipt: unknown;
  approvalTxHash?: string | null;
}
