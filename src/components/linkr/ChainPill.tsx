import { cn } from "@/lib/utils";
import type { ChainTone } from "@/lib/linkr/chain-presentation";

const CHAIN_ICON_SRC: Record<ChainTone, string> = {
  robinhood: "/linkr/chains/evm.png",
  solana: "/linkr/chains/sol.png",
};

const CHAIN_ACCESSIBLE_LABEL: Record<ChainTone, string> = {
  robinhood: "Robinhood EVM",
  solana: "Solana",
};

export function ChainPill({
  chain,
  className,
  iconOnly = false,
  label,
}: {
  chain: ChainTone | null | undefined;
  className?: string;
  iconOnly?: boolean;
  label?: string | null;
}) {
  const resolvedChain = chain ?? "robinhood";
  const accessibleLabel = label || CHAIN_ACCESSIBLE_LABEL[resolvedChain];

  return (
    <span
      aria-label={accessibleLabel}
      className={cn("sm-chain-pill", iconOnly && "sm-chain-pill-icon-only", className)}
      data-chain={resolvedChain}
      title={accessibleLabel}
    >
      <img
        aria-hidden="true"
        className="sm-chain-pill-image"
        src={CHAIN_ICON_SRC[resolvedChain]}
        alt=""
      />
      <span className={iconOnly ? "sr-only" : "sm-chain-pill-text"}>{accessibleLabel}</span>
    </span>
  );
}
