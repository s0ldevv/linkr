// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  loadExpectedXBotIdentity,
  normalizeXBotHandle,
} from "./x_bot_identity.ts";

Deno.test("X bot identity normalizes the expected handle", () => {
  assertEquals(normalizeXBotHandle(" @LinkrCash "), "linkrcash");
  assertEquals(
    loadExpectedXBotIdentity((name) =>
      name === "X_BOT_USER_ID" ? "2070400325207334912" : "@LinkrCash"
    ),
    { userId: "2070400325207334912", handle: "linkrcash" },
  );
});

Deno.test("X bot identity rejects missing or wrong configuration", () => {
  assertThrows(() => loadExpectedXBotIdentity(() => undefined));
  assertThrows(() =>
    loadExpectedXBotIdentity((
      name,
    ) => (name === "X_BOT_USER_ID" ? "not-numeric" : "linkrcash"))
  );
  assertThrows(() =>
    loadExpectedXBotIdentity((name) =>
      name === "X_BOT_USER_ID" ? "2070400325207334912" : "someoneelse"
    )
  );
});
