import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertLaunchPayloadMatchesThread,
  LaunchIntentMismatchError,
  launchVerificationReply,
  reconcileVerificationWithUserText,
  sanitizeLaunchSemanticVerification,
} from "./launch_semantic_verifier.ts";

Deno.test("semantic verifier accepts a matching launch payload", () => {
  const verification = sanitizeLaunchSemanticVerification({
    matches_user_intent: true,
    blocking_mismatches: [],
    confidence: 0.97,
    user_visible_summary: "Launch TEST named test on Solana",
    clarification_question: null,
  });

  assertLaunchPayloadMatchesThread(verification);
  assertEquals(
    verification.user_visible_summary,
    "Launch TEST named test on Solana",
  );
});

Deno.test("semantic verifier blocks mismatched launch payloads with a useful question", () => {
  const verification = sanitizeLaunchSemanticVerification({
    matches_user_intent: false,
    blocking_mismatches: [
      'name "linkrbot" conflicts with the original request for name "test"',
    ],
    confidence: 0.93,
    user_visible_summary: "Launch TEST named linkrbot on Solana",
    clarification_question:
      'I have name "linkrbot" and ticker TEST, but your first request said name "test". Should I launch name "test" with ticker TEST on Solana?',
  });

  assertThrows(
    () => assertLaunchPayloadMatchesThread(verification),
    LaunchIntentMismatchError,
    "launch_payload_intent_mismatch",
  );
  assertEquals(
    launchVerificationReply(verification),
    'I have name "linkrbot" and ticker TEST, but your first request said name "test". Should I launch name "test" with ticker TEST on Solana?',
  );
});

// Production incident, 2026-07-30: @s0ldev asked for ticker "test" on Solana.
// The payload carried "TEST" — an uppercase form the platform is *required* to
// produce, since the database rejects any symbol not matching ^[A-Z0-9]{2,10}$
// and stores it via upper(). The verifier called that a mismatch, paused the
// launch, and asked the user to choose between "test" and "TEST" — where the
// lowercase option could never have launched.
Deno.test("a mandatory uppercase ticker is never a mismatch", () => {
  const verification = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: [
        'Symbol mismatch: user requested ticker "test" but payload uses "TEST" (case differs).',
      ],
      confidence: 0.9,
      user_visible_summary:
        "Payload sets name test, symbol TEST, chain solana, dev buy 0 SOL.",
      clarification_question:
        'Do you want the token symbol exactly as "test" (lowercase) instead of "TEST" (uppercase), or is the uppercase symbol acceptable?',
    }),
    {
      originalUserRequest:
        "@linkrbot launch a coin called test, ticker test. On Solana.",
      finalPayload: {
        name: "test",
        symbol: "TEST",
        chain: "solana",
        dev_buy_amount: "0 SOL",
      },
    },
  );

  assertEquals(verification.blocking_mismatches, []);
  assertEquals(verification.matches_user_intent, true);
  assertEquals(verification.clarification_question, null);
  assertEquals(verification.reconciled_slots, ["symbol"]);
  assertLaunchPayloadMatchesThread(verification);
});

// The safety net this verifier exists for must survive untouched. The bot
// handle is stripped from user text, so it can never be proven to agree.
Deno.test("a real mismatch is still blocked after reconciliation", () => {
  const verification = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: [
        'name "linkrbot" conflicts with the original request for name "test"',
      ],
      confidence: 0.93,
      user_visible_summary: "Launch TEST named linkrbot on Solana",
      clarification_question: "Should I launch name test instead?",
    }),
    {
      originalUserRequest: "@linkrbot launch a coin called test on Solana",
      finalPayload: { name: "linkrbot", symbol: "TEST", chain: "solana" },
    },
  );

  assertEquals(verification.blocking_mismatches.length, 1);
  assertEquals(verification.matches_user_intent, false);
  assertThrows(
    () => assertLaunchPayloadMatchesThread(verification),
    LaunchIntentMismatchError,
  );
});

Deno.test("a genuine ticker change is still blocked", () => {
  const verification = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: [
        'Symbol mismatch: user asked for "moon", payload "TEST"',
      ],
      confidence: 0.95,
      user_visible_summary: "Launch TEST on Solana",
      clarification_question: "Which ticker?",
    }),
    {
      originalUserRequest:
        "@linkrbot launch a coin called moondog ticker moon on Solana",
      finalPayload: { name: "moondog", symbol: "TEST", chain: "solana" },
    },
  );

  assertEquals(verification.blocking_mismatches.length, 1);
  assertThrows(
    () => assertLaunchPayloadMatchesThread(verification),
    LaunchIntentMismatchError,
  );
});

// A slot the user never stated cannot be proven to agree, so nothing is
// cleared on their behalf.
Deno.test("an unstated slot is never reconciled away", () => {
  const verification = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: ["Symbol mismatch: payload uses MOON"],
      confidence: 0.9,
      user_visible_summary: "Launch MOON on Solana",
      clarification_question: "Is MOON right?",
    }),
    {
      originalUserRequest: "@linkrbot launch a coin called moondog on Solana",
      finalPayload: { name: "moondog", symbol: "MOON", chain: "solana" },
    },
  );
  assertEquals(verification.blocking_mismatches.length, 1);
  assertEquals(verification.reconciled_slots, undefined);
});

Deno.test("a complaint naming several slots clears only when all are proven", () => {
  const input = {
    originalUserRequest:
      "@linkrbot launch a coin called test, ticker test. On Solana.",
    finalPayload: {
      name: "test",
      symbol: "TEST",
      chain: "solana" as const,
      dev_buy_amount: "0 SOL",
    },
  };

  const bothProven = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: ["name and ticker case differ from the request"],
      confidence: 0.9,
      user_visible_summary: "s",
      clarification_question: "q",
    }),
    input,
  );
  assertEquals(bothProven.blocking_mismatches, []);

  const oneUnproven = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: ["ticker case differs and the dev buy is wrong"],
      confidence: 0.9,
      user_visible_summary: "s",
      clarification_question: "q",
    }),
    {
      ...input,
      finalPayload: { ...input.finalPayload, dev_buy_amount: "1 SOL" },
    },
  );
  assertEquals(oneUnproven.blocking_mismatches.length, 1);
});

Deno.test("an unrecognizable complaint is always kept", () => {
  const verification = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: ["something about this payload looks wrong"],
      confidence: 0.9,
      user_visible_summary: "s",
      clarification_question: "q",
    }),
    {
      originalUserRequest:
        "@linkrbot launch a coin called test ticker test on Solana",
      finalPayload: { name: "test", symbol: "TEST", chain: "solana" },
    },
  );
  assertEquals(verification.blocking_mismatches.length, 1);
});

// Reconciliation corrects the mismatch list, not the model's own uncertainty.
Deno.test("low confidence still blocks even when every slot is proven", () => {
  const verification = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: ["ticker case differs"],
      confidence: 0.2,
      user_visible_summary: "s",
      clarification_question: "q",
    }),
    {
      originalUserRequest:
        "@linkrbot launch a coin called test ticker test on Solana",
      finalPayload: { name: "test", symbol: "TEST", chain: "solana" },
    },
  );
  assertEquals(verification.blocking_mismatches, []);
  assertThrows(
    () => assertLaunchPayloadMatchesThread(verification),
    LaunchIntentMismatchError,
  );
});

Deno.test("a follow-up ticker overrides the original request", () => {
  const verification = reconcileVerificationWithUserText(
    sanitizeLaunchSemanticVerification({
      matches_user_intent: false,
      blocking_mismatches: ["ticker differs from the request"],
      confidence: 0.9,
      user_visible_summary: "s",
      clarification_question: "q",
    }),
    {
      originalUserRequest:
        "@linkrbot launch a coin called test ticker old on Solana",
      latestFollowUp: "@linkrbot actually make the ticker moon",
      finalPayload: { name: "test", symbol: "MOON", chain: "solana" },
    },
  );
  assertEquals(verification.blocking_mismatches, []);
  assertEquals(verification.reconciled_slots, ["symbol"]);
});
