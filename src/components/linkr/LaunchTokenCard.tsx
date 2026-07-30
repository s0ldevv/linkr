import { ArrowRight, Eye } from "lucide-react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { ChainPill } from "@/components/linkr/ChainPill";
import { TokenMintCopy } from "@/components/linkr/TokenMintCopy";
import type { LaunchTokenCardData } from "@/lib/linkr/launch-token-card";
import { normalizeProfileHandle } from "@/lib/linkr/profile-links";
import { xIntent } from "@/lib/linkr/home-data";

export function LaunchTokenCard({ coin, index }: { coin: LaunchTokenCardData; index: number }) {
  const launcherUsername = normalizeProfileHandle(coin.launcherHandle);

  return (
    <article
      className="sm-launch-token-card"
      data-placeholder={coin.placeholder || undefined}
      style={{ "--coin-index": index } as CSSProperties}
    >
      <div className="sm-launch-token-top">
        <span className="sm-launch-token-avatar">
          {coin.imageUrl ? <img src={coin.imageUrl} alt="" /> : coin.symbol.slice(0, 2)}
        </span>
        <span className="sm-launch-token-name">
          <strong>${coin.symbol}</strong>
          <small>{coin.name}</small>
          {launcherUsername && (
            <Link
              className="sm-launch-token-launcher"
              to="/u/$username"
              params={{ username: launcherUsername }}
            >
              by @{launcherUsername}
            </Link>
          )}
          <TokenMintCopy mint={coin.mint} />
        </span>
        <ChainPill chain={coin.chainTone} iconOnly label={coin.chainLabel} />
        <span className={`sm-launch-status`} data-tone={coin.statusTone}>
          <i />
          {coin.status}
        </span>
      </div>

      <div className="sm-launch-token-meta">
        <span>{coin.age}</span>
      </div>

      <div className="sm-launch-token-market">
        <span>MCAP</span>
        <strong>{coin.marketCap}</strong>
      </div>

      <Sparkline values={coin.sparkline} />

      <div className="sm-launch-token-actions">
        {coin.isLive && coin.mint ? (
          <>
            <Link to="/coin/$mint" params={{ mint: coin.mint }} className="sm-launch-btn">
              <Eye aria-hidden="true" size={14} />
              View
            </Link>
            <Link to="/coin/$mint" params={{ mint: coin.mint }} className="sm-launch-btn">
              Buy
            </Link>
          </>
        ) : (
          <>
            <span className="sm-launch-btn sm-launch-btn--disabled" aria-disabled="true">
              <Eye aria-hidden="true" size={14} />
              View
            </span>
            <span className="sm-launch-btn sm-launch-btn--disabled" aria-disabled="true">
              Buy
            </span>
          </>
        )}
        <a href={xIntent(`@linkrbot track $${coin.symbol}`)} rel="noreferrer" target="_blank">
          Track
        </a>
        {coin.isLive && coin.mint ? (
          <Link aria-label={`Open ${coin.symbol}`} to="/coin/$mint" params={{ mint: coin.mint }}>
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        ) : (
          <span aria-label={`${coin.symbol} pending`} className="sm-launch-btn--disabled">
            <ArrowRight aria-hidden="true" size={14} />
          </span>
        )}
      </div>
    </article>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const width = 120;
  const height = 44;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - 7 - ((value - min) / range) * (height - 14);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className="sm-launch-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}
