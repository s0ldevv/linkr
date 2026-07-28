export function shortAddress(addr: string | null | undefined, head = 4, tail = 4): string {
  if (!addr) return "--";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

export function formatEth(value: number | string | null | undefined, digits = 4): string {
  if (value == null) return "0";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatUsd(value: number | string | null | undefined): string {
  if (value == null) return "$0.00";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function bpsToPercent(bps: number | null | undefined): string {
  if (!bps) return "0%";
  return `${(bps / 100).toFixed(2)}%`;
}

export function relativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
