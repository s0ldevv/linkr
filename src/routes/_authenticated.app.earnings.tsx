import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Coins,
  DollarSign,
  ExternalLink,
  Loader2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { ChainPill } from "@/components/linkr/ChainPill";
import { DashboardStatCard } from "@/components/linkr/DashboardStatCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, shortAddress } from "@/lib/linkr/format";

type ChainFilter = "all" | "robinhood" | "solana";
type EarningsChain = "robinhood" | "solana";

type RewardAmount = {
  amount: string;
  base_units: string;
  symbol: string;
};

type EarningsItem = {
  id: string;
  name: string | null;
  symbol: string | null;
  image_url: string | null;
  chain: EarningsChain;
  chain_label: string;
  launch_platform: string | null;
  launch_source: string | null;
  status: string | null;
  created_at: string | null;
  token_address: string | null;
  mint: string | null;
  wallet_address: string | null;
  wallet_id: string | null;
  available_native: RewardAmount;
  available_token: RewardAmount | null;
  claimed_native: RewardAmount;
  claimed_token: RewardAmount | null;
  can_claim: boolean;
  claim_error: string | null;
  sharing_config_address: string | null;
  earning_role: "owner" | "shared_recipient";
  reward_share_bps: number | null;
  reward_share_percent: number | null;
};

type EarningsTimelinePoint = {
  date: string;
  label: string;
  eth_claimed: number;
  sol_claimed: number;
  eth_cumulative: number;
  sol_cumulative: number;
};

type EarningsResponse = {
  items: EarningsItem[];
  summary: {
    total_launches: number;
    owned_count: number;
    shared_count: number;
    claimable_count: number;
    sol_available: RewardAmount;
    eth_available: RewardAmount;
    sol_claimed: RewardAmount;
    eth_claimed: RewardAmount;
  };
  timeline: EarningsTimelinePoint[];
};

type ClaimResponse = {
  chain: EarningsChain;
  explorer_url?: string;
  tx_hash?: string;
  signature?: string;
};

const CHAIN_FILTERS: Array<{ label: string; value: ChainFilter }> = [
  { label: "All", value: "all" },
  { label: "Robinhood", value: "robinhood" },
  { label: "Solana", value: "solana" },
];

export const Route = createFileRoute("/_authenticated/app/earnings")({
  head: () => ({ meta: [{ title: "Earnings - Linkr" }] }),
  component: EarningsPage,
});

function EarningsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");

  const earningsQuery = useQuery({
    queryKey: ["creator-rewards-earnings", user?.id],
    enabled: !!user,
    queryFn: fetchEarnings,
  });

  const claimMutation = useMutation({
    mutationFn: claimRewards,
    onSuccess: (result) => {
      toast.success(
        result.chain === "solana" ? "Solana rewards claimed" : "Robinhood rewards claimed",
        {
          description: result.tx_hash ?? result.signature ?? undefined,
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["creator-rewards-earnings", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["activity-feed", user?.id] });
    },
    onError: (error) => {
      toast.error("Could not claim rewards", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const data = earningsQuery.data;
  const items = data?.items ?? [];
  const filteredItems =
    chainFilter === "all" ? items : items.filter((item) => item.chain === chainFilter);

  return (
    <div className="app-dashboard-page app-dashboard-launches-page app-earnings-page">
      <header className="app-live-hero app-dashboard-hero app-dashboard-launches-hero app-earnings-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Creator rewards</p>
          <h1>Earnings</h1>
          <p>
            Claim creator rewards from coins you launched or that share fees with you, with each
            balance tied to the correct recipient wallet.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Creator rewards status">
          <DollarSign aria-hidden="true" size={16} />
          claim center
        </div>
      </header>

      <section className="app-dashboard-launch-stats" aria-label="Earnings stats">
        <DashboardStatCard
          label="Earning coins"
          value={String(data?.summary.total_launches ?? 0)}
          detail={`${data?.summary.owned_count ?? 0} launched · ${data?.summary.shared_count ?? 0} shared`}
          icon={<Coins />}
        />
        <DashboardStatCard
          label="Claimable"
          value={String(data?.summary.claimable_count ?? 0)}
          icon={<Sparkles />}
        />
        <DashboardStatCard
          label="ETH ready"
          value={formatReward(data?.summary.eth_available)}
          detail="Robinhood"
        />
        <DashboardStatCard
          label="SOL ready"
          value={formatReward(data?.summary.sol_available)}
          detail="Pump.fun"
        />
        <DashboardStatCard label="Claimed" value={formatClaimedSummary(data)} detail="ETH + SOL" />
      </section>

      <EarningsTimelineCard
        loading={earningsQuery.isLoading}
        points={data?.timeline ?? []}
        totalEth={data?.summary.eth_claimed}
        totalSol={data?.summary.sol_claimed}
      />

      <section className="sm-card app-dashboard-card app-dashboard-launch-list app-earnings-list">
        <div className="app-dashboard-card-head app-dashboard-section-head app-dashboard-launch-list-head app-earnings-list-head">
          <div>
            <h2>Your earning coins</h2>
            <p className="app-dashboard-section-copy">
              Includes your launches and Solana coins whose creator fees were shared with you.
            </p>
          </div>
          <div className="app-earnings-filter" aria-label="Filter earnings by chain">
            {CHAIN_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                data-active={chainFilter === filter.value}
                onClick={() => setChainFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {earningsQuery.isLoading && <div className="app-empty-state">Loading earnings...</div>}
        {earningsQuery.isError && (
          <div className="app-empty-state">
            Could not load creator rewards. Refresh the page and try again.
          </div>
        )}
        {!earningsQuery.isLoading && !earningsQuery.isError && items.length === 0 && (
          <div className="app-empty-state">
            Your launches and coins that share creator fees with you will appear here once
            confirmed.
          </div>
        )}
        {!earningsQuery.isLoading &&
          !earningsQuery.isError &&
          items.length > 0 &&
          filteredItems.length === 0 && (
            <div className="app-empty-state">No launches match this chain filter.</div>
          )}

        {filteredItems.length > 0 && (
          <div className="app-dashboard-launch-grid app-earnings-grid">
            {filteredItems.map((item) => (
              <EarningsCard
                key={item.id}
                item={item}
                claiming={claimMutation.isPending && claimMutation.variables?.launchId === item.id}
                onClaim={() => claimMutation.mutate({ launchId: item.id })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EarningsTimelineCard({
  loading,
  points,
  totalEth,
  totalSol,
}: {
  loading: boolean;
  points: EarningsTimelinePoint[];
  totalEth?: RewardAmount | null;
  totalSol?: RewardAmount | null;
}) {
  const hasPoints = points.length > 0;
  const chart = hasPoints ? buildTimelineChart(points) : null;

  return (
    <section className="sm-card app-dashboard-card app-earnings-chart-card">
      <div className="app-dashboard-card-head app-dashboard-section-head app-earnings-chart-head">
        <div>
          <h2>Rewards over time</h2>
          <p className="app-dashboard-section-copy">
            Cumulative creator rewards claimed from Robinhood Chain and Solana launches.
          </p>
        </div>
        <div className="app-earnings-chart-totals" aria-label="Claimed totals">
          <span>
            <b>{formatReward(totalEth)}</b>
            <small>ETH claimed</small>
          </span>
          <span>
            <b>{formatReward(totalSol)}</b>
            <small>SOL claimed</small>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="app-empty-state">Loading earnings chart...</div>
      ) : !hasPoints ? (
        <div className="app-empty-state">
          Your claimed reward history will appear here after your first claim.
        </div>
      ) : (
        <div className="app-earnings-chart-wrap">
          {chart && (
            <svg
              className="app-earnings-chart"
              viewBox="0 0 1000 320"
              role="img"
              aria-label="Cumulative claimed creator rewards over time"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="earningsEthFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="var(--app-lime)" stopOpacity="0.34" />
                  <stop offset="95%" stopColor="var(--app-lime)" stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id="earningsSolFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="var(--app-ink)" stopOpacity="0.18" />
                  <stop offset="95%" stopColor="var(--app-ink)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {chart.grid.map((y) => (
                <line
                  key={y}
                  className="app-earnings-chart-grid-line"
                  x1="52"
                  x2="976"
                  y1={y}
                  y2={y}
                />
              ))}
              <path
                className="app-earnings-chart-area app-earnings-chart-area-sol"
                d={chart.solArea}
              />
              <path
                className="app-earnings-chart-area app-earnings-chart-area-eth"
                d={chart.ethArea}
              />
              <path
                className="app-earnings-chart-line app-earnings-chart-line-sol"
                d={chart.solLine}
              />
              <path
                className="app-earnings-chart-line app-earnings-chart-line-eth"
                d={chart.ethLine}
              />
              {chart.xLabels.map((label) => (
                <text
                  key={label.x + label.text}
                  className="app-earnings-chart-axis"
                  x={label.x}
                  y="304"
                >
                  {label.text}
                </text>
              ))}
              {chart.yLabels.map((label) => (
                <text
                  key={label.y + label.text}
                  className="app-earnings-chart-axis"
                  x="20"
                  y={label.y + 4}
                >
                  {label.text}
                </text>
              ))}
            </svg>
          )}
          <div className="app-earnings-chart-legend">
            <span data-series="eth">ETH cumulative</span>
            <span data-series="sol">SOL cumulative</span>
          </div>
        </div>
      )}
    </section>
  );
}

function EarningsCard({
  item,
  claiming,
  onClaim,
}: {
  item: EarningsItem;
  claiming: boolean;
  onClaim: () => void;
}) {
  const token = item.token_address ?? item.mint;
  const explorerUrl = transactionExplorerHref(item);
  const symbol = item.symbol ? "$" + item.symbol : "Coin";
  const canClaim = item.can_claim && !claiming;

  return (
    <article className="app-dashboard-launch-card app-earnings-card">
      <div className="app-dashboard-launch-card-top">
        <LaunchArt item={item} />
        <div>
          <strong>{symbol}</strong>
          <small>{item.name ?? item.chain_label}</small>
        </div>
      </div>

      <div className="app-dashboard-launch-meta-line">
        <ChainBadge item={item} />
        <span className="app-earnings-role" data-shared={item.earning_role === "shared_recipient"}>
          {item.earning_role === "shared_recipient"
            ? `Shared with you · ${formatShare(item.reward_share_percent)}`
            : "Your launch"}
        </span>
        <span>{item.created_at ? relativeTime(item.created_at) : "launch"}</span>
        {item.launch_source === "website" && <span>website</span>}
      </div>

      <div className="app-dashboard-launch-card-facts app-earnings-amount-grid">
        <Detail label="Available" value={formatReward(item.available_native)} strong />
        <Detail label="Claimed" value={formatReward(item.claimed_native)} />
        <Detail label="Wallet" value={shortAddress(item.wallet_address, 5, 5)} mono />
        {item.available_token && (
          <Detail label="Token fees" value={formatReward(item.available_token)} />
        )}
        {item.claimed_token && (
          <Detail label="Token claimed" value={formatReward(item.claimed_token)} />
        )}
        <Detail
          label={item.chain === "solana" ? "Mint" : "Token"}
          value={shortAddress(token, 5, 5)}
          mono
        />
      </div>

      {item.claim_error && (
        <div className="app-dashboard-launch-error">
          <AlertCircle className="h-4 w-4" />
          <span>{item.claim_error}</span>
        </div>
      )}

      <div className="app-dashboard-launch-card-foot app-earnings-card-foot">
        <div>
          {token ? (
            <Link to="/coin/$mint" params={{ mint: token }}>
              Open coin <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span>Waiting for token</span>
          )}
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noreferrer">
              Explorer <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <Button
          type="button"
          className="app-dashboard-launch-primary app-earnings-claim-button"
          disabled={!canClaim}
          onClick={onClaim}
        >
          {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          {claiming ? "Claiming" : "Claim"}
        </Button>
      </div>
    </article>
  );
}

function formatShare(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "fee share";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function LaunchArt({ item }: { item: EarningsItem }) {
  const fallback = (item.symbol ?? item.name ?? item.chain_label).slice(0, 2);
  return (
    <div className="app-dashboard-launch-art">
      {item.image_url ? <img src={item.image_url} alt="" /> : <span>{fallback}</span>}
    </div>
  );
}

function ChainBadge({ item }: { item: EarningsItem }) {
  return (
    <ChainPill
      chain={item.chain}
      className="app-dashboard-launch-chain"
      iconOnly
      label={item.chain_label}
    />
  );
}

function Detail({
  label,
  value,
  mono = false,
  strong = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="app-dashboard-launch-detail">
      <small>{label}</small>
      <strong className={mono ? "sm-mono" : strong ? "app-earnings-value-strong" : undefined}>
        {value}
      </strong>
    </div>
  );
}

function buildTimelineChart(points: EarningsTimelinePoint[]) {
  const width = 1000;
  const height = 320;
  const left = 52;
  const right = 24;
  const top = 20;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(
    0.000001,
    ...points.map((point) => Math.max(point.eth_cumulative, point.sol_cumulative)),
  );
  const scaleX = (index: number) =>
    points.length === 1 ? left + plotWidth : left + (plotWidth * index) / (points.length - 1);
  const scaleY = (value: number) => top + plotHeight - (Math.max(0, value) / max) * plotHeight;
  const ethPoints = points.map((point, index) => [scaleX(index), scaleY(point.eth_cumulative)]);
  const solPoints = points.map((point, index) => [scaleX(index), scaleY(point.sol_cumulative)]);
  const baseline = top + plotHeight;
  const linePath = (coords: number[][]) => {
    if (coords.length === 1) {
      const [x, y] = coords[0];
      return `M ${(x - 2).toFixed(2)} ${y.toFixed(2)} L ${(x + 2).toFixed(2)} ${y.toFixed(2)}`;
    }
    return coords
      .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");
  };
  const areaPath = (coords: number[][]) => {
    const firstX = coords[0][0];
    const lastX = coords[coords.length - 1][0];
    return `${linePath(coords)} L ${lastX.toFixed(2)} ${baseline} L ${firstX.toFixed(2)} ${baseline} Z`;
  };
  const labelIndexes = uniqueNumbers([
    0,
    Math.floor((points.length - 1) / 2),
    points.length - 1,
  ]).filter((index) => points[index]);
  const yTicks = [0, max / 2, max];

  return {
    ethArea: areaPath(ethPoints),
    ethLine: linePath(ethPoints),
    grid: yTicks.map((value) => scaleY(value)),
    solArea: areaPath(solPoints),
    solLine: linePath(solPoints),
    xLabels: labelIndexes.map((index) => ({
      text: points[index].label,
      x: scaleX(index),
    })),
    yLabels: yTicks.map((value) => ({
      text: formatChartAxis(value),
      y: scaleY(value),
    })),
  };
}

async function fetchEarnings(): Promise<EarningsResponse> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const response = await fetch(`${supabaseFunctionsUrl()}/creator-rewards-earnings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Could not load creator rewards");
  return json as EarningsResponse;
}

async function claimRewards({ launchId }: { launchId: string }): Promise<ClaimResponse> {
  const { data, error } = await supabase.functions.invoke("creator-rewards-earnings", {
    body: {
      launch_id: launchId,
      idempotency_key: `${launchId}:${crypto.randomUUID()}`,
    },
  });
  if (error) throw error;
  return data as ClaimResponse;
}

function supabaseFunctionsUrl() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new Error("Missing Supabase URL");
  return `${url.replace(/\/+$/, "")}/functions/v1`;
}

function formatReward(reward?: RewardAmount | null) {
  if (!reward) return "0";
  const amount = Number(reward.amount);
  const value = Number.isFinite(amount)
    ? amount.toLocaleString(undefined, {
        maximumFractionDigits: amount >= 1 ? 4 : 8,
      })
    : reward.amount;
  return `${value} ${reward.symbol}`;
}

function formatChartAxis(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value === 0) return "0";
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)];
}

function formatClaimedSummary(data?: EarningsResponse) {
  if (!data) return "0";
  const eth = formatReward(data.summary.eth_claimed);
  const sol = formatReward(data.summary.sol_claimed);
  return `${eth} / ${sol}`;
}

function transactionExplorerHref(item: EarningsItem) {
  const address = item.token_address ?? item.mint;
  if (!address) return null;
  if (item.chain === "solana") return `https://solscan.io/token/${address}`;
  return `https://explorer.robinhood.com/token/${address}`;
}
