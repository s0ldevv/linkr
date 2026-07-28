import { snapshotRowToBundle } from "./cache.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("snapshotRowToBundle maps cached rows into market bundle shape", () => {
  const tokenAddress = "0x1111111111111111111111111111111111111111";
  const bundle = snapshotRowToBundle({
    mint: tokenAddress,
    token_address: tokenAddress,
    explorer_url: `https://robinhoodchain.blockscout.com/token/${tokenAddress}`,
    symbol: "CACHE",
    name: "Cached Token",
    pair_address: "pair",
    pair_url: "https://example.com/pair",
    price_usd: "1.5",
    liquidity_usd: "10000",
    volume_24h_usd: "5000",
    price_change_24h: "-3",
    buys_24h: 11,
    sells_24h: 9,
    market_cap_usd: "100000",
    fdv_usd: "120000",
    fetched_at: "2026-07-06T00:00:00Z",
  });

  assert(bundle.symbol === "CACHE", "symbol mismatch");
  assert(bundle.chainId === 4663, "chain id mismatch");
  assert(bundle.tokenAddress === tokenAddress, "token address mismatch");
  assert(bundle.explorerUrl?.includes("robinhoodchain.blockscout.com"), "explorer URL mismatch");
  assert(bundle.price?.usd === 1.5, "price mismatch");
  assert(bundle.primaryPair?.pairAddress === "pair", "pair mismatch");
  assert(bundle.flow?.buys24h === 11, "buys mismatch");
  assert(bundle.sources.includes("cache"), "cache source missing");
});
