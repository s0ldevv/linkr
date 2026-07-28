import { validateToolInput } from "./linkr_tool_registry.ts";
import {
  buildTerminalXSearchReply,
  buildTerminalXSearchRequest,
  isTerminalXSearchCapabilityQuestion,
  isTerminalXSearchRequest,
  xSearchPostsToItems,
} from "./linkr_terminal_x_search.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("terminal X search separates capability questions from real searches", () => {
  assert(
    isTerminalXSearchCapabilityQuestion("Can you search on X?"),
    "empty X search ability question should stay conversational",
  );
  assert(
    !isTerminalXSearchRequest("Can you search on X?"),
    "empty X search ability question should not execute a search",
  );
  assert(
    isTerminalXSearchRequest("What are people saying about $ansem"),
    "people-saying cashtag question should execute X search",
  );
  assert(
    isTerminalXSearchRequest(
      "Check what people are saying on X about $ansem and let me know what they're saying",
    ),
    "explicit X chatter request should execute X search",
  );
});

Deno.test("terminal X search builds clean public X queries", () => {
  const cashtag = buildTerminalXSearchRequest(
    "What are people saying about $ansem",
  );
  assert(cashtag.topic === "$ANSEM", "cashtag topic should be normalized");
  assert(
    cashtag.query.includes("$ANSEM") && cashtag.query.includes("-is:retweet"),
    "cashtag query should include ticker and retweet filter",
  );

  const handle = buildTerminalXSearchRequest("Search posts from @S0Ldev on X");
  assert(handle.topic === "@S0Ldev", "handle topic should be preserved");
  assert(
    handle.query.includes("from:S0Ldev"),
    "profile query should use from:handle",
  );
});

Deno.test("terminal validates x.search as a non-value-moving terminal tool", () => {
  const validation = validateToolInput(
    "x.search",
    { query: "$ANSEM" },
    "terminal",
  );
  assert(validation.ok, "x.search should validate on terminal surface");
  assert(
    validation.tool?.value_moving === false,
    "x.search must never be value-moving",
  );
});

Deno.test("terminal X search reply is graceful for empty and populated results", () => {
  const empty = buildTerminalXSearchReply({
    topic: "$ANSEM",
    query: "$ANSEM OR ANSEM -is:retweet",
    recent: toolResult([]),
    relevant: toolResult([]),
  });
  assert(
    /searched public X/i.test(empty.text),
    "empty reply should say it searched X",
  );
  assert(
    !/raw|payload|json/i.test(empty.text),
    "reply should not expose internals",
  );

  const populated = buildTerminalXSearchReply({
    topic: "$ANSEM",
    query: "$ANSEM OR ANSEM -is:retweet",
    recent: toolResult([
      { id: "1", text: "$ANSEM is cooking, strong timeline interest today" },
    ]),
    relevant: toolResult([
      { id: "2", text: "Mixed takes on ANSEM, some caution but still bullish" },
    ]),
  });
  assert(
    /X read/i.test(populated.text),
    "populated reply should summarize the X read",
  );
  assert(populated.posts.length === 2, "posts should be deduped and returned");
  assert(
    xSearchPostsToItems(populated.posts)[0].url,
    "post items should include URLs",
  );
});

function toolResult(posts: Array<Record<string, unknown>>) {
  return {
    tool: "x.search",
    ok: true,
    facts: { posts },
    summary: "test",
    freshness: "live" as const,
    confidence: posts.length ? 0.75 : 0.2,
    privacy: "external_untrusted" as const,
    redactions: [],
    answerable: posts.length > 0,
    error: null,
  };
}
