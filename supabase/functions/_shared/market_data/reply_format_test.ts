import { buildMarketInfoReply, shouldRepairCoinInquiryReply } from "./reply_format.ts";
import { lintPublicReply } from "../reply_lint.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("buildMarketInfoReply formats token info cleanly with DYOR", () => {
  const reply = buildMarketInfoReply({
    symbol: "ANSEM",
    name: "The Black Bull",
    pair: { dex: "Blockscout" },
    price_usd: 0.4219,
    price_change_24h: 35.9,
    market_cap_usd: 4_200_000,
    liquidity_usd: 3_530_000,
    volume_24h_usd: 25_560_000,
    buys_24h: 19_855,
    sells_24h: 19_719,
  });

  assert(reply, "reply should be built");
  assert(reply.includes("$ANSEM (The Black Bull)"), "missing title");
  assert(!reply.includes("on Blockscout"), "should not display Blockscout as a DEX");
  assert(reply.includes("Price: $0.422 | 24h +35.9%"), "missing price line");
  assert(reply.includes("Market cap: $4.2M | Liq: $3.53M | Vol: $25.56M"), "missing market line");
  assert(reply.includes("24h flow: 19.86K buys / 19.72K sells"), "missing flow line");
  assert(reply.includes("Read:"), "missing read");
  assert(reply.includes("DYOR"), "missing DYOR");
  assert(!reply.includes("DEX Screener"), "should not mention provider");
  assert(!reply.includes("Moralis"), "should not mention provider");
  assert(reply.length <= 260, "reply should fit X limit");
  assert(lintPublicReply(reply, "coin_inquiry").ok, "reply should pass lint");
});

Deno.test("shouldRepairCoinInquiryReply catches source-heavy messy replies", () => {
  const messy =
    "ANSEM (The Black Bull): $0.4219, +1.4% 1h, +4.51% 6h, +35.9% 24h. Liquidity: $3.53M. Vol: $25.56M 24h. Buys/Sells: 19,855 / 19,719. Fresh data from DEX Screener + Moralis.";

  assert(shouldRepairCoinInquiryReply(messy), "messy source-heavy reply should be repaired");
});

Deno.test("shouldRepairCoinInquiryReply catches false no-data market replies", () => {
  const noData =
    "Token identified, but there is no market data available for it right now. Share the ticker or a chart.";

  assert(shouldRepairCoinInquiryReply(noData), "false no-data reply should be repaired");
});

Deno.test("shouldRepairCoinInquiryReply catches vague not-provided analytics replies", () => {
  const vague = "Cash Cat (CASHCAT)\n$0.151953, up/down data not provided\n24h volume: $51.16M";

  assert(shouldRepairCoinInquiryReply(vague), "not-provided analytics reply should be repaired");
});

Deno.test(
  "shouldRepairCoinInquiryReply catches price-only replies when market cap is available",
  () => {
    const priceOnly = "$CASHCAT\nPrice: $0.153 | 24h +37.7%\nRead: strong momentum. DYOR.";
    const fallback =
      "$CASHCAT\nPrice: $0.153 | 24h +37.7%\nMarket cap: $147.74M | Liq: $7M | Vol: $54.02M\nRead: strong momentum. DYOR.";

    assert(
      shouldRepairCoinInquiryReply(priceOnly, fallback),
      "price-only replies should be repaired when fallback has market cap",
    );
  },
);
