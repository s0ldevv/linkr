import {
  mergeMarketBundles,
  normalizeBlockscoutToken,
  normalizeDexPair,
  normalizeMoralisAnalytics,
  normalizeMoralisMetadata,
  normalizeMoralisPrice,
  selectPrimaryDexPair,
} from "./normalize.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("selectPrimaryDexPair chooses the highest-liquidity Robinhood Chain base pair", () => {
  const mint = "0x1111111111111111111111111111111111111111";
  const pair = selectPrimaryDexPair(
    [
      {
        chainId: "robinhood",
        pairAddress: "low",
        baseToken: { address: mint, symbol: "LOW", name: "Low" },
        liquidity: { usd: 100 },
        volume: { h24: 1000 },
        priceUsd: "1",
      },
      {
        chainId: "ethereum",
        pairAddress: "wrong-chain",
        baseToken: { address: "0x9999999999999999999999999999999999999999" },
        liquidity: { usd: 999999 },
      },
      {
        chainId: "robinhood",
        pairAddress: "high",
        baseToken: { address: mint, symbol: "HIGH", name: "High" },
        liquidity: { usd: 5000 },
        volume: { h24: 2000 },
        priceUsd: "2",
      },
    ],
    mint,
  );

  assert(pair?.pairAddress === "high", "highest-liquidity Robinhood Chain pair should win");
});

Deno.test("normalizeDexPair maps core pair market fields", () => {
  const mint = "0x1111111111111111111111111111111111111111";
  const bundle = normalizeDexPair(
    {
      chainId: "robinhood",
      dexId: "rh-dex",
      url: "https://dexscreener.com/robinhood/pair",
      pairAddress: "pair",
      labels: ["v3"],
      baseToken: { address: mint, symbol: "TEST", name: "Test Token" },
      priceNative: "0.01",
      priceUsd: "0.25",
      txns: {
        m5: { buys: 1, sells: 2 },
        h1: { buys: 3, sells: 4 },
        h6: { buys: 5, sells: 6 },
        h24: { buys: 10, sells: 4 },
      },
      volume: { h24: 12345, h6: 900, h1: 100, m5: 10 },
      priceChange: { h24: 5.5 },
      liquidity: { usd: 50000, base: 123, quote: 456 },
      fdv: 1000000,
      marketCap: 900000,
      pairCreatedAt: 1780000000000,
      boosts: { active: 2 },
      info: { imageUrl: "https://example.com/logo.png" },
    },
    mint,
  );

  assert(bundle.symbol === "TEST", "symbol mismatch");
  assert(bundle.price?.usd === 0.25, "price mismatch");
  assert(bundle.liquidity?.base === 123, "base liquidity mismatch");
  assert(bundle.flow?.buys24h === 10, "buys mismatch");
  assert(bundle.flow?.sells1h === 4, "1h sells mismatch");
  assert(bundle.txns?.m5 === 3, "5m tx count mismatch");
  assert(bundle.txns?.h24 === 14, "tx count mismatch");
  assert(bundle.valuation?.fdvUsd === 1000000, "fdv mismatch");
  assert(bundle.primaryPair?.pairAddress === "pair", "pair mismatch");
  assert(bundle.primaryPair?.labels?.[0] === "v3", "pair labels mismatch");
  assert(bundle.discovery?.boostAmount === 2, "boost amount mismatch");
});

Deno.test("normalizeDexPair maps Solana token pairs", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const bundle = normalizeDexPair(
    {
      chainId: "solana",
      dexId: "raydium",
      url: "https://dexscreener.com/solana/pair",
      pairAddress: "pair",
      baseToken: { address: mint, symbol: "SOL", name: "Wrapped SOL" },
      priceUsd: "150",
      txns: { h24: { buys: 100, sells: 90 } },
      volume: { h24: 123456 },
      liquidity: { usd: 987654 },
      fdv: 90000000000,
    },
    mint,
  );

  assert(bundle.chain === "solana", "chain mismatch");
  assert(bundle.chainId == null, "Solana should not use Robinhood numeric chain id");
  assert(bundle.mint === mint, "mint mismatch");
  assert(bundle.symbol === "SOL", "symbol mismatch");
  assert(bundle.primaryPair?.dexId === "raydium", "dex mismatch");
  assert(bundle.price?.usd === 150, "price mismatch");
  assert(bundle.flow?.buys24h === 100, "buys mismatch");
});

Deno.test("Moralis normalizers map price, metadata, and analytics", () => {
  const mint = "0x1111111111111111111111111111111111111111";
  const price = normalizeMoralisPrice(
    {
      tokenAddress: mint,
      symbol: "MOR",
      usdPrice: 1.23,
      usdPrice24hrPercentChange: -2,
      pairAddress: "pair",
      pairTotalLiquidityUsd: 1000,
    },
    mint,
  );
  const metadata = normalizeMoralisMetadata(
    {
      address: mint,
      name: "Moralis Token",
      symbol: "MOR",
      logo: "https://example.com/mor.png",
      possible_spam: false,
      verified_contract: true,
    },
    mint,
  );
  const analytics = normalizeMoralisAnalytics(
    {
      tokenAddress: mint,
      totalBuys: 8,
      totalSells: 3,
      totalBuyers: 7,
      totalSellers: 2,
      totalBuyVolumeUsd: 500,
      totalSellVolumeUsd: 100,
    },
    mint,
  );
  const merged = mergeMarketBundles(mint, [price, metadata, analytics]);

  assert(merged.symbol === "MOR", "merged symbol mismatch");
  assert(merged.price?.usd === 1.23, "Moralis price mismatch");
  assert(merged.metadata?.verified === true, "verified metadata mismatch");
  assert(merged.flow?.buyers24h === 7, "buyers mismatch");
  assert(merged.flow?.sellVolume24h === 100, "sell volume mismatch");
});

Deno.test("mergeMarketBundles prefers a real DEX pair over Blockscout token page", () => {
  const mint = "0x1111111111111111111111111111111111111111";
  const merged = mergeMarketBundles(mint, [
    {
      chain: "robinhood",
      chainId: 4663,
      mint,
      primaryPair: {
        pairAddress: mint,
        dexId: "Blockscout",
        url: `https://robinhoodchain.blockscout.com/token/${mint}`,
      },
      sources: ["blockscout"],
      freshness: { fetchedAt: new Date().toISOString(), ttlSeconds: 90 },
    },
    {
      chain: "robinhood",
      chainId: 4663,
      mint,
      primaryPair: {
        pairAddress: "0x2222222222222222222222222222222222222222",
        dexId: "uniswap",
        url: "https://dexscreener.com/robinhood/pair",
      },
      sources: ["dexscreener"],
      freshness: { fetchedAt: new Date().toISOString(), ttlSeconds: 90 },
    },
  ]);

  assert(merged.primaryPair?.dexId === "uniswap", "real DEX pair should win");
});

Deno.test("normalizeBlockscoutToken maps Robinhood Chain token analytics", () => {
  const tokenAddress = "0x2222222222222222222222222222222222222222";
  const bundle = normalizeBlockscoutToken(
    {
      address_hash: tokenAddress,
      symbol: "RHD",
      name: "Robinhood Demo",
      decimals: "18",
      type: "ERC-20",
      exchange_rate: "0.42",
      circulating_market_cap: "4200000",
      holders_count: "123",
      reputation: "ok",
    },
    { token_holders_count: "456", transfers_count: "789" },
    [],
  );

  assert(bundle.chain === "robinhood", "chain mismatch");
  assert(bundle.chainId === 4663, "chain id mismatch");
  assert(bundle.mint === tokenAddress, "mint compatibility alias mismatch");
  assert(bundle.tokenAddress === tokenAddress, "token address mismatch");
  assert(
    bundle.explorerUrl === `https://robinhoodchain.blockscout.com/token/${tokenAddress}`,
    "Blockscout URL mismatch",
  );
  assert(bundle.holders?.count === 456, "holder count mismatch");
  assert(bundle.txns?.transfers === 789, "transfer count mismatch");
  assert(bundle.metadata?.tokenType === "ERC-20", "token type mismatch");
});
