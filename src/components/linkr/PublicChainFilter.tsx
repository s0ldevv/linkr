import { ChainPill } from "@/components/linkr/ChainPill";

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
    <ChainPill
      chain={value}
      className="sm-public-chain-filter-icon"
      iconOnly
      label={chainFilterLabel(value)}
    />
  );
}

function chainFilterLabel(value: PublicChainFilterValue) {
  if (value === "solana") return "Solana";
  if (value === "robinhood") return "Robinhood";
  return "All activity";
}
