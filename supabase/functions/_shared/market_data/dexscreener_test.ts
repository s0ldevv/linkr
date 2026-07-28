import { getDexPair, getDexTokenPairs } from "./dexscreener.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Dexscreener client returns fallbacks for empty inputs without network", async () => {
  const pairs = await getDexTokenPairs(null, "");
  const pair = await getDexPair(null, "");
  assert(Array.isArray(pairs) && pairs.length === 0, "empty mint pairs should be empty");
  assert(pair === null, "empty pair lookup should be null");
});
