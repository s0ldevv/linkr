import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { signRequest, sha256Hex } from "./signing.js";

test("signRequest creates the Linkr canonical HMAC headers", () => {
  const apiKey = "linkr_live_0123456789_" + "a".repeat(64);
  const url = new URL("https://www.linkr.cash/api/cli/chat?x=1");
  const signed = signRequest({
    apiKey,
    method: "POST",
    url,
    body: { message: "hello" },
    idempotencyKey: "idem-1",
    clientVersion: "0.0.0-test",
    installId: "install-1",
  });
  const bodyHash = sha256Hex(signed.body);
  const payload = [
    "LINKR-HMAC-SHA256",
    "POST",
    "/api/cli/chat?x=1",
    bodyHash,
    signed.headers["X-Linkr-Timestamp"],
    signed.headers["X-Linkr-Nonce"],
    "idem-1",
  ].join("\n");
  const expected = createHmac("sha256", apiKey).update(payload).digest("hex");
  assert.equal(signed.headers["X-Linkr-Body-SHA256"], bodyHash);
  assert.equal(signed.headers["X-Linkr-Signature"], expected);
  assert.equal(signed.headers["X-Linkr-Canonical-Path"], "/api/cli/chat?x=1");
  assert.equal(signed.headers["Idempotency-Key"], "idem-1");
});
