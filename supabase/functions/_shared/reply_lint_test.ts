import { lintPublicReply, sanitizePublicReply } from "./reply_lint.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("lintPublicReply blocks internal language", () => {
  const blocked = [
    "The thread context is just a greeting.",
    "No token data is available here.",
    "Based on the provided context, hello.",
    "The classification says this is general_inquiry.",
    "The tool used an API key.",
    "Thanks, I've got it. I'll check the token info for this address now.",
  ];

  for (const text of blocked) {
    const result = lintPublicReply(text, "conversation");
    assert(!result.ok, text + " should fail lint");
    assert(
      result.blocked_phrases.length > 0,
      text + " should report blocked phrases",
    );
  }
});

Deno.test("lintPublicReply allows clean market read language", () => {
  const clean = [
    "$TEST\nPrice: $0.01 | 24h +12%\nLiq: $120K | Vol: $42K\nRead: positive momentum. DYOR.",
    "$HOT\nPrice: $0.42 | 24h +35.9%\nLiq: $3.53M | Vol: $25.56M\nRead: strong momentum, but chasing strength is risky. DYOR.",
    "Trending tokens are moving fast. Pick one and send the contract address for a cleaner read. DYOR.",
  ];

  for (const text of clean) {
    const result = lintPublicReply(text, "coin_inquiry");
    assert(result.ok, text + " should pass lint");
  }
});

Deno.test("lintPublicReply allows supported Solana market language in coin replies", () => {
  const clean = [
    "This looks active on Solana, but liquidity is still thin. DYOR.",
    "Raydium liquidity looks active here, but volume can turn fast. DYOR.",
    "Pump activity is noisy; watch liquidity and holder concentration. DYOR.",
  ];

  for (const text of clean) {
    const result = lintPublicReply(text, "coin_inquiry");
    assert(result.ok, text + " should pass lint");
  }
});

Deno.test("lintPublicReply blocks source-heavy market replies", () => {
  const blocked = [
    "Fresh data from DEX Screener + Moralis.",
    "DEX Screener shows $TEST around $0.01 with $120K liquidity.",
    "Moralis shows 80 buyers and 60 sellers over 24h.",
    "$TEST: price $0.01. Source: DEX Screener. Not financial advice.",
    "$TEST: $0.01. Buys/Sells: 100 / 95.",
  ];

  for (const text of blocked) {
    const result = lintPublicReply(text, "coin_inquiry");
    assert(!result.ok, text + " should fail lint");
    assert(
      result.blocked_phrases.includes("coin-source-noise"),
      text + " should flag source noise",
    );
  }
});

Deno.test("lintPublicReply allows clean conversation and coin inquiry fallbacks", () => {
  const clean = [
    ["Hi! How can I help?", "conversation"],
    ["Hi! I'm good, thanks for asking. How can I help?", "conversation"],
    [
      "I need the token contract address, ticker, or chart to answer that cleanly.",
      "coin_inquiry",
    ],
  ] as const;

  for (const [text, mode] of clean) {
    const result = lintPublicReply(text, mode);
    assert(result.ok, text + " should pass lint");
  }
});

Deno.test("sanitizePublicReply removes links and trims length", () => {
  const text = sanitizePublicReply(
    "Check this https://example.com please " + "x".repeat(400),
  );
  assert(!text.includes("https://example.com"), "link should be removed");
  assert(text.length <= 260, "text should be capped at 260 chars");
});
