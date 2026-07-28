import {
  isDefinitiveReplyTargetFailure,
  isRetryableXPostFailure,
} from "./x_reply_delivery.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("deleted or invisible X reply targets are terminal provider rejections", () => {
  const payload = {
    title: "Forbidden",
    detail:
      "You attempted to reply to a Tweet that is deleted or not visible to you.",
  };
  assert(
    isDefinitiveReplyTargetFailure(payload),
    "target failure not detected",
  );
  assert(!isRetryableXPostFailure(403, payload), "target failure was retried");
});

Deno.test("X authorization, rate-limit, and provider failures remain retryable", () => {
  assert(
    isRetryableXPostFailure(401, {}),
    "401 must retry behind auth circuit",
  );
  assert(
    isRetryableXPostFailure(403, { detail: "client is not permitted" }),
    "authorization 403 must retry behind auth circuit",
  );
  assert(isRetryableXPostFailure(429, {}), "429 must retry");
  assert(isRetryableXPostFailure(503, {}), "503 must retry");
  assert(!isRetryableXPostFailure(400, {}), "400 must be terminal");
});
