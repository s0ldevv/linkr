import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  Copy,
  Eye,
  Gauge,
  History,
  MessageSquare,
  Rocket,
  Send,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Upload,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { formatEth, formatUsd, shortAddress } from "@/lib/linkr/format";
import type { ViewerHomeData } from "@/lib/linkr/home-data";
import { formatSignedPercent, xIntent } from "@/lib/linkr/home-data";

type WalletData = NonNullable<ViewerHomeData["wallet"]>;
type PortfolioData = ViewerHomeData["portfolio"];
type ProfileData = ViewerHomeData["profile"];

const QUICK_ACTIONS = [
  {
    key: "buy",
    className: "sm-viewer-action-buy",
    intent: "@linkrbot buy $100 of ",
    icon: ShoppingCart,
    title: "Buy Token",
    subtitle: "Swap ETH into any mint",
  },
  {
    key: "launch",
    className: "sm-viewer-action-launch",
    intent: "@linkrbot launch $TOKEN with this image",
    icon: Rocket,
    title: "Launch Coin",
    subtitle: "Create a token with media",
  },
  {
    key: "ask",
    className: "sm-viewer-action-ask",
    intent: "@linkrbot what is the CA above?",
    icon: MessageSquare,
    title: "Ask Linkr",
    subtitle: "Analyze anything on-chain",
  },
] as const;

function ActionBody({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <>
      <span>
        <Icon aria-hidden="true" size={18} />
      </span>
      <strong>{title}</strong>
      <small>{subtitle}</small>
      <ArrowUpRight aria-hidden="true" size={16} />
    </>
  );
}

function LoadingSkeleton() {
  return (
    <aside
      className="sm-hero-rail sm-viewer-deck"
      aria-label="Your Linkr portfolio"
      aria-busy="true"
    >
      <section className="sm-viewer-panel sm-viewer-loading-panel">
        <span />
        <strong>Loading your command deck</strong>
      </section>
      <section className="sm-viewer-panel sm-viewer-loading-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </section>
    </aside>
  );
}

function PortfolioPanel({
  wallet,
  portfolio,
  stats,
}: {
  wallet: WalletData | null;
  portfolio: PortfolioData;
  stats: { label: string; value: number }[];
}) {
  const signedChange = formatSignedPercent(portfolio?.change24hPercent);
  const changeTone = signedChange ? (signedChange.startsWith("-") ? "down" : "up") : "flat";
  const totalEth =
    portfolio?.totalEthEquivalent != null
      ? formatEth(portfolio.totalEthEquivalent, 4)
      : wallet
        ? formatEth(wallet.ethBalance, 4)
        : "--";
  const totalUsd = portfolio?.totalUsd != null ? formatUsd(portfolio.totalUsd) : "USD unavailable";

  const copyWallet = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address ?? wallet.publicKey);
      toast.success("Wallet address copied");
    } catch {
      toast.error("Could not copy address");
    }
  };

  return (
    <section className="sm-viewer-panel sm-viewer-portfolio-panel">
      <div className="sm-viewer-panel-top">
        <span>
          <Eye aria-hidden="true" size={16} />
          Your Portfolio
        </span>
        <b data-tone={changeTone}>{signedChange ?? "24h --"}</b>
      </div>

      {wallet ? (
        <>
          <div className="sm-viewer-balance">
            <strong>{totalEth}</strong>
            <span>ETH</span>
          </div>
          <p>{totalUsd}</p>

          <button
            className="sm-viewer-wallet-pill"
            type="button"
            onClick={copyWallet}
            aria-label={`Copy wallet address ${shortAddress(wallet.address ?? wallet.publicKey, 5, 5)}`}
          >
            <Wallet aria-hidden="true" size={16} />
            <code>{shortAddress(wallet.address ?? wallet.publicKey, 5, 5)}</code>
            <Copy aria-hidden="true" size={15} />
          </button>

          <div className="sm-viewer-portfolio-stats">
            {stats.map(({ label, value }) => (
              <span key={label}>
                <strong>{value}</strong>
                <small>{label}</small>
              </span>
            ))}
          </div>

          <div className="sm-viewer-portfolio-actions">
            <Link to="/app/wallet">
              <Upload aria-hidden="true" size={16} />
              Deposit
            </Link>
            <Link to="/app/wallet">
              <Send aria-hidden="true" size={16} />
              Withdraw
            </Link>
            <Link to="/app/history">
              <History aria-hidden="true" size={16} />
              History
            </Link>
          </div>
        </>
      ) : (
        <div className="sm-viewer-empty">
          <strong>Wallet preparing</strong>
          <p>Your Linkr wallet is still being set up.</p>
          <Link to="/app/onboarding">
            Check setup
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      )}
    </section>
  );
}

function QuickActionsPanel({ hasSellableTokens }: { hasSellableTokens: boolean }) {
  return (
    <section className="sm-viewer-panel sm-viewer-actions-panel">
      <div className="sm-viewer-panel-title">
        <span>Quick Actions</span>
        <h3>Move faster from X</h3>
      </div>

      <div className="sm-viewer-action-grid">
        <a
          className="sm-viewer-action sm-viewer-action-buy"
          href={xIntent("@linkrbot buy $100 of ")}
          target="_blank"
          rel="noreferrer"
        >
          <ActionBody icon={ShoppingCart} title="Buy Token" subtitle="Swap ETH into any mint" />
        </a>

        {hasSellableTokens ? (
          <a
            className="sm-viewer-action sm-viewer-action-sell"
            href={xIntent("@linkrbot sell 50% of ")}
            target="_blank"
            rel="noreferrer"
          >
            <ActionBody
              icon={CircleDollarSign}
              title="Sell Token"
              subtitle="Exit a position instantly"
            />
          </a>
        ) : (
          <button
            className="sm-viewer-action sm-viewer-action-sell"
            type="button"
            disabled
            title="No token holdings yet"
          >
            <ActionBody
              icon={CircleDollarSign}
              title="Sell Token"
              subtitle="No token holdings yet"
            />
          </button>
        )}

        <Link className="sm-viewer-action sm-viewer-action-send" to="/app/wallet">
          <ActionBody icon={Send} title="Send ETH" subtitle="Transfer from your wallet" />
        </Link>

        {QUICK_ACTIONS.filter((a) => a.key !== "buy").map((action) => (
          <a
            key={action.key}
            className={`sm-viewer-action ${action.className}`}
            href={xIntent(action.intent)}
            target="_blank"
            rel="noreferrer"
          >
            <ActionBody icon={action.icon} title={action.title} subtitle={action.subtitle} />
          </a>
        ))}
      </div>
    </section>
  );
}

function RulesPanel({ profile }: { profile: ProfileData }) {
  const rules = [
    { label: "EVM buy", value: `${formatEth(profile?.maxAutoBuyEth, 2)} ETH` },
    { label: "SOL buy", value: `${formatEth(profile?.maxAutoBuySol, 2)} SOL` },
    { label: "Sell cap", value: `${formatEth(profile?.maxAutoSellPercent, 2)}%` },
    { label: "EVM dev", value: `${formatEth(profile?.maxAutoDevBuyEth, 2)} ETH` },
    { label: "SOL dev", value: `${formatEth(profile?.maxAutoDevBuySol, 2)} SOL` },
    { label: "SOL transfer", value: `${formatEth(profile?.maxAutoTransferSol, 2)} SOL` },
    { label: "Confirm", value: profile?.requireConfirmationForAllTx ? "Required" : "Smart" },
  ];

  return (
    <section className="sm-viewer-panel sm-viewer-rules-panel">
      <div className="sm-viewer-panel-top">
        <span>
          <ShieldCheck aria-hidden="true" size={16} />
          Rules
        </span>
        <SlidersHorizontal aria-hidden="true" size={18} />
      </div>

      <div className="sm-viewer-rules-grid">
        {rules.map(({ label, value }) => (
          <span key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </span>
        ))}
      </div>

      <Link className="sm-viewer-rules-link" to="/app/settings">
        <Gauge aria-hidden="true" size={17} />
        Tune rules
        <ArrowRight aria-hidden="true" size={17} />
      </Link>
    </section>
  );
}

export function LoggedInHeroRail({
  data,
  loading,
}: {
  data: ViewerHomeData | null | undefined;
  loading?: boolean;
}) {
  if (loading && !data) return <LoadingSkeleton />;

  const wallet = data?.wallet ?? null;
  const portfolio = data?.portfolio ?? null;
  const holdings = portfolio?.holdings ?? [];

  const stats = [
    { label: "Tokens", value: holdings.length },
    { label: "Pending", value: data?.pendingActions.length ?? 0 },
    {
      label: "Recent",
      value: (data?.recentAgentRuns.length ?? 0) + (data?.recentTransactions.length ?? 0),
    },
    { label: "Launches", value: data?.recentLaunches.length ?? 0 },
  ];

  return (
    <aside className="sm-hero-rail sm-viewer-deck" aria-label="Your Linkr portfolio">
      <div className="sm-viewer-deck-head">
        <div>
          <h2>X wallet cockpit</h2>
        </div>
        <Link to="/app">
          Dashboard
          <ArrowUpRight aria-hidden="true" size={17} />
        </Link>
      </div>

      <div className="sm-viewer-deck-grid">
        <PortfolioPanel wallet={wallet} portfolio={portfolio} stats={stats} />
        <QuickActionsPanel hasSellableTokens={holdings.length > 0} />
        <RulesPanel profile={data?.profile ?? null} />
      </div>
    </aside>
  );
}
