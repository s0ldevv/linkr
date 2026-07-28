import {
  getMoralisTokenAnalyticsBatch,
  getMoralisTokenMetadata,
  getMoralisTokenPrice,
  searchMoralisTokens,
} from "./moralis.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Moralis client returns fallbacks when API key is unavailable", async () => {
  const mint = "0x1111111111111111111111111111111111111111";
  assert((await getMoralisTokenPrice(null, mint)) === null, "missing key price should be null");
  assert(
    (await getMoralisTokenMetadata(null, mint)) === null,
    "missing key metadata should be null",
  );
  assert(
    (await getMoralisTokenAnalyticsBatch(null, [mint])).length === 0,
    "missing key analytics should be empty",
  );
  assert(
    (await searchMoralisTokens(null, { query: "hood" })).length === 0,
    "missing key search should be empty",
  );
});
