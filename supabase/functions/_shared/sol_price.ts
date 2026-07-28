// deno-lint-ignore-file no-explicit-any
// Live SOL/USD price with the legacy sol_price_cache table.

const STALE_MS = 60_000;

export async function getSolUsdPrice(
  admin: any,
): Promise<{ price: number; source: string } | null> {
  const { data: latest } = await admin
    .from("sol_price_cache")
    .select("price_usd,source,fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const age = Date.now() - new Date(latest.fetched_at).getTime();
    if (age < STALE_MS) return { price: Number(latest.price_usd), source: latest.source };
  }

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    );
    if (response.ok) {
      const json = await response.json();
      const price = Number(json?.solana?.usd);
      if (price > 0) {
        await admin.from("sol_price_cache").insert({
          price_usd: price,
          source: "coingecko",
          fetched_at: new Date().toISOString(),
        });
        return { price, source: "coingecko" };
      }
    }
  } catch (_) {
    // Last-known stale value beats no value for command amount normalization.
  }

  if (latest) return { price: Number(latest.price_usd), source: `${latest.source}_stale` };
  return null;
}
