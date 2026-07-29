import {
  parseTelegramVerificationHandoffPayload,
  telegramLoginKeyboard,
  telegramLogoutKeyboard,
  telegramStartMenuKeyboard,
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
  const invalid = [
    null,
    "",
    "login",
    "verify_123",
    "verify_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  ];
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

Deno.test("Telegram logout keyboard uses stable callback payloads", () => {
  const keyboard = telegramLogoutKeyboard();
  const buttons = keyboard.inline_keyboard[0];
  if (buttons[0].callback_data !== "logout:confirm") {
    throw new Error("Logout confirm callback changed");
  }
  if (buttons[1].callback_data !== "logout:cancel") {
    throw new Error("Logout cancel callback changed");
  }
});

Deno.test("Telegram login keyboard uses the Linkr login button label", () => {
  const keyboard = telegramLoginKeyboard("https://example.test/login");
  const button = keyboard.inline_keyboard[0][0];
  if (button.text !== "Log in with X") {
    throw new Error("Login button label changed");
  }
  if (button.url !== "https://example.test/login") {
    throw new Error("Login button URL changed");
  }
});

Deno.test("Telegram start menu keyboard links to Linkr surfaces and keeps login last", () => {
  const keyboard = telegramStartMenuKeyboard("https://example.test/login");
  const rows = keyboard.inline_keyboard;
  if (rows[0][0].url !== "https://linkr.cash") {
    throw new Error("Website button URL changed");
  }
  if (rows[0][1].url !== "https://linkr.cash/app/terminal") {
    throw new Error("Terminal button URL changed");
  }
  if (rows[1][0].url !== "https://x.com/linkrcash") {
    throw new Error("X button URL changed");
  }
  const login = rows[rows.length - 1][0];
  if (
    login.text !== "Log in with X" || login.url !== "https://example.test/login"
  ) {
    throw new Error("Login button is not last in the start menu");
  }
});
