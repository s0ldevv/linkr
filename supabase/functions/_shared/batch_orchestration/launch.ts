import type { MarketChain } from "../market_data/types.ts";

export function inferLaunchTargets(args: {
  text: string;
  extraction?: any;
  threadText?: string | null;
}): MarketChain[] {
  const text = [
    args.text,
    args.threadText,
    args.extraction?.launch_chain,
    args.extraction?.platform,
  ]
    .map((value) => String(value ?? ""))
    .join(" ")
    .toLowerCase();
  const explicit = String(args.extraction?.launch_chain ?? "").toLowerCase();

  const wantsSolana = /\b(sol|solana|pump\.fun|pumpfun|pump|pumpswap)\b/.test(
    text,
  );
  const wantsRobinhood = /\b(robinhood|rhood|evm|eth|weth)\b/.test(text);
  const wantsBoth =
    /\b(both|each|all|multi[- ]?chain|two chains|2 chains)\b/.test(text) ||
    (wantsSolana && wantsRobinhood);

  // Multiple chains are ambiguous for an irreversible launch. The caller must
  // ask the user to select exactly one; it must never fan out implicitly.
  if (wantsBoth) return [];
  if (explicit === "solana" || wantsSolana) return ["solana"];
  if (explicit === "robinhood" || wantsRobinhood) return ["robinhood"];
  // There is deliberately no profile or platform launch-chain default.
  return [];
}

export function childExtractionForLaunchTarget(
  extraction: any,
  chain: MarketChain,
): any {
  const unit = String(extraction?.dev_buy_original_unit ?? "").toLowerCase();
  const amount = numberOrNull(extraction?.dev_buy_original);
  const child = { ...extraction, launch_chain: chain, token_chain: chain };

  if (chain === "solana") {
    if (unit === "sol" || unit === "usd") {
      child.dev_buy_original = amount ?? 0;
      child.dev_buy_original_unit = unit;
    } else {
      child.dev_buy_original = 0;
      child.dev_buy_original_unit = "sol";
    }
    return child;
  }

  if (unit === "eth" || unit === "usd") {
    child.dev_buy_original = amount ?? 0;
    child.dev_buy_original_unit = unit;
  } else {
    child.dev_buy_original = 0;
    child.dev_buy_original_unit = "eth";
  }
  return child;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
