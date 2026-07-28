import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import type { PublicTokenRank } from "@/lib/linkr/home-data";
import { formatCompactUsd } from "@/lib/linkr/home-data";
import { chainPresentationForRecord } from "@/lib/linkr/chain-presentation";
import { shortAddress } from "@/lib/linkr/format";
import { RobinhoodLogo, SolanaLogo } from "@/components/linkr/ChainLogos";
import { Sparkline } from "./Sparkline";
import { badgeForToken } from "./terminal-data";
import { Check, Copy } from "lucide-react";

const BADGE_LABELS: Record<string, string> = {
  demo: "Demo",
  live: "Live",
  new: "New",
  pending: "Pending",
  trending: "Trending",
};

function compactRelativeAge(value: Date | string | null | undefined): string {
  if (!value) return "--";
  const parsed = typeof value === "string" ? new Date(value) : value;
  const ms = Date.now() - parsed.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "now";

  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}hr`;

  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;

  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo`;

  const year = Math.floor(month / 12);
  return `${year}y`;
}

function useLiveRelativeAge(value: Date | string | null | undefined) {
  const [label, setLabel] = useState("--");

  useEffect(() => {
    const update = () => setLabel(compactRelativeAge(value));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [value]);

  return label;
}

export function TerminalCoinCard({ isDemo, token }: { isDemo: boolean; token: PublicTokenRank }) {
  const badge = badgeForToken(token, isDemo);
  const chain = chainPresentationForRecord(token);
  const navigate = useNavigate();
  const coinHref = token.mint ? `/coin/${token.mint}` : null;
  const sparkColor = badge === "trending" ? "purple" : "lime";
  const ageLabel = useLiveRelativeAge(token.createdAt);
  const truncatedMint = token.mint ? shortAddress(token.mint, 5, 5) : null;
  const [copiedMint, setCopiedMint] = useState(false);
  const copyResetTimeout = useRef<number | null>(null);

  const handleCardOpen = () => {
    if (!coinHref) return;
    if (token.mint) {
      navigate({ to: "/coin/$mint", params: { mint: token.mint } });
    }
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!coinHref || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    handleCardOpen();
  };

  const handleCopyMint = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!token.mint) return;
    await navigator.clipboard.writeText(token.mint);
    setCopiedMint(true);

    if (copyResetTimeout.current != null) {
      window.clearTimeout(copyResetTimeout.current);
    }
    copyResetTimeout.current = window.setTimeout(() => {
      setCopiedMint(false);
    }, 1200);
  };

  useEffect(() => {
    return () => {
      if (copyResetTimeout.current != null) {
        window.clearTimeout(copyResetTimeout.current);
      }
    };
  }, []);

  const cardContent = (
    <>
      <div className="lkt-coin-top">
        <span className="lkt-coin-avatar-wrap" aria-hidden="true">
          <span className="lkt-avatar" aria-hidden="true">
            {token.imageUrl ? (
              <img src={token.imageUrl} alt="" loading="lazy" />
            ) : (
              token.symbol.slice(0, 2).toUpperCase()
            )}
          </span>
          <span className="lkt-coin-chain-badge">
            <span
              aria-label={chain.label}
              className="lkt-coin-chain-logo"
              data-chain={chain.chain}
              title={chain.label}
            >
              {chain.chain === "solana" ? <SolanaLogo /> : <RobinhoodLogo />}
            </span>
          </span>
        </span>
        <div className="lkt-coin-id">
          <span className="lkt-coin-symbol">${token.symbol}</span>
          <span className="lkt-coin-name">{token.name}</span>
          <div className="lkt-coin-meta-row">
            <span className="lkt-coin-mint">
              {truncatedMint ? (
                <code>{truncatedMint}</code>
              ) : (
                <span aria-label="No mint address">No mint</span>
              )}
              {truncatedMint && (
                <button
                  type="button"
                  className="lkt-coin-mint-copy"
                  data-copied={copiedMint ? "true" : "false"}
                  aria-label="Copy mint"
                  onClick={handleCopyMint}
                >
                  {copiedMint ? <Check size={14} strokeWidth={2.4} /> : <Copy size={13} />}
                </button>
              )}
            </span>
            <time className="lkt-coin-age" dateTime={token.createdAt}>
              {ageLabel}
            </time>
          </div>
        </div>
        <span className={`lkt-badge lkt-badge--${badge}`}>
          {badge !== "demo" && <span className="lkt-dot" aria-hidden="true" />}{" "}
          {BADGE_LABELS[badge]}
        </span>
      </div>

      <div className="lkt-coin-market">
        <div>
          <span className="lkt-coin-mcap-label">MCAP</span>
          <span className="lkt-coin-mcap">
            {token.marketCapUsd != null ? formatCompactUsd(token.marketCapUsd) : "--"}
          </span>
        </div>
        <div className="lkt-coin-spark">
          <Sparkline seedKey={token.id} drift={token.priceChange24h} color={sparkColor} />
        </div>
      </div>
    </>
  );

  if (!coinHref) {
    return (
      <article className="lkt-coin-card" data-demo={isDemo}>
        {cardContent}
      </article>
    );
  }

  return (
    <article
      className="lkt-coin-card lkt-coin-card--linkable"
      data-demo={isDemo}
      role="link"
      tabIndex={0}
      onClick={handleCardOpen}
      onKeyDown={handleCardKeyDown}
    >
      {cardContent}
    </article>
  );
}
