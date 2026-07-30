import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Rocket,
  Sparkles,
} from "lucide-react";
import { ChainPill } from "@/components/linkr/ChainPill";
import { DashboardStatCard } from "@/components/linkr/DashboardStatCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { chainPresentationForRecord } from "@/lib/linkr/chain-presentation";
import { formatEth, formatUsd, relativeTime, shortAddress } from "@/lib/linkr/format";
import type { Tables } from "@/integrations/supabase/types";

type Launch = Tables<"coin_launches">;

export const Route = createFileRoute("/_authenticated/app/explore")({
  head: () => ({ meta: [{ title: "Explore - Linkr" }] }),
  component: ExplorePage,
});

function ExplorePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const launchesQuery = useQuery({
    queryKey: ["live-launches", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coin_launches")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("live-launches-" + user.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "coin_launches",
          filter: "user_id=eq." + user.id,
        },
        () => queryClient.invalidateQueries({ queryKey: ["live-launches", user.id] }),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user]);

  const launches = useMemo(() => launchesQuery.data ?? [], [launchesQuery.data]);
  const featured = launches[0];
  const stats = useMemo(() => buildLaunchStats(launches), [launches]);

  return (
    <div className="app-dashboard-page app-dashboard-launches-page">
      <header className="app-live-hero app-dashboard-hero app-dashboard-launches-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Token launches</p>
          <h1>Explore</h1>
          <p>
            Track Robinhood Chain launches and Solana Pump.fun launches in one dashboard, with each
            chain clearly labeled from request through confirmation.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Launch monitor status">
          <span />
          live monitor
        </div>
      </header>

      <section className="app-dashboard-launch-stats" aria-label="Launch stats">
        <DashboardStatCard label="Total" value={String(launches.length)} icon={<Rocket />} />
        <DashboardStatCard
          label="Confirmed"
          value={String(stats.confirmed)}
          icon={<CheckCircle2 />}
        />
        <DashboardStatCard label="Pending" value={String(stats.pending)} icon={<Clock3 />} />
        <DashboardStatCard
          label="Robinhood"
          value={String(stats.robinhood)}
          detail="ETH launches"
        />
        <DashboardStatCard label="Solana" value={String(stats.solana)} detail="Pump.fun launches" />
      </section>

      {launchesQuery.isLoading ? (
        <section className="sm-card app-dashboard-card app-dashboard-launch-empty">
          <Clock3 className="h-8 w-8" />
          <div>
            <h2>Loading launches</h2>
            <p>Checking your launch history.</p>
          </div>
        </section>
      ) : launches.length === 0 ? (
        <section className="sm-card app-dashboard-card app-dashboard-launch-empty">
          <Sparkles className="h-8 w-8" />
          <div>
            <h2>No launches yet</h2>
            <p>Coins launched from X replies or the Agent API will appear here.</p>
          </div>
          <Button asChild className="app-dashboard-launch-primary">
            <a
              href="https://x.com/intent/post?text=%40linkrbot%20launch%20%24TOKEN%20on%20Solana%20with%20this%20image"
              target="_blank"
              rel="noreferrer"
            >
              Launch from X <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </section>
      ) : (
        <>
          {featured && <FeaturedLaunch launch={featured} />}

          <section className="sm-card app-dashboard-card app-dashboard-launch-list">
            <div className="app-dashboard-card-head app-dashboard-section-head app-dashboard-launch-list-head">
              <div>
                <h2>Explore</h2>
                <p className="app-dashboard-section-copy">
                  Recent token launches requested from X or the Agent API.
                </p>
              </div>
            </div>

            <div className="app-dashboard-launch-grid">
              {launches.map((launch) => (
                <LaunchCard key={launch.id} launch={launch} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FeaturedLaunch({ launch }: { launch: Launch }) {
  const tokenAddress = launch.token_address ?? launch.mint;
  const openHref = externalLaunchHref(launch);

  return (
    <section className="sm-card app-dashboard-card app-dashboard-launch-feature">
      <LaunchArt launch={launch} large />
      <div className="app-dashboard-launch-feature-copy">
        <div className="app-dashboard-launch-meta-line">
          <ChainBadge launch={launch} />
          <Status status={launch.status} />
          <span>{relativeTime(launch.created_at)}</span>
        </div>
        <h2>${launch.symbol}</h2>
        <p>{launch.description || launch.name}</p>
        <div className="app-dashboard-launch-detail-grid">
          <Detail label="Dev buy" value={formatLaunchDevBuy(launch)} />
          <Detail
            label={chainPresentationForRecord(launch).addressLabel}
            value={shortAddress(tokenAddress, 6, 6)}
            mono
          />
          <Detail
            label="Tx"
            value={shortAddress(launch.tx_hash ?? launch.tx_signature, 6, 6)}
            mono
          />
        </div>
      </div>
      <div className="app-dashboard-launch-feature-actions">
        {tokenAddress ? (
          <Button asChild className="app-dashboard-launch-primary">
            <Link to="/coin/$mint" params={{ mint: tokenAddress }}>
              Open coin <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <span className="app-dashboard-launch-disabled">Queued</span>
        )}
        {openHref && (
          <Button asChild variant="outline" className="app-dashboard-launch-secondary">
            <a href={openHref} target="_blank" rel="noreferrer">
              Explorer <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
    </section>
  );
}

function LaunchCard({ launch }: { launch: Launch }) {
  const tokenAddress = launch.token_address ?? launch.mint;
  const href = externalLaunchHref(launch);

  return (
    <article className="app-dashboard-launch-card">
      <div className="app-dashboard-launch-card-top">
        <LaunchArt launch={launch} />
        <div>
          <strong>${launch.symbol}</strong>
          <small>{launch.name}</small>
        </div>
      </div>
      <p>{launch.description || "Launch request"}</p>
      <div className="app-dashboard-launch-meta-line">
        <ChainBadge launch={launch} />
        <Status status={launch.status} />
      </div>
      <div className="app-dashboard-launch-card-facts">
        <Detail label="Dev buy" value={formatLaunchDevBuy(launch)} />
        <Detail label="Created" value={relativeTime(launch.created_at)} />
        <Detail
          label={chainPresentationForRecord(launch).addressLabel}
          value={shortAddress(tokenAddress, 5, 5)}
          mono
        />
      </div>
      {launch.error && (
        <div className="app-dashboard-launch-error">
          <AlertCircle className="h-4 w-4" />
          <span>{launch.error}</span>
        </div>
      )}
      <div className="app-dashboard-launch-card-foot">
        {tokenAddress ? (
          <Link to="/coin/$mint" params={{ mint: tokenAddress }}>
            Open coin <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span>Waiting for token</span>
        )}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            Explorer <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function LaunchArt({ launch, large = false }: { launch: Launch; large?: boolean }) {
  return (
    <div
      className={
        large
          ? "app-dashboard-launch-art app-dashboard-launch-art-large"
          : "app-dashboard-launch-art"
      }
    >
      {launch.image_url ? (
        <img src={launch.image_url} alt="" />
      ) : (
        <span>{launch.symbol.slice(0, 2)}</span>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="app-dashboard-launch-detail">
      <small>{label}</small>
      <strong className={mono ? "sm-mono" : undefined}>{value}</strong>
    </div>
  );
}

function ChainBadge({ launch }: { launch: Pick<Launch, "chain" | "launch_platform"> }) {
  const chain = chainPresentationForRecord(launch);
  return (
    <ChainPill
      chain={chain.chain}
      className="app-dashboard-launch-chain"
      iconOnly
      label={chain.platformLabel}
    />
  );
}

function Status({ status }: { status: string | null }) {
  const normalized = status ?? "unknown";
  return <span className={"app-status app-status-" + normalized}>{normalized}</span>;
}

function buildLaunchStats(launches: Launch[]) {
  const confirmed = launches.filter(
    (l) => l.status === "confirmed" || l.tx_signature || l.tx_hash,
  ).length;
  const pending = launches.filter((l) =>
    ["pending", "queued", "processing", "submitted"].includes(l.status ?? ""),
  ).length;
  const solana = launches.filter((launch) => launchChain(launch) === "solana").length;
  const robinhood = launches.length - solana;

  return { confirmed, pending, robinhood, solana };
}

function launchChain(launch: Pick<Launch, "chain" | "launch_platform">) {
  if (launch.chain === "solana" || launch.launch_platform === "pump_fun") return "solana";
  return "robinhood";
}

function formatLaunchDevBuy(launch: Launch) {
  if (launch.dev_buy_usd != null) return formatUsd(launch.dev_buy_usd);
  if (launchChain(launch) === "solana") return `${Number(launch.dev_buy_sol ?? 0).toFixed(3)} SOL`;
  return formatEth(launch.dev_buy_eth, 3) + " ETH";
}

function externalLaunchHref(launch: Launch) {
  if (launch.pump_url) return launch.pump_url;
  if (launch.solscan_url) return launch.solscan_url;
  if (launch.tx_signature) return `https://solscan.io/tx/${launch.tx_signature}`;
  return null;
}
