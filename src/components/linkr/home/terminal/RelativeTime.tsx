import { useEffect, useMemo, useState } from "react";
import { relativeTime } from "@/lib/linkr/format";

type RelativeTimeProps = {
  className?: string;
  fallback?: string;
  value: Date | string | null | undefined;
};

function isoValue(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.toISOString();
}

export function RelativeTime({ className, fallback = "recently", value }: RelativeTimeProps) {
  const dateTime = useMemo(() => isoValue(value), [value]);
  const [hydrated, setHydrated] = useState(false);
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    const update = () => {
      setLabel(relativeTime(value) || fallback);
      setHydrated(true);
    };

    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, [fallback, value]);

  return (
    <time className={className} dateTime={hydrated ? dateTime : undefined}>
      {label}
    </time>
  );
}
