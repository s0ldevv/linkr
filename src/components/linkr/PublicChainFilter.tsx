import { RobinhoodLogo, SolanaLogo } from "@/components/linkr/ChainLogos";

export type PublicChainFilterValue = "all" | "robinhood" | "solana";

export function PublicChainFilter({
  active,
  ariaLabel,
  counts,
  onChange,
}: {
  active: PublicChainFilterValue;
  ariaLabel: string;
  counts: Record<PublicChainFilterValue, number>;
  onChange: (value: PublicChainFilterValue) => void;
}) {
  return (
    <div className="sm-public-chain-filter" aria-label={ariaLabel}>
      {(["all", "robinhood", "solana"] as PublicChainFilterValue[]).map((value) => (
        <button
          aria-pressed={active === value}
          data-chain-filter={value}
          key={value}
          onClick={() => onChange(value)}
          type="button"
        >
          {value !== "all" && <ChainFilterIcon value={value} />}
          <span className="sm-public-chain-filter-copy">
            <span>{chainFilterLabel(value)}</span>
            <strong>{counts[value]}</strong>
          </span>
        </button>
      ))}
    </div>
  );
}

function ChainFilterIcon({ value }: { value: Exclude<PublicChainFilterValue, "all"> }) {
  return (
    <span className="sm-public-chain-filter-icon" aria-hidden="true">
      {value === "robinhood" && <RobinhoodLogo className="sm-public-chain-filter-logo-robinhood" />}
      {value === "solana" && <SolanaLogo className="sm-public-chain-filter-logo-solana" />}
    </span>
  );
}

function chainFilterLabel(value: PublicChainFilterValue) {
  if (value === "solana") return "Solana";
  if (value === "robinhood") return "Robinhood";
  return "All activity";
}
