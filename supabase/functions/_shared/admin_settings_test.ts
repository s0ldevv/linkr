import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeLaunchFundingPolicy,
  normalizeMetadataTestingPolicy,
  normalizeXUserGatingPolicy,
  normalizeXUserMetrics,
} from "./admin_settings.ts";

Deno.test("launch funding policy rejects unsupported modes", () => {
  assertEquals(
    normalizeLaunchFundingPolicy({ mode: "first_eligible_launch" }),
    {
      mode: "first_eligible_launch",
    },
  );
  assertEquals(
    normalizeLaunchFundingPolicy({ mode: "fund_every_eligible_launch" }),
    {
      mode: "fund_every_eligible_launch",
    },
  );
  assertEquals(
    normalizeLaunchFundingPolicy({ mode: "unsupported_mode" }),
    {
      mode: "first_eligible_launch",
    },
  );
});

Deno.test("X gating policy clamps unsafe threshold values", () => {
  assertEquals(
    normalizeXUserGatingPolicy({
      min_followers_enabled: true,
      min_followers: -10,
      min_following_enabled: true,
      min_following: 5.8,
      min_posts_enabled: true,
      min_posts: "12",
    }),
    {
      min_followers_enabled: true,
      min_followers: 0,
      min_following_enabled: true,
      min_following: 5,
      min_posts_enabled: true,
      min_posts: 12,
    },
  );
});

Deno.test("metadata testing policy treats invalid or blank testing fields as unset", () => {
  assertEquals(
    normalizeMetadataTestingPolicy({
      enabled: true,
      test_website_url: "http://not-secure.example",
      test_twitter_url: "https://example.com/not-x",
      test_telegram_url: "https://t.me/",
    }),
    {
      enabled: true,
      test_website_url: null,
      test_twitter_url: null,
      test_telegram_url: null,
    },
  );
});

Deno.test("metadata testing policy normalizes common URL input", () => {
  assertEquals(
    normalizeMetadataTestingPolicy({
      enabled: true,
      test_website_url: "linkr.cash/coin/test",
      test_twitter_url: "x.com/linkrcash/status/123",
      test_telegram_url: "t.me/linkr",
    }),
    {
      enabled: true,
      test_website_url: "https://linkr.cash/coin/test",
      test_twitter_url: "https://x.com/linkrcash/status/123",
      test_telegram_url: "https://t.me/linkr",
    },
  );
});

Deno.test("X public metrics normalize to bounded integers", () => {
  assertEquals(
    normalizeXUserMetrics({
      followers_count: 10.9,
      following_count: "bad",
      tweet_count: "42",
    }),
    {
      followers_count: 10,
      following_count: 0,
      tweet_count: 42,
    },
  );
});
