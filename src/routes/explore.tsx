import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TerminalCoinCard } from "@/components/linkr/home/terminal/TerminalCoinCard";
import { PLACEHOLDER_TOKENS } from "@/components/linkr/home/terminal/terminal-data";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import {
  PublicChainFilter,
  type PublicChainFilterValue,
} from "@/components/linkr/PublicChainFilter";
import { useHomeDashboardData } from "@/hooks/use-home-dashboard-data";
import { supabase } from "@/integrations/supabase/client";
import { isSolanaRecord } from "@/lib/linkr/chain-presentation";
import { relativeTime, formatEth } from "@/lib/linkr/format";
import type { PublicTokenRank } from "@/lib/linkr/home-data";
import type { Tables } from "@/integrations/supabase/types";
import "@/components/linkr/home/terminal/terminal-home.css";

type Launch = Tables<"coin_launches">;
type LaunchPreview = Pick<
  Launch,
  | "id"
  | "created_at"
  | "description"
  | "chain"
  | "launch_platform"
  | "launch_origin"
  | "launch_source"
  | "dev_buy_eth"
  | "dev_buy_sol"
  | "dev_buy_usd"
  | "image_url"
  | "mint"
  | "name"
  | "status"
  | "symbol"
  | "token_address"
  | "tx_signature"
>;
type BoardStat = {
  label: string;
  value: string;
  detail: string;
};
type ChainFilter = PublicChainFilterValue;
type LaunchCardRow = {
  isDemo: boolean;
  launchSource?: string | null;
  token: PublicTokenRank;
};

export const Route = createFileRoute("/explore")({
  head: () => ({ meta: [{ title: "Explore - Linkr" }] }),
  component: PublicExplorePage,
});

function PublicExplorePage() {
  const queryClient = useQueryClient();
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const homeQuery = useHomeDashboardData();

  const launchesQuery = useQuery({
    queryKey: ["public-live-launches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coin_launches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("public-live-launches")
      .on("postgres_changes", { event: "*", schema: "public", table: "coin_launches" }, () => {
        queryClient.invalidateQueries({ queryKey: ["public-live-launches"] });
        queryClient.invalidateQueries({ queryKey: ["home-dashboard-data"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const realLaunches = useMemo<LaunchPreview[]>(
    () => launchesQuery.data ?? [],
    [launchesQuery.data],
  );
  const homeTokens = useMemo(
    () =>
      [...(homeQuery.data?.public.topLaunchedTokens ?? [])].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      ),
    [homeQuery.data?.public.topLaunchedTokens],
  );
  const homeTokenLookup = useMemo(() => {
    const lookup = new Map<string, PublicTokenRank>();
    homeTokens.forEach((token) => {
      lookup.set(token.id, token);
      if (token.mint) lookup.set(token.mint.toLowerCase(), token);
    });
    return lookup;
  }, [homeTokens]);
  const launchRows = useMemo<LaunchCardRow[]>(() => {
    if (realLaunches.length > 0) {
      return realLaunches.map((launch) => {
        const tokenAddress = launch.token_address ?? launch.mint;
        const token =
          homeTokenLookup.get(launch.id) ??
          (tokenAddress ? homeTokenLookup.get(tokenAddress.toLowerCase()) : undefined) ??
          publicTokenFromLaunch(launch);

        return { isDemo: false, launchSource: launch.launch_source, token };
      });
    }

    if (homeTokens.length > 0) {
      return homeTokens.map((token) => ({ isDemo: false, token }));
    }

    return PLACEHOLDER_TOKENS.map((token) => ({ isDemo: true, token }));
  }, [homeTokenLookup, homeTokens, realLaunches]);
  const visibleRows = useMemo(
    () => filterRowsByChain(launchRows, chainFilter),
    [chainFilter, launchRows],
  );
  const stats = useMemo<BoardStat[]>(() => {
    const confirmed = visibleRows.filter(({ token }) =>
      ["confirmed", "completed", "success", "live"].includes((token.status ?? "").toLowerCase()),
    ).length;
    const queued = visibleRows.filter(({ token }) =>
      ["pending", "processing", "queued", "new"].includes((token.status ?? "").toLowerCase()),
    ).length;
    const devBuyEth = visibleRows.reduce((sum, { token }) => sum + (token.devBuyEth ?? 0), 0);
    const devBuySol = visibleRows.reduce((sum, { token }) => sum + (token.devBuySol ?? 0), 0);
    const latest = visibleRows[0]?.token;

    return [
      {
        label: "recorded",
        value: String(visibleRows.length),
        detail: visibleRows.some((row) => !row.isDemo)
          ? "live token launches"
          : "homepage placeholders",
      },
      {
        label: "confirmed",
        value: String(confirmed),
        detail: queued > 0 ? queued + " still settling" : "receipts cleared",
      },
      {
        label: "starter flow",
        value:
          devBuySol > 0
            ? `${formatEth(devBuyEth, 2)} ETH / ${devBuySol.toFixed(2)} SOL`
            : formatEth(devBuyEth, 2),
        detail: "native dev buys by chain",
      },
      {
        label: "latest",
        value: latest ? "$" + latest.symbol : "none",
        detail: latest ? relativeTime(latest.createdAt) : "waiting for first launch",
      },
    ];
  }, [visibleRows]);

  return (
    <div className="lkt-home min-h-screen sm-public-board-page sm-public-launches-page">
      <MarketingHeader />
      <main className="sm-public-launches-main">
        <div className="sm-public-board-shell sm-public-launches-summary">
          <section className="sm-public-metrics" aria-label="Launch stats">
            {stats.map((stat) => (
              <BoardStatCard key={stat.label} stat={stat} />
            ))}
          </section>

          <section className="sm-public-section-head" aria-labelledby="explore-gallery-title">
            <div>
              <span>Coin gallery</span>
              <h2 id="explore-gallery-title">Explore</h2>
              <p>Filter by chain without changing the token card layout used on the homepage.</p>
            </div>
          </section>
          <div className="sm-public-filter-toolbar">
            <PublicChainFilter
              active={chainFilter}
              ariaLabel="Filter tokens by chain"
              counts={cardCounts(launchRows)}
              onChange={setChainFilter}
            />
            <Link className="sm-public-launch-action" to="/launch">
              <Rocket aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>Launch</span>
            </Link>
          </div>
        </div>

        <section
          className="sm-public-board-shell sm-public-launch-card-section lkt-section-narrow"
          aria-busy={launchesQuery.isLoading || homeQuery.isLoading || undefined}
          aria-label="Explore token cards"
        >
          <div className="lkt-coin-grid">
            {visibleRows.map(({ isDemo, launchSource, token }) => (
              <div
                className="sm-public-launch-card-wrap"
                data-launch-source={launchSource ?? undefined}
                key={token.id}
              >
                {launchSource === "website" && (
                  <span className="sm-public-launch-source-badge">Website launch</span>
                )}
                <TerminalCoinCard isDemo={isDemo} token={token} />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function BoardStatCard({ stat }: { stat: BoardStat }) {
  return (
    <div className="sm-public-metric">
      <span>{stat.label}</span>
      <strong>{stat.value}</strong>
      <p>{stat.detail}</p>
    </div>
  );
}

function publicTokenFromLaunch(launch: LaunchPreview): PublicTokenRank {
  const tokenAddress = launch.token_address ?? launch.mint;

  return {
    chain: launch.chain,
    createdAt: launch.created_at,
    description: launch.description,
    devBuyEth: launch.dev_buy_eth,
    devBuySol: launch.dev_buy_sol,
    devBuyUsd: launch.dev_buy_usd,
    id: launch.id,
    imageUrl: launch.image_url,
    launchPlatform: launch.launch_platform,
    liquidityUsd: null,
    marketCapUsd: null,
    mint: tokenAddress,
    name: launch.name,
    pairUrl: null,
    priceChange24h: null,
    status: tokenStatusFromLaunchStatus(launch.status),
    symbol: launch.symbol,
    txSignature: launch.tx_signature,
  };
}

function tokenStatusFromLaunchStatus(status: string | null): PublicTokenRank["status"] {
  const normalized = (status ?? "").toLowerCase();
  // Only show as "new" if actually processing/pending
  if (
    ["processing", "pending", "queued", "created", "new"].some((value) =>
      normalized.includes(value),
    )
  ) {
    return "new";
  }
  // Only show as "live" if confirmed/completed successfully
  if (
    ["confirmed", "completed", "success", "live", "submitted", "posted"].some((value) =>
      normalized.includes(value),
    )
  ) {
    return "live";
  }
  // For failed/cancelled/expired, return the actual status so UI can handle appropriately
  if (
    ["failed", "cancelled", "expired", "error", "rejected"].some((value) =>
      normalized.includes(value),
    )
  ) {
    return normalized as PublicTokenRank["status"];
  }
  // Default to the normalized status
  return normalized as PublicTokenRank["status"];
}

function filterRowsByChain(rows: LaunchCardRow[], chainFilter: ChainFilter) {
  if (chainFilter === "all") return rows;
  return rows.filter(({ token }) => chainKeyForToken(token) === chainFilter);
}

function cardCounts(rows: LaunchCardRow[]): Record<ChainFilter, number> {
  return rows.reduce(
    (counts, { token }) => {
      counts.all += 1;
      counts[chainKeyForToken(token)] += 1;
      return counts;
    },
    { all: 0, robinhood: 0, solana: 0 },
  );
}

function chainKeyForToken(token: PublicTokenRank): Exclude<ChainFilter, "all"> {
  return isSolanaRecord(token) ? "solana" : "robinhood";
}
