export type MarketProvider = "blockscout" | "dexscreener" | "moralis" | "cache";
export type MarketChain = "robinhood" | "solana";
export type MarketSortBy = "volume1hDesc" | "volume24hDesc" | "liquidityDesc" | "marketCapDesc";

export interface MarketDataBundle {
  chain: MarketChain;
  chainId?: number | null;
  tokenAddress?: string | null;
  explorerUrl?: string | null;
  // Compatibility alias for the historical field name.
  mint: string;
  symbol?: string | null;
  name?: string | null;
  primaryPair?: {
    pairAddress: string;
    dexId?: string | null;
    url?: string | null;
    createdAt?: string | null;
    labels?: string[];
  } | null;
  price?: {
    usd?: number | null;
    native?: string | null;
    change5m?: number | null;
    change1h?: number | null;
    change6h?: number | null;
    change24h?: number | null;
  };
  liquidity?: {
    usd?: number | null;
    base?: number | null;
    quote?: number | null;
  };
  volume?: {
    m5?: number | null;
    h1?: number | null;
    h6?: number | null;
    h24?: number | null;
  };
  txns?: {
    m5?: number | null;
    h1?: number | null;
    h6?: number | null;
    h24?: number | null;
    transfers?: number | null;
  };
  flow?: {
    buys5m?: number | null;
    sells5m?: number | null;
    buys1h?: number | null;
    sells1h?: number | null;
    buys6h?: number | null;
    sells6h?: number | null;
    buys24h?: number | null;
    sells24h?: number | null;
    buyers24h?: number | null;
    sellers24h?: number | null;
    buyVolume24h?: number | null;
    sellVolume24h?: number | null;
  };
  holders?: {
    count?: number | null;
  };
  valuation?: {
    fdvUsd?: number | null;
    marketCapUsd?: number | null;
  };
  metadata?: {
    logoUrl?: string | null;
    socials?: Array<{ platform: string; handle?: string | null; url?: string | null }>;
    websites?: string[];
    decimals?: number | null;
    tokenType?: string | null;
    reputation?: string | null;
    possibleSpam?: boolean | null;
    verified?: boolean | null;
    score?: number | null;
  };
  discovery?: {
    boosted?: boolean;
    boostAmount?: number | null;
    boostTotalAmount?: number | null;
    paidOrders?: string[];
    metas?: string[];
  };
  sources: MarketProvider[];
  freshness: {
    fetchedAt: string;
    ttlSeconds: number;
  };
  warnings: string[];
}

export interface MarketDiscoveryItem {
  chain: MarketChain;
  chainId?: number | null;
  tokenAddress?: string | null;
  explorerUrl?: string | null;
  // Compatibility alias for the historical field name.
  mint?: string | null;
  pairAddress?: string | null;
  symbol?: string | null;
  name?: string | null;
  source: "blockscout" | "dexscreener" | "moralis";
  listKind: string;
  rank: number;
  priceUsd?: number | null;
  marketCapUsd?: number | null;
  fdvUsd?: number | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  priceChange24h?: number | null;
  holdersCount?: number | null;
  tokenType?: string | null;
  url?: string | null;
  raw?: Record<string, unknown>;
}

export interface TokenCandidate {
  mint: string;
  chain?: MarketChain;
  symbol?: string | null;
  name?: string | null;
  source: string;
}
