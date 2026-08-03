import { Link } from "@tanstack/react-router";
import { ArrowRight, Award, Wallet } from "lucide-react";
import type { HomeDashboardData, PublicAchievement } from "@/lib/linkr/home-data";
import { formatCompactNumber, formatCompactUsd } from "@/lib/linkr/home-data";
import { RelativeTime } from "./RelativeTime";
import { PLACEHOLDER_TRADERS, PLACEHOLDER_WALLETS } from "./terminal-data";

function TopUsersColumn({ data }: { data: HomeDashboardData | undefined }) {
  const real = data?.public.topTraders30d ?? [];
  const hasReal = real.length > 0;
  const rows = hasReal ? real : PLACEHOLDER_TRADERS;

  return (
    <section className="lkt-panel lkt-col lkt-col--purple" aria-label="Top users">
      <div className="lkt-col-head">
        <h3 className="lkt-col-title">Top Users (30d)</h3>
        {!hasReal && <span className="lkt-col-tag">Demo</span>}
      </div>
      <ul className="lkt-col-list">
        {rows.slice(0, 5).map((trader) => (
          <li key={`${trader.rank}-${trader.handle}`}>
            <Link
              className="lkt-rank lkt-rank--profile"
              to="/u/$username"
              params={{ username: trader.handle.replace(/^@/, "") }}
            >
              <span className="lkt-rank-pos">{trader.rank}</span>
              <span className="lkt-avatar" style={{ height: 30, width: 30 }} aria-hidden="true">
                {trader.avatar_url ? (
                  <img src={trader.avatar_url} alt="" loading="lazy" />
                ) : (
                  trader.handle.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="lkt-rank-name">@{trader.handle.replace(/^@/, "")}</span>
              <span className="lkt-rank-value">
                {(trader.actions ?? trader.trades).toLocaleString("en-US")} actions
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="lkt-col-foot">
        <a href="#trending" className="lkt-view-all">
          View Leaderboard
          <ArrowRight aria-hidden="true" size={13} strokeWidth={2.6} />
        </a>
      </div>
    </section>
  );
}

function TopWalletsColumn({ data }: { data: HomeDashboardData | undefined }) {
  const real = data?.public.topWallets30d ?? [];
  const hasReal = real.length > 0;
  const rows = hasReal ? real : PLACEHOLDER_WALLETS;

  return (
    <section className="lkt-panel lkt-col" id="wallets" aria-label="Top wallets">
      <div className="lkt-col-head">
        <h3 className="lkt-col-title">Top Wallets</h3>
        {!hasReal && <span className="lkt-col-tag">Demo</span>}
      </div>
      <ul className="lkt-col-list">
        {rows.slice(0, 5).map((wallet) => (
          <li key={`${wallet.rank}-${wallet.wallet}`}>
            <div className="lkt-rank">
              <span className="lkt-rank-pos">{wallet.rank}</span>
              <span className="lkt-wallet-icon" aria-hidden="true">
                <Wallet size={14} strokeWidth={2.2} />
              </span>
              <span className="lkt-rank-name lkt-mono">{wallet.wallet}</span>
              <span className="lkt-wallet-chain" data-chain={wallet.chain ?? "robinhood"}>
                {wallet.native_symbol ?? (wallet.chain === "solana" ? "SOL" : "ETH")}
              </span>
              <span className="lkt-rank-value">{formatCompactUsd(wallet.volume_usd)} volume</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="lkt-col-foot">
        <Link to="/activity" className="lkt-view-all">
          View All Wallets
          <ArrowRight aria-hidden="true" size={13} strokeWidth={2.6} />
        </Link>
      </div>
    </section>
  );
}

function achievementMetric(achievement: PublicAchievement) {
  const value = achievement.metric_value ?? achievement.threshold;
  return value == null ? null : formatCompactNumber(value);
}

function MilestonesColumn({ data }: { data: HomeDashboardData | undefined }) {
  const achievements = data?.public.recentAchievements ?? [];
  const spotlight = achievements[0] ?? null;
  const rows = achievements.slice(spotlight ? 1 : 0, spotlight ? 5 : 4);

  return (
    <section
      className="lkt-panel lkt-col lkt-col--lime lkt-milestones"
      aria-label="Recent milestones"
    >
      <div className="lkt-col-head">
        <h3 className="lkt-col-title">Recent Milestones</h3>
        <span className="lkt-col-tag">Database</span>
      </div>

      {spotlight ? (
        <div className="lkt-milestone-spotlight">
          <span className="lkt-milestone-icon" aria-hidden="true">
            <Award size={18} strokeWidth={2.4} />
          </span>
          <div>
            <span>{spotlight.kind}</span>
            <strong>{spotlight.title}</strong>
            <p>{spotlight.detail || "A public Linkr milestone was recorded."}</p>
          </div>
          <RelativeTime value={spotlight.achieved_at} />
        </div>
      ) : (
        <div className="lkt-milestone-empty">
          <span className="lkt-milestone-icon" aria-hidden="true">
            <Award size={18} strokeWidth={2.4} />
          </span>
          <strong>Milestones are warming up</strong>
          <p>Public achievements from the database will appear here as Linkr reaches them.</p>
        </div>
      )}

      <ul className="lkt-col-list">
        {rows.map((achievement) => (
          <li key={achievement.id}>
            <div className="lkt-milestone-row">
              <span className="lkt-milestone-dot" aria-hidden="true" />
              <span className="lkt-milestone-name">{achievement.title}</span>
              <span className="lkt-milestone-value">
                {achievementMetric(achievement) ?? <RelativeTime value={achievement.achieved_at} />}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="lkt-col-foot">
        <Link to="/activity" className="lkt-view-all">
          View activity
          <ArrowRight aria-hidden="true" size={13} strokeWidth={2.6} />
        </Link>
      </div>
    </section>
  );
}

export function TerminalRanks({ data }: { data: HomeDashboardData | undefined }) {
  return (
    <div className="lkt-triple lkt-triple--ranks">
      <TopUsersColumn data={data} />
      <TopWalletsColumn data={data} />
      <MilestonesColumn data={data} />
    </div>
  );
}
