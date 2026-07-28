import { ArrowUpRight, Radio } from "lucide-react";
import { relativeTime, shortAddress } from "@/lib/linkr/format";
import type { HeroFeedItem } from "@/lib/linkr/home-data";
import { ChainPill } from "@/components/linkr/ChainPill";

export function HeroLiveFeed({
  error,
  items,
  loading,
}: {
  error?: Error | null;
  items: HeroFeedItem[];
  loading?: boolean;
}) {
  const [featuredItem, ...restItems] = items;
  const visibleItems = restItems.slice(0, 3);
  const stateMessage = loading
    ? "Loading live activity..."
    : error
      ? "Live activity is unavailable right now."
      : "No real Linkr activity has been published yet.";

  return (
    <section className="sm-live-activity" aria-label="Live Linkr activity">
      <div className="sm-live-activity-inner">
        <header className="sm-live-activity-head">
          <div className="sm-live-activity-title">
            <span className="sm-live-activity-kicker">
              <Radio aria-hidden="true" size={16} />
              Live activity
            </span>
            <h2>Signed from replies.</h2>
          </div>
          <div className="sm-live-activity-copy">
            <p>Launches, trades, transfers, and reward receipts as they land on the public tape.</p>
            <a className="sm-live-activity-link" href="/activity">
              View timeline
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
          </div>
        </header>

        <div className="sm-live-activity-board">
          {featuredItem ? (
            <article className="sm-live-activity-feature" data-tone={featuredItem.tone}>
              <div className="sm-live-activity-feature-top">
                <div className="sm-live-activity-avatar">
                  {featuredItem.avatarImageUrl ? (
                    <img src={featuredItem.avatarImageUrl} alt="" />
                  ) : (
                    featuredItem.avatarLabel
                  )}
                </div>
                <div>
                  <span>Latest action</span>
                  <strong>{relativeTime(featuredItem.timestamp)}</strong>
                </div>
              </div>
              <h3>{featuredItem.title}</h3>
              <p>{featuredItem.body}</p>
              <div className="sm-live-activity-feature-foot">
                {featuredItem.chainLabel && (
                  <ChainPill
                    chain={featuredItem.chainTone}
                    iconOnly
                    label={featuredItem.chainLabel}
                  />
                )}
                {featuredItem.status && <span>{featuredItem.status}</span>}
                {featuredItem.reference && (
                  <code>{shortAddress(featuredItem.reference, 5, 5)}</code>
                )}
              </div>
            </article>
          ) : (
            <div className="sm-live-activity-feature sm-live-activity-empty">{stateMessage}</div>
          )}

          <div className="sm-live-activity-list">
            {visibleItems.length === 0 && featuredItem && (
              <div className="sm-live-activity-state">{stateMessage}</div>
            )}
            {visibleItems.map((item) => (
              <article key={item.id} className="sm-live-activity-row" data-tone={item.tone}>
                <div className="sm-live-activity-row-main">
                  <div className="sm-live-activity-row-meta">
                    <strong>{item.actorLabel}</strong>
                    {item.actorHandle && <span>{item.actorHandle}</span>}
                    <span>{relativeTime(item.timestamp)}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
                <div className="sm-live-activity-row-side">
                  {item.chainShortLabel && (
                    <ChainPill chain={item.chainTone} iconOnly label={item.chainLabel} />
                  )}
                  {item.status && <span>{item.status}</span>}
                  {item.reference && <code>{shortAddress(item.reference, 5, 5)}</code>}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
