import { Award } from "lucide-react";
import type { PublicAchievement } from "@/lib/linkr/home-data";
import { formatCompactNumber } from "@/lib/linkr/home-data";
import { relativeTime } from "@/lib/linkr/format";

export function HomeAchievements({ achievements }: { achievements: PublicAchievement[] }) {
  return (
    <section className="sm-dashboard-card">
      <div className="sm-card-head">
        <h2>Recent Achievements</h2>
      </div>
      <div className="sm-achievement-list">
        {achievements.length === 0 && (
          <div className="sm-empty-line">No public milestones yet.</div>
        )}
        {achievements.map((achievement) => (
          <div key={achievement.id} className="sm-achievement-row">
            <span>
              <Award aria-hidden="true" size={18} />
            </span>
            <div>
              <strong>{achievement.title}</strong>
              <small>
                {achievement.detail || achievement.kind}
                {achievement.metric_value != null
                  ? ` / ${formatCompactNumber(achievement.metric_value)}`
                  : ""}
              </small>
            </div>
            <time>{relativeTime(achievement.achieved_at)}</time>
          </div>
        ))}
      </div>
    </section>
  );
}
