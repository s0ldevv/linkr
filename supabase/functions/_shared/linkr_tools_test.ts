import { summarizePostIntelligence } from "./post_intelligence.ts";
import { searchPublicX } from "./x_search_tool.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("post intelligence returns public facts without executing actions", () => {
  const result = summarizePostIntelligence({
    tweet_id: "t1",
    text: "launch this $TEST",
    flattened_context: "Parent post says $TEST is a meme.",
  });
  assert(result.ok, "post intelligence should succeed");
  assert(result.privacy === "public", "post intelligence should be public");
  assert(result.facts.summary.includes("$TEST"), "summary should include context");
});

Deno.test("x search degrades when bearer token is missing", async () => {
  const result = await searchPublicX({ query: "$WIF", bearerToken: "" });
  assert(!result.ok, "missing bearer should degrade");
  assert(result.error === "missing_query_or_bearer", "missing bearer error mismatch");
});

Deno.test("x search forwards sort order for top and recent sampling", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  try {
    globalThis.fetch = ((input: URL | RequestInfo) => {
      capturedUrl = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    const result = await searchPublicX({
      query: "$CASHCAT",
      bearerToken: "test-token",
      sort_order: "relevancy",
    });
    assert(result.ok, "mocked search should succeed");
    assert(capturedUrl.includes("sort_order=relevancy"), "sort_order should be forwarded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
