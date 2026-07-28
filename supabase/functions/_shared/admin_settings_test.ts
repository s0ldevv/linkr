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

Deno.test("metadata testing policy disables invalid URLs", () => {
  assertEquals(
    normalizeMetadataTestingPolicy({
      enabled: true,
      test_website_url: "http://not-secure.example",
      test_twitter_url: "javascript:alert(1)",
      test_telegram_url: "https://t.me/linkr",
    }),
    {
      enabled: true,
      test_website_url: "https://google.com",
      test_twitter_url: "https://x.com",
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
