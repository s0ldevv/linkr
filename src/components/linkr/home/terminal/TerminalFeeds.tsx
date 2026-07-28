import { Link } from "@tanstack/react-router";
import { ArrowRight, Receipt } from "lucide-react";
import type { HomeDashboardData, PublicTokenRank } from "@/lib/linkr/home-data";
import { formatCompactUsd, formatSignedPercent } from "@/lib/linkr/home-data";
import { shortAddress } from "@/lib/linkr/format";
import { ChainPill } from "@/components/linkr/ChainPill";
import { ProfileHandleLink, ProfileLinkedText } from "@/components/linkr/ProfileHandleLink";
import { isLinkrHandle, normalizeProfileHandle } from "@/lib/linkr/profile-links";
import { RelativeTime } from "./RelativeTime";
import { Sparkline } from "./Sparkline";
import { PLACEHOLDER_TOKENS, blockscoutTx, postsFromFeed, receiptsFromFeed } from "./terminal-data";

function initials(handle: string): string {
  return handle.replace("@", "").slice(0, 2).toUpperCase();
}

function PostCard({ post }: { post: ReturnType<typeof postsFromFeed>[number] }) {
  return (
    <div className="lkt-post">
      <span className="lkt-avatar" style={{ height: 32, width: 32 }} aria-hidden="true">
        {post.avatarUrl ? <img src={post.avatarUrl} alt="" /> : initials(post.handle)}
      </span>
      <div className="lkt-post-body">
        <div className="lkt-post-meta">
          <ProfileHandleLink className="lkt-post-handle" handle={post.handle}>
            {post.handle}
          </ProfileHandleLink>
          <RelativeTime className="lkt-post-time" value={post.timestamp} />
          {post.url && (
            <a className="lkt-post-open" href={post.url} target="_blank" rel="noreferrer">
              Open
            </a>
          )}
        </div>
        <p className="lkt-post-text">
          <ProfileLinkedText text={post.text} />
        </p>
      </div>
    </div>
  );
}

function PostsColumn({ data }: { data: HomeDashboardData | undefined }) {
  const posts = postsFromFeed(data);
  const isDemo = posts.every((post) => post.isDemo);

  return (
    <section className="lkt-panel lkt-col" id="posts" aria-label="Live posts and questions">
      <div className="lkt-col-head">
        <h3 className="lkt-col-title">Live Posts &amp; Questions</h3>
        <span className="lkt-live-chip">
          <span className="lkt-dot" aria-hidden="true" />
          {isDemo ? "Demo" : "Live"}
        </span>
      </div>
      <ul className="lkt-col-list">
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>
      <div className="lkt-col-foot">
        <Link to="/activity" className="lkt-view-all">
          View All Posts
          <ArrowRight aria-hidden="true" size={13} strokeWidth={2.6} />
        </Link>
      </div>
    </section>
  );
}

function ReceiptsColumn({ data }: { data: HomeDashboardData | undefined }) {
  const receipts = receiptsFromFeed(data);
  const isDemo = receipts.every((receipt) => receipt.isDemo);

  return (
    <section className="lkt-panel lkt-col" id="receipts" aria-label="Action results and receipts">
      <div className="lkt-col-head">
        <h3 className="lkt-col-title">Action Results / Receipts</h3>
        <span className="lkt-live-chip">
          <span className="lkt-dot" aria-hidden="true" />
          {isDemo ? "Demo" : "Live"}
        </span>
      </div>
      <ul className="lkt-col-list">
        {receipts.map((receipt) => (
          <li key={receipt.id}>
            <div className="lkt-receipt">
              <div className="lkt-receipt-top">
                <span className="lkt-receipt-icon" aria-hidden="true">
                  <Receipt size={13} strokeWidth={2.4} />
                </span>
                <span className="lkt-receipt-title">{receipt.title}</span>
                <span className={`lkt-badge lkt-badge--${badgeForStatus(receipt.status)}`}>
                  {receipt.status}
                </span>
                {receipt.chainLabel && (
                  <ChainPill
                    chain={receipt.chainTone}
                    className="lkt-chain-pill"
                    iconOnly
                    label={receipt.chainLabel}
                  />
                )}
              </div>
              <div className="lkt-receipt-sub">
                <span
                  className="lkt-receipt-profile-stamp"
                  onClick={() => openProfileForHandle(receipt.handle)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openProfileForHandle(receipt.handle);
                    }
                  }}
                  role={isProfileHandle(receipt.handle) ? "link" : undefined}
                  tabIndex={isProfileHandle(receipt.handle) ? 0 : undefined}
                >
                  {receipt.handle} - <RelativeTime value={receipt.timestamp} />
                </span>
                {receipt.txSignature ? (
                  <a href={blockscoutTx(receipt.txSignature)} target="_blank" rel="noreferrer">
                    TX: {shortAddress(receipt.txSignature, 4, 4)}
                  </a>
                ) : (
                  <span>TX: --</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="lkt-col-foot">
        <Link to="/activity" className="lkt-view-all">
          View All Receipts
          <ArrowRight aria-hidden="true" size={13} strokeWidth={2.6} />
        </Link>
      </div>
    </section>
  );
}

function badgeForStatus(status: string): string {
  if (status === "executed") return "executed";
  if (status === "active") return "active";
  if (status === "failed") return "failed";
  return "executed";
}

function isProfileHandle(handle: string | null | undefined): boolean {
  return Boolean(normalizeProfileHandle(handle) && !isLinkrHandle(handle));
}

function openProfileForHandle(handle: string | null | undefined) {
  const username = normalizeProfileHandle(handle);
  if (!username || isLinkrHandle(username)) return;
  window.location.assign(`/u/${encodeURIComponent(username)}`);
}

function TrendingColumn({ tokens }: { tokens: PublicTokenRank[] | undefined }) {
  const hasReal = (tokens?.length ?? 0) > 0;
  const source = hasReal ? (tokens as PublicTokenRank[]) : PLACEHOLDER_TOKENS;
  const rows = [...source]
    .sort((a, b) => (b.priceChange24h ?? -Infinity) - (a.priceChange24h ?? -Infinity))
    .slice(0, 5);

  return (
    <section className="lkt-panel lkt-col" id="trending" aria-label="Trending tokens">
      <div className="lkt-col-head">
        <h3 className="lkt-col-title">Trending Tokens</h3>
        <span className="lkt-col-tag">24h</span>
      </div>
      <ul className="lkt-col-list">
        {rows.map((token, index) => (
          <li key={token.id}>
            <div className="lkt-trend">
              <span className="lkt-trend-rank">{index + 1}</span>
              <span className="lkt-avatar" style={{ height: 30, width: 30 }} aria-hidden="true">
                {token.imageUrl ? (
                  <img src={token.imageUrl} alt="" loading="lazy" />
                ) : (
                  token.symbol.slice(0, 2).toUpperCase()
                )}
              </span>
              <div className="lkt-trend-id">
                <span className="lkt-trend-symbol">${token.symbol}</span>
                <span className="lkt-trend-name">{token.name}</span>
              </div>
              <div className="lkt-trend-spark">
                <Sparkline seedKey={`trend-${token.id}`} drift={token.priceChange24h} height={26} />
              </div>
              <div className="lkt-trend-nums">
                <span className="lkt-trend-mcap">
                  {token.marketCapUsd != null ? formatCompactUsd(token.marketCapUsd) : "--"}
                </span>
                <span className="lkt-trend-change" data-negative={(token.priceChange24h ?? 0) < 0}>
                  {formatSignedPercent(token.priceChange24h) ?? "--"}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="lkt-col-foot">
        <Link to="/explore" className="lkt-view-all">
          View All
          <ArrowRight aria-hidden="true" size={13} strokeWidth={2.6} />
        </Link>
      </div>
    </section>
  );
}

export function TerminalFeeds({ data }: { data: HomeDashboardData | undefined }) {
  return (
    <div className="lkt-triple lkt-triple--feeds">
      <PostsColumn data={data} />
      <ReceiptsColumn data={data} />
      <TrendingColumn tokens={data?.public.topLaunchedTokens} />
    </div>
  );
}
