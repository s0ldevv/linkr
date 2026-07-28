export type ChainTone = "robinhood" | "solana";

export type ChainPresentation = {
  addressLabel: "Contract" | "Mint";
  chain: ChainTone;
  label: string;
  nativeSymbol: "ETH" | "SOL";
  platformLabel: string;
  shortLabel: "EVM" | "SOL";
};

type ChainLike = {
  chain?: string | null;
  chain_id?: number | null;
  launch_platform?: string | null;
  launchPlatform?: string | null;
  native_symbol?: string | null;
  nativeSymbol?: string | null;
};

export function chainPresentationForRecord(row: ChainLike | null | undefined): ChainPresentation {
  return chainPresentation(chainForRecord(row) ?? "robinhood");
}

export function chainPresentationForRecordIfKnown(
  row: ChainLike | null | undefined,
): ChainPresentation | null {
  const chain = chainForRecord(row);
  return chain ? chainPresentation(chain) : null;
}

export function chainForRecord(row: ChainLike | null | undefined): ChainTone | null {
  const chain = row?.chain?.trim().toLowerCase();
  const platform = (row?.launch_platform ?? row?.launchPlatform)?.trim().toLowerCase();
  const native = (row?.native_symbol ?? row?.nativeSymbol)?.trim().toLowerCase();

  if (chain === "solana" || platform === "pump_fun" || native === "sol") return "solana";
  if (chain === "robinhood" || native === "eth") return "robinhood";
  return null;
}

function chainPresentation(chain: ChainTone): ChainPresentation {
  if (chain === "solana") {
    return {
      addressLabel: "Mint",
      chain,
      label: "Pump.fun / SOL",
      nativeSymbol: "SOL",
      platformLabel: "Pump.fun",
      shortLabel: "SOL",
    };
  }

  return {
    addressLabel: "Contract",
    chain,
    label: "Robinhood / EVM",
    nativeSymbol: "ETH",
    platformLabel: "Robinhood",
    shortLabel: "EVM",
  };
}

export function isSolanaRecord(row: ChainLike | null | undefined) {
  return chainForRecord(row) === "solana";
}
