import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Rocket } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { PublicTokenRank } from "@/lib/linkr/home-data";
import "@/components/linkr/home/terminal/terminal-home.css";

type ChainFilter = PublicChainFilterValue;
type LaunchCardRow = {
  isDemo: boolean;
  launchSource?: string | null;
  token: PublicTokenRank;
};

const DEFAULT_CARDS_PER_ROW = 4;
const INITIAL_VISIBLE_CARD_ROWS = 5;
const ADDITIONAL_VISIBLE_CARD_ROWS = 2;

export const Route = createFileRoute("/explore")({
  head: () => ({ meta: [{ title: "Explore - Linkr" }] }),
  component: PublicExplorePage,
});

function PublicExplorePage() {
  const queryClient = useQueryClient();
  const coinGridRef = useRef<HTMLDivElement | null>(null);
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const [cardsPerRow, setCardsPerRow] = useState(DEFAULT_CARDS_PER_ROW);
  const [visibleCardRows, setVisibleCardRows] = useState(INITIAL_VISIBLE_CARD_ROWS);
  const homeQuery = useHomeDashboardData({ publicLaunchLimit: 60 });

  useEffect(() => {
    const channel = supabase
      .channel("public-live-launches")
      .on("postgres_changes", { event: "*", schema: "public", table: "coin_launches" }, () => {
        queryClient.invalidateQueries({ queryKey: ["home-dashboard-data"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const homeTokens = useMemo(
    () =>
      [...(homeQuery.data?.public.topLaunchedTokens ?? [])].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      ),
    [homeQuery.data?.public.topLaunchedTokens],
  );
  const launchRows = useMemo<LaunchCardRow[]>(() => {
    if (homeTokens.length > 0) {
      return homeTokens.map((token) => ({
        isDemo: false,
        launchSource: token.launchSource,
        token,
      }));
    }

    return PLACEHOLDER_TOKENS.map((token) => ({ isDemo: true, token }));
  }, [homeTokens]);
  const visibleRows = useMemo(
    () => filterRowsByChain(launchRows, chainFilter),
    [chainFilter, launchRows],
  );
  const visibleCardCount = Math.min(visibleRows.length, visibleCardRows * cardsPerRow);
  const pagedRows = useMemo(
    () => visibleRows.slice(0, visibleCardCount),
    [visibleCardCount, visibleRows],
  );
  const hiddenCardCount = visibleRows.length - visibleCardCount;
  const hasMoreRows = hiddenCardCount > 0;
  const nextRowsToReveal = Math.min(
    ADDITIONAL_VISIBLE_CARD_ROWS,
    Math.ceil(hiddenCardCount / cardsPerRow),
  );

  const syncCardsPerRow = useCallback(() => {
    setCardsPerRow(cardsPerRowFromGrid(coinGridRef.current));
  }, []);

  useEffect(() => {
    setVisibleCardRows(INITIAL_VISIBLE_CARD_ROWS);
  }, [chainFilter]);

  useEffect(() => {
    syncCardsPerRow();

    const grid = coinGridRef.current;
    if (!grid || typeof window === "undefined") return;

    const observer = "ResizeObserver" in window ? new ResizeObserver(syncCardsPerRow) : undefined;
    observer?.observe(grid);
    window.addEventListener("resize", syncCardsPerRow);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncCardsPerRow);
    };
  }, [syncCardsPerRow]);

  return (
    <div className="lkt-home min-h-screen sm-public-board-page sm-public-launches-page sm-public-explore-page">
      <MarketingHeader />
      <main className="sm-public-launches-main">
        <div className="sm-public-board-shell sm-public-launches-summary">
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
          aria-busy={homeQuery.isLoading || undefined}
          aria-label="Explore token cards"
        >
          <div className="lkt-coin-grid" ref={coinGridRef}>
            {pagedRows.map(({ isDemo, launchSource, token }) => (
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
          {hasMoreRows && (
            <div className="sm-public-launch-card-actions">
              <button
                type="button"
                className="lkt-view-all sm-public-launch-view-more"
                aria-label={`View ${nextRowsToReveal} more rows of launched coins`}
                onClick={() =>
                  setVisibleCardRows((currentRows) => currentRows + ADDITIONAL_VISIBLE_CARD_ROWS)
                }
              >
                <span>View more</span>
                <ChevronDown aria-hidden="true" size={14} strokeWidth={2.6} />
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function filterRowsByChain(rows: LaunchCardRow[], chainFilter: ChainFilter) {
  if (chainFilter === "all") return rows;
  return rows.filter(({ token }) => chainKeyForToken(token) === chainFilter);
}

function cardsPerRowFromGrid(grid: HTMLDivElement | null): number {
  if (!grid || typeof window === "undefined") return DEFAULT_CARDS_PER_ROW;

  const renderedCards = Array.from(grid.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  const firstCardTop = renderedCards[0]?.offsetTop;
  if (typeof firstCardTop === "number") {
    const firstNextRowIndex = renderedCards.findIndex(
      (element) => element.offsetTop !== firstCardTop,
    );
    return Math.max(1, firstNextRowIndex > 0 ? firstNextRowIndex : renderedCards.length);
  }

  const templateColumns = window.getComputedStyle(grid).gridTemplateColumns;
  const columnCount = templateColumns
    .split(/\s+/)
    .filter((column) => column && column !== "none").length;

  return Math.max(1, columnCount || DEFAULT_CARDS_PER_ROW);
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
