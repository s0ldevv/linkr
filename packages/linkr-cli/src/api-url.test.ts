import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_API_URL,
  describeApiUrlResolution,
  normalizeApiUrl,
  resolveApiUrl,
} from "./api-url.js";

test("resolveApiUrl uses the production origin by default", () => {
  assert.deepEqual(resolveApiUrl({ env: {} }), {
    apiUrl: DEFAULT_API_URL,
    source: "default",
  });
});

test("normalizeApiUrl strips trailing slashes and common /api paths", () => {
  assert.equal(normalizeApiUrl("https://www.linkr.cash/").apiUrl, DEFAULT_API_URL);
  assert.equal(normalizeApiUrl("https://www.linkr.cash/api").apiUrl, DEFAULT_API_URL);
  assert.equal(normalizeApiUrl("https://www.linkr.cash/api/").apiUrl, DEFAULT_API_URL);
  assert.equal(
    normalizeApiUrl("https://www.linkr.cash/api/cli/auth/start").apiUrl,
    DEFAULT_API_URL,
  );
});

test("normalizeApiUrl accepts localhost without a scheme for dev use", () => {
  assert.equal(normalizeApiUrl("localhost:5173/api").apiUrl, "http://localhost:5173");
});

test("normalizeApiUrl accepts a bare production host", () => {
  assert.equal(normalizeApiUrl("www.linkr.cash/api").apiUrl, DEFAULT_API_URL);
});

test("resolveApiUrl prefers explicit options over environment values", () => {
  const resolved = resolveApiUrl({
    apiUrl: "https://www.linkr.cash/api",
    env: { LINKR_API_URL: "https://example.com" },
  });
  assert.equal(resolved.apiUrl, DEFAULT_API_URL);
  assert.equal(resolved.source, "option");
  assert.equal(resolved.normalizedFrom, "https://www.linkr.cash/api");
});

test("normalizeApiUrl rejects page paths and URL components that cannot work", () => {
  assert.throws(() => normalizeApiUrl("https://www.linkr.cash/docs"), /site origin/);
  assert.throws(() => normalizeApiUrl("https://www.linkr.cash?x=1"), /query string/);
  assert.throws(() => normalizeApiUrl("ftp://www.linkr.cash"), /http or https/);
});

test("describeApiUrlResolution explains user-provided normalization", () => {
  assert.equal(
    describeApiUrlResolution(normalizeApiUrl("https://www.linkr.cash/api")),
    "Using Linkr API: https://www.linkr.cash (normalized from https://www.linkr.cash/api)",
  );
  assert.equal(describeApiUrlResolution(resolveApiUrl({ env: {} })), null);
});
