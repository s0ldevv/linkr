// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { configuredLinkrAdminXUserId, normalizeXHandle } from "./x_bans.ts";

Deno.test("X ban helpers normalize handles and require stable admin identity", () => {
  assertEquals(normalizeXHandle(" @LinkrBot "), "linkrbot");
  assertEquals(
    configuredLinkrAdminXUserId(() => "2070400325207334912"),
    "2070400325207334912",
  );
  assertThrows(() => configuredLinkrAdminXUserId(() => undefined));
  assertThrows(() => configuredLinkrAdminXUserId(() => "not-a-user-id"));
});
