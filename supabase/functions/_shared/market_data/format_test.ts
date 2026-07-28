import {
  buildPublicDiscoveryFacts,
  buildPublicMarketFacts,
  formatCompactUsd,
  formatPercent,
} from "./format.ts";
import type { MarketDataBundle, MarketDiscoveryItem } from "./types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("buildPublicMarketFacts excludes raw data and keeps useful fields", () => {
  const tokenAddress = "0x1111111111111111111111111111111111111111";
  const bundle: MarketDataBundle = {
    chain: "robinhood",
    chainId: 4663,
    mint: tokenAddress,
    tokenAddress,
    explorerUrl: `https://robinhoodchain.blockscout.com/token/${tokenAddress}`,
    symbol: "TEST",
    name: "Test Token",
    primaryPair: {
      pairAddress: tokenAddress,
      dexId: "Blockscout",
      url: `https://robinhoodchain.blockscout.com/token/${tokenAddress}`,
    },
    price: { usd: 1.23, change24h: 5 },
    liquidity: { usd: 1000, base: 111, quote: 222 },
    volume: { m5: 50, h1: 500, h6: 1500, h24: 2000 },
    txns: { m5: 3, h1: 12, h6: 80, h24: 100 },
    flow: { buys5m: 1, sells5m: 2, buys1h: 7, sells1h: 5, buys24h: 55, sells24h: 45 },
    valuation: { fdvUsd: 1000000 },
    metadata: { logoUrl: "https://example.com/logo.png" },
    discovery: { boosted: true, boostAmount: 2 },
    sources: ["dexscreener", "moralis"],
    freshness: { fetchedAt: new Date().toISOString(), ttlSeconds: 90 },
    warnings: [],
  };

  const facts = buildPublicMarketFacts(bundle);
  const serialized = JSON.stringify(facts);
  assert(serialized.includes("TEST"), "facts should include symbol");
  assert((facts as any).chain_id === 4663, "facts should include Robinhood chain id");
  assert((facts as any).token_address === tokenAddress, "facts should include token address");
  assert(
    serialized.includes("robinhoodchain.blockscout.com"),
    "facts should include Blockscout URL",
  );
  assert((facts as any).price_change_24h === 5, "facts should include 24h change");
  assert((facts as any).liquidity_base === 111, "facts should include base liquidity");
  assert((facts as any).volume_5m_usd === 50, "facts should include 5m volume");
  assert((facts as any).txns_24h === 100, "facts should include 24h txns");
  assert((facts as any).buys_1h === 7, "facts should include 1h buys");
  assert((facts as any).boost_amount === 2, "facts should include boost amount");
  assert(!serialized.includes("dexscreener"), "facts should not include source names");
  assert(!serialized.includes("raw_json"), "facts should not include raw JSON");
});

Deno.test("buildPublicMarketFacts labels Solana token facts", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const bundle: MarketDataBundle = {
    chain: "solana",
    chainId: null,
    mint,
    tokenAddress: mint,
    explorerUrl: `https://solscan.io/token/${mint}`,
    symbol: "SOL",
    name: "Wrapped SOL",
    primaryPair: {
      pairAddress: "pair",
      dexId: "raydium",
      url: "https://dexscreener.com/solana/pair",
    },
    price: { usd: 150, change24h: 2 },
    liquidity: { usd: 1000000 },
    volume: { h24: 2000000 },
    txns: { h24: 190 },
    flow: { buys24h: 100, sells24h: 90 },
    valuation: { fdvUsd: 90000000000 },
    metadata: {},
    discovery: {},
    sources: ["dexscreener"],
    freshness: { fetchedAt: new Date().toISOString(), ttlSeconds: 90 },
    warnings: [],
  };

  const facts = buildPublicMarketFacts(bundle);
  assert((facts as any).chain === "Solana", "facts should label Solana chain");
  assert((facts as any).token_address === mint, "facts should include Solana mint");
  assert(String((facts as any).explorer_url).includes("solscan.io"), "Solscan URL missing");
});

Deno.test("buildPublicDiscoveryFacts returns ranked bounded items", () => {
  const items: MarketDiscoveryItem[] = Array.from({ length: 10 }, (_, index) => ({
    chain: "robinhood",
    chainId: 4663,
    mint:
      "0x" +
      String(index + 1)
        .repeat(40)
        .slice(0, 40),
    tokenAddress:
      "0x" +
      String(index + 1)
        .repeat(40)
        .slice(0, 40),
    symbol: "T" + index,
    name: "Token " + index,
    source: "moralis",
    listKind: "token_search",
    rank: index + 1,
    volume24hUsd: 1000 - index,
  }));

  const facts = buildPublicDiscoveryFacts(items);
  assert(Array.isArray(facts.items), "items should be an array");
  assert((facts.items as unknown[]).length === 8, "discovery facts should cap at 8 items");
});

Deno.test("market format helpers produce compact user-facing values", () => {
  assert(formatCompactUsd(1_250_000) === "$1.25M", "compact USD mismatch");
  assert(formatPercent(2.5) === "+2.5%", "positive percent mismatch");
  assert(formatPercent(-1) === "-1%", "negative percent mismatch");
});
