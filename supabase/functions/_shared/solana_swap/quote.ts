import { SOLANA_NATIVE_ASSET_ID, normalizeSolanaPublicKey } from "../solana_chain.ts";
import {
  readJupiterApiKey,
  readJupiterQuoteUrl,
  readJupiterSwapUrl,
  readSolanaSwapMaxPriceImpactBps,
  resolveSolanaSwapPriorityFeeLamports,
} from "./constants.ts";
import type { SolanaSwapQuote, SolanaSwapRequest } from "./types.ts";

export async function quoteSolanaSwap(request: SolanaSwapRequest): Promise<SolanaSwapQuote> {
  const inputMint =
    request.side === "buy" ? SOLANA_NATIVE_ASSET_ID : normalizeSolanaPublicKey(request.inputMint);
  const outputMint =
    request.side === "buy" ? normalizeSolanaPublicKey(request.outputMint) : SOLANA_NATIVE_ASSET_ID;
  const amount = request.side === "buy" ? request.inputLamports : request.inputTokenAmount;
  const url = new URL(readJupiterQuoteUrl());
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", String(Math.max(0, Math.floor(request.slippageBps))));
  url.searchParams.set("onlyDirectRoutes", "false");

  const json = await jupiterFetch(url.toString());
  const quote = normalizeQuote(json, request, inputMint, outputMint, amount);
  enforceQuotePolicy(quote);
  return quote;
}

export async function createSolanaSwapTransaction(
  quote: SolanaSwapQuote,
  userPublicKey: string,
  priorityFeeLamports?: number | null,
): Promise<any> {
  const body: Record<string, unknown> = {
    quoteResponse: quote.raw,
    userPublicKey: normalizeSolanaPublicKey(userPublicKey),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  };

  const resolvedPriorityFeeLamports = resolveSolanaSwapPriorityFeeLamports(priorityFeeLamports);
  if (resolvedPriorityFeeLamports > 0) {
    body.prioritizationFeeLamports = {
      priorityLevelWithMaxLamports: {
        maxLamports: resolvedPriorityFeeLamports,
        priorityLevel: "veryHigh",
      },
    };
  }

  const json = await jupiterFetch(readJupiterSwapUrl(), {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!json?.swapTransaction) throw new Error("jupiter_swap_missing_transaction");
  return json;
}

function normalizeQuote(
  json: any,
  request: SolanaSwapRequest,
  inputMint: string,
  outputMint: string,
  inputAmount: string,
): SolanaSwapQuote {
  const outAmount = stringValue(json?.outAmount);
  const minOutput = stringValue(json?.otherAmountThreshold ?? outAmount);
  if (!outAmount || !minOutput) throw new Error("jupiter_quote_missing_amounts");
  return {
    chain: "solana",
    side: request.side,
    inputMint,
    outputMint,
    inputAmount,
    quotedOutputAmount: outAmount,
    minOutputAmount: minOutput,
    priceImpactBps: priceImpactToBps(json?.priceImpactPct),
    routeSource: "jupiter",
    quoteId: stringValue(json?.quoteId ?? json?.requestId),
    raw: json,
  };
}

function enforceQuotePolicy(quote: SolanaSwapQuote): void {
  const maxImpact = readSolanaSwapMaxPriceImpactBps();
  if (quote.priceImpactBps != null && quote.priceImpactBps > maxImpact) {
    throw new Error("solana_swap_quote_price_impact_too_high");
  }
}

async function jupiterFetch(url: string, init: RequestInit = {}): Promise<any> {
  const apiKey = readJupiterApiKey();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.method === "POST") headers.set("Content-Type", "application/json");
  if (apiKey) headers.set("x-api-key", apiKey);

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = json?.error ?? json?.message ?? `${response.status}`;
    throw new Error(`jupiter_api_${response.status}_${message}`);
  }
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
  return Math.round(n * 10_000);
}
