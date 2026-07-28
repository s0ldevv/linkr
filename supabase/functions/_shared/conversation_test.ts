import {
  asksHowLinkrIs,
  buildConversationTranscript,
  checkIsFollowUp,
  detectConversationShortcut,
  extractTokenFollowUpFields,
  isThreadReference,
  looksLikeExplicitCommand,
  normalizeConversationText,
  shouldAvoidWellnessAnswer,
  shouldTreatFollowUpAsCoinInquiry,
} from "./conversation.ts";
import { lintPublicReply } from "./reply_lint.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("detectConversationShortcut catches natural conversation acts", () => {
  const cases = [
    {
      text: "Hi!",
      kind: "greeting",
      reply: "Hi! How can I help?",
    },
    {
      text: "Hello!",
      kind: "greeting",
      reply: "Hi! How can I help?",
    },
    {
      text: "Hi! How are you?",
      kind: "greeting_with_wellness",
      reply: "Hi! I'm good, thanks for asking. How can I help?",
    },
    {
      text: "How are you?",
      kind: "wellness_question",
      reply: "I'm good, thanks for asking. How can I help?",
    },
    {
      text: "hey what's up",
      kind: "greeting_with_status",
      reply: "Hey! Not much, ready to help. What do you want to do?",
    },
    {
      text: "gm how's it going",
      kind: "time_greeting_with_wellness",
      reply: "GM! I'm good, thanks for asking. How can I help?",
    },
    {
      text: "@linkrcash hello there",
      kind: "greeting",
      reply: "Hi! How can I help?",
    },
  ];

  for (const { text, kind, reply } of cases) {
    const shortcut = detectConversationShortcut(text);
    assert(shortcut?.kind === kind, text + " kind mismatch");
    assert(shortcut?.reply === reply, text + " reply mismatch");
    const lint = lintPublicReply(shortcut.reply, shortcut.kind);
    assert(lint.ok, text + " shortcut reply should pass lint");
  }
});

Deno.test("wellness replies only answer questions the user asked", () => {
  assert(!asksHowLinkrIs("Hello!"), "plain hello should not ask how Linkr is");
  assert(asksHowLinkrIs("Hi, how are you doing today?"), "wellness question should match");
  assert(asksHowLinkrIs("gm how's it going?"), "time greeting wellness should match");
  assert(
    !asksHowLinkrIs("how are buyers and sellers looking?"),
    "market analytics wording should not be wellness",
  );
  assert(
    shouldAvoidWellnessAnswer("Hello!", "Hi! I'm good, thanks for asking. How can I help?"),
    "plain greeting should block wellness answer",
  );
  assert(
    !shouldAvoidWellnessAnswer(
      "Hi! How are you?",
      "Hi! I'm good, thanks for asking. How can I help?",
    ),
    "actual wellness question should allow wellness answer",
  );
});

Deno.test("detectConversationShortcut catches thanks and capability help", () => {
  assert(detectConversationShortcut("thank you bro")?.kind === "thanks", "thanks should match");
  assert(detectConversationShortcut("@linkrcash nice") === null, "ambient remark should not be shortcut");
  assert(
    detectConversationShortcut("@linkrcash what can you do?")?.kind === "capability_help",
    "capability help should match",
  );
  assert(
    detectConversationShortcut("commands")?.kind === "capability_help",
    "commands should match",
  );
  const schedule = detectConversationShortcut("@linkrcash are you able to schedule buys/sells?");
  assert(schedule?.kind === "capability_help", "schedule capability should match");
  assert(schedule?.reply.includes("market-cap triggers"), "schedule capability reply should state market-cap support");
});

Deno.test("conversation shortcut does not capture command or token inquiry text", () => {
  const cases = [
    "buy $50 of BONK",
    "sell 50% of this",
    "send 0.1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "launch $TEST with this image",
    "confirm buy",
    "cancel",
    "what is this token?",
    "price of BONK",
    "check 0x8A1d4b4C7f8e0a7d9C1b2E3F4a5B6c7D8e9F0123",
  ];

  for (const text of cases) {
    assert(detectConversationShortcut(text) === null, text + " should not be shortcut");
  }
});

Deno.test("thread reference and explicit command detection are separate", () => {
  assert(isThreadReference("what is the CA above?"), "CA above should be a thread reference");
  assert(isThreadReference("what is this?"), "what is this should be a thread reference");
  assert(
    looksLikeExplicitCommand("can you show my wallet?"),
    "wallet should be explicit info intent",
  );
  assert(looksLikeExplicitCommand("confirm buy"), "confirm should be explicit command");
});

Deno.test("no-handle reply text stays classifiable", () => {
  assert(
    normalizeConversationText("what do you mean?") === "what do you mean",
    "reply text should not strip to empty",
  );
  assert(
    looksLikeExplicitCommand("buy $20 of this"),
    "command under bot comment should remain explicit",
  );
});

Deno.test("token references in follow-ups force coin inquiry extraction", () => {
  const tokenAddress = "0x1111111111111111111111111111111111111111";
  const fields = extractTokenFollowUpFields(tokenAddress);
  assert(fields.hasTokenReference, "contract follow-up should be a token reference");
  assert(fields.extraction.token_address === tokenAddress, "token address should be extracted");
  assert(fields.extraction.token_mint === tokenAddress, "compatibility mint should be extracted");
  assert(
    fields.extraction.market_query_type === "token_lookup",
    "contract address should be token lookup",
  );
  assert(
    shouldTreatFollowUpAsCoinInquiry("general_inquiry", tokenAddress),
    "contract follow-up should force coin inquiry even after a generic parent",
  );
  assert(
    shouldTreatFollowUpAsCoinInquiry("coin_inquiry", "this one please"),
    "coin inquiry parent should keep follow-up in coin mode",
  );
  assert(
    !shouldTreatFollowUpAsCoinInquiry("general_inquiry", "what do you mean?"),
    "plain follow-up should remain conversation",
  );
});

Deno.test("base58-looking strings are not treated as token addresses", () => {
  const fields = extractTokenFollowUpFields("Mint111111111111111111111111111111111111111");
  assert(!fields.hasTokenReference, "base58-looking text should not be a token reference");
  assert(fields.extraction.token_address === null, "base58-looking text should not set address");
  assert(fields.extraction.token_mint === null, "base58-looking text should not set mint alias");
});

Deno.test("normalizeConversationText strips handles and punctuation", () => {
  assert(
    normalizeConversationText("@linkrcash Hi! How are you?") === "hi how are you",
    "normalized greeting mismatch",
  );
});

Deno.test("buildConversationTranscript formats user-facing dialogue only", () => {
  const transcript = buildConversationTranscript({
    conversation_id: "123",
    total_count: 2,
    messages: [
      {
        id: "1",
        tweet_id: "1",
        conversation_id: "123",
        author_twitter_id: "u1",
        author_username: "alice",
        text: "@linkrcash Hi!",
        role: "user",
        created_at: "2026-07-06T00:00:00Z",
      },
      {
        id: "2",
        tweet_id: "1",
        reply_tweet_id: "2",
        conversation_id: "123",
        author_twitter_id: "u1",
        text: "Hi! How can I help?",
        role: "assistant",
        created_at: "2026-07-06T00:00:01Z",
      },
    ],
  });

  assert(transcript.includes("User @alice:"), "missing user label");
  assert(transcript.includes("Linkr:"), "missing Linkr label");
});

Deno.test("checkIsFollowUp recognizes replies to known Linkr reply tweet ids", async () => {
  let tableName = "";
  let replyTweetId = "";
  const fakeAdmin = {
    from(table: string) {
      tableName = table;
      return {
        select(_columns: string) {
          return this;
        },
        eq(_column: string, value: string) {
          replyTweetId = value;
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: replyTweetId === "known-bot-reply-id" ? { tweet_id: "parent-inbox-id" } : null,
          });
        },
      };
    },
  };

  const known = await checkIsFollowUp(fakeAdmin, [
    { type: "replied_to", id: "known-bot-reply-id" },
  ]);
  assert(tableName === "twitter_replies", "should look up twitter_replies");
  assert(known.isFollowUp, "known bot reply should be a follow-up");
  assert(known.parentInboxTweetId === "parent-inbox-id", "parent inbox id mismatch");
  assert(known.parentReplyTweetId === "known-bot-reply-id", "parent reply tweet id mismatch");

  const unknown = await checkIsFollowUp(fakeAdmin, [
    { type: "replied_to", id: "unknown-reply-id" },
  ]);
  assert(!unknown.isFollowUp, "unknown parent should not be a follow-up");
  assert(unknown.parentInboxTweetId === null, "unknown parent inbox id should be null");
  assert(unknown.parentReplyTweetId === null, "unknown parent reply tweet id should be null");
});
