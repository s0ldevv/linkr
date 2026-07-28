import {
  isLinkrFastHandoffEnabled,
  normalizeChainedTweetIds,
  wakeAndDispatchStage,
} from "./internal_pipeline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("normalizeChainedTweetIds accepts only unique numeric tweet ids", () => {
  const ids = normalizeChainedTweetIds([
    " 123 ",
    "123",
    "0",
    "abc",
    456,
    "789",
  ]);
  assert(
    JSON.stringify(ids) === JSON.stringify(["123", "789"]),
    "tweet IDs were not normalized",
  );
});

Deno.test("normalizeChainedTweetIds applies a strict bounded limit", () => {
  const ids = normalizeChainedTweetIds(["1", "2", "3"], 2);
  assert(
    JSON.stringify(ids) === JSON.stringify(["1", "2"]),
    "tweet ID limit was not applied",
  );
  assert(
    normalizeChainedTweetIds("1").length === 0,
    "non-array input must be rejected",
  );
});

Deno.test("fast handoff defaults OFF and honors explicit truthy/falsy flags", () => {
  const original = Deno.env.get("LINKR_FAST_HANDOFF_ENABLED");
  try {
    Deno.env.delete("LINKR_FAST_HANDOFF_ENABLED");
    assert(!isLinkrFastHandoffEnabled(), "unset flag must default to OFF");
    Deno.env.set("LINKR_FAST_HANDOFF_ENABLED", "");
    assert(!isLinkrFastHandoffEnabled(), "blank flag must default to OFF");
    for (const on of ["1", "true", "yes", "on", "TRUE", " On "]) {
      Deno.env.set("LINKR_FAST_HANDOFF_ENABLED", on);
      assert(isLinkrFastHandoffEnabled(), `flag ${JSON.stringify(on)} should enable`);
    }
    for (const off of ["0", "false", "no", "off", "nope"]) {
      Deno.env.set("LINKR_FAST_HANDOFF_ENABLED", off);
      assert(!isLinkrFastHandoffEnabled(), `flag ${JSON.stringify(off)} should stay OFF`);
    }
  } finally {
    if (original === undefined) Deno.env.delete("LINKR_FAST_HANDOFF_ENABLED");
    else Deno.env.set("LINKR_FAST_HANDOFF_ENABLED", original);
  }
});

Deno.test("wakeAndDispatchStage never dispatches when the wake is not granted", async () => {
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetched = true;
    return Promise.resolve(new Response("{}"));
  };
  try {
    // Circuit open / in-flight dispatch => requested:false => no HTTP invoke.
    const gated = await wakeAndDispatchStage(
      { rpc: () => Promise.resolve({ data: { requested: false }, error: null }) },
      "reply_x_normal",
      "worker-reply-x",
    );
    assert(gated.attempted === false, "gated wake must not attempt dispatch");
    assert(!fetched, "gated wake must not issue an HTTP request");

    // RPC error must be swallowed (never throws) and reported as not attempted.
    const errored = await wakeAndDispatchStage(
      { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) },
      "reply_x_normal",
      "worker-reply-x",
    );
    assert(errored.attempted === false, "wake RPC error must not attempt dispatch");
    assert(errored.ok === false, "wake RPC error must report failure");
    assert(!fetched, "wake RPC error must not issue an HTTP request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
