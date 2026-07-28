import { Link } from "@tanstack/react-router";
import { ArrowRight, Rocket } from "lucide-react";
import type { PublicTokenRank } from "@/lib/linkr/home-data";
import { TerminalCoinCard } from "./TerminalCoinCard";
import { PLACEHOLDER_TOKENS } from "./terminal-data";

export function TerminalLaunches({
  tokens,
  isLoading,
}: {
  tokens: PublicTokenRank[] | undefined;
  isLoading: boolean;
}) {
  const hasReal = (tokens?.length ?? 0) > 0;
  const rows = hasReal ? (tokens as PublicTokenRank[]) : PLACEHOLDER_TOKENS;

  return (
    <section className="lkt-section-narrow" id="launches" aria-label="Newly launched coins">
      <div className="lkt-section-head">
        <h2 className="lkt-section-title">
          NEW LAUNCHES
          <span className="lkt-live-chip">
            <span className="lkt-dot" aria-hidden="true" />
            Live
          </span>
        </h2>
        <div className="lkt-section-actions">
          <Link to="/explore" className="lkt-view-all">
            Explore
            <ArrowRight aria-hidden="true" size={13} strokeWidth={2.6} />
          </Link>
          <Link to="/launch" className="lkt-launch-link">
            <Rocket aria-hidden="true" size={14} strokeWidth={2.4} />
            Launch
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="lkt-coin-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="lkt-skeleton" style={{ borderRadius: 14, height: 172 }} />
          ))}
        </div>
      ) : (
        <div className="lkt-coin-grid">
          {rows.slice(0, 12).map((token) => (
            <TerminalCoinCard key={token.id} token={token} isDemo={!hasReal} />
          ))}
        </div>
      )}
    </section>
  );
}
