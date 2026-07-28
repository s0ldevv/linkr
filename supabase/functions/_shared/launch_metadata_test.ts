import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePumpFunLaunchMetadata } from "./launch_metadata.ts";

Deno.test("production pump metadata never falls back to testing website", () => {
  const resolved = resolvePumpFunLaunchMetadata(
    {
      mint_address: "Mint111111111111111111111111111111111111111",
      source_tweet_url: "https://x.com/linkrcash/status/123",
    },
    { testingMode: false },
  );

  assertEquals(
    resolved.websiteUrl,
    "https://linkr.cash/coin/Mint111111111111111111111111111111111111111",
  );
  assertEquals(resolved.twitterUrl, "https://x.com/linkrcash/status/123");
  assertEquals(resolved.telegramUrl, null);
  assertEquals(resolved.testingMode, false);
});

Deno.test("pump metadata testing mode requires explicit policy enablement", () => {
  const resolved = resolvePumpFunLaunchMetadata(
    { mint_address: "Mint111" },
    {
      testingMode: true,
      testingWebsiteUrl: "https://example.com/test",
      testingTwitterUrl: "https://twitter.com/linkrcash/status/123",
      testingTelegramUrl: "@linkr",
    },
  );

  assertEquals(resolved.websiteUrl, "https://example.com/test");
  assertEquals(resolved.twitterUrl, "https://twitter.com/linkrcash/status/123");
  assertEquals(resolved.telegramUrl, "https://t.me/linkr");
  assertEquals(resolved.testingMode, true);
});
