// deno-lint-ignore-file no-explicit-any
// Live ETH/USD price with a 60s cache stored in native_price_cache.

import { ROBINHOOD_CHAIN_ID, ROBINHOOD_NATIVE_SYMBOL } from "./robinhood_chain.ts";

const STALE_MS = 60_000;

export async function getEthUsdPrice(admin: any): Promise<{ price: number; source: string } | null> {
  const { data: latest } = await admin
    .from("native_price_cache")
    .select("price_usd,source,fetched_at")
    .eq("chain_id", ROBINHOOD_CHAIN_ID)
    .eq("symbol", ROBINHOOD_NATIVE_SYMBOL)
    .maybeSingle();

  if (latest) {
    const age = Date.now() - new Date(latest.fetched_at).getTime();
    if (age < STALE_MS) return { price: Number(latest.price_usd), source: latest.source };
  }

  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );
    if (r.ok) {
      const j = await r.json();
      const price = Number(j?.ethereum?.usd);
      if (price > 0) {
        await admin.from("native_price_cache").upsert(
          {
            chain_id: ROBINHOOD_CHAIN_ID,
            symbol: ROBINHOOD_NATIVE_SYMBOL,
            price_usd: price,
            source: "coingecko",
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "chain_id,symbol" },
        );
        return { price, source: "coingecko" };
      }
    }
  } catch (_) {
    // Last-known stale value beats no value for non-critical paths.
  }

  if (latest) return { price: Number(latest.price_usd), source: `${latest.source}_stale` };
  return null;
}
