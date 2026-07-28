import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideLaunchAuthorization } from "./launch_authorization_policy.ts";

const safe = {
  explicitLaunchIntent: true,
  name: "Test",
  chain: "solana",
  chainProvenance: "user_text",
  walletId: "wallet-id",
  devBuyAmount: 0,
  maximumAutoDevBuy: 0,
  requireConfirmationForAll: false,
};

Deno.test("explicit safe launch is auto-authorized", () => {
  assertEquals(decideLaunchAuthorization(safe), {
    kind: "auto_authorized",
    reasonCode: "explicit_launch_intent",
  });
});

Deno.test("chain cannot come from a profile, platform, or model default", () => {
  for (
    const provenance of [
      "profile_default",
      "platform_default",
      "ai_generated",
      "deterministic_fallback",
    ]
  ) {
    assertEquals(
      decideLaunchAuthorization({ ...safe, chainProvenance: provenance }),
      {
        kind: "clarification_required",
        reasonCode: "explicit_chain_missing",
      },
    );
  }
});

Deno.test("profile confirmation preference is preserved", () => {
  assertEquals(
    decideLaunchAuthorization({ ...safe, requireConfirmationForAll: true }),
    {
      kind: "confirmation_required",
      reasonCode: "profile_requires_confirmation",
    },
  );
});

Deno.test("positive buy cannot exceed the configured cap", () => {
  assertEquals(
    decideLaunchAuthorization({
      ...safe,
      devBuyAmount: 0.2,
      maximumAutoDevBuy: 0.1,
    }),
    {
      kind: "clarification_required",
      reasonCode: "dev_buy_exceeds_cap",
    },
  );
});
