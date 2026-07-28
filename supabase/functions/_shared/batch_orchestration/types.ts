import type { MarketChain } from "../market_data/types.ts";

export type BatchKind = "coin_inquiry" | "launch_coin";

export interface BatchTarget {
  id: string;
  chain: MarketChain;
  address: string;
  source: "tweet" | "thread" | "extraction" | "history";
  confidence: number;
}

export interface MultiCoinInquiryItem {
  target: BatchTarget;
  facts: Record<string, unknown> | null;
  error: string | null;
}

export interface MultiCoinInquiryData {
  batch: true;
  kind: "multi_coin_inquiry";
  items: MultiCoinInquiryItem[];
  overflow_count: number;
  warnings: string[];
}

export interface LaunchBatchItem {
  item_id: string;
  chain: MarketChain;
  launch_platform: "robinhood_single_sided_lp" | "pump_fun";
  name: string;
  symbol: string;
  description: string | null;
  image_url: string;
  dev_buy_eth?: number | null;
  dev_buy_sol?: number | null;
  dev_buy_usd?: number | null;
  dev_buy_original?: number | null;
  dev_buy_original_unit?: "eth" | "sol" | "usd" | null;
  metadata_website_url?: string | null;
  metadata_twitter_url?: string | null;
  metadata_telegram_url?: string | null;
  creator_rewards_recipient_wallet?: string | null;
  creator_rewards_recipient_handle?: string | null;
  creator_rewards_share_percent?: number | null;
  creator_rewards_share_bps?: number | null;
  fee_wallet?: string | null;
  settings_snapshot?: Record<string, unknown>;
}

export interface LaunchBatchPayload {
  intent: "launch_coin_batch";
  batch_version: 1;
  source_tweet_id: string;
  source_tweet_url: string | null;
  creator_rewards_request_text?: string | null;
  image_url: string;
  items: LaunchBatchItem[];
}
