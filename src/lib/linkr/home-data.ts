import { formatEth, formatUsd, relativeTime, shortAddress } from "@/lib/linkr/format";
import { chainPresentationForRecord, type ChainTone } from "@/lib/linkr/chain-presentation";

export type Tone = "neutral" | "success" | "warning" | "danger";

export type PublicFeedItem = {
  amount_eth: number | null;
  amount_sol?: number | null;
  amount_usd: number | null;
  chain?: string | null;
  created_at: string | null;
  detail: string | null;
  id: string | null;
  kind: string | null;
  reference: string | null;
  status: string | null;
  title: string | null;
  tx_hash: string | null;
  // Conversation columns (view update 20260707173000).
  tweet_id?: string | null;
  user_post_text?: string | null;
  user_post_url?: string | null;
  user_post_author?: string | null;
  linkr_response_text?: string | null;
  linkr_response_tweet_id?: string | null;
  linkr_response_status?: string | null;
  launch_platform?: string | null;
  native_symbol?: string | null;
};

export type PublicTraderRank = {
  amount_eth: number;
  handle: string;
  rank: number;
  trades: number;
  volume_usd: number;
  actions?: number | null;
  avatar_url?: string | null;
  posts?: number | null;
  launches?: number | null;
  score?: number | null;
};

export type PublicWalletRank = {
  amount_eth: number;
  rank: number;
  trades: number;
  volume_usd: number;
  wallet: string;
};

export type SystemStatusEntry = {
  checked_at: string;
  latency_ms: number | null;
  source: string;
  status: "ok" | "degraded" | "down" | string;
};

export type PublicTokenRank = {
  createdAt: string;
  description: string | null;
  devBuyEth: number | null;
  devBuySol?: number | null;
  devBuyUsd: number | null;
  chain?: string | null;
  launchPlatform?: string | null;
  id: string;
  imageUrl: string | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  mint: string | null;
  name: string;
  pairUrl: string | null;
  priceChange24h: number | null;
  status: string;
  symbol: string;
  txSignature: string | null;
};

export type PublicAchievement = {
  achieved_at: string;
  detail: string | null;
  id: string;
  kind: string;
  metadata: unknown;
  metric_value: number | null;
  threshold: number | null;
  title: string;
};

export type ViewerProfile = {
  defaultSlippageBps: number;
  maxAutoBuyEth: number;
  maxAutoBuySol: number;
  maxAutoDevBuyEth: number;
  maxAutoDevBuySol: number;
  maxAutoSellPercent: number;
  maxAutoTransferEth: number;
  maxAutoTransferSol: number;
  profileCompleted: boolean;
  requireConfirmationForAllTx: boolean;
  twitterName: string | null;
  twitterProfileImageUrl: string | null;
  twitterUsername: string | null;
  userId: string;
};

export type ViewerWallet = {
  address?: string | null;
  chainId?: number | null;
  explorerUrl?: string | null;
  publicKey: string;
  ethBalance: number;
  ethUsdPrice: number | null;
};

export type PortfolioHolding = {
  amount: number;
  decimals: number;
  logoUrl: string | null;
  mint: string;
  name: string | null;
  priceChange24h: number | null;
  priceUsd: number | null;
  symbol: string | null;
  valueUsd: number | null;
};

export type ViewerPortfolio = {
  change24hPercent: number | null;
  holdings: PortfolioHolding[];
  totalEthEquivalent: number | null;
  totalUsd: number | null;
};

export type PrivatePendingAction = {
  action_payload: unknown;
  confirmation_phrase: string;
  created_at: string;
  expires_at: string;
  id: string;
  intent: string;
  status: string;
  tweet_id: string | null;
};

export type PrivateTransaction = {
  action: string | null;
  amount_original: number | null;
  amount_original_unit: string | null;
  amount_eth: number | null;
  amount_sol?: number | null;
  amount_usd: number | null;
  chain?: string | null;
  confirmed_at: string | null;
  created_at: string;
  error: string | null;
  id: string;
  input_mint: string | null;
  output_mint: string | null;
  eth_price_usd: number | null;
  status: string | null;
  tweet_id: string | null;
  tx_hash: string | null;
};

export type PrivateAgentRun = {
  completed_at: string | null;
  confidence: number | null;
  created_at: string;
  error: string | null;
  id: string;
  intent: string | null;
  requires_confirmation: boolean;
  status: string;
  tweet_id: string | null;
};

export type PrivateLaunch = {
  chain?: string | null;
  created_at: string;
  description: string | null;
  dev_buy_eth: number | null;
  dev_buy_sol?: number | null;
  dev_buy_usd: number | null;
  id: string;
  image_url: string | null;
  launch_platform?: string | null;
  mint: string | null;
  name: string;
  status: string;
  symbol: string;
  tweet_id: string | null;
  tx_signature: string | null;
};

export type ViewerHomeData = {
  pendingActions: PrivatePendingAction[];
  portfolio: ViewerPortfolio | null;
  profile: ViewerProfile | null;
  recentAgentRuns: PrivateAgentRun[];
  recentLaunches: PrivateLaunch[];
  recentTransactions: PrivateTransaction[];
  wallet: ViewerWallet | null;
};

export type PublicHomeData = {
  liveFeed: PublicFeedItem[];
  recentAchievements: PublicAchievement[];
  topLaunchedTokens: PublicTokenRank[];
  topTraders30d: PublicTraderRank[];
  topWallets30d?: PublicWalletRank[];
  systemStatus?: SystemStatusEntry[];
};

export type HomeDashboardData = {
  public: PublicHomeData;
  viewer: ViewerHomeData | null;
};

export type HeroFeedItem = {
  actorHandle?: string | null;
  actorLabel: string;
  avatarImageUrl?: string | null;
  avatarLabel: string;
  body: string;
  chainLabel?: string;
  chainShortLabel?: string;
  chainTone?: ChainTone;
  command?: string | null;
  id: string;
  reference?: string | null;
  status?: string | null;
  timestamp: string;
  title: string;
  tone: Tone;
};

function demoHeroFeed(): HeroFeedItem[] {
  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  return [
    {
      actorLabel: "Mira",
      actorHandle: "@miraonthechain",
      avatarLabel: "MI",
      body: "$NOVA launched with a 2.4 ETH dev buy and metadata pinned.",
      chainLabel: "Robinhood / EVM",
      chainShortLabel: "EVM",
      chainTone: "robinhood",
      command: "@linkrcash launch $NOVA with 2.4 ETH",
      id: "demo-hero-feed-launch-nova",
      reference: "0x8A1d4b4C7f8e0a7d9C1b2E3F4a5B6c7D8e9F0123",
      status: "confirmed",
      timestamp: minutesAgo(4),
      title: "Token launch confirmed",
      tone: "success",
    },
    {
      actorLabel: "Trader",
      actorHandle: "@ethsignal",
      avatarLabel: "TR",
      body: "Bought $RUSH on Solana after Linkr checked wallet limits.",
      chainLabel: "Pump.fun / SOL",
      chainShortLabel: "SOL",
      chainTone: "solana",
      command: "@linkrcash buy 0.8 SOL of $RUSH",
      id: "demo-hero-feed-buy-rush",
      reference: "0x42dB3a6e9F7C2dA1b0E8fCc5D6a7B8c9D0e1F234",
      status: "completed",
      timestamp: minutesAgo(11),
      title: "Reply trade executed",
      tone: "success",
    },
    {
      actorLabel: "Wallet",
      actorHandle: "@linkrcash",
      avatarLabel: "WA",
      body: "Transfer request is waiting for a confirmation reply before signing.",
      chainLabel: "Robinhood / EVM",
      chainShortLabel: "EVM",
      chainTone: "robinhood",
      command: "@linkrcash send 1.2 ETH to kai.eth",
      id: "demo-hero-feed-pending-transfer",
      reference: "tweet-1937201846",
      status: "pending",
      timestamp: minutesAgo(18),
      title: "Confirmation pending",
      tone: "warning",
    },
    {
      actorLabel: "Linkr",
      actorHandle: "@linkrcash",
      avatarLabel: "LK",
      body: "Pump.fun launch receipt posted with the Solana mint address.",
      chainLabel: "Pump.fun / SOL",
      chainShortLabel: "SOL",
      chainTone: "solana",
      command: "@linkrcash launch $WAVE on Solana",
      id: "demo-hero-feed-rewards",
      reference: "0x91C4E5d6A7B8c9D0E1f234567890abCDef123456",
      status: "posted",
      timestamp: minutesAgo(27),
      title: "Rewards receipt posted",
      tone: "success",
    },
    {
      actorLabel: "Launch desk",
      actorHandle: "@linkrcash",
      avatarLabel: "LD",
      body: "$PIXEL artwork, ticker, and supply details passed preflight checks.",
      chainLabel: "Robinhood / EVM",
      chainShortLabel: "EVM",
      chainTone: "robinhood",
      command: "@linkrcash prepare launch $PIXEL",
      id: "demo-hero-feed-preflight",
      reference: "0xaB12cD34Ef56a7890bC1234567890dEFa1234567",
      status: "validating",
      timestamp: minutesAgo(36),
      title: "Launch preflight running",
      tone: "warning",
    },
  ];
}

export function buildHeroFeed(data: HomeDashboardData | undefined, includeViewer: boolean) {
  if (!data) return [];

  const items: HeroFeedItem[] = [];

  if (includeViewer && data.viewer) {
    items.push(...data.viewer.pendingActions.map(normalizePrivatePending));
    items.push(...data.viewer.recentTransactions.map(normalizePrivateTransaction));
    items.push(...data.viewer.recentAgentRuns.map(normalizePrivateRun));
    items.push(...data.viewer.recentLaunches.map(normalizePrivateLaunch));
  }

  items.push(...data.public.liveFeed.map(normalizePublicFeedItem));

  if (items.length === 0) {
    items.push(...demoHeroFeed());
  }

  return items
    .filter((item) => item.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 7);
}

export function normalizePublicFeedItem(row: PublicFeedItem): HeroFeedItem {
  const chain = chainPresentationForRecord(row);
  return {
    actorLabel: actorForKind(row.kind),
    actorHandle: "@linkrcash",
    avatarLabel: labelForKind(row.kind),
    body: row.detail || row.reference || "Linkr activity",
    chainLabel: chain.label,
    chainShortLabel: chain.shortLabel,
    chainTone: chain.chain,
    id: row.id || `public-${row.created_at}`,
    reference: row.reference || row.tx_hash,
    status: row.status,
    timestamp: row.created_at || new Date().toISOString(),
    title: row.title || titleCase(row.kind || "activity"),
    tone: toneForStatus(row.status),
  };
}

export function normalizePrivateTransaction(row: PrivateTransaction): HeroFeedItem {
  const chain = chainPresentationForRecord(row);
  const amount =
    row.amount_usd != null
      ? formatUsd(row.amount_usd)
      : row.chain === "solana" && row.amount_sol != null
        ? `${Number(row.amount_sol).toFixed(4)} SOL`
        : row.amount_eth != null
          ? `${formatEth(row.amount_eth)} ETH`
          : null;

  return {
    actorLabel: "You",
    actorHandle: "private wallet",
    avatarLabel: "Y",
    body: [
      row.action ? titleCase(row.action) : "Wallet action",
      amount,
      shortAddress(row.tx_hash || row.output_mint || row.input_mint, 6, 6),
    ]
      .filter(Boolean)
      .join(" / "),
    chainLabel: chain.label,
    chainShortLabel: chain.shortLabel,
    chainTone: chain.chain,
    id: `tx-${row.id}`,
    reference: row.tx_hash || row.tweet_id,
    status: row.status,
    timestamp: row.created_at,
    title: row.action ? `${titleCase(row.action)} handled` : "Wallet action handled",
    tone: toneForStatus(row.status),
  };
}

export function normalizePrivatePending(row: PrivatePendingAction): HeroFeedItem {
  return {
    actorLabel: "You",
    actorHandle: "confirmation required",
    avatarLabel: "Y",
    body: `Reply "${row.confirmation_phrase}" before ${relativeTime(row.expires_at)}`,
    command: row.intent,
    id: `pending-${row.id}`,
    reference: row.tweet_id,
    status: row.status,
    timestamp: row.created_at,
    title: "Confirmation pending",
    tone: "warning",
  };
}

export function normalizePrivateRun(row: PrivateAgentRun): HeroFeedItem {
  return {
    actorLabel: "Linkr",
    actorHandle: "@linkrcash",
    avatarLabel: "L",
    body: row.error || row.intent || "Agent run",
    id: `run-${row.id}`,
    reference: row.tweet_id,
    status: row.status,
    timestamp: row.created_at,
    title: row.intent ? `${titleCase(row.intent)} processed` : "Agent run processed",
    tone: toneForStatus(row.status),
  };
}

export function normalizePrivateLaunch(row: PrivateLaunch): HeroFeedItem {
  const chain = chainPresentationForRecord(row);
  const devBuy =
    row.dev_buy_usd != null
      ? formatUsd(row.dev_buy_usd)
      : chain.chain === "solana" && row.dev_buy_sol != null
        ? `${Number(row.dev_buy_sol).toFixed(3)} SOL`
        : row.dev_buy_eth != null
          ? `${formatEth(row.dev_buy_eth)} ETH`
          : null;
  return {
    actorLabel: "You",
    actorHandle: "coin launch",
    avatarImageUrl: row.image_url,
    avatarLabel: row.symbol.slice(0, 2).toUpperCase(),
    body: [`$${row.symbol} - ${row.name}`, chain.platformLabel, devBuy].filter(Boolean).join(" / "),
    chainLabel: chain.label,
    chainShortLabel: chain.shortLabel,
    chainTone: chain.chain,
    id: `launch-${row.id}`,
    reference: row.mint || row.tx_signature || row.tweet_id,
    status: row.status,
    timestamp: row.created_at,
    title: "Launch tracked",
    tone: toneForStatus(row.status),
  };
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Number(value) >= 10_000 ? 1 : 2,
    notation: Number(value) >= 10_000 ? "compact" : "standard",
  }).format(Number(value));
}

export function formatCompactUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `$${formatCompactNumber(Number(value))}`;
}

export function formatSignedPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}%`;
}

export function xIntent(text: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function actorForKind(kind: string | null | undefined) {
  const normalized = (kind || "").toLowerCase();
  if (normalized.includes("launch")) return "Linkr";
  if (normalized.includes("buy") || normalized.includes("sell")) return "Trader";
  if (normalized.includes("transfer")) return "Wallet";
  return "Linkr";
}

function labelForKind(kind: string | null | undefined) {
  const normalized = (kind || "").toUpperCase();
  if (!normalized) return "L";
  return normalized.slice(0, 2);
}

function toneForStatus(status: string | null | undefined): Tone {
  const normalized = (status || "").toLowerCase();
  if (["confirmed", "completed", "posted", "success", "submitted", "saved"].includes(normalized)) {
    return "success";
  }
  if (
    ["pending", "processing", "validating", "awaiting_confirmation", "queued"].includes(normalized)
  ) {
    return "warning";
  }
  if (["failed", "cancelled", "expired", "error"].includes(normalized)) return "danger";
  return "neutral";
}

function titleCase(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase());
}
