import { fetchAllXSearchPages, oldestFirstXPages } from "./x_pagination.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("X pagination follows every token and preserves the original cursor", async () => {
  const urls: string[] = [];
  const bodies = [
    { data: [{ id: "200" }], meta: { next_token: "next-2" } },
    { data: [{ id: "100" }], meta: {} },
  ];
  const pages = await fetchAllXSearchPages({
    firstResponse: Response.json(bodies[0]),
    baseUrl: "https://api.x.test/search",
    params: new URLSearchParams({ since_id: "50", max_results: "100" }),
    bearer: "test-only",
    fetchImpl: ((input: string | URL | Request) => {
      urls.push(String(input));
      return Promise.resolve(Response.json(bodies[1]));
    }) as typeof fetch,
  });
  assert(pages.length === 2, "pagination stopped early");
  assert(urls[0].includes("since_id=50"), "since cursor was lost");
  assert(urls[0].includes("next_token=next-2"), "next token was lost");
  assert(
    oldestFirstXPages(pages)[0].data[0].id === "100",
    "pages were not ordered oldest first",
  );
});

Deno.test("X pagination rejects a token cycle", async () => {
  let rejected = false;
  try {
    await fetchAllXSearchPages({
      firstResponse: Response.json({ meta: { next_token: "loop" } }),
      baseUrl: "https://api.x.test/search",
      params: new URLSearchParams(),
      bearer: "test-only",
      fetchImpl: (() =>
        Promise.resolve(
          Response.json({ meta: { next_token: "loop" } }),
        )) as typeof fetch,
    });
  } catch (error) {
    rejected = error instanceof Error &&
      error.message === "x_pagination_token_cycle";
  }
  assert(rejected, "token cycle was not rejected");
});
