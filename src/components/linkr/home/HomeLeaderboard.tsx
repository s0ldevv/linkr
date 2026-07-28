import { Link } from "@tanstack/react-router";
import type { PublicTraderRank } from "@/lib/linkr/home-data";
import { formatCompactNumber, formatCompactUsd } from "@/lib/linkr/home-data";

export function HomeLeaderboard({ traders }: { traders: PublicTraderRank[] }) {
  return (
    <section className="sm-dashboard-card" id="leaderboard">
      <div className="sm-card-head">
        <h2>Top Traders (30D)</h2>
        <a href="/activity">View All</a>
      </div>
      <div className="sm-table-list">
        {traders.length === 0 && (
          <div className="sm-empty-line">No completed trades in the last 30 days.</div>
        )}
        {traders.map((trader) => (
          <Link
            key={trader.handle}
            className="sm-rank-row"
            to="/u/$username"
            params={{ username: trader.handle.replace(/^@/, "") }}
          >
            <span>{trader.rank}</span>
            <strong>@{trader.handle}</strong>
            <small>{formatCompactNumber(trader.trades)} trades</small>
            <b>{formatCompactUsd(trader.volume_usd)}</b>
          </Link>
        ))}
      </div>
    </section>
  );
}
