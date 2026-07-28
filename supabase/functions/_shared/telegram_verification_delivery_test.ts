import {
  parseTelegramVerificationHandoffPayload,
  telegramVerificationHandoffPayload,
} from "./telegram.ts";

const CHALLENGE_ID = "123e4567-e89b-12d3-a456-426614174000";

Deno.test("Telegram verification handoff round-trips a challenge UUID", () => {
  const payload = telegramVerificationHandoffPayload(CHALLENGE_ID);
  if (payload !== "verify_123e4567e89b12d3a456426614174000") {
    throw new Error(`Unexpected handoff payload: ${payload}`);
  }
  if (parseTelegramVerificationHandoffPayload(payload) !== CHALLENGE_ID) {
    throw new Error("Handoff payload did not round-trip");
  }
});

Deno.test("Telegram verification handoff rejects malformed and unrelated payloads", () => {
  const invalid = [null, "", "login", "verify_123", "verify_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"];
  for (const payload of invalid) {
    if (parseTelegramVerificationHandoffPayload(payload) !== null) {
      throw new Error(`Malformed payload was accepted: ${payload}`);
    }
  }
});

Deno.test("Telegram verification handoff refuses a non-UUID challenge id", () => {
  let threw = false;
  try {
    telegramVerificationHandoffPayload("not-a-uuid");
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Invalid challenge id was accepted");
});
