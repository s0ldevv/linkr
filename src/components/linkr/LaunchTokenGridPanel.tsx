import type { ReactNode } from "react";
import { LaunchTokenCard } from "@/components/linkr/LaunchTokenCard";
import type { LaunchTokenCardData } from "@/lib/linkr/launch-token-card";

export function LaunchTokenGridPanel({
  action,
  cards,
  hasLiveLaunches,
}: {
  action?: ReactNode;
  cards: LaunchTokenCardData[];
  hasLiveLaunches: boolean;
}) {
  return (
    <section className="sm-launch-grid-panel" aria-label="Newly launched coins" data-fx="rise">
      <div className="sm-launch-grid-head">
        <div>
          <span>
            Newly launched coins <i /> {hasLiveLaunches ? "live" : "placeholders"}
          </span>
          <p>
            {hasLiveLaunches
              ? "Fresh Linkr launches, ordered by the newest activity."
              : "Placeholder launch cards are shown here until live coins arrive."}
          </p>
        </div>
        {action}
      </div>

      <div className="sm-launch-card-grid">
        {cards.map((coin, index) => (
          <LaunchTokenCard coin={coin} index={index} key={coin.id} />
        ))}
      </div>
    </section>
  );
}
