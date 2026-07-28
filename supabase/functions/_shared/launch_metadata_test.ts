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
    {
      metadata_website_url: "https://user.example",
      metadata_twitter_url: "https://x.com/user/status/999",
      metadata_telegram_url: "https://t.me/usergroup",
      mint_address: "Mint111",
      source_tweet_url: "https://x.com/linkrcash/status/123",
    },
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

Deno.test("metadata testing blank fields use launch defaults and ignore user metadata", () => {
  const resolved = resolvePumpFunLaunchMetadata(
    {
      metadata_website_url: "https://user.example",
      metadata_twitter_url: "https://x.com/user/status/999",
      metadata_telegram_url: "https://t.me/usergroup",
      mint_address: "Mint111",
      source_tweet_url: "https://x.com/linkrcash/status/123",
    },
    {
      testingMode: true,
      testingWebsiteUrl: null,
      testingTwitterUrl: null,
      testingTelegramUrl: null,
    },
  );

  assertEquals(resolved.websiteUrl, "https://linkr.cash/coin/Mint111");
  assertEquals(resolved.twitterUrl, "https://x.com/linkrcash/status/123");
  assertEquals(resolved.telegramUrl, null);
  assertEquals(resolved.testingMode, true);
});
