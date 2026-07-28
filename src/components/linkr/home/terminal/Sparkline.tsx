import { useId, useMemo } from "react";
import { sparklinePath, sparklinePoints } from "./terminal-data";

type SparklineProps = {
  seedKey: string;
  drift?: number | null;
  color?: "lime" | "purple";
  height?: number;
};

export function Sparkline({ seedKey, drift = null, color = "lime", height = 34 }: SparklineProps) {
  const gradientId = useId();
  const width = 120;
  const stroke = color === "purple" ? "var(--lkt-purple)" : "var(--lkt-lime)";

  const path = useMemo(
    () => sparklinePath(sparklinePoints(seedKey, drift), width, height - 4),
    [seedKey, drift, height],
  );

  return (
    <svg
      className="lkt-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: "block", height, width: "100%" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${path} L ${width} ${height} L 0 ${height} Z`}
        fill={`url(#${gradientId})`}
        stroke="none"
      />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
