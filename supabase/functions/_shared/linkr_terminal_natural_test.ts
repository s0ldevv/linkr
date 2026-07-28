import {
  buildTerminalNaturalPrompt,
  isTerminalTradeAdviceQuestion,
  isRepetitiveTerminalReply,
  lintTerminalReply,
  shouldIndexTerminalMemory,
  shouldRouteTerminalNaturalBeforeAction,
  TERMINAL_PERSONA_TEST_FACTS,
  terminalNaturalFallbackReply,
} from "./linkr_terminal_natural.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("terminal routes action ability questions to natural conversation", () => {
  const natural = [
    "can you buy it?",
    "Can schedule buys?",
    "how do I buy that token?",
    "what do you need to launch a coin?",
    "are you able to sell by market cap?",
    "can you launch coins?",
    "should I buy it?",
    "is this a good idea to buy?",
  ];
  for (const text of natural) {
    assert(
      shouldRouteTerminalNaturalBeforeAction(text),
      `expected natural route: ${text}`,
    );
  }

  const concrete = [
    "buy 0.1 SOL of 6Q3zNnW4JYpX6uDa5x6qXcP2dDz6Yy9JYxLfZz4zpump",
    "can you buy 0.1 SOL of 6Q3zNnW4JYpX6uDa5x6qXcP2dDz6Yy9JYxLfZz4zpump",
    "send 0.1 SOL to 6Q3zNnW4JYpX6uDa5x6qXcP2dDz6Yy9JYxLfZz4zpump",
  ];
  for (const text of concrete) {
    assert(
      !shouldRouteTerminalNaturalBeforeAction(text),
      `expected concrete action route: ${text}`,
    );
  }
});

Deno.test("terminal recognizes trade advice as conversation, not execution", () => {
  const advice = [
    "Should I buy it?",
    "I'm asking you if it's a good idea to buy this coin",
    "would you sell here?",
    "is this worth buying?",
  ];
  for (const text of advice) {
    assert(isTerminalTradeAdviceQuestion(text), `expected advice: ${text}`);
    assert(
      shouldRouteTerminalNaturalBeforeAction(text),
      `expected natural routing: ${text}`,
    );
  }
});

Deno.test("terminal natural prompt includes identity and private terminal context", () => {
  const prompt = buildTerminalNaturalPrompt({
    text: "who built you?",
    route: "identity",
    intent: "identity",
    conversationSummary: "User asked if Linkr can talk naturally.",
    recentMessages: [
      { role: "user", content: "what's up linkr" },
      { role: "assistant", content: "I am here with you." },
    ],
    refs: [],
    pendingActions: [],
    drafts: [],
    sourceRefs: [],
    toolFacts: "Token facts: price and liquidity are available.",
    memorySnippets: [],
    activeEntities: [],
  });

  assert(prompt.includes(TERMINAL_PERSONA_TEST_FACTS.handle), "handle missing");
  assert(
    prompt.includes(TERMINAL_PERSONA_TEST_FACTS.builder),
    "builder missing",
  );
  assert(prompt.includes(TERMINAL_PERSONA_TEST_FACTS.engine), "engine missing");
  assert(
    prompt.includes("authenticated private Linkr terminal"),
    "terminal context missing",
  );
  assert(
    prompt.includes("Do not repeat"),
    "anti-repetition instruction missing",
  );
  assert(prompt.includes("Tool facts"), "tool facts section missing");
});

Deno.test("terminal reply lint blocks internal leakage", () => {
  const bad = lintTerminalReply(
    "I queried linkr_terminal_messages with raw tool payload JSON.",
  );
  assert(!bad.ok, "internal table/tool wording should fail");
  assert(bad.blocked.length > 0, "blocked reasons should be present");

  const good = lintTerminalReply(
    "Yes. I can help with that, but I need the token and amount first.",
  );
  assert(good.ok, "normal user-facing reply should pass");
});

Deno.test("terminal anti-repetition catches repeated assistant replies", () => {
  const recent = [
    {
      role: "assistant",
      content:
        "I can help with wallets and token research. Tell me what you want to do.",
    },
  ];
  assert(
    isRepetitiveTerminalReply(
      "I can help with wallets and token research. Tell me what you want to do.",
      recent,
    ),
    "exact repeat should be blocked",
  );
  assert(
    !isRepetitiveTerminalReply(
      "Fair. We can just talk for a minute. What is on your mind?",
      recent,
    ),
    "fresh conversational reply should pass",
  );
});

Deno.test("terminal memory indexing is selective", () => {
  assert(
    shouldIndexTerminalMemory("remember that I prefer Solana launches"),
    "explicit memory should index",
  );
  assert(
    shouldIndexTerminalMemory("my default chain is Solana"),
    "default preference should index",
  );
  assert(
    !shouldIndexTerminalMemory("what's up linkr"),
    "casual small talk should not index",
  );
});

Deno.test("terminal fallback stays natural for action questions", () => {
  const reply = terminalNaturalFallbackReply("can you buy it?");
  assert(/yes|can/i.test(reply), "fallback should answer ability question");
  assert(
    /confirm|review|details|amount/i.test(reply),
    "fallback should mention safe next step",
  );
  assert(
    !reply.includes("exact_schedule_details"),
    "fallback must not leak internal fields",
  );
});
