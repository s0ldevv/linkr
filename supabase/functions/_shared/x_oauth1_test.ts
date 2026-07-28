// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createXOAuth1AuthorizationHeader,
  loadXOAuth1Credentials,
  percentEncode,
} from "./x_oauth1.ts";

const credentials = {
  consumerKey: "9djdj82h48djs9d2",
  consumerSecret: "j49sk3j29djd",
  accessToken: "kkk9d7dh3k39sjv7",
  accessTokenSecret: "dh893hdasih9",
};

Deno.test("OAuth 1.0a percent encoding follows RFC 3986", () => {
  assertEquals(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assertEquals(percentEncode("An encoded string!"), "An%20encoded%20string%21");
  assertEquals(
    percentEncode("Dogs, Cats & Mice"),
    "Dogs%2C%20Cats%20%26%20Mice",
  );
  assertEquals(percentEncode("☃"), "%E2%98%83");
  assertEquals(percentEncode("-._~"), "-._~");
});

Deno.test("OAuth 1.0a signer matches RFC 5849 signature vector", async () => {
  const header = await createXOAuth1AuthorizationHeader({
    method: "POST",
    url: "http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b",
    credentials,
    nonce: "7d8f3e4a",
    timestamp: 137131201,
    formParameters: [
      ["c2", ""],
      ["a3", "2 q"],
    ],
    allowInsecureForTesting: true,
    includeVersion: false,
  });
  // RFC 5849 verified erratum 2550 corrects the originally printed bYT5...
  // value to r6/TJjbCOr97/+UU0NsvSne7s5g=.
  assert(
    header.includes('oauth_signature="r6%2FTJjbCOr97%2F%2BUU0NsvSne7s5g%3D"'),
  );
});

Deno.test("OAuth 1.0a signer normalizes query order and default HTTPS port", async () => {
  const options = {
    method: "GET",
    credentials,
    nonce: "fixed",
    timestamp: 1700000000,
  };
  const left = await createXOAuth1AuthorizationHeader({
    ...options,
    url: "https://API.X.COM:443/2/users/me?z=2&a=1&a=0",
  });
  const right = await createXOAuth1AuthorizationHeader({
    ...options,
    url: "https://api.x.com/2/users/me?a=0&z=2&a=1",
  });
  assertEquals(left, right);
});

Deno.test("OAuth 1.0a signer is deterministic with injected nonce and timestamp", async () => {
  const options = {
    method: "POST",
    url: "https://api.x.com/2/tweets",
    credentials,
    nonce: "nonce-value",
    timestamp: 1700000000,
  };
  assertEquals(
    await createXOAuth1AuthorizationHeader(options),
    await createXOAuth1AuthorizationHeader(options),
  );
});

Deno.test("OAuth 1.0a signer generates a fresh nonce", async () => {
  const first = await createXOAuth1AuthorizationHeader({
    method: "POST",
    url: "https://api.x.com/2/tweets",
    credentials,
  });
  const second = await createXOAuth1AuthorizationHeader({
    method: "POST",
    url: "https://api.x.com/2/tweets",
    credentials,
  });
  assert(first !== second);
});

Deno.test("OAuth 1.0a header excludes secrets", async () => {
  const header = await createXOAuth1AuthorizationHeader({
    method: "POST",
    url: "https://api.x.com/2/tweets",
    credentials,
    nonce: "safe",
    timestamp: 1700000000,
  });
  assert(header.startsWith("OAuth "));
  assert(header.includes('oauth_signature_method="HMAC-SHA1"'));
  assert(!header.includes(credentials.consumerSecret));
  assert(!header.includes(credentials.accessTokenSecret));
});

Deno.test("OAuth 1.0a credentials fail with a sanitized missing-variable error", () => {
  const values: Record<string, string> = {
    X_OAUTH1_CONSUMER_KEY: "consumer",
    X_OAUTH1_CONSUMER_SECRET: "do-not-leak",
  };
  try {
    loadXOAuth1Credentials((name) => values[name]);
    throw new Error("expected credential loading to fail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertEquals(message, "X_OAUTH1_ACCESS_TOKEN is not configured");
    assert(!message.includes("do-not-leak"));
  }
});

Deno.test("OAuth 1.0a signer rejects insecure production URLs", async () => {
  await assertRejects(
    () =>
      createXOAuth1AuthorizationHeader({
        method: "GET",
        url: "http://api.x.com/2/users/me",
        credentials,
      }),
    Error,
    "require HTTPS",
  );
});
