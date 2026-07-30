import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertLaunchPayloadMatchesThread,
  LaunchIntentMismatchError,
  launchVerificationReply,
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
