// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_X_BOT_HANDLE,
  isLinkrBotHandle,
  loadExpectedXBotIdentity,
  normalizeXBotHandle,
} from "./x_bot_identity.ts";

Deno.test("X bot identity normalizes the expected handle", () => {
  assertEquals(DEFAULT_X_BOT_HANDLE, "linkrcash");
  assertEquals(normalizeXBotHandle(" @LinkrBot "), "linkrbot");
  assertEquals(normalizeXBotHandle(" @LinkrCash "), "linkrcash");
  assertEquals(
    loadExpectedXBotIdentity((name) =>
      name === "X_BOT_USER_ID" ? "2070400325207334912" : "@LinkrCash"
    ),
    { userId: "2070400325207334912", handle: "linkrcash" },
  );
});

Deno.test("X bot identity treats LinkrCash as canonical and LinkrBot as legacy", () => {
  assertEquals(isLinkrBotHandle("@LinkrCash"), true);
  assertEquals(isLinkrBotHandle("@LinkrBot"), true);
  assertEquals(isLinkrBotHandle("@project"), false);
});

Deno.test("X bot identity rejects missing or wrong configuration", () => {
  assertThrows(() => loadExpectedXBotIdentity(() => undefined));
  assertThrows(() =>
    loadExpectedXBotIdentity((
      name,
    ) => (name === "X_BOT_USER_ID" ? "not-numeric" : "linkrbot"))
  );
  assertThrows(() =>
    loadExpectedXBotIdentity((name) =>
      name === "X_BOT_USER_ID" ? "2070400325207334912" : "bad-handle!"
    )
  );
});

Deno.test("cron mention fetcher falls back to LinkrCash, not LinkrBot", async () => {
  const source = await Deno.readTextFile(
    new URL("../cron-fetch-mentions/index.ts", import.meta.url),
  );
  assertEquals(source.includes('DEFAULT_BOT_HANDLE = "linkrbot"'), false);
  assertEquals(source.includes('BOT_HANDLE = "linkrbot"'), false);
  assertEquals(source.includes("DEFAULT_X_BOT_HANDLE"), true);
});
