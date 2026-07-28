import { confirmBatchLaunchReply, buildMultiMarketInfoReply } from "./replies.ts";
import type { MultiCoinInquiryData } from "./types.ts";
import { lintPublicReply } from "../reply_lint.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("buildMultiMarketInfoReply formats mixed-chain facts compactly", () => {
  const data: MultiCoinInquiryData = {
    batch: true,
    kind: "multi_coin_inquiry",
    overflow_count: 0,
    warnings: [],
    items: [
      {
        target: {
          id: "robinhood:0x020bfc650a365f8bb26819deaabf3e21291018b4",
          chain: "robinhood",
          address: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
          source: "tweet",
          confidence: 0.99,
        },
        facts: {
          symbol: "ABC",
          token_address: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
          price_usd: 0.012,
          price_change_24h: 8.4,
          market_cap_usd: 1_200_000,
        },
        error: null,
      },
      {
        target: {
          id: "solana:So11111111111111111111111111111111111111112",
          chain: "solana",
          address: "So11111111111111111111111111111111111111112",
          source: "tweet",
          confidence: 0.99,
        },
        facts: {
          symbol: "MOON",
          token_address: "So11111111111111111111111111111111111111112",
          price_usd: 0.004,
          price_change_24h: -3.1,
          liquidity_usd: 180_000,
        },
        error: null,
      },
    ],
  };
  const reply = buildMultiMarketInfoReply(data);
  assert(reply, "reply should be built");
  assert(reply.includes("$ABC"), "missing first symbol");
  assert(reply.includes("$MOON"), "missing second symbol");
  assert(reply.length <= 260, "reply should fit X");
  assert(lintPublicReply(reply, "coin_inquiry").ok, "reply should pass lint");
});

Deno.test("confirmBatchLaunchReply summarizes grouped launch confirmation", () => {
  const reply = confirmBatchLaunchReply([
    {
      item_id: "solana",
      chain: "solana",
      launch_platform: "pump_fun",
      name: "Moon",
      symbol: "MOON",
      description: null,
      image_url: "https://example.com/moon.png",
      dev_buy_sol: 0.1,
    },
    {
      item_id: "robinhood",
      chain: "robinhood",
      launch_platform: "robinhood_single_sided_lp",
      name: "Moon",
      symbol: "MOON",
      description: null,
      image_url: "https://example.com/moon.png",
      dev_buy_eth: 0.02,
    },
  ]);
  assert(reply.includes("2 launches"), "missing count");
  assert(reply.includes("confirm launch"), "missing confirmation phrase");
  assert(reply.length <= 260, "reply should fit X");
});
