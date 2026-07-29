import { RobinhoodLogo, SolanaLogo } from "@/components/linkr/ChainLogos";
import { cn } from "@/lib/utils";
import type { ChainTone } from "@/lib/linkr/chain-presentation";

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
  const Logo = resolvedChain === "solana" ? SolanaLogo : RobinhoodLogo;

  return (
    <span
      aria-label={accessibleLabel}
      className={cn("sm-chain-pill", iconOnly && "sm-chain-pill-icon-only", className)}
      data-chain={resolvedChain}
      title={accessibleLabel}
    >
      <Logo aria-hidden="true" className="sm-chain-pill-image" />
      <span className={iconOnly ? "sr-only" : "sm-chain-pill-text"}>{accessibleLabel}</span>
    </span>
  );
}
