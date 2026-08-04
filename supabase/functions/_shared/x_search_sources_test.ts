import {
  buildInboxSearchSource,
  buildSeededFlattenedContext,
  decideInboxIngest,
  isDuplicateTweetId,
  normalizeSinceId,
  oldestSinceId,
} from "./x_search_sources.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("buildInboxSearchSource combines mentions and replies into one request", () => {
  const source = buildInboxSearchSource("@LinkrCash");
  assert(
    source.cursorKey === "x_inbox_since_id_v2",
    "combined cursor mismatch",
  );
  assert(
    source.query === "(@linkrcash OR to:linkrcash) -from:linkrcash",
    "combined query mismatch",
  );
  assert(
    source.legacyCursorKeys.length === 2,
    "both legacy cursors must be retained for bootstrap",
  );
  assert(
    source.requireKnownParentReply,
    "reply source should require a known parent by default",
  );
});

Deno.test("buildInboxSearchSource preserves the reply scan feature flag", () => {
  const source = buildInboxSearchSource("linkrbot", {
    replyToBotScanEnabled: false,
  });
  assert(
    source.query === "@linkrbot -from:linkrbot",
    "disabled reply scan must be mention-only",
  );
  assert(
    source.cursorKey === "x_mentions_since_id",
    "disabled reply scan must not advance the combined cursor",
  );
  assert(!source.replyToBotScanEnabled, "reply scan flag mismatch");
});

Deno.test("decideInboxIngest preserves explicit mention precedence", () => {
  const source = buildInboxSearchSource("linkrcash");
  const direct = decideInboxIngest(source, "@LinkrCash help", {
    isFollowUp: true,
  });
  assert(direct.shouldIngest, "explicit mention should ingest");
  assert(
    direct.source === "mention",
    "explicit mention must retain legacy source precedence",
  );
  assert(
    direct.reason === "direct_mention",
    "explicit mention reason mismatch",
  );

  const substring = decideInboxIngest(source, "hello @linkrcash_fake", {
    isFollowUp: false,
  });
  assert(
    !substring.shouldIngest,
    "a longer username must not count as the bot mention",
  );
});

Deno.test("decideInboxIngest enforces known parents for handle-less replies", () => {
  const source = buildInboxSearchSource("linkrbot");
  const known = decideInboxIngest(source, "what do you mean?", {
    isFollowUp: true,
  });
  const unknown = decideInboxIngest(source, "what do you mean?", {
    isFollowUp: false,
  });
  assert(
    known.shouldIngest && known.source === "reply_to_bot",
    "known follow-up should ingest",
  );
  assert(
    known.reason === "reply_to_known_linkr_reply",
    "known follow-up reason mismatch",
  );
  assert(!unknown.shouldIngest, "unknown parent should be rejected by default");
});

Deno.test("decideInboxIngest can explicitly allow unknown reply parents", () => {
  const source = buildInboxSearchSource("linkrbot", {
    replyToBotRequireKnownParent: false,
  });
  const decision = decideInboxIngest(source, "hello", { isFollowUp: false });
  assert(
    decision.shouldIngest,
    "unknown reply parent should ingest only when enabled",
  );
  assert(decision.source === "reply_to_bot", "unknown reply source mismatch");
  assert(
    decision.reason === "reply_to_linkr_account_unknown_parent",
    "unknown reason mismatch",
  );
});

Deno.test("oldestSinceId chooses the lossless legacy cursor", () => {
  assert(oldestSinceId(["300", "200"]) === "200", "older cursor should win");
  assert(
    oldestSinceId([null, "300", "invalid"]) === "300",
    "invalid cursors must be ignored",
  );
  assert(
    oldestSinceId([null, "0"]) === undefined,
    "no usable cursor should remain undefined",
  );
  assert(
    oldestSinceId(["99999999999999999999", "100000000000000000000"]) ===
      "99999999999999999999",
    "cursor comparison must remain integer-precise",
  );
});

Deno.test("isDuplicateTweetId catches existing and repeated rows", () => {
  assert(
    isDuplicateTweetId("100", new Set(["100"]), new Set()),
    "existing row missed",
  );
  assert(
    isDuplicateTweetId("200", new Set(), new Set(["200"])),
    "repeated row missed",
  );
  assert(
    !isDuplicateTweetId("300", new Set(["100"]), new Set(["200"])),
    "new row rejected",
  );
});

Deno.test("normalizeSinceId accepts only usable numeric cursors", () => {
  assert(normalizeSinceId("12345") === "12345", "numeric cursor should pass");
  assert(normalizeSinceId(" 12345 ") === "12345", "cursor should trim");
  assert(normalizeSinceId("0") === undefined, "zero cursor should reset");
  assert(
    normalizeSinceId("abc") === undefined,
    "non-numeric cursor should reset",
  );
  assert(normalizeSinceId(null) === undefined, "null cursor should reset");
});

Deno.test("buildSeededFlattenedContext preserves no-handle reply text", () => {
  const context = buildSeededFlattenedContext({
    rootText: "Root launch post",
    parentText: "Linkr: I can help with that.",
    userText: "what do you mean?",
  });
  assert(context.includes("Root post: Root launch post"), "root post missing");
  assert(
    context.includes("Parent post: Linkr: I can help with that."),
    "parent post missing",
  );
  assert(
    context.includes("User post: what do you mean?"),
    "user reply missing",
  );
});
