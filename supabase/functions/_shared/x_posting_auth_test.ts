// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertMatch,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  loadXBotPostAuthMode,
  xPostingAuthorization,
} from "./x_posting_auth.ts";

Deno.test("X posting auth mode fails closed when missing or invalid", () => {
  assertThrows(() => loadXBotPostAuthMode(() => undefined));
  assertThrows(() => loadXBotPostAuthMode(() => "bearer"));
});

Deno.test("X posting auth mode accepts only explicit supported modes", () => {
  assertEquals(
    loadXBotPostAuthMode(() => "oauth1"),
    "oauth1",
  );
  assertEquals(
    loadXBotPostAuthMode(() => " OAUTH2 "),
    "oauth2",
  );
});

Deno.test("X posting auth creates an OAuth 1.0a header from server environment", async () => {
  const values: Record<string, string> = {
    X_OAUTH1_CONSUMER_KEY: "consumer",
    X_OAUTH1_CONSUMER_SECRET: "consumer-secret",
    X_OAUTH1_ACCESS_TOKEN: "access",
    X_OAUTH1_ACCESS_TOKEN_SECRET: "access-secret",
  };
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Deno.env.get(name));
    Deno.env.set(name, value);
  }
  try {
    const result = await xPostingAuthorization(
      null,
      { method: "POST", url: "https://api.x.com/2/tweets" },
      { mode: "oauth1" },
    );
    assertEquals(result.mode, "oauth1");
    assertMatch(result.authorization, /^OAuth /);
  } finally {
    for (const [name, value] of previous) {
      if (value == null) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("X posting auth keeps OAuth 2.0 rollback mode reachable", async () => {
  const result = await xPostingAuthorization(
    { marker: "admin" },
    { method: "POST", url: "https://api.x.com/2/tweets" },
    {
      mode: "oauth2",
      oauth2TokenLoader: (admin) => {
        assertEquals(admin.marker, "admin");
        return Promise.resolve({ accessToken: "rollback-access-token" });
      },
    },
  );
  assertEquals(result, {
    authorization: "Bearer rollback-access-token",
    mode: "oauth2",
  });
});
