export type SolanaSwapSide = "buy" | "sell";

export interface SolanaTokenInfo {
  mint: string;
  symbol: string | null;
  decimals: number;
}

export interface SolanaBuySwapRequest {
  side: "buy";
  userId: string;
  walletId: string;
  walletAddress: string;
  inputLamports: string;
  outputMint: string;
  slippageBps: number;
  priorityFeeLamports?: number | null;
  idempotencyKey: string;
  sourceTweetId: string;
  sourceSurface?: string | null;
}

export interface SolanaSellSwapRequest {
  side: "sell";
  userId: string;
  walletId: string;
  walletAddress: string;
  inputMint: string;
  inputTokenAmount: string;
  slippageBps: number;
  priorityFeeLamports?: number | null;
  idempotencyKey: string;
  sourceTweetId: string;
  sourceSurface?: string | null;
}

export type SolanaSwapRequest = SolanaBuySwapRequest | SolanaSellSwapRequest;

export interface SolanaSwapQuote {
  chain: "solana";
  side: SolanaSwapSide;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  quotedOutputAmount: string;
  minOutputAmount: string;
  priceImpactBps: number | null;
  routeSource: "jupiter";
  quoteId: string | null;
  raw: unknown;
}

export interface SolanaSwapExecutionResult {
  txHash: string;
  signature: string;
  status: "confirmed" | "submitted";
  inputAmount: string;
  outputAmount: string | null;
  quotedOutputAmount: string;
  minOutputAmount: string;
  explorerUrl: string;
  quote: SolanaSwapQuote;
  inputToken: SolanaTokenInfo;
  outputToken: SolanaTokenInfo;
  rawResult: unknown;
}
