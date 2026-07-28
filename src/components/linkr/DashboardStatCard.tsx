import type { ReactNode } from "react";

type DashboardStatCardProps = {
  detail?: string;
  icon?: ReactNode;
  label: string;
  value: string;
};

export function DashboardStatCard({ detail, icon, label, value }: DashboardStatCardProps) {
  return (
    <div className="sm-card app-dashboard-card app-dashboard-launch-stat">
      {icon && <span>{icon}</span>}
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {detail && <em>{detail}</em>}
      </div>
    </div>
  );
}
