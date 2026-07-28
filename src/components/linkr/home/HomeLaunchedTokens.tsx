import { Link } from "@tanstack/react-router";
import type { PublicTokenRank } from "@/lib/linkr/home-data";
import { formatCompactUsd } from "@/lib/linkr/home-data";
import { shortAddress } from "@/lib/linkr/format";

export function HomeLaunchedTokens({ tokens }: { tokens: PublicTokenRank[] }) {
  return (
    <section className="sm-dashboard-card">
      <div className="sm-card-head">
        <h2>Top Launched Tokens</h2>
        <Link to="/explore">Explore</Link>
      </div>
      <div className="sm-token-list">
        {tokens.length === 0 && <div className="sm-empty-line">No real Linkr launches yet.</div>}
        {tokens.map((token) => (
          <Link
            key={token.id}
            to="/coin/$mint"
            params={{ mint: token.mint ?? "" }}
            className="sm-token-row"
            data-disabled={!token.mint || undefined}
          >
            <span className="sm-token-avatar">
              {token.imageUrl ? <img src={token.imageUrl} alt="" /> : token.symbol.slice(0, 2)}
            </span>
            <span>
              <strong>${token.symbol}</strong>
              <small>
                {token.name} / {token.chain === "solana" ? "Solana" : "Robinhood"}
              </small>
            </span>
            <b>
              {token.marketCapUsd != null
                ? formatCompactUsd(token.marketCapUsd)
                : shortAddress(token.mint)}
            </b>
          </Link>
        ))}
      </div>
    </section>
  );
}
