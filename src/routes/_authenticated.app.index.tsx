import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { ChainPill } from "@/components/linkr/ChainPill";
import { Button } from "@/components/ui/button";
import { RobinhoodLogo, SolanaLogo } from "@/components/linkr/ChainLogos";
import { chainPresentationForRecord } from "@/lib/linkr/chain-presentation";
import { shortAddress, formatEth, bpsToPercent, relativeTime, formatUsd } from "@/lib/linkr/format";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Wallet,
  Twitter,
  History as HistoryIcon,
  Rocket,
} from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";

type WalletRecord = {
  id: string;
  public_key: string;
  address?: string | null;
  chain_id?: number | null;
  wallet_type?: string | null;
  explorer_url?: string | null;
  is_primary: boolean;
  created_at: string;
};

type WalletBalance = {
  wallet_id: string;
  address: string;
  wallet_type: "evm" | "solana";
  is_primary: boolean;
  native_symbol: "ETH" | "SOL";
  native_balance: number | null;
  native_price_usd: number | null;
  usdc_balance: string | null;
  explorer_url?: string | null;
  error?: string | null;
};

type WalletBalancesResponse = { balances: WalletBalance[]; fetched_at: string };

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Home - Linkr" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const walletsQuery = useQuery({
    queryKey: ["wallets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_wallets");
      if (error) throw error;
      return (data ?? []) as WalletRecord[];
    },
  });

  const wallets = walletsQuery.data ?? [];
  const evmWallets = wallets.filter((wallet) => wallet.wallet_type === "evm");
  const solanaWallets = wallets.filter((wallet) => wallet.wallet_type === "solana");
  const primaryEvmWallet = evmWallets.find((wallet) => wallet.is_primary) ?? evmWallets[0] ?? null;
  const primarySolanaWallet =
    solanaWallets.find((wallet) => wallet.is_primary) ?? solanaWallets[0] ?? null;
  const walletPk = primaryEvmWallet?.address ?? primaryEvmWallet?.public_key ?? null;
  const solanaPk = primarySolanaWallet?.address ?? primarySolanaWallet?.public_key ?? null;

  const walletBalancesQuery = useQuery({
    queryKey: ["wallet-balances", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      const result = await supabase.functions.invoke<WalletBalancesResponse>("wallet-balances", {
        body: {},
      });
      if (result.error) throw new Error(result.error.message);
      const data = result.data;
      if (!data || !Array.isArray(data.balances)) throw new Error("Wallet balance lookup failed");
      return data;
    },
  });

  const txQuery = useQuery({
    queryKey: ["recent-tx", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, action, chain, amount_eth, amount_sol, amount_usd, amount_original, amount_original_unit, status, created_at, tx_hash, tx_signature",
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const launchesQuery = useQuery({
    queryKey: ["recent-dashboard-launches", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coin_launches")
        .select(
          "id,name,symbol,chain,launch_platform,dev_buy_eth,dev_buy_sol,dev_buy_usd,status,created_at,mint,token_address,tx_signature,tx_hash",
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const profile = profileQuery.data;
  const walletBalanceById = new Map(
    (walletBalancesQuery.data?.balances ?? []).map((balance) => [balance.wallet_id, balance]),
  );
  const evmBalanceRows = evmWallets.map((wallet) => walletBalanceById.get(wallet.id));
  const solanaBalanceRows = solanaWallets.map((wallet) => walletBalanceById.get(wallet.id));
  const hasEthBalanceData =
    evmWallets.length > 0 &&
    evmBalanceRows.every((balance) => Number.isFinite(balance?.native_balance));
  const hasSolBalanceData =
    solanaWallets.length > 0 &&
    solanaBalanceRows.every((balance) => Number.isFinite(balance?.native_balance));
  const hasUsdcBalanceData =
    solanaWallets.length > 0 &&
    solanaBalanceRows.every(
      (balance) =>
        balance?.usdc_balance !== null &&
        balance?.usdc_balance !== undefined &&
        Number.isFinite(Number(balance.usdc_balance)),
    );
  const hasEthUsdData =
    hasEthBalanceData &&
    evmBalanceRows.every((balance) => Number.isFinite(balance?.native_price_usd));
  const hasSolUsdData =
    hasSolBalanceData &&
    solanaBalanceRows.every((balance) => Number.isFinite(balance?.native_price_usd));
  const totalEth = evmBalanceRows.reduce(
    (sum, balance) => sum + (Number(balance?.native_balance) || 0),
    0,
  );
  const totalSol = solanaBalanceRows.reduce(
    (sum, balance) => sum + (Number(balance?.native_balance) || 0),
    0,
  );
  const totalUsdc = solanaBalanceRows.reduce(
    (sum, balance) => sum + (Number(balance?.usdc_balance) || 0),
    0,
  );
  const totalEthUsd = evmBalanceRows.reduce(
    (sum, balance) =>
      sum + (Number(balance?.native_balance) || 0) * (Number(balance?.native_price_usd) || 0),
    0,
  );
  const totalSolUsd = solanaBalanceRows.reduce(
    (sum, balance) =>
      sum + (Number(balance?.native_balance) || 0) * (Number(balance?.native_price_usd) || 0),
    0,
  );
  const hasPortfolioData =
    wallets.length > 0 &&
    (evmWallets.length === 0 || hasEthUsdData) &&
    (solanaWallets.length === 0 || (hasSolUsdData && hasUsdcBalanceData));
  const totalPortfolioUsd = totalEthUsd + totalSolUsd + totalUsdc;
  const recentItems = useMemo(() => {
    const txItems = (txQuery.data ?? []).map((tx) => {
      const chain = chainPresentationForRecord(tx);
      return {
        amount: amountForTx(tx),
        chainLabel: chain.shortLabel,
        chainTone: chain.chain,
        createdAt: tx.created_at,
        id: "tx-" + tx.id,
        reference: tx.tx_hash ?? tx.tx_signature,
        title: tx.action ?? "action",
      };
    });
    const launchItems = (launchesQuery.data ?? []).map((launch) => {
      const chain = chainPresentationForRecord(launch);
      return {
        amount: amountForLaunch(launch),
        chainLabel: chain.shortLabel,
        chainTone: chain.chain,
        createdAt: launch.created_at,
        id: "launch-" + launch.id,
        reference: launch.token_address ?? launch.mint ?? launch.tx_hash ?? launch.tx_signature,
        title: "launch $" + launch.symbol,
      };
    });

    return [...txItems, ...launchItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [launchesQuery.data, txQuery.data]);
  const limitsAllZero =
    profile &&
    Number(profile.default_slippage_bps) === 0 &&
    Number(profile.max_auto_buy_eth) === 0 &&
    Number(profile.max_auto_buy_sol) === 0 &&
    Number(profile.max_auto_sell_percent) === 0 &&
    Number(profile.max_auto_dev_buy_eth) === 0 &&
    Number(profile.max_auto_dev_buy_sol) === 0;

  return (
    <div className="app-dashboard-page">
      <header className="app-live-hero app-dashboard-hero">
        <div className="app-dashboard-hero-copy">
          <p className="app-live-kicker">Command wallet</p>
          <h1>@{profile?.twitter_username ?? "you"}</h1>
          <p>
            Your X-connected Robinhood Chain and Solana dashboard for balances, limits, recent
            activity, and commands.
          </p>
        </div>
        <div className="app-live-signal" aria-label="Wallet status">
          <span />
          {walletPk || solanaPk ? "wallet ready" : "setup needed"}
        </div>
      </header>

      {limitsAllZero && (
        <div className="app-dashboard-alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            <div className="font-medium text-foreground">
              All trading limits are currently disabled.
            </div>
            <div className="mt-0.5 text-muted-foreground">
              Set limits to let Linkr handle wallet actions from X again.
            </div>
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-warning/40 bg-transparent text-warning hover:bg-warning/10"
          >
            <Link to="/app/settings">Open Settings</Link>
          </Button>
        </div>
      )}

      {/* Wallet card */}
      <div className="app-dashboard-grid app-dashboard-grid-primary">
        <section className="sm-card app-dashboard-card app-dashboard-portfolio-card">
          <div className="app-dashboard-card-head app-dashboard-section-head">
            <div>
              <h2>Wallet balances</h2>
              <p className="app-dashboard-section-copy">
                Your combined portfolio across {wallets.length}{" "}
                {wallets.length === 1 ? "wallet" : "wallets"}.
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/app/wallet">
                Manage <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          <div className="app-dashboard-portfolio-grid">
            <DashboardBalanceStat
              asset="eth"
              balance={hasEthBalanceData ? totalEth : null}
              equivalent={hasEthUsdData ? totalEthUsd : null}
              loading={walletBalancesQuery.isLoading}
              symbol="ETH"
            />
            <DashboardBalanceStat
              asset="sol"
              balance={hasSolBalanceData ? totalSol : null}
              equivalent={hasSolUsdData ? totalSolUsd : null}
              loading={walletBalancesQuery.isLoading}
              symbol="SOL"
            />
            <DashboardBalanceStat
              asset="usdc"
              balance={hasUsdcBalanceData ? totalUsdc : null}
              loading={walletBalancesQuery.isLoading}
              symbol="USDC"
            />
            <DashboardBalanceStat
              asset="portfolio"
              balance={hasPortfolioData ? totalPortfolioUsd : null}
              loading={walletBalancesQuery.isLoading}
              symbol="USDC"
            />
          </div>

          <div className="app-dashboard-deposit-row">
            <DashboardDepositAddress
              address={walletPk}
              copied={copiedWallet === "evm"}
              label="Primary EVM"
              loading={walletsQuery.isLoading}
              onCopy={() => walletPk && copyWalletAddress(walletPk, "evm")}
            />
            <DashboardDepositAddress
              address={solanaPk}
              copied={copiedWallet === "solana"}
              label="Primary Solana"
              loading={walletsQuery.isLoading}
              onCopy={() => solanaPk && copyWalletAddress(solanaPk, "solana")}
            />
          </div>
        </section>

        <div className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-title">Your rules</div>
          <dl className="app-dashboard-rule-list">
            <Row label="Default slippage" value={bpsToPercent(profile?.default_slippage_bps)} />
            <Row label="Max auto sell" value={`${formatEth(profile?.max_auto_sell_percent, 2)}%`} />
            <Row label="EVM buy cap" value={`${formatEth(profile?.max_auto_buy_eth)} ETH`} />
            <Row
              label="EVM transfer cap"
              value={`${formatEth(profile?.max_auto_transfer_eth)} ETH`}
            />
            <Row label="EVM dev buy" value={`${formatEth(profile?.max_auto_dev_buy_eth)} ETH`} />
            <Row label="Solana buy cap" value={`${formatEth(profile?.max_auto_buy_sol)} SOL`} />
            <Row
              label="Solana transfer cap"
              value={`${formatEth(profile?.max_auto_transfer_sol)} SOL`}
            />
            <Row label="Solana dev buy" value={`${formatEth(profile?.max_auto_dev_buy_sol)} SOL`} />
          </dl>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-5 w-full border-border bg-transparent"
          >
            <Link to="/app/settings">Adjust</Link>
          </Button>
        </div>
      </div>

      {/* Recent activity + commands */}
      <div className="app-dashboard-grid app-dashboard-grid-secondary">
        <div className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-head">
            <h2>Recent wallet moves</h2>
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="gap-1 text-primary hover:bg-primary/10"
            >
              <Link to="/app/history">
                All <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="app-dashboard-activity-list">
            {recentItems.length === 0 && (
              <div className="app-dashboard-empty">
                <HistoryIcon className="h-8 w-8 opacity-40" />
                Nothing yet. Reply to a post with @linkrcash to start.
              </div>
            )}
            {recentItems.map((item) => (
              <div key={item.id} className="app-dashboard-activity-row">
                <div>
                  <div className="font-medium capitalize">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {relativeTime(item.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="app-dashboard-activity-chain-line">
                    <ChainPill chain={item.chainTone} iconOnly label={item.chainLabel} />
                    <span className="sm-mono">{item.amount}</span>
                  </div>
                  <div className="text-xs text-muted-foreground sm-mono">
                    {shortAddress(item.reference)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sm-card app-dashboard-card">
          <div className="app-dashboard-card-head app-dashboard-section-head">
            <div>
              <h2>Commands you can try</h2>
              <p className="app-dashboard-section-copy">
                Common X prompts for wallet actions, launches, and liquidity.
              </p>
            </div>
          </div>
          <ul className="app-dashboard-command-list">
            {[
              "@linkrcash balance",
              "@linkrcash buy $50 of BONK",
              "@linkrcash add 0.2 ETH liquidity to <contract>",
              "@linkrcash sell 25% of $WIF",
              "@linkrcash launch $PULSE dev buy 0.1 ETH",
            ].map((c) => (
              <li key={c} className="app-dashboard-command-row">
                <Twitter className="h-3.5 w-3.5 text-primary" />
                <span className="sm-mono">{c}</span>
              </li>
            ))}
          </ul>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-5 w-full gap-1 border-border bg-transparent"
          >
            <a href="https://x.com/linkrcash" target="_blank" rel="noreferrer">
              <Rocket className="h-3.5 w-3.5" /> Go to X
            </a>
          </Button>
        </div>
      </div>
    </div>
  );

  async function copyWalletAddress(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedWallet(key);
      window.setTimeout(() => {
        setCopiedWallet((current) => (current === key ? null : current));
      }, 1400);
      toast.success("Address copied");
    } catch {
      toast.error("Copy failed");
    }
  }
}

function DashboardBalanceStat({
  asset,
  balance,
  equivalent,
  loading,
  symbol,
}: {
  asset: "eth" | "sol" | "usdc" | "portfolio";
  balance: number | null;
  equivalent?: number | null;
  loading: boolean;
  symbol: "ETH" | "SOL" | "USDC";
}) {
  const label = asset === "portfolio" ? "Total portfolio" : `Total ${symbol}`;

  return (
    <article className="app-dashboard-balance-stat" data-asset={asset}>
      <div className="app-dashboard-balance-stat-head">
        <DashboardAssetMark asset={asset} />
        <span>{label}</span>
      </div>
      <div className="app-dashboard-balance-stat-value">
        <strong className="sm-mono">{loading ? "--" : formatDashboardBalance(balance)}</strong>
        <span>{symbol}</span>
      </div>
      <small>
        {asset === "portfolio"
          ? "All assets combined"
          : equivalent != null
            ? `${formatUsd(equivalent)} in USDC`
            : asset === "usdc"
              ? "Across all Solana wallets"
              : "-- in USDC"}
      </small>
    </article>
  );
}

function DashboardAssetMark({ asset }: { asset: "eth" | "sol" | "usdc" | "portfolio" }) {
  return (
    <span className="app-dashboard-balance-logo" data-asset={asset} aria-hidden="true">
      {asset === "eth" ? (
        <RobinhoodLogo />
      ) : asset === "sol" ? (
        <SolanaLogo />
      ) : asset === "usdc" ? (
        <img src="/linkr/usdc.webp" alt="" />
      ) : (
        <Wallet />
      )}
    </span>
  );
}

function DashboardDepositAddress({
  address,
  copied,
  label,
  loading,
  onCopy,
}: {
  address: string | null;
  copied: boolean;
  label: string;
  loading: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="app-dashboard-deposit-address">
      <div>
        <span>{label}</span>
        <strong className="sm-mono">
          {address ? shortAddress(address, 8, 6) : loading ? "Loading..." : "Not available"}
        </strong>
      </div>
      {address && (
        <button type="button" aria-label={`Copy ${label} address`} onClick={onCopy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

function formatDashboardBalance(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="app-dashboard-rule-row">
      <dt>{label}</dt>
      <dd className="sm-mono">{value}</dd>
    </div>
  );
}

function amountForTx(tx: {
  amount_eth: number | null;
  amount_original: number | null;
  amount_original_unit: string | null;
  amount_sol?: number | null;
  amount_usd: number | null;
  chain?: string | null;
}) {
  if (tx.amount_usd != null) return formatUsd(tx.amount_usd);
  if (tx.chain === "solana" && tx.amount_sol != null)
    return `${Number(tx.amount_sol).toFixed(4)} SOL`;
  if (tx.amount_original != null && tx.amount_original_unit) {
    return `${formatEth(tx.amount_original, 4)} ${tx.amount_original_unit}`;
  }
  return `${formatEth(tx.amount_eth)} ETH`;
}

function amountForLaunch(launch: {
  chain?: string | null;
  dev_buy_eth: number | null;
  dev_buy_sol?: number | null;
  dev_buy_usd: number | null;
  launch_platform?: string | null;
}) {
  if (launch.dev_buy_usd != null) return formatUsd(launch.dev_buy_usd);
  const chain = chainPresentationForRecord(launch);
  if (chain.chain === "solana") return `${Number(launch.dev_buy_sol ?? 0).toFixed(3)} SOL`;
  return `${formatEth(launch.dev_buy_eth, 3)} ETH`;
}
