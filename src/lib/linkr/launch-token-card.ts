import { chainPresentationForRecord, type ChainTone } from "@/lib/linkr/chain-presentation";
import { relativeTime } from "@/lib/linkr/format";
import { formatCompactUsd, type PublicTokenRank } from "@/lib/linkr/home-data";

export type LaunchTokenCardData = {
  age: string;
  chainLabel?: string;
  chainTone?: ChainTone;
  href: string;
  id: string;
  imageUrl?: string | null;
  isLive: boolean;
  marketCap: string;
  mint?: string | null;
  name: string;
  placeholder: boolean;
  sparkline: number[];
  status: string;
  statusTone: "live" | "new" | "trending";
  symbol: string;
};

export function launchTokenCardFromPublicToken(token: PublicTokenRank): LaunchTokenCardData {
  const change = token.priceChange24h ?? 0;
  const status = launchStatusFromToken(token, change);
  const chain = chainPresentationForRecord(token);

  return {
    age: relativeTime(token.createdAt),
    chainLabel: chain.shortLabel,
    chainTone: chain.chain,
    href: token.mint ? `/coin/${token.mint}` : "/explore",
    id: token.id,
    imageUrl: token.imageUrl,
    isLive: status.isLive,
    marketCap:
      token.marketCapUsd != null
        ? formatCompactUsd(token.marketCapUsd)
        : token.liquidityUsd != null
          ? formatCompactUsd(token.liquidityUsd)
          : "--",
    mint: token.mint,
    name: token.name,
    placeholder: false,
    sparkline: sparklineFromPublicToken(token),
    status: status.status,
    statusTone: status.tone,
    symbol: token.symbol,
  };
}

export function sparklineFromCardSeed(seedValue: string, slopeValue = 8) {
  const seed = Array.from(seedValue).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length: 12 }, (_, index) => {
    const wave = Math.sin((seed + index * 31) * 0.18) * 12;
    const slope = index * Math.max(-2, Math.min(4, slopeValue / 8));
    return Math.max(12, Math.min(88, 34 + wave + slope));
  });
}

function launchStatusFromToken(
  token: PublicTokenRank,
  change: number,
): {
  status: string;
  tone: LaunchTokenCardData["statusTone"];
  isLive: boolean;
} {
  const normalized = (token.status || "").toLowerCase();

  // Check if actually live (tradeable)
  const isLive = ["confirmed", "completed", "success", "live", "submitted", "posted"].some((s) =>
    normalized.includes(s),
  );

  // Check if pending/processing
  const isPending = ["processing", "pending", "queued", "created", "new"].some((s) =>
    normalized.includes(s),
  );

  // If token has no mint, always show as Pending regardless of status
  if (!token.mint) {
    return { status: "Pending", tone: "new", isLive: false };
  }

  if (isPending) {
    return { status: "Pending", tone: "new", isLive: false };
  }

  if (isLive) {
    if (change >= 15) return { status: "Trending", tone: "trending", isLive: true };
    return { status: "Live", tone: "live", isLive: true };
  }

  // For failed/cancelled - still show as Pending but could add different handling
  return { status: "Pending", tone: "new", isLive: false };
}

function sparklineFromPublicToken(token: PublicTokenRank) {
  return sparklineFromCardSeed(`${token.symbol}${token.name}`, token.priceChange24h ?? 8);
}
