import { routeLinkrTurnDeterministic } from "./conversation_router.ts";
import { composeReplyPlanText } from "./linkr_reply_composer.ts";
import { buildXSearchReply, buildXSearchRequest } from "./turn_coordinator.ts";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("deterministic router handles identity and safety before classifier", () => {
  assert(
    routeLinkrTurnDeterministic({ text: "@linkrbot who built you?" }).route ===
      "identity",
  );
  assert(
    routeLinkrTurnDeterministic({ text: "@linkrbot export my private key" })
      .route ===
      "safe_refusal",
  );
  assert(
    routeLinkrTurnDeterministic({ text: "@linkrbot buy 0.1 SOL of xyz" })
      .route ===
      "normal_classifier",
  );
  assert(
    routeLinkrTurnDeterministic({
      text: "@linkrbot What are people on X saying about it?",
      is_follow_up: true,
      has_history: true,
    }).route === "x_search",
    "public X sentiment follow-up should route to x_search",
  );
  assert(
    routeLinkrTurnDeterministic({
      text:
        "@linkrbot Try again check what people on X are saying about $cashcat",
    }).route === "x_search",
    "check what people on X are saying should route to x_search",
  );
  assert(
    routeLinkrTurnDeterministic({
      text: "@linkrbot search twitter for recent posts about CASHCAT",
    }).route === "x_search",
    "twitter post search requests should route to x_search",
  );
});

Deno.test("deterministic router ignores ambient remarks but keeps useful social replies", () => {
  assert(
    routeLinkrTurnDeterministic({
      text: "@linkrbot nice",
      ingest_source: "mention",
    }).route ===
      "ambient_ignore",
    "ambient remarks should not get replies",
  );
  assert(
    routeLinkrTurnDeterministic({
      text: "thanks",
      is_follow_up: true,
      ingest_source: "reply_to_bot",
      ingest_reason: "reply_to_known_linkr_reply",
      parent_reply_tweet_id: "known",
    }).route === "small_talk",
    "thanks under known Linkr reply should still get a reply",
  );
  const chain = routeLinkrTurnDeterministic({
    text: "@linkrbot what chains can you operate on?",
    ingest_source: "mention",
  });
  assert(
    chain.route === "capability_help",
    "chain question should be capability help",
  );
  assert(
    chain.intent === "chain_capability",
    "chain question should use chain capability intent",
  );
  const schedule = routeLinkrTurnDeterministic({
    text: "@linkrbot are you able to schedule buys/sells?",
    ingest_source: "mention",
  });
  assert(schedule.route === "capability_help", "schedule ability question should be capability help");
  assert(schedule.intent === "schedule_capability", "schedule ability question should use schedule capability intent");
  assert(schedule.allowed_tools.includes("action.prepare_schedule"), "schedule capability route should expose schedule preparation");
});

Deno.test("reply composer falls back when public lint fails", () => {
  const composed = composeReplyPlanText({
    mode: "deterministic",
    intent: "general",
    text: "The database says this from the prompt.",
    facts: [],
    privacy: ["public"],
    fallback_text: "I need one clearer detail.",
    idempotency_key: "reply:test",
  });
  assert(composed.used_fallback, "lint failure should use fallback");
  assert(
    composed.text === "I need one clearer detail.",
    "fallback text mismatch",
  );
});

Deno.test("x search request resolves pronoun follow-up from thread token focus", () => {
  const directRequest = buildXSearchRequest({
    admin: null,
    tw: {
      tweet_id: "t0",
      text:
        "@linkrbot Try again check what people on X are saying about $cashcat",
    },
    profile: {},
    wallet: {},
    user_context: {},
    thread_context: {
      detected_mints: [],
      parent_chain: [],
      flattened_context: "",
    },
  });
  assert(
    directRequest.topic === "CASHCAT",
    "should uppercase direct cashtag topic",
  );
  assert(
    directRequest.query.includes("$CASHCAT"),
    "direct query should include cashtag",
  );

  const request = buildXSearchRequest({
    admin: null,
    tw: {
      tweet_id: "t1",
      text: "@linkrbot What are people on X saying about it?",
    },
    profile: {},
    wallet: {},
    user_context: {},
    thread_context: {
      detected_mints: ["0x020bfC650A365f8BB26819deAAbF3E21291018b4"],
      parent_chain: [
        { text: "@linkrbot Risk read: high risk." },
        { text: "@linkrbot CASHCAT on Robinhood Chain. Price: $0.05. DYOR" },
      ],
      flattened_context: "CASHCAT on Robinhood Chain",
    },
  });
  assert(request.topic === "CASHCAT", "should use CASHCAT as active topic");
  assert(request.query.includes("$CASHCAT"), "query should include cashtag");
  assert(
    request.query.includes("0x020bfC650A365f8BB26819deAAbF3E21291018b4"),
    "query should include CA",
  );
});

Deno.test("x search reply is non-empty for results and empty-result fallback", () => {
  const reply = buildXSearchReply({
    topic: "CASHCAT",
    query: "$CASHCAT OR CASHCAT",
    recentOk: true,
    relevantOk: true,
    recentPosts: [{ id: "1", text: "CASHCAT looks strong and bullish here" }],
    relevantPosts: [{ id: "2", text: "CASHCAT risk is high after the dump" }],
  });
  assert(reply.length > 0, "reply should be non-empty");
  assert(reply.length <= 260, "reply should fit X");
  assert(
    /mixed|bullish|cautious|neutral/i.test(reply),
    "reply should include sentiment",
  );

  const emptyReply = buildXSearchReply({
    topic: "CASHCAT",
    query: "$CASHCAT OR CASHCAT",
    recentOk: true,
    relevantOk: true,
    recentPosts: [],
    relevantPosts: [],
  });
  assert(emptyReply.length > 0, "empty search should still produce a reply");
  assert(
    emptyReply.includes("little recent chatter"),
    "empty search should explain low chatter",
  );
});
