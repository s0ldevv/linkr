export type LaunchChain = "robinhood" | "solana";

export interface LaunchRequestSignals {
  explicitChain: boolean;
  explicitDevBuy: boolean;
}

export interface LaunchExecutionDecision extends LaunchRequestSignals {
  autoExecute: boolean;
  forceZeroDevBuy: boolean;
  reason:
    | "first_launch"
    | "fully_specified"
    | "explicit_chain_zero_default"
    | "chain_confirmation_required"
    | "dev_buy_confirmation_required";
}

export function launchRequestSignals(args: {
  text?: unknown;
  extraction?: Record<string, unknown> | null;
}): LaunchRequestSignals {
  const text = String(args.text ?? "").toLowerCase();
  const extraction = args.extraction ?? {};
  const extractedChain = String(
    extraction.launch_chain ??
      extraction.token_chain ??
      (extraction.launch_chain_explicit === true ? extraction.chain : "") ??
      "",
  ).toLowerCase();
  const extractedUnit = String(
    extraction.dev_buy_original_unit ?? extraction.initial_buy_unit ?? "",
  ).toLowerCase();
  const extractedAmount = numberOrNull(
    extraction.dev_buy_original ??
      extraction.dev_buy_eth ??
      extraction.dev_buy_sol ??
      extraction.initial_buy_eth ??
      extraction.initial_buy_sol,
  );

  const extractedChainIsExplicit = extraction.launch_chain_explicit !== false &&
    (extractedChain === "solana" || extractedChain === "robinhood");
  const explicitChain = extraction.launch_chain_explicit === true ||
    extractedChainIsExplicit ||
    /\b(solana|pump\s*\.\s*fun|pumpfun|pumpswap|robinhood(?:\s+chain)?|rhood|evm)\b/i
      .test(
        text,
      ) ||
    /\bon\s+(?:the\s+)?(?:sol|eth)\b/i.test(text) ||
    ((extractedUnit === "sol" || extractedUnit === "eth") &&
      extractedAmount != null &&
      extractedAmount > 0);

  const explicitZero = /\b(?:no|zero)\s+(?:dev|initial)\s*buy\b/i.test(text) ||
    /\bwithout\s+(?:a\s+)?(?:dev|initial)\s*buy\b/i.test(text) ||
    /\b(?:dev|initial)\s*buy\s*(?:of|is|:|=)?\s*0(?:\.0+)?\b/i.test(text) ||
    /\b0(?:\.0+)?\s*(?:sol|eth|usd|dollars?)\s+(?:dev|initial)\s*buy\b/i.test(
      text,
    );
  const labeledDevBuy = /\b(?:dev|initial)\s*buy\b/i.test(text) ||
    /\b\d+(?:\.\d+)?\s*(?:sol|eth|usd|dollars?)\s+(?:dev|initial)\s*buy\b/i
      .test(text);
  const launchNativeAmount =
    /\b(?:launch|create|make)\b[\s\S]{0,180}\b\d+(?:\.\d+)?\s*(?:sol|eth)\b/i
      .test(text);
  const explicitDevBuy = extraction.dev_buy_explicit === true ||
    explicitZero ||
    labeledDevBuy ||
    launchNativeAmount ||
    extractedAmount != null && extractedAmount > 0;

  return { explicitChain, explicitDevBuy };
}

export function decideLaunchExecution(args: {
  firstLaunchSubsidyEligible: boolean;
  signals: LaunchRequestSignals;
}): LaunchExecutionDecision {
  const { explicitChain, explicitDevBuy } = args.signals;
  if (!explicitChain) {
    return {
      explicitChain,
      explicitDevBuy,
      autoExecute: false,
      forceZeroDevBuy: args.firstLaunchSubsidyEligible,
      reason: "chain_confirmation_required",
    };
  }
  if (args.firstLaunchSubsidyEligible) {
    return {
      explicitChain,
      explicitDevBuy,
      autoExecute: true,
      forceZeroDevBuy: true,
      reason: "first_launch",
    };
  }
  if (!explicitDevBuy) {
    return {
      explicitChain,
      explicitDevBuy,
      autoExecute: true,
      forceZeroDevBuy: true,
      reason: "explicit_chain_zero_default",
    };
  }
  return {
    explicitChain,
    explicitDevBuy,
    autoExecute: true,
    forceZeroDevBuy: false,
    reason: "fully_specified",
  };
}

export function zeroLaunchDevBuy(
  payload: Record<string, unknown>,
  chain: LaunchChain,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload };
  next.dev_buy_original = 0;
  next.dev_buy_original_amount = 0;
  next.dev_buy_original_unit = chain === "solana" ? "sol" : "eth";
  next.dev_buy_usd = null;
  next.initial_buy_eth = 0;
  next.initial_buy_sol = 0;
  if (chain === "solana") {
    next.dev_buy_sol = 0;
    delete next.dev_buy_eth;
  } else {
    next.dev_buy_eth = 0;
    delete next.dev_buy_sol;
  }
  return next;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
