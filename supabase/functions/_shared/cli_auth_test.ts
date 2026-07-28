import {
  createCliUserCode,
  isRecentCliXAuthenticationForRequest,
  normalizeCliLimits,
  normalizeCliOpaqueCode,
  normalizeCliScopes,
  normalizeCliUserCode,
} from "./cli_auth.ts";

Deno.test("CLI user code normalizes hyphen and space variations", () => {
  const code = createCliUserCode();
  const compact = code.replace(/-/g, "").toLowerCase();
  if (normalizeCliUserCode(compact) !== code) {
    throw new Error("compact code did not normalize");
  }
  if (normalizeCliUserCode(` ${code.toLowerCase()} `) !== code) {
    throw new Error("spaced code did not normalize");
  }
});

Deno.test("CLI opaque browser and device codes reject short or unsafe values", () => {
  if (normalizeCliOpaqueCode("abc")) throw new Error("short code accepted");
  if (normalizeCliOpaqueCode("a".repeat(31))) {
    throw new Error("31-char code accepted");
  }
  if (!normalizeCliOpaqueCode("a".repeat(32))) {
    throw new Error("32-char code rejected");
  }
  if (normalizeCliOpaqueCode("a".repeat(32) + "!")) {
    throw new Error("unsafe code accepted");
  }
});

Deno.test("CLI scopes always include base chat scopes", () => {
  const scopes = normalizeCliScopes(["trade:buy"]);
  for (
    const required of [
      "profile:read",
      "actions:read",
      "coins:read",
      "coin:read",
      "chat:write",
    ]
  ) {
    if (!scopes.includes(required as never)) {
      throw new Error(`missing ${required}`);
    }
  }
  if (!scopes.includes("trade:buy")) throw new Error("explicit scope missing");
});

Deno.test("CLI limits default write capabilities to zero unless supplied", () => {
  const limits = normalizeCliLimits(
    {},
    ["profile:read", "chat:write", "trade:buy"] as any,
  );
  if (limits.max_buy_eth !== 0) {
    throw new Error("missing write cap did not default to zero");
  }
  const custom = normalizeCliLimits(
    { max_buy_eth: 0.005 },
    ["trade:buy"] as any,
  );
  if (custom.max_buy_eth !== 0.005) {
    throw new Error("custom cap was not preserved");
  }
});

Deno.test("CLI limits clamp oversized client requested caps", () => {
  const limits = normalizeCliLimits({
    max_buy_eth: 10,
    max_buy_sol: 10,
    max_sell_percent: 100,
    daily_request_limit: 5000,
    daily_tx_limit: 5000,
  }, ["trade:buy", "trade:sell"] as any);
  if (limits.max_buy_eth !== 0.01) {
    throw new Error("ETH buy cap was not clamped");
  }
  if (limits.max_buy_sol !== 0.05) {
    throw new Error("SOL buy cap was not clamped");
  }
  if (limits.max_sell_percent !== 25) {
    throw new Error("sell percent cap was not clamped");
  }
  if (limits.daily_request_limit !== 500) {
    throw new Error("daily request cap was not clamped");
  }
  if (limits.daily_tx_limit !== 25) {
    throw new Error("daily tx cap was not clamped");
  }
});

Deno.test("CLI approval requires recent X auth after the browser request", () => {
  const requestCreatedAt = "2026-07-28T20:00:00.000Z";
  const now = Date.parse("2026-07-28T20:01:00.000Z");
  if (
    !isRecentCliXAuthenticationForRequest(
      new Date("2026-07-28T20:00:05.000Z"),
      requestCreatedAt,
      now,
    )
  ) {
    throw new Error("fresh post-request X auth was rejected");
  }
  if (
    !isRecentCliXAuthenticationForRequest(
      new Date("2026-07-28T19:59:45.000Z"),
      requestCreatedAt,
      now,
    )
  ) {
    throw new Error("minor auth/request clock skew was rejected");
  }
  if (
    isRecentCliXAuthenticationForRequest(
      new Date("2026-07-28T19:58:00.000Z"),
      requestCreatedAt,
      now,
    )
  ) {
    throw new Error("pre-request X auth was accepted");
  }
  if (
    isRecentCliXAuthenticationForRequest(
      new Date("2026-07-28T19:54:59.000Z"),
      requestCreatedAt,
      now,
    )
  ) {
    throw new Error("stale X auth was accepted");
  }
  if (
    isRecentCliXAuthenticationForRequest(
      null,
      requestCreatedAt,
      now,
    )
  ) {
    throw new Error("missing X auth timestamp was accepted");
  }
});
