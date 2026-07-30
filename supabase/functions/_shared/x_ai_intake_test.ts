import {
  buildReplyPrompt,
  buildRoutePrompt,
  isCompleteAiReply,
  parseXAiRoute,
} from "./x_ai_intake.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("X AI route parser accepts a read-only AI trade opinion", () => {
  const route = parseXAiRoute({
    lane: "reply",
    reply_kind: "trade_advice",
    token_address: "Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump",
    token_chain: "solana",
    reason: "user asks for token research and an opinion",
  });
  assert(route.lane === "reply", "trade opinion must remain read-only");
  assert(
    route.reply_kind === "trade_advice",
    "trade advice must use the AI advice mode",
  );
});

Deno.test("AI reply completeness rejects truncation and incomplete trade reads", () => {
  const route = parseXAiRoute({ lane: "reply", reply_kind: "trade_advice" });
  assert(
    !isCompleteAiReply("Looks active but risky...", route),
    "truncated output must be repaired",
  );
  assert(
    !isCompleteAiReply("Looks active but liquidity is thin.", route),
    "trade read must include DYOR",
  );
  assert(
    isCompleteAiReply(
      "Activity is strong, but liquidity is thin and volatility is high. DYOR",
      route,
    ),
    "complete trade read should pass",
  );
});

Deno.test("X AI route parser rejects malformed or unsafe reply routes", () => {
  for (
    const value of [
      {},
      { lane: "reply", reply_kind: "buy_token" },
      { lane: "execute", reply_kind: "trade_advice" },
    ]
  ) {
    let rejected = false;
    try {
      parseXAiRoute(value);
    } catch {
      rejected = true;
    }
    assert(rejected, "malformed AI route must fail closed");
  }
});

Deno.test("exact reported X prompt is represented in AI routing and reply instructions", () => {
  const text =
    "@linkrbot what can you tell me about this token: Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump and do you recommend that I buy it?";
  const routePrompt = buildRoutePrompt(text);
  assert(
    routePrompt.includes(text),
    "router must receive the complete user post",
  );
  assert(
    routePrompt.includes("trade opinion is read-only"),
    "router must distinguish advice from execution",
  );
  const replyPrompt = buildReplyPrompt({
    text,
    route: parseXAiRoute({
      lane: "reply",
      reply_kind: "trade_advice",
      token_chain: "solana",
    }),
    marketFacts: { price_usd: 0.01, liquidity_usd: 1000 },
  });
  assert(
    replyPrompt.includes("AI opinion"),
    "trade advice response must be AI-authored",
  );
  assert(
    replyPrompt.includes(
      "Never turn a question or opinion request into a transaction",
    ),
    "advice cannot execute",
  );
});

Deno.test("X router treats social or impossible value asks as conversation", () => {
  const routePrompt = buildRoutePrompt("@linkrbot can you spare some SOL?");
  assert(
    routePrompt.includes("rhetorical asks"),
    "router should mention rhetorical asks",
  );
  assert(
    routePrompt.includes("not command execution"),
    "router should distinguish public banter from executable commands",
  );
});

Deno.test("X router keeps NFT how-to conversational but executable NFT requests legacy", () => {
  const routePrompt = buildRoutePrompt("@linkrbot how can I launch an NFT?");
  assert(
    routePrompt.includes("NFT how-to or capability questions"),
    "router should keep NFT how-to questions conversational",
  );
  assert(
    routePrompt.includes("explicit requests to launch, mint, create"),
    "router should reserve executable NFT requests for legacy command flow",
  );

  const replyPrompt = buildReplyPrompt({
    text: "@linkrbot how can I launch an NFT?",
    route: parseXAiRoute({ lane: "reply", reply_kind: "conversation" }),
  });
  assert(
    replyPrompt.includes("Solana collection-first rule"),
    "reply prompt should ground NFT collection-first guidance",
  );
  assert(
    replyPrompt.includes("Robinhood NFT launches are not wired yet"),
    "reply prompt should include Robinhood NFT unsupported fact",
  );
});

Deno.test("X reply prompt grounds persona and permits normal conversation", () => {
  const prompt = buildReplyPrompt({
    text: "@linkrbot who made you?",
    route: parseXAiRoute({ lane: "reply", reply_kind: "conversation" }),
  });
  assert(prompt.includes("@S0Ldev"), "reply prompt should include builder");
  assert(prompt.includes("LNKR-1"), "reply prompt should include engine");
  assert(
    prompt.includes("normal public conversation"),
    "reply prompt should authorize conversation",
  );
  assert(
    !prompt.includes("180-230 characters"),
    "reply prompt should not force padded replies",
  );
});
