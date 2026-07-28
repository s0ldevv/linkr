import { stableIdempotencyKey } from "./linkr_idempotency.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("stable idempotency keys are deterministic and bounded", () => {
  const a = stableIdempotencyKey("reply", "tweet 1", " deterministic ");
  const b = stableIdempotencyKey("reply", "tweet 1", "deterministic");
  assert(a === b, "key should normalize whitespace");
  assert(a.length <= 480, "key should be bounded");
});
