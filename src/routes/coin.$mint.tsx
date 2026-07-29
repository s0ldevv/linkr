import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import { CoinComments } from "@/components/linkr/coin/CoinComments";
import { formatEth, relativeTime, shortAddress } from "@/lib/linkr/format";
import { resolveIpfsUrl } from "@/lib/linkr/ipfs";
import { normalizeProfileHandle } from "@/lib/linkr/profile-links";
import {
  ArrowRight,
  Check,
  Copy,
  DollarSign,
  ExternalLink,
  Link2,
  Share2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

type Launch = Tables<"coin_launches">;
type LaunchWithLauncher = Launch & {
  launcher: LauncherProfile | null;
};
type DexWindow = "m5" | "h1" | "h6" | "h24";
type MarketChain = "robinhood" | "solana";
type TradeSide = "buy" | "sell";

type MarketAddress = {
  address: string;
  chain: MarketChain;
};

type DexToken = {
  address?: string;
  name?: string;
  symbol?: string;
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: DexToken;
  quoteToken?: DexToken;
  priceNative?: string;
  priceUsd?: string | null;
  txns?: Partial<Record<DexWindow, { buys?: number; sells?: number }>>;
  volume?: Partial<Record<DexWindow, number>>;
  priceChange?: Partial<Record<DexWindow, number>> | null;
  liquidity?: { usd?: number; base?: number; quote?: number } | null;
  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;
  info?: {
    imageUrl?: string;
    header?: string;
    websites?: Array<{ label?: string; url?: string }>;
    socials?: Array<{ type?: string; url?: string }>;
  };
  boosts?: { active?: number } | null;
};

type TokenDetail = {
  addressLabel: string;
  chain: MarketChain;
  chainLabel: string;
  createdAt: string | null;
  creatorRewardsConfig: Json | null;
  description: string;
  devBuyEth: number | null;
  devBuySol: number | null;
  explorerUrl: string | null;
  imageUrl?: string | null;
  imageSources: TokenImageSource[];
  isLaunch: boolean;
  launcher: LauncherProfile | null;
  launchSource: string | null;
  name: string;
  nativeSymbol: "ETH" | "SOL";
  status: string;
  symbol: string;
  tweetId: string | null;
  txSignature: string | null;
  userId: string | null;
};

type LauncherProfile = {
  name: string | null;
  profileImageUrl: string | null;
  username: string;
};

type PublicProfileRow = {
  twitter_name: string | null;
  twitter_profile_image_url: string | null;
  twitter_username: string | null;
  user_id: string;
};

type RpcError = { message?: string };

const profileRpc = supabase as unknown as {
  rpc: (
    fn: "get_public_profiles",
    args: { _user_ids: string[] },
  ) => Promise<{ data: PublicProfileRow[] | null; error: RpcError | null }>;
};

type TokenImageSource = {
  source: "dexscreener" | "launch" | "blockscout" | "solana";
  url: string;
};

type BlockscoutTokenMetadata = {
  imageUrl: string | null;
  name: string | null;
  symbol: string | null;
};

type RewardRecipient = {
  address: string;
  label: string;
  shareBps: number | null;
  sharePercent: number | null;
  source: "live" | "stored" | "launch" | "pump-sdk";
};

type CreatorRewardsSnapshot = {
  admin: string | null;
  canDistribute: boolean | null;
  chain: MarketChain | null;
  claimableFeesLamports: string | null;
  claimableFeesSol: string | null;
  claimableFeesEth: string | null;
  claimableFeesWei: string | null;
  distributableFeesLamports: string | null;
  distributableFeesSol: string | null;
  distributableFeesEth: string | null;
  distributableFeesWei: string | null;
  editable: boolean | null;
  error: string | null;
  factoryAddress: string | null;
  feeCollectorAddress: string | null;
  isGraduated: boolean | null;
  minimumRequiredLamports: string | null;
  minimumRequiredSol: string | null;
  minimumRequiredEth: string | null;
  nativeSymbol: "ETH" | "SOL" | null;
  recipients: RewardRecipient[];
  sharingConfigAddress: string | null;
  source: "live" | "stored" | "launch" | "partial" | "none";
  totalShareBps: number | null;
  version: number | null;
};

const ROBINHOOD_DEXSCREENER_CHAIN_SLUG =
  import.meta.env.VITE_ROBINHOOD_DEXSCREENER_CHAIN_SLUG || "robinhood";
const ROBINHOOD_CHAIN_ID = 4663;
const SOLANA_DEXSCREENER_CHAIN_SLUG = "solana";
const SOLANA_EXPLORER_BASE_URL = "https://solscan.io/token";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const Route = createFileRoute("/coin/$mint")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.mint.slice(0, 8)}... - Linkr` },
      {
        name: "description",
        content: `Live EVM and Solana token detail for mint ${params.mint}.`,
      },
    ],
  }),
  component: CoinPage,
});

function CoinPage() {
  const { mint: routeMint } = Route.useParams();
  const marketAddress = useMemo(() => normalizeMarketAddress(routeMint), [routeMint]);
  const mint = marketAddress?.address ?? routeMint.trim();
  const chain = marketAddress?.chain ?? null;
  const isSupportedToken = Boolean(marketAddress);
  const isRobinhoodToken = chain === "robinhood";
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const launchQuery = useQuery({
    queryKey: ["coin-launch", chain, mint],
    enabled: isSupportedToken,
    queryFn: async () => {
      return fetchLaunch(mint, chain ?? "robinhood");
    },
  });

  const dexQuery = useQuery({
    queryKey: ["dex-pairs", chain, mint],
    enabled: isSupportedToken,
    refetchInterval: 30_000,
    queryFn: async () => {
      const pairs = await fetchDexPairs(mint, chain ?? "robinhood");
      return {
        pairs,
        primary: selectPrimaryPair(pairs, mint),
      };
    },
  });

  const launch = launchQuery.data ?? null;
  const pair = dexQuery.data?.primary ?? null;
  const knownImageUrl =
    normalizeImageUrl(pair?.info?.imageUrl) ?? normalizeImageUrl(launch?.image_url);
  const shouldFetchBlockscoutMetadata =
    isRobinhoodToken && !knownImageUrl && !dexQuery.isLoading && !launchQuery.isLoading;
  const blockscoutMetadataQuery = useQuery({
    queryKey: ["blockscout-token-metadata", mint],
    enabled: shouldFetchBlockscoutMetadata,
    retry: 1,
    staleTime: 10 * 60_000,
    queryFn: () => fetchBlockscoutTokenMetadata(mint),
  });
  const blockscoutMetadata = blockscoutMetadataQuery.data ?? null;
  const detail = useMemo(
    () =>
      marketAddress
        ? buildTokenDetail({
            blockscoutMetadata,
            chain: marketAddress.chain,
            launch,
            mint,
            pair,
          })
        : null,
    [blockscoutMetadata, launch, marketAddress, mint, pair],
  );
  const marketCap = firstFinite(pair?.marketCap, pair?.fdv);
  const dexChartUrl = useMemo(() => buildDexscreenerEmbedUrl(pair), [pair]);

  const similarQuery = useQuery({
    queryKey: ["dex-similar", chain, detail?.symbol, mint, pair?.pairAddress],
    enabled: isSupportedToken && Boolean(detail?.symbol),
    queryFn: async () =>
      fetchSimilarPairs(detail?.symbol ?? "", mint, chain ?? "robinhood", pair?.pairAddress),
  });

  const similarPairs = useMemo(() => similarQuery.data ?? [], [similarQuery.data]);

  const creatorRewardsQuery = useQuery({
    queryKey: ["creator-rewards", chain, mint, detail?.creatorRewardsConfig, detail?.userId],
    enabled: isSupportedToken && Boolean(detail),
    refetchInterval: 60_000,
    retry: 1,
    queryFn: () =>
      fetchCreatorRewardsSnapshot({
        creatorRewardsConfig: detail?.creatorRewardsConfig ?? null,
        mint,
        userId: detail?.userId ?? null,
      }),
  });

  const priceChange24h = finiteNumber(pair?.priceChange?.h24);
  const marketDelta =
    marketCap != null ? estimateDeltaFromPercent(marketCap, priceChange24h) : null;
  const progress = getLaunchProgress(launch, pair);
  const isLoading = isSupportedToken && (dexQuery.isLoading || launchQuery.isLoading) && !detail;
  const notFound = !isLoading && !detail;

  useEffect(() => {
    if (!detail) return;

    const symbolLabel = detail.symbol ? ` ($${detail.symbol})` : "";
    document.title = `${detail.name}${symbolLabel} - Linkr`;
  }, [detail]);

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((currentKey) => (currentKey === key ? null : currentKey));
      }, 1600);
    } catch {
      setCopiedKey(null);
    }
  };

  const shareCoin = async () => {
    const url = window.location.href;
    const title = `${detail?.name ?? "Token"} $${detail?.symbol ?? ""} on Linkr`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return;
      }
    }

    await copyText(url, "page");
  };

  return (
    <div className="sm-coin-page">
      <MarketingHeader />
      <main className="sm-coin-shell">
        {isLoading && <div className="sm-coin-loading">Loading live token data...</div>}

        {notFound && (
          <div className="sm-coin-empty">
            <h1>No live token data found</h1>
            <p className="sm-mono">{mint}</p>
            <p>
              {isSupportedToken
                ? `Dexscreener did not return a ${chain ? marketChainLabel(chain) : "supported"} trading pair for this token.`
                : "Linkr token pages support Robinhood Chain 0x token addresses and Solana mint addresses."}
            </p>
            <Link to="/explore">Back to explore</Link>
          </div>
        )}

        {detail && (
          <div className="sm-coin-layout">
            <div className="sm-coin-main">
              <section className="sm-coin-identity" aria-label="Coin summary">
                <div className="sm-coin-token-art">
                  <ImageWithFallback
                    fallback={<span>{detail.symbol.slice(0, 2)}</span>}
                    urls={detail.imageSources.map((source) => source.url)}
                  />
                </div>

                <div className="sm-coin-title-block">
                  <div
                    className="sm-coin-title-line"
                    style={
                      {
                        "--coin-name-chars": Math.max(detail.name.length, 1),
                      } as CSSProperties
                    }
                  >
                    <h1>{detail.name}</h1>
                    <span>${detail.symbol}</span>
                  </div>
                  <div className="sm-coin-subline">
                    <span>{detail.status}</span>
                    {detail.launcher && (
                      <span>
                        by{" "}
                        <Link
                          className="sm-coin-launcher-pill"
                          to="/u/$username"
                          params={{ username: detail.launcher.username }}
                        >
                          @{detail.launcher.username}
                        </Link>
                      </span>
                    )}
                    {detail.launchSource === "website" && <span>Website launch</span>}
                    {detail.createdAt && <span>{relativeTime(detail.createdAt)}</span>}
                    {pair?.dexId && <span>{pair.dexId}</span>}
                    <span>{detail.chainLabel}</span>
                  </div>
                </div>

                <div className="sm-coin-identity-actions">
                  <button type="button" onClick={shareCoin}>
                    <Share2 aria-hidden="true" size={17} />
                    Share
                  </button>
                  <button type="button" onClick={() => copyText(mint, "mint")}>
                    {copiedKey === "mint" ? (
                      <Check aria-hidden="true" className="sm-coin-copy-confirmed" size={17} />
                    ) : (
                      <Copy aria-hidden="true" size={17} />
                    )}
                    {shortAddress(mint, 5, 5)}
                  </button>
                  {pair?.pairAddress && (
                    <button type="button" onClick={() => copyText(pair.pairAddress ?? "", "pair")}>
                      {copiedKey === "pair" ? (
                        <Check aria-hidden="true" className="sm-coin-copy-confirmed" size={17} />
                      ) : (
                        <Copy aria-hidden="true" size={17} />
                      )}
                      Pair
                    </button>
                  )}
                </div>

                <div className="sm-coin-links">
                  {detail.isLaunch && detail.tweetId && (
                    <a
                      href={`https://x.com/i/web/status/${detail.tweetId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <X aria-hidden="true" size={15} />
                      Launch tweet
                    </a>
                  )}
                  {pair?.url && (
                    <a href={pair.url} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" size={15} />
                      Dexscreener
                    </a>
                  )}
                  {detail.explorerUrl && (
                    <a href={detail.explorerUrl} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden="true" size={15} />
                      Explorer
                    </a>
                  )}
                </div>
              </section>

              <section className="sm-coin-chart-card" aria-label="Market chart">
                <div className="sm-coin-chart-summary">
                  <div>
                    <span>Market cap</span>
                    <strong>{formatCompactUsd(marketCap)}</strong>
                    <small
                      className={priceChange24h != null && priceChange24h < 0 ? "is-down" : "is-up"}
                    >
                      {marketDelta != null ? formatSignedCompactUsd(marketDelta) + " " : ""}
                      {formatPercent(priceChange24h)} 24h
                    </small>
                  </div>
                </div>

                <DexscreenerChart
                  isLoading={dexQuery.isLoading}
                  name={detail.name}
                  url={dexChartUrl}
                />

                <div className="sm-coin-chart-footer">
                  <span>Chart: Dexscreener</span>
                  {pair?.url && (
                    <a href={pair.url} target="_blank" rel="noreferrer">
                      Open full chart
                    </a>
                  )}
                </div>
              </section>

              <section className="sm-coin-about">
                <h2>About ${detail.symbol}</h2>
                <p>{detail.description}</p>
                <div className="sm-coin-about-meta">
                  <span>
                    {detail.addressLabel} {shortAddress(mint, 6, 6)}
                  </span>
                  {pair?.pairAddress && <span>Pair {shortAddress(pair.pairAddress, 6, 6)}</span>}
                  {detail.createdAt && <span>Listed {relativeTime(detail.createdAt)}</span>}
                  {detail.txSignature && <span>confirmed on-chain</span>}
                </div>
              </section>

              <CreatorRewards
                detail={detail}
                isLoading={creatorRewardsQuery.isLoading}
                rewards={creatorRewardsQuery.data ?? null}
              />

              <section className="sm-coin-metrics" aria-label="Market metrics">
                <MetricTile label="Vol 24h" value={formatCompactUsd(pair?.volume?.h24)} />
                <MetricTile label="Liquidity" value={formatCompactUsd(pair?.liquidity?.usd)} />
                <MetricTile
                  label="Price"
                  value={<TokenPriceValue value={pair?.priceUsd} />}
                  valueClassName="sm-coin-price-value"
                />
                <MetricTile
                  label="5m"
                  value={formatPercent(pair?.priceChange?.m5)}
                  tone={pair?.priceChange?.m5}
                />
                <MetricTile
                  label="1h"
                  value={formatPercent(pair?.priceChange?.h1)}
                  tone={pair?.priceChange?.h1}
                />
              </section>

              <CoinComments mint={mint} symbol={detail.symbol} />
            </div>

            <aside className="sm-coin-side" aria-label="Coin actions and related data">
              <CoinLauncherCard detail={detail} />
              <TradeCommandCard
                detail={detail}
                liquidityUsd={pair?.liquidity?.usd}
                mint={mint}
                pair={pair}
              />
              <SimilarCoins pairs={similarPairs} />
              {!detail.isLaunch && <PoolStatsCard detail={detail} pair={pair} mint={mint} />}
              {detail.isLaunch ? (
                <BondingProgress progress={progress} />
              ) : (
                <TokenLinksCard detail={detail} pair={pair} />
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function CoinLauncherCard({ detail }: { detail: TokenDetail }) {
  if (!detail.launcher) return null;

  const { launcher } = detail;
  const initials = initialsFor(launcher.name ?? launcher.username);
  const launchedAt = detail.createdAt ? relativeTime(detail.createdAt) : "Linkr launch";

  return (
    <section className="sm-coin-side-card">
      <div className="sm-coin-side-title">
        <span>
          <UserRound aria-hidden="true" size={16} />
          Launched by
        </span>
        <small>Creator</small>
      </div>

      <Link
        className="sm-coin-creator-row"
        to="/u/$username"
        params={{ username: launcher.username }}
        aria-label={`View @${launcher.username}'s profile`}
      >
        <span>
          {launcher.profileImageUrl ? <img src={launcher.profileImageUrl} alt="" /> : initials}
        </span>
        <div>
          <strong>@{launcher.username}</strong>
          <small>{launcher.name ?? "Linkr launcher"}</small>
        </div>
        <b>{launchedAt}</b>
      </Link>
    </section>
  );
}

function TradeCommandCard({
  detail,
  liquidityUsd,
  mint,
  pair,
}: {
  detail: TokenDetail;
  liquidityUsd?: number | null;
  mint: string;
  pair: DexPair | null;
}) {
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [buyAmount, setBuyAmount] = useState("100");
  const [sellPercent, setSellPercent] = useState("50");
  const isBuy = tradeSide === "buy";
  const normalizedBuyAmount = normalizeTradeAmount(buyAmount, 100);
  const normalizedSellPercent = normalizeTradeAmount(sellPercent, 50, 100);
  const tradeCommand = isBuy
    ? `@linkrcash buy $${normalizedBuyAmount} of ${mint}`
    : `@linkrcash sell ${normalizedSellPercent}% of ${mint}`;
  const buyAmounts = [25, 100, 250];
  const sellPercents = [25, 50, 100];
  const activeAmount = isBuy ? buyAmount : sellPercent;

  return (
    <section className="sm-coin-trade-card" aria-label="Token buy and sell command card">
      <div className="sm-coin-trade-tabs">
        <button aria-pressed={isBuy} onClick={() => setTradeSide("buy")} type="button">
          Buy
        </button>
        <button aria-pressed={!isBuy} onClick={() => setTradeSide("sell")} type="button">
          Sell
        </button>
      </div>

      <label className="sm-coin-trade-amount">
        <span>{isBuy ? "$" : ""}</span>
        <input
          aria-label={isBuy ? "Buy amount in USD" : "Sell percent"}
          className="sm-coin-trade-input"
          inputMode="decimal"
          onChange={(event) => {
            const nextValue = sanitizeTradeAmountInput(event.target.value, isBuy ? undefined : 100);
            if (isBuy) {
              setBuyAmount(nextValue);
            } else {
              setSellPercent(nextValue);
            }
          }}
          pattern="[0-9]*[.]?[0-9]*"
          placeholder={isBuy ? "100" : "50"}
          type="text"
          value={activeAmount}
        />
        <small>{isBuy ? "USD" : "% sell"}</small>
      </label>

      <div className="sm-coin-trade-presets">
        {isBuy
          ? buyAmounts.map((amount) => (
              <button
                aria-pressed={normalizedBuyAmount === String(amount)}
                key={amount}
                onClick={() => setBuyAmount(String(amount))}
                type="button"
              >
                ${amount}
              </button>
            ))
          : sellPercents.map((percent) => (
              <button
                aria-pressed={normalizedSellPercent === String(percent)}
                key={percent}
                onClick={() => setSellPercent(String(percent))}
                type="button"
              >
                {percent}%
              </button>
            ))}
      </div>

      <a
        className="sm-coin-trade-submit"
        href={xIntent(tradeCommand)}
        target="_blank"
        rel="noreferrer"
      >
        {isBuy ? `Post ${detail.chainLabel} buy` : `Post ${detail.chainLabel} sell`}
        <ArrowRight aria-hidden="true" size={18} />
      </a>

      <div className="sm-coin-trade-command">
        <span>Command</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(tradeCommand);
          }}
          type="button"
        >
          {tradeCommand}
        </button>
      </div>

      {pair?.url && (
        <a className="sm-coin-trade-link" href={pair.url} target="_blank" rel="noreferrer">
          Open live pair
          <ExternalLink aria-hidden="true" size={15} />
        </a>
      )}
    </section>
  );
}

function normalizeTradeAmount(value: string, fallback: number, max?: number) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  const bounded = max != null ? Math.min(safe, max) : safe;
  return bounded.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    useGrouping: false,
  });
}

function sanitizeTradeAmountInput(value: string, max?: number) {
  const digitsAndDot = value.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = digitsAndDot.split(".");
  const decimal = rest.join("").slice(0, 6);
  const wholePart = whole.replace(/^0+(?=\d)/, "");
  const normalized = rest.length > 0 ? `${wholePart || "0"}.${decimal}` : wholePart;
  if (!normalized) return "";
  const parsed = Number(normalized);
  if (max != null && Number.isFinite(parsed) && parsed > max) return String(max);
  return normalized;
}

function SimilarCoins({ pairs }: { pairs: DexPair[] }) {
  return (
    <section className="sm-coin-side-card">
      <div className="sm-coin-side-title">
        <span>
          <Link2 aria-hidden="true" size={16} />
          Similar coins
        </span>
        <small>{pairs.length || "0"}</small>
      </div>
      <div className="sm-coin-similar-list">
        {pairs.length === 0 && <p>No related Dexscreener pairs found yet.</p>}
        {pairs.map((pair) => (
          <a
            key={pair.pairAddress ?? pair.baseToken?.address}
            href={pair.url ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            <CoinAvatar pair={pair} />
            <span>
              <strong>{pair.baseToken?.name ?? "Unknown coin"}</strong>
              <small>${pair.baseToken?.symbol ?? "TOKEN"}</small>
            </span>
            <b>{formatCompactUsd(firstFinite(pair.marketCap, pair.fdv, pair.liquidity?.usd))}</b>
          </a>
        ))}
      </div>
    </section>
  );
}

function CreatorRewards({
  detail,
  isLoading,
  rewards,
}: {
  detail: TokenDetail;
  isLoading: boolean;
  rewards: CreatorRewardsSnapshot | null;
}) {
  const baseRecipients = rewards?.recipients.length ? rewards.recipients : [];
  const creatorAddress = rewards?.admin ?? detail.userId;
  const isNoConfig = rewards?.source === "none";
  const recipients = isNoConfig ? [] : ensureCreatorRecipient(baseRecipients, creatorAddress);
  const displayRecipients = recipients.length
    ? recipients
    : isNoConfig
      ? [
          {
            address: creatorAddress ?? "Creator wallet",
            label: "Creator",
            shareBps: 10000,
            sharePercent: 100,
            source: "launch" as const,
          },
        ]
      : [
          {
            address: "No on-chain split",
            label: "No split configured",
            shareBps: null,
            sharePercent: null,
            source: "launch" as const,
          },
        ];
  const totalShareBps =
    rewards?.totalShareBps ??
    (isNoConfig
      ? 10000
      : recipients.reduce((sum, recipient) => sum + (recipient.shareBps ?? 0), 0) || null);
  const totalSharePercent = totalShareBps != null ? totalShareBps / 100 : null;
  const sourceLabel =
    rewards?.source === "live"
      ? detail.chain === "solana"
        ? "Pump SDK"
        : "Live launch config"
      : rewards?.source === "stored"
        ? "Stored launch config"
        : rewards?.source === "partial"
          ? "Partial config"
          : "Creator keeps rewards";
  const claimableFeesNative =
    detail.chain === "solana"
      ? (rewards?.claimableFeesSol ?? rewards?.distributableFeesSol ?? null)
      : (rewards?.claimableFeesEth ?? rewards?.distributableFeesEth ?? null);
  const claimableFeesBaseUnits =
    detail.chain === "solana"
      ? (rewards?.claimableFeesLamports ?? rewards?.distributableFeesLamports ?? null)
      : (rewards?.claimableFeesWei ?? rewards?.distributableFeesWei ?? null);
  const claimableLabel =
    claimableFeesBaseUnits != null
      ? formatRewardBaseUnitAmount(
          claimableFeesBaseUnits,
          detail.chain === "solana" ? 9 : 18,
          detail.nativeSymbol,
        )
      : claimableFeesNative != null
        ? formatRewardNativeAmount(claimableFeesNative, detail.nativeSymbol)
        : rewards?.canDistribute === false
          ? "Below minimum"
          : "--";

  return (
    <section className="sm-coin-side-card sm-coin-rewards-card">
      <div className="sm-coin-side-title sm-coin-rewards-title">
        <span>
          <ShieldCheck aria-hidden="true" size={16} />
          Creator rewards
        </span>
        <small>{isLoading ? "Syncing" : sourceLabel}</small>
      </div>

      <div className="sm-coin-rewards-hero">
        <div>
          <span>Available to claim now</span>
          <strong>{claimableLabel}</strong>
          <small>
            {detail.chain === "solana"
              ? "Pump fee sharing rewards currently distributable for this mint."
              : "Live creator rewards currently available from this coin."}
          </small>
        </div>
        <span className="sm-coin-rewards-orb">
          <DollarSign aria-hidden="true" size={26} />
        </span>
      </div>

      <div className="sm-coin-rewards-chips" aria-label="Creator reward split">
        <span>
          <small>Creator split</small>
          <strong>{formatRewardPercent(totalSharePercent)}</strong>
        </span>
      </div>

      <div className="sm-coin-rewards-list">
        <div className="sm-coin-rewards-list-head">
          <span>Distribution</span>
          <small>Wallet shares</small>
        </div>
        {displayRecipients.map((recipient, index) => {
          const sharePercent = clampPercent(recipient.sharePercent ?? 0);
          const walletUrl = accountExplorerUrl(detail.chain, recipient.address);
          return (
            <div key={`${recipient.address}-${index}`} className="sm-coin-reward-recipient">
              <span>{recipient.label.slice(0, 2).toUpperCase()}</span>
              <div className="sm-coin-reward-body">
                <span className="sm-coin-reward-row">
                  <strong>{recipient.label}</strong>
                  <b>{formatRewardPercent(recipient.sharePercent)}</b>
                </span>
                <small>
                  {walletUrl ? (
                    <a href={walletUrl} target="_blank" rel="noreferrer">
                      {formatRewardAddress(recipient.address)}
                    </a>
                  ) : (
                    formatRewardAddress(recipient.address)
                  )}
                </small>
                <span
                  className="sm-coin-reward-meter"
                  aria-label={`${recipient.label} share ${formatRewardPercent(recipient.sharePercent)}`}
                >
                  <i style={{ width: `${sharePercent}%` }} />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="sm-coin-rewards-note">
        {isNoConfig
          ? "Creator is collecting all trading fee rewards."
          : rewards?.feeCollectorAddress
            ? `Fee collector ${shortAddress(rewards.feeCollectorAddress, 6, 6)}`
            : rewards?.sharingConfigAddress
              ? `Sharing config ${shortAddress(rewards.sharingConfigAddress, 6, 6)}`
              : rewards?.error
                ? rewards.error
                : "Waiting for the launch sharing config to appear on-chain."}
      </p>
    </section>
  );
}

function PoolStatsCard({
  detail,
  mint,
  pair,
}: {
  detail: TokenDetail;
  mint: string;
  pair: DexPair | null;
}) {
  const buys = Number(pair?.txns?.h24?.buys ?? 0);
  const sells = Number(pair?.txns?.h24?.sells ?? 0);

  return (
    <section className="sm-coin-side-card">
      <div className="sm-coin-side-title">
        <span>
          <ShieldCheck aria-hidden="true" size={16} />
          Pool details
        </span>
      </div>
      <div className="sm-coin-info-list">
        <span>
          <small>DEX</small>
          <strong>{pair?.dexId ?? "--"}</strong>
        </span>
        <span>
          <small>Pair</small>
          <strong>{shortAddress(pair?.pairAddress, 6, 6)}</strong>
        </span>
        <span>
          <small>24h buys / sells</small>
          <strong>{pair ? `${buys.toLocaleString()} / ${sells.toLocaleString()}` : "--"}</strong>
        </span>
        <a
          href={detail.explorerUrl ?? tokenExplorerUrl(detail.chain, mint)}
          target="_blank"
          rel="noreferrer"
        >
          View token on explorer
        </a>
      </div>
    </section>
  );
}

function BondingProgress({ progress }: { progress: number }) {
  return (
    <section className="sm-coin-side-card sm-coin-progress-card">
      <div className="sm-coin-progress-head">
        <span>Bonding curve progress</span>
        <strong>{progress.toFixed(1)}%</strong>
      </div>
      <div className="sm-coin-progress-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p>
        {progress >= 100
          ? "Coin has graduated."
          : progress > 0
            ? "Trading on the bonding curve. Graduates at ~$69k market cap."
            : "Waiting for the first trades on the bonding curve."}
      </p>
    </section>
  );
}

function TokenLinksCard({ detail, pair }: { detail: TokenDetail; pair: DexPair | null }) {
  const links = [
    ...(pair?.info?.websites ?? []).map((site) => ({
      label: site.label || "Website",
      url: site.url,
    })),
    ...(pair?.info?.socials ?? []).map((site) => ({
      label: titleCase(site.type || "social"),
      url: site.url,
    })),
    { label: "Explorer", url: detail.explorerUrl },
    pair?.url ? { label: "Dexscreener", url: pair.url } : null,
  ].filter((item): item is { label: string; url: string } => Boolean(item?.url));

  return (
    <section className="sm-coin-side-card">
      <div className="sm-coin-side-title">
        <span>
          <ExternalLink aria-hidden="true" size={16} />
          Token links
        </span>
      </div>
      <div className="sm-coin-link-list">
        {links.map((link) => (
          <a key={link.label + link.url} href={link.url} target="_blank" rel="noreferrer">
            {link.label}
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        ))}
      </div>
    </section>
  );
}

function MetricTile({
  label,
  tone,
  value,
  valueClassName = "",
}: {
  label: string;
  tone?: number | null;
  value: ReactNode;
  valueClassName?: string;
}) {
  const toneClass = tone == null ? "" : tone < 0 ? "is-down" : "is-up";

  return (
    <div className="sm-coin-metric">
      <span>{label}</span>
      <strong className={[toneClass, valueClassName].filter(Boolean).join(" ")}>{value}</strong>
    </div>
  );
}

function TokenPriceValue({ value }: { value: number | string | null | undefined }) {
  const price = formatTokenPrice(value);

  if (typeof price === "string") {
    return <>{price}</>;
  }

  return (
    <span className="sm-token-price-compact" aria-label={price.full}>
      <span>$0.0</span>
      <sub>{price.zeroCount}</sub>
      <span>{price.significant}</span>
    </span>
  );
}

function ImageWithFallback({ fallback, urls }: { fallback: ReactNode; urls: string[] }) {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const normalizedUrls = useMemo(() => uniqueStrings(urls.map(normalizeImageUrl)), [urls]);
  const currentUrl = normalizedUrls.find((url) => !failedUrls.has(url));

  useEffect(() => {
    setFailedUrls(new Set());
  }, [normalizedUrls.join("|")]);

  if (!currentUrl) return <>{fallback}</>;

  return (
    <img
      src={currentUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setFailedUrls((current) => {
          const next = new Set(current);
          next.add(currentUrl);
          return next;
        });
      }}
    />
  );
}

function CoinAvatar({ pair }: { pair: DexPair }) {
  return (
    <ImageWithFallback
      fallback={<em>{(pair.baseToken?.symbol ?? "TK").slice(0, 2)}</em>}
      urls={[pair.info?.imageUrl ?? ""]}
    />
  );
}

function DexscreenerChart({
  isLoading,
  name,
  url,
}: {
  isLoading: boolean;
  name: string;
  url: string | null;
}) {
  if (isLoading) {
    return <div className="sm-coin-chart-state">Loading Dexscreener chart...</div>;
  }

  if (!url) {
    return <div className="sm-coin-chart-state">No Dexscreener chart found for this pair.</div>;
  }

  return (
    <div className="sm-coin-chart-wrap">
      <iframe
        title={`${name} Dexscreener chart`}
        src={url}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
        style={{
          border: 0,
          display: "block",
          height: "clamp(420px, 52vw, 720px)",
          width: "100%",
        }}
      />
    </div>
  );
}

async function fetchDexPairs(mint: string, chain: MarketChain): Promise<DexPair[]> {
  const endpoint = `https://api.dexscreener.com/token-pairs/v1/${dexscreenerChainSlug(chain)}/${mint}`;
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return Array.isArray(data) ? data : Array.isArray(data?.pairs) ? data.pairs : [];
}

async function fetchLaunch(
  address: string,
  chain: MarketChain,
): Promise<LaunchWithLauncher | null> {
  const normalized = normalizeMarketAddress(address);
  if (!normalized || normalized.chain !== chain) return null;

  const { data, error } = await supabase
    .from("coin_launches")
    .select("*")
    .or(`token_address.ilike.${normalized.address},mint.ilike.${normalized.address}`)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw error;

  const matchingRows = (data ?? []).filter((row) =>
    sameMarketAddress(row.token_address ?? row.mint, normalized.address),
  );

  const launch =
    chain === "robinhood"
      ? (matchingRows.find((row) => row.chain_id === ROBINHOOD_CHAIN_ID) ??
        matchingRows.find((row) => row.chain_id == null) ??
        null)
      : (matchingRows.find((row) => row.chain_id !== ROBINHOOD_CHAIN_ID) ?? null);

  if (!launch) return null;

  return {
    ...launch,
    launcher: await fetchLauncherProfile(launch.user_id),
  };
}

async function fetchLauncherProfile(userId: string | null): Promise<LauncherProfile | null> {
  if (!userId) return null;

  try {
    const { data, error } = await profileRpc.rpc("get_public_profiles", { _user_ids: [userId] });
    if (error) return null;

    const row = (data ?? []).find((profile) => profile.user_id === userId);
    const username = normalizeProfileHandle(row?.twitter_username);
    if (!username) return null;

    return {
      name: stringValue(row?.twitter_name),
      profileImageUrl: normalizeImageUrl(row?.twitter_profile_image_url),
      username,
    };
  } catch {
    return null;
  }
}

async function fetchBlockscoutTokenMetadata(
  tokenAddress: string,
): Promise<BlockscoutTokenMetadata | null> {
  const normalizedTokenAddress = normalizeRobinhoodTokenAddress(tokenAddress);
  if (!normalizedTokenAddress) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);

  try {
    const response = await fetch(
      `https://robinhoodchain.blockscout.com/api/v2/tokens/${normalizedTokenAddress}`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    return normalizeBlockscoutTokenMetadata(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSimilarPairs(
  symbol: string,
  mint: string,
  chain: MarketChain,
  currentPairAddress?: string,
): Promise<DexPair[]> {
  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(`${symbol} ${dexscreenerChainSlug(chain)}`)}`,
    { headers: { Accept: "application/json" } },
  );

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const seen = new Set<string>();

  return ((data?.pairs ?? []) as DexPair[])
    .filter((pair) => {
      const key = pair.pairAddress ?? pair.baseToken?.address ?? "";
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return (
        pair.chainId === dexscreenerChainSlug(chain) &&
        pair.pairAddress !== currentPairAddress &&
        !sameMarketAddress(pair.baseToken?.address, mint)
      );
    })
    .sort((a, b) => scorePair(b, mint) - scorePair(a, mint))
    .slice(0, 5);
}

async function fetchCreatorRewardsSnapshot({
  creatorRewardsConfig,
  mint,
  userId,
}: {
  creatorRewardsConfig: Json | null;
  mint: string;
  userId: string | null;
}): Promise<CreatorRewardsSnapshot> {
  const storedRecipients = normalizeStoredRewardRecipients(creatorRewardsConfig);

  try {
    const { data, error } = await supabase.functions.invoke("creator-rewards-config", {
      body: { mint },
    });

    if (error) throw error;

    const liveSnapshot = normalizeEdgeRewardsSnapshot(data, userId);
    if (!liveSnapshot) {
      return {
        ...emptyRewardsSnapshot(),
        recipients: storedRecipients,
        source: storedRecipients.length ? "stored" : "none",
        totalShareBps: totalRecipientBps(storedRecipients),
      };
    }

    if (liveSnapshot.source !== "live" && liveSnapshot.source !== "partial") {
      return {
        ...liveSnapshot,
        recipients: storedRecipients,
        source: storedRecipients.length ? "stored" : liveSnapshot.source,
        totalShareBps: totalRecipientBps(storedRecipients),
      };
    }

    return liveSnapshot;
  } catch (error) {
    return {
      admin: null,
      canDistribute: null,
      chain: null,
      claimableFeesLamports: null,
      claimableFeesSol: null,
      claimableFeesEth: null,
      claimableFeesWei: null,
      distributableFeesLamports: null,
      distributableFeesSol: null,
      distributableFeesEth: null,
      distributableFeesWei: null,
      editable: null,
      error: error instanceof Error ? error.message : "Creator rewards are unavailable right now.",
      factoryAddress: null,
      feeCollectorAddress: null,
      isGraduated: null,
      minimumRequiredLamports: null,
      minimumRequiredSol: null,
      minimumRequiredEth: null,
      nativeSymbol: null,
      recipients: storedRecipients,
      sharingConfigAddress: null,
      source: storedRecipients.length ? "stored" : "none",
      totalShareBps: totalRecipientBps(storedRecipients),
      version: null,
    };
  }
}

function emptyRewardsSnapshot(): CreatorRewardsSnapshot {
  return {
    admin: null,
    canDistribute: null,
    chain: null,
    claimableFeesLamports: null,
    claimableFeesSol: null,
    claimableFeesEth: null,
    claimableFeesWei: null,
    distributableFeesLamports: null,
    distributableFeesSol: null,
    distributableFeesEth: null,
    distributableFeesWei: null,
    editable: null,
    error: null,
    factoryAddress: null,
    feeCollectorAddress: null,
    isGraduated: null,
    minimumRequiredLamports: null,
    minimumRequiredSol: null,
    minimumRequiredEth: null,
    nativeSymbol: null,
    recipients: [],
    sharingConfigAddress: null,
    source: "none",
    totalShareBps: null,
    version: null,
  };
}

function normalizeEdgeRewardsSnapshot(
  value: unknown,
  userId: string | null,
): CreatorRewardsSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const rawRecipients = Array.isArray(data.recipients) ? data.recipients : [];
  const recipients = rawRecipients
    .map((recipient): RewardRecipient | null => {
      if (!recipient || typeof recipient !== "object") return null;
      const item = recipient as Record<string, unknown>;
      const address = stringValue(item.address);
      if (!address) return null;
      const shareBps = numberValue(item.shareBps ?? item.share_bps ?? item.bps);
      const sharePercent = numberValue(item.sharePercent ?? item.share_percent ?? item.percent);

      return {
        address,
        label: stringValue(item.label) ?? labelRewardRecipient(address, userId),
        shareBps,
        sharePercent: sharePercent ?? (shareBps != null ? shareBps / 100 : null),
        source: "live" as const,
      };
    })
    .filter((recipient): recipient is RewardRecipient => Boolean(recipient));

  return {
    admin: stringValue(data.admin),
    canDistribute: booleanValue(data.canDistribute),
    chain: marketChainValue(data.chain),
    claimableFeesLamports: stringValue(
      data.claimableFeesLamports ?? data.distributableFeesLamports,
    ),
    claimableFeesSol: stringValue(data.claimableFeesSol ?? data.distributableFeesSol),
    claimableFeesEth: stringValue(data.claimableFeesEth ?? data.distributableFeesEth),
    claimableFeesWei: stringValue(data.claimableFeesWei ?? data.distributableFeesWei),
    distributableFeesLamports: stringValue(data.distributableFeesLamports),
    distributableFeesSol: stringValue(data.distributableFeesSol),
    distributableFeesEth: stringValue(data.distributableFeesEth),
    distributableFeesWei: stringValue(data.distributableFeesWei),
    editable: booleanValue(data.editable),
    error: stringValue(data.error),
    factoryAddress: stringValue(data.factoryAddress),
    feeCollectorAddress: stringValue(data.feeCollectorAddress),
    isGraduated: booleanValue(data.isGraduated),
    minimumRequiredLamports: stringValue(data.minimumRequiredLamports),
    minimumRequiredSol: stringValue(data.minimumRequiredSol),
    minimumRequiredEth: stringValue(data.minimumRequiredEth),
    nativeSymbol: nativeSymbolValue(data.nativeSymbol),
    recipients,
    sharingConfigAddress: stringValue(data.sharingConfigAddress),
    source:
      data.source === "live" || data.source === "partial" || data.source === "stored"
        ? data.source
        : "none",
    totalShareBps: numberValue(data.totalShareBps) ?? totalRecipientBps(recipients),
    version: numberValue(data.version),
  };
}

function selectPrimaryPair(pairs: DexPair[], mint: string): DexPair | null {
  return [...pairs].sort((a, b) => scorePair(b, mint) - scorePair(a, mint))[0] ?? null;
}

function normalizeStoredRewardRecipients(config: Json | null): RewardRecipient[] {
  if (!config || typeof config !== "object") return [];
  const root = config as Record<string, unknown>;
  const candidates = [
    root.shareholders,
    root.recipients,
    root.distribution,
    root.distributions,
    root.splits,
    root.wallets,
  ];
  const rows = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!rows) return [];

  return rows
    .map((row, index): RewardRecipient | null => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const address = stringValue(
        item.address ??
          item.wallet ??
          item.recipient ??
          item.publicKey ??
          item.pubkey ??
          item.user_id,
      );
      if (!address) return null;
      const bps = numberValue(item.shareBps ?? item.share_bps ?? item.bps);
      const percent = numberValue(item.percent ?? item.percentage ?? item.share);
      const shareBps = bps ?? (percent != null ? percent * 100 : null);
      const sharePercent = percent ?? (bps != null ? bps / 100 : null);

      return {
        address,
        label: stringValue(item.label ?? item.name ?? item.role) ?? `Recipient ${index + 1}`,
        shareBps,
        sharePercent,
        source: "stored" as const,
      };
    })
    .filter((recipient): recipient is RewardRecipient => Boolean(recipient));
}

function ensureCreatorRecipient(
  recipients: RewardRecipient[],
  creatorAddress: string | null,
): RewardRecipient[] {
  if (!creatorAddress) return recipients;
  let hasCreator = false;
  const nextRecipients = recipients.map((recipient) => {
    if (recipient.address !== creatorAddress) return recipient;
    hasCreator = true;
    return { ...recipient, label: "Creator" };
  });

  if (hasCreator) return nextRecipients;

  return [
    {
      address: creatorAddress,
      label: "Creator",
      shareBps: 0,
      sharePercent: 0,
      source: "live",
    },
    ...nextRecipients,
  ];
}

function labelRewardRecipient(address: string, userId: string | null): string {
  if (userId && address === userId) return "Creator";
  return "Reward wallet";
}

function totalRecipientBps(recipients: RewardRecipient[]): number | null {
  const total = recipients.reduce((sum, recipient) => sum + (recipient.shareBps ?? 0), 0);
  return total > 0 ? total : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeBlockscoutTokenMetadata(value: unknown): BlockscoutTokenMetadata | null {
  if (!value || typeof value !== "object") return null;
  const token = value as Record<string, unknown>;
  const nestedToken =
    token.token && typeof token.token === "object" ? (token.token as Record<string, unknown>) : {};
  const nestedMetadata =
    token.metadata && typeof token.metadata === "object"
      ? (token.metadata as Record<string, unknown>)
      : {};

  const imageUrl = normalizeImageUrl(
    token.icon_url ??
      token.logo_url ??
      token.image_url ??
      nestedToken.icon_url ??
      nestedToken.logo_url ??
      nestedToken.image_url ??
      nestedMetadata.image ??
      nestedMetadata.logo ??
      nestedMetadata.logoURI,
  );
  const name = stringValue(token.name ?? nestedToken.name);
  const symbol = stringValue(token.symbol ?? nestedToken.symbol);

  if (!imageUrl && !name && !symbol) return null;

  return { imageUrl, name, symbol };
}

function collectTokenImageSources({
  blockscoutMetadata,
  launch,
  pair,
}: {
  blockscoutMetadata: BlockscoutTokenMetadata | null;
  launch: LaunchWithLauncher | null;
  pair: DexPair | null;
}): TokenImageSource[] {
  const candidates: TokenImageSource[] = [
    { source: "dexscreener", url: pair?.info?.imageUrl ?? "" },
    { source: "launch", url: launch?.image_url ?? "" },
    { source: "blockscout", url: blockscoutMetadata?.imageUrl ?? "" },
  ];
  const seen = new Set<string>();

  return candidates.reduce<TokenImageSource[]>((sources, candidate) => {
    const url = normalizeImageUrl(candidate.url);
    if (!url || seen.has(url)) return sources;
    seen.add(url);
    sources.push({ ...candidate, url });
    return sources;
  }, []);
}

function normalizeImageUrl(value: unknown): string | null {
  const raw = stringValue(value);
  return resolveIpfsUrl(raw);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function scorePair(pair: DexPair, mint: string): number {
  const baseMatch = sameMarketAddress(pair.baseToken?.address, mint) ? 1_000_000_000 : 0;
  const quoteMatch = sameMarketAddress(pair.quoteToken?.address, mint) ? 100_000_000 : 0;
  return (
    baseMatch +
    quoteMatch +
    Number(pair.liquidity?.usd ?? 0) * 100 +
    Number(pair.volume?.h24 ?? 0) * 4 +
    Number(pair.marketCap ?? pair.fdv ?? 0)
  );
}

function buildDexscreenerEmbedUrl(pair: DexPair | null): string | null {
  const rawUrl =
    pair?.url ||
    (pair?.chainId && pair?.pairAddress
      ? `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`
      : null);
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "dexscreener.com" ||
      url.username ||
      url.password ||
      !/^\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._~-]{1,128}\/?$/.test(url.pathname)
    ) {
      return null;
    }
    url.hash = "";
    url.search = "";
    url.searchParams.set("embed", "1");
    url.searchParams.set("theme", "dark");
    url.searchParams.set("trades", "0");
    url.searchParams.set("info", "0");
    return url.toString();
  } catch {
    return null;
  }
}

function getTokenForMint(pair: DexPair | null, mint: string): DexToken | null {
  if (!pair) return null;
  if (sameMarketAddress(pair.baseToken?.address, mint)) return pair.baseToken ?? null;
  if (sameMarketAddress(pair.quoteToken?.address, mint)) return pair.quoteToken ?? null;
  return pair.baseToken ?? pair.quoteToken ?? null;
}

function buildTokenDetail({
  blockscoutMetadata,
  chain,
  launch,
  mint,
  pair,
}: {
  blockscoutMetadata: BlockscoutTokenMetadata | null;
  chain: MarketChain;
  launch: LaunchWithLauncher | null;
  mint: string;
  pair: DexPair | null;
}): TokenDetail | null {
  if (!launch && !pair) return null;

  const token = getTokenForMint(pair, mint);
  const name = token?.name || launch?.name || blockscoutMetadata?.name || shortAddress(mint, 6, 6);
  const symbol = token?.symbol || launch?.symbol || blockscoutMetadata?.symbol || "TOKEN";
  const pairCreatedAt = pair?.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null;
  const isLaunch = Boolean(launch);
  const imageSources = collectTokenImageSources({ blockscoutMetadata, launch, pair });
  const description =
    launch?.description ||
    (pair
      ? `Live ${marketChainLabel(chain)} market data for ${name}, sourced from the active ${pair.dexId ?? "DEX"} pair.`
      : `Linkr launch details for ${name}.`);

  return {
    addressLabel: chain === "solana" ? "Mint" : "Contract",
    chain,
    chainLabel: marketChainLabel(chain),
    createdAt: launch?.created_at ?? pairCreatedAt,
    creatorRewardsConfig: launch?.creator_rewards_config ?? null,
    description,
    devBuyEth: launch?.dev_buy_eth ?? null,
    devBuySol: launch?.dev_buy_sol ?? null,
    explorerUrl: tokenExplorerUrl(chain, mint),
    imageUrl: imageSources[0]?.url ?? null,
    imageSources,
    isLaunch,
    launcher: launch?.launcher ?? null,
    launchSource: launch?.launch_source ?? null,
    name,
    nativeSymbol: chain === "solana" ? "SOL" : "ETH",
    status: launch?.status ? `launch ${launch.status}` : "live market",
    symbol,
    tweetId: launch?.tweet_id ?? null,
    txSignature: launch?.tx_signature ?? null,
    userId: launch?.user_id ?? null,
  };
}

function getLaunchProgress(launch: Launch | null | undefined, pair: DexPair | null): number {
  if (!launch) return 0;
  // Pump.fun graduation threshold is ~$69k market cap (≈85 SOL raised on the bonding curve).
  // Progress should reflect real trading activity, not just that the mint tx confirmed.
  const GRADUATION_MCAP_USD = 69_000;

  const marketCap = finiteNumber(pair?.marketCap) ?? finiteNumber(pair?.fdv);
  if (marketCap != null && marketCap > 0) {
    const pct = (marketCap / GRADUATION_MCAP_USD) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  // No market data yet — reflect launch pipeline status with a small nominal value.
  if (launch?.status === "confirmed" || launch?.tx_signature) return 0;
  if (launch?.status === "queued") return 0;
  if (launch?.status === "processing") return 0;
  if (launch?.status === "pending") return 0;
  return 0;
}

function estimateDeltaFromPercent(current: number, pct: number | null): number | null {
  if (pct == null) return null;
  const previous = current / Math.max(0.01, 1 + pct / 100);
  return current - previous;
}

function firstFinite(...values: Array<number | string | null | undefined>): number | null {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number != null) return number;
  }

  return null;
}

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) ? number : null;
}

function formatCompactUsd(value: number | string | null | undefined): string {
  const number = finiteNumber(value);
  if (number == null) return "--";
  return `$${formatCompactNumber(number)}`;
}

function formatSignedCompactUsd(value: number | null | undefined): string {
  const number = finiteNumber(value);
  if (number == null) return "";
  const sign = number >= 0 ? "+" : "-";
  return `${sign}$${formatCompactNumber(Math.abs(number))}`;
}

function formatCompactNumber(value: number | string | null | undefined): string {
  const number = finiteNumber(value);
  if (number == null) return "--";
  if (Math.abs(number) < 1) return number.toFixed(4);
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(number) >= 10_000 ? 2 : 3,
    notation: Math.abs(number) >= 10_000 ? "compact" : "standard",
  }).format(number);
}

function formatTokenPrice(
  value: number | string | null | undefined,
): string | { full: string; significant: string; zeroCount: number } {
  const number = finiteNumber(value);
  if (number == null) return "--";

  if (number >= 1) {
    return `$${number.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }

  const compactTinyPrice = formatTinyTokenPrice(value, number);
  if (compactTinyPrice) return compactTinyPrice;

  return `$${number.toLocaleString(undefined, {
    maximumFractionDigits: 10,
    minimumSignificantDigits: 2,
    maximumSignificantDigits: 5,
  })}`;
}

function formatTinyTokenPrice(
  originalValue: number | string | null | undefined,
  number: number,
): { full: string; significant: string; zeroCount: number } | null {
  if (number <= 0 || number >= 0.01) return null;

  const plainPrice = toPlainDecimal(originalValue, number);
  const fractional = plainPrice.split(".")[1] ?? "";
  const zeroCount = fractional.match(/^0*/)?.[0].length ?? 0;

  if (zeroCount < 3) return null;

  const significant = fractional.slice(zeroCount, zeroCount + 4).replace(/0+$/, "") || "0";

  return {
    full: `$${plainPrice}`,
    significant,
    zeroCount,
  };
}

function toPlainDecimal(value: number | string | null | undefined, number: number): string {
  if (typeof value === "string" && value.trim() && !/[eE]/.test(value)) {
    const trimmed = value.trim();
    return trimmed.startsWith(".") ? `0${trimmed}` : trimmed;
  }

  return number.toFixed(30).replace(/\.?0+$/, "");
}

function formatPercent(value: number | string | null | undefined): string {
  const number = finiteNumber(value);
  if (number == null) return "--";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function formatRewardPercent(value: number | string | null | undefined): string {
  const number = finiteNumber(value);
  if (number == null) return "--";
  return `${number.toLocaleString(undefined, {
    maximumFractionDigits: number >= 10 ? 1 : 2,
    minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
  })}%`;
}

function formatRewardAddress(address: string): string {
  return address.includes(" ") ? address : shortAddress(address, 6, 6);
}

function formatRewardNativeAmount(value: string, symbol: "ETH" | "SOL"): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value} ${symbol}`;
  if (number === 0) return `0 ${symbol}`;
  if (number > 0 && number < 0.000001) return `<0.000001 ${symbol}`;

  const maximumFractionDigits = number < 0.01 ? 6 : number < 1 ? 4 : 4;
  return `${number.toLocaleString(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  })} ${symbol}`;
}

function formatRewardBaseUnitAmount(
  value: string,
  decimals: 9 | 18,
  symbol: "ETH" | "SOL",
): string {
  const baseUnits = bigintString(value);
  if (baseUnits == null) return "--";
  return formatRewardNativeAmount(formatBaseUnitsToDecimal(baseUnits, decimals), symbol);
}

function bigintString(value: string | null | undefined): bigint | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  return BigInt(text);
}

function formatBaseUnitsToDecimal(value: bigint, decimals: 9 | 18): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) return whole.toString();

  const fractionalText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fractionalText}`;
}

function tokenExplorerUrl(chain: MarketChain, address: string): string {
  if (chain === "solana") return `${SOLANA_EXPLORER_BASE_URL}/${address}`;
  return blockscoutTokenUrl(address);
}

function accountExplorerUrl(chain: MarketChain, address: string): string | null {
  if (chain === "solana") {
    return normalizeSolanaAddress(address) ? `https://solscan.io/account/${address}` : null;
  }
  if (!normalizeRobinhoodTokenAddress(address)) return null;
  return `https://robinhoodchain.blockscout.com/address/${address}`;
}

function blockscoutTokenUrl(address: string): string {
  return `https://robinhoodchain.blockscout.com/token/${address}`;
}

function normalizeRobinhoodTokenAddress(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(text) ? text.toLowerCase() : null;
}

function normalizeMarketAddress(value: string | null | undefined): MarketAddress | null {
  const robinhood = normalizeRobinhoodTokenAddress(value);
  if (robinhood) return { address: robinhood, chain: "robinhood" };
  const solana = normalizeSolanaAddress(value);
  return solana ? { address: solana, chain: "solana" } : null;
}

function normalizeSolanaAddress(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return null;
  return base58DecodedLength(text) === 32 ? text : null;
}

function sameMarketAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeMarketAddress(a);
  const right = normalizeMarketAddress(b);
  if (!left || !right || left.chain !== right.chain) return false;
  return left.chain === "robinhood"
    ? left.address.toLowerCase() === right.address.toLowerCase()
    : left.address === right.address;
}

function dexscreenerChainSlug(chain: MarketChain): string {
  return chain === "solana" ? SOLANA_DEXSCREENER_CHAIN_SLUG : ROBINHOOD_DEXSCREENER_CHAIN_SLUG;
}

function marketChainLabel(chain: MarketChain): string {
  return chain === "solana" ? "Solana" : "Robinhood Chain";
}

function marketChainValue(value: unknown): MarketChain | null {
  return value === "solana" || value === "robinhood" ? value : null;
}

function nativeSymbolValue(value: unknown): "ETH" | "SOL" | null {
  return value === "ETH" || value === "SOL" ? value : null;
}

function base58DecodedLength(value: string): number | null {
  const bytes: number[] = [0];
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    let carry = digit;
    for (let i = 0; i < bytes.length; i++) {
      const next = bytes[i] * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return bytes.length;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase());
}

function initialsFor(value: string): string {
  const parts = value.replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map((part) => part[0]).join("") || "U").toUpperCase();
}

function xIntent(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
