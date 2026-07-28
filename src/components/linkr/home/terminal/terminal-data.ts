import type {
  HomeDashboardData,
  PublicFeedItem,
  PublicTokenRank,
  PublicTraderRank,
  PublicWalletRank,
  SystemStatusEntry,
} from "@/lib/linkr/home-data";
import { chainPresentationForRecord, type ChainTone } from "@/lib/linkr/chain-presentation";

/* ------------------------------------------------------------------
 * Deterministic sparkline generation.
 * We do not store token price history client-side, so sparklines are
 * seeded from the row id: same row always renders the same shape, and
 * the overall drift follows the real 24h price change when available.
 * ------------------------------------------------------------------ */

function seedFromString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sparklinePoints(seedKey: string, drift: number | null | undefined): number[] {
  const rand = mulberry32(seedFromString(seedKey));
  const direction = drift == null ? (rand() > 0.35 ? 1 : -1) : drift >= 0 ? 1 : -1;
  const points: number[] = [];
  let value = 0.5 - direction * 0.18;

  for (let i = 0; i < 26; i += 1) {
    value += direction * 0.016 + (rand() - 0.5) * 0.16;
    value = Math.min(0.95, Math.max(0.05, value));
    points.push(value);
  }

  return points;
}

export function sparklinePath(points: number[], width: number, height: number): string {
  if (points.length === 0) return "";
  const step = width / (points.length - 1);
  return points
    .map((point, index) => {
      const x = (index * step).toFixed(1);
      const y = ((1 - point) * height).toFixed(1);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

/* ------------------------------------------------------------------
 * Token helpers
 * ------------------------------------------------------------------ */

export type CoinBadge = "live" | "trending" | "new" | "pending" | "demo";

export function badgeForToken(token: PublicTokenRank, isDemo: boolean): CoinBadge {
  if (isDemo) return "demo";
  const status = token.status.toLowerCase();
  // If token has no mint, show as pending
  if (!token.mint) return "pending";
  // Only show specific badges for actual status values
  if (status === "trending") return "trending";
  if (status === "new") return "new";
  if (["confirmed", "completed", "success", "live", "submitted", "posted"].includes(status)) {
    return "live";
  }
  // For failed/cancelled/pending, still show as "new" to indicate not fully live
  if (["failed", "cancelled", "expired", "error", "rejected"].includes(status)) {
    return "new";
  }
  // Default: show as new until confirmed
  return "new";
}

export function blockscoutTx(hash: string) {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

export function blockscoutToken(address: string) {
  return `https://robinhoodchain.blockscout.com/token/${address}`;
}

/* ------------------------------------------------------------------
 * Placeholders — shown until real rows exist in the database.
 * Every placeholder is clearly flagged so the UI can label it "demo".
 * ------------------------------------------------------------------ */

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const PLACEHOLDER_TOKENS: PublicTokenRank[] = [
  {
    symbol: "SNOVA",
    name: "Snova Protocol",
    chain: "robinhood",
    marketCapUsd: 84_200,
    priceChange24h: 21.4,
    ageMin: 1,
  },
  {
    symbol: "SRUSH",
    name: "Rush AI",
    chain: "solana",
    launchPlatform: "pump_fun",
    marketCapUsd: 41_600,
    priceChange24h: 9.8,
    ageMin: 2,
  },
  {
    symbol: "SPTXEL",
    name: "Pixel Power",
    chain: "robinhood",
    marketCapUsd: 128_400,
    priceChange24h: 28.6,
    ageMin: 5,
  },
  {
    symbol: "SWFT",
    name: "Swiftly Token",
    chain: "solana",
    launchPlatform: "pump_fun",
    marketCapUsd: 92_300,
    priceChange24h: 6.1,
    ageMin: 7,
  },
  {
    symbol: "BOOST",
    name: "BoostCoin",
    chain: "robinhood",
    marketCapUsd: 231_700,
    priceChange24h: 32.1,
    ageMin: 9,
  },
  {
    symbol: "DRIFT",
    name: "Drift Token",
    chain: "solana",
    launchPlatform: "pump_fun",
    marketCapUsd: 76_800,
    priceChange24h: 4.4,
    ageMin: 11,
  },
  {
    symbol: "ETHAI",
    name: "EthAI",
    chain: "robinhood",
    marketCapUsd: 181_500,
    priceChange24h: 12.7,
    ageMin: 15,
  },
  {
    symbol: "LITE",
    name: "Litechain",
    chain: "solana",
    launchPlatform: "pump_fun",
    marketCapUsd: 66_400,
    priceChange24h: 13.7,
    ageMin: 15,
  },
  {
    symbol: "AGENT",
    name: "AgentCoin",
    chain: "robinhood",
    marketCapUsd: 207_600,
    priceChange24h: 18.9,
    ageMin: 17,
  },
  {
    symbol: "MEME",
    name: "MemeGen",
    chain: "solana",
    launchPlatform: "pump_fun",
    marketCapUsd: 54_100,
    priceChange24h: 3.2,
    ageMin: 19,
  },
  {
    symbol: "WAVE",
    name: "WaveSense",
    chain: "robinhood",
    marketCapUsd: 112_300,
    priceChange24h: 19.2,
    ageMin: 22,
  },
  {
    symbol: "LENS",
    name: "Lens Protocol",
    chain: "solana",
    launchPlatform: "pump_fun",
    marketCapUsd: 58_200,
    priceChange24h: 7.5,
    ageMin: 23,
  },
].map((token, index) => ({
  chain: token.chain,
  createdAt: minutesAgo(token.ageMin),
  description: null,
  devBuyEth: null,
  devBuyUsd: null,
  id: `demo-token-${index}`,
  imageUrl: null,
  liquidityUsd: null,
  launchPlatform: token.launchPlatform ?? null,
  marketCapUsd: token.marketCapUsd,
  mint: null,
  name: token.name,
  pairUrl: null,
  priceChange24h: token.priceChange24h,
  status: "demo",
  symbol: token.symbol,
  txSignature: null,
}));

export type PostRow = {
  avatarUrl: string | null;
  handle: string;
  id: string;
  isDemo: boolean;
  text: string;
  timestamp: string;
  url: string | null;
};

export const PLACEHOLDER_POSTS: PostRow[] = [
  { handle: "@alpha_king", text: "Where is everyone watching right now?", min: 0.4 },
  { handle: "@defi_master_42", text: "Just minted a new coin from a single reply.", min: 1 },
  { handle: "@web3_wizard", text: "Any thoughts on the newest launch?", min: 2 },
  { handle: "@trade_alpha", text: "Locked in on my next entry.", min: 3 },
  { handle: "@nft_hunter", text: "New wallet rule saved for extra safety.", min: 4 },
].map((post, index) => ({
  avatarUrl: null,
  handle: post.handle,
  id: `demo-post-${index}`,
  isDemo: true,
  text: post.text,
  timestamp: minutesAgo(post.min),
  url: null,
}));

export type ReceiptRow = {
  chainLabel?: string;
  chainTone?: ChainTone;
  handle: string | null;
  id: string;
  isDemo: boolean;
  status: string;
  timestamp: string;
  title: string;
  txSignature: string | null;
};

export const PLACEHOLDER_RECEIPTS: ReceiptRow[] = [
  { title: "Buy executed on Robinhood Chain", status: "executed", min: 1, chain: "robinhood" },
  { title: "Pump.fun launch confirmed", status: "executed", min: 2, chain: "solana" },
  { title: "Buy executed on Solana", status: "executed", min: 2, chain: "solana" },
  { title: "Robinhood launch queued", status: "active", min: 7, chain: "robinhood" },
  { title: "SOL transfer confirmed", status: "executed", min: 9, chain: "solana" },
].map((receipt, index) => ({
  chainLabel: chainPresentationForRecord(receipt).shortLabel,
  chainTone: chainPresentationForRecord(receipt).chain,
  handle: "@linkrcash",
  id: `demo-receipt-${index}`,
  isDemo: true,
  status: receipt.status,
  timestamp: minutesAgo(receipt.min),
  title: receipt.title,
  txSignature: null,
}));

export const PLACEHOLDER_TRADERS: PublicTraderRank[] = [
  { handle: "alpha_king", actions: 3241 },
  { handle: "defi_master_42", actions: 2123 },
  { handle: "web3_wizard", actions: 1652 },
  { handle: "trade_alpha", actions: 1287 },
  { handle: "nft_hunter", actions: 992 },
].map((trader, index) => ({
  amount_eth: 0,
  actions: trader.actions,
  avatar_url: null,
  handle: trader.handle,
  rank: index + 1,
  trades: trader.actions,
  volume_usd: 0,
}));

export const PLACEHOLDER_WALLETS: PublicWalletRank[] = [
  { wallet: "7x92...a802", volume: 22_800_000 },
  { wallet: "8fCp...7b6e", volume: 8_600_000 },
  { wallet: "3nDa...e8fa", volume: 6_200_000 },
  { wallet: "9kLm...d2a9", volume: 4_700_000 },
  { wallet: "1zRt...b015", volume: 3_200_000 },
].map((entry, index) => ({
  amount_eth: 0,
  rank: index + 1,
  trades: 0,
  volume_usd: entry.volume,
  wallet: entry.wallet,
}));

export const SYSTEM_SOURCES: { key: string; label: string }[] = [
  { key: "x_connection", label: "X Connection" },
  { key: "robinhood_rpc", label: "Robinhood Chain RPC" },
  { key: "data_indexing", label: "Data Indexing" },
  { key: "execution_engine", label: "Execution Engine" },
  { key: "risk_engine", label: "Risk Engine" },
  { key: "monitoring", label: "Monitoring" },
];

export function systemStatusRows(entries: SystemStatusEntry[] | undefined) {
  const bySource = new Map<string, SystemStatusEntry>();
  for (const entry of entries ?? []) {
    bySource.set(normalizeSourceKey(entry.source), entry);
  }

  const known = SYSTEM_SOURCES.map((source) => {
    const entry = bySource.get(source.key);
    bySource.delete(source.key);
    return { label: source.label, status: entry?.status ?? "ok", hasData: Boolean(entry) };
  });

  const extras = [...bySource.values()].map((entry) => ({
    label: labelFromSourceKey(entry.source),
    status: entry.status,
    hasData: true,
  }));

  return [...known, ...extras];
}

function normalizeSourceKey(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function labelFromSourceKey(source: string): string {
  return source
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function allSystemsOperational(entries: SystemStatusEntry[] | undefined): boolean {
  if (!entries || entries.length === 0) return true;
  return entries.every((entry) => entry.status === "ok");
}

/* ------------------------------------------------------------------
 * Feed splitting: posts vs receipts
 * ------------------------------------------------------------------ */

function cleanUserPostText(text: string): string {
  const cleaned = text
    .replace(/(^|\s)@linkrcash\b[,:;.!?-]?\s*/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || text.trim();
}

function avatarUrlByHandle(data: HomeDashboardData | undefined): Map<string, string> {
  const avatars = new Map<string, string>();
  for (const trader of data?.public.topTraders30d ?? []) {
    if (trader.avatar_url) {
      avatars.set(trader.handle.replace(/^@/, "").toLowerCase(), trader.avatar_url);
    }
  }
  return avatars;
}

export function postsFromFeed(data: HomeDashboardData | undefined): PostRow[] {
  const feed = data?.public.liveFeed ?? [];
  const avatars = avatarUrlByHandle(data);
  const rows = feed
    .filter((item) => item.user_post_text && item.user_post_author)
    .slice(0, 5)
    .map((item) => ({
      avatarUrl: avatars.get((item.user_post_author ?? "").replace(/^@/, "").toLowerCase()) ?? null,
      handle: `@${item.user_post_author}`,
      id: item.id ?? `post-${item.created_at}`,
      isDemo: false,
      text: cleanUserPostText(item.user_post_text ?? ""),
      timestamp: item.created_at ?? new Date().toISOString(),
      url: item.user_post_url ?? null,
    }));

  return rows.length > 0 ? rows : PLACEHOLDER_POSTS;
}

export function receiptsFromFeed(data: HomeDashboardData | undefined): ReceiptRow[] {
  const feed = data?.public.liveFeed ?? [];
  const rows = feed
    .filter((item) => isReceiptKind(item))
    .slice(0, 5)
    .map((item) => {
      const chain = chainPresentationForRecord(item);
      return {
        chainLabel: chain.shortLabel,
        chainTone: chain.chain,
        handle: item.user_post_author ? `@${item.user_post_author}` : "@linkrcash",
        id: item.id ?? `receipt-${item.created_at}`,
        isDemo: false,
        status: receiptStatus(item.status),
        timestamp: item.created_at ?? new Date().toISOString(),
        title: item.title ?? "Linkr action",
        txSignature: item.tx_hash ?? null,
      };
    });

  return rows.length > 0 ? rows : PLACEHOLDER_RECEIPTS;
}

function isReceiptKind(item: PublicFeedItem): boolean {
  const kind = (item.kind ?? "").toLowerCase();
  return (
    Boolean(item.tx_hash) ||
    kind.includes("buy") ||
    kind.includes("sell") ||
    kind.includes("transfer") ||
    kind.includes("launch")
  );
}

function receiptStatus(status: string | null): string {
  const normalized = (status ?? "").toLowerCase();
  if (["confirmed", "completed", "posted", "success", "submitted"].includes(normalized)) {
    return "executed";
  }
  if (["pending", "validating", "processing", "active"].includes(normalized)) {
    return "active";
  }
  if (["failed", "error"].includes(normalized)) return "failed";
  return normalized || "executed";
}
