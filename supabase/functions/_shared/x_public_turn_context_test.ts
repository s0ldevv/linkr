import {
  linkrPublicPersonaFacts,
  type LinkrPublicTurnContext,
  publicMarketEntity,
  resolveMarketTargetForTurn,
  resolvePublicReferences,
} from "./x_public_turn_context.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contextFrom(
  partial: Partial<LinkrPublicTurnContext>,
): LinkrPublicTurnContext {
  const base = {
    tweet: { tweet_id: "t1", text: "" },
    work_item: null,
    conversation: { conversation_id: "c1", messages: [], total_count: 0 },
    transcript: "",
    thread_context: null,
    parent_inbox_tweet: null,
    parent_linkr_reply: null,
    active_state: null,
    persona: linkrPublicPersonaFacts(),
    entities: [],
    facts: [],
    resolved_references: [],
    market_candidates: [],
    constraints: {
      public_reply: true as const,
      max_reply_chars: 260,
      value_moving_requires_confirmation: true as const,
      no_private_cross_user_data: true as const,
    },
  };
  const merged = { ...base, ...partial };
  return { ...merged, ...resolvePublicReferences(merged) };
}

Deno.test("public turn context resolves a single contextual token reference", () => {
  const address = "0x1111111111111111111111111111111111111111";
  const context = contextFrom({
    tweet: { tweet_id: "t2", text: "@linkrbot is that one worth watching?" },
    parent_inbox_tweet: {
      tweet_id: "t1",
      text: `@linkrbot read this token ${address}`,
    },
    parent_linkr_reply: {
      reply_tweet_id: "r1",
      reply_text: "It looks active, but risk is still high. DYOR.",
    },
  });

  const resolution = resolveMarketTargetForTurn(context, "trade_advice");
  assert(resolution.target !== null, "contextual token should resolve");
  assert(
    resolution.target.target.address === address,
    "resolved address mismatch",
  );
  assert(
    resolution.target.source === "parent_post",
    "parent post should be the strongest source",
  );
});

Deno.test("public turn context asks for clarification when multiple contextual tokens exist", () => {
  const context = contextFrom({
    tweet: { tweet_id: "t3", text: "@linkrbot what about that one?" },
    thread_context: {
      flattened_context:
        "Thread mentions 0x2222222222222222222222222222222222222222 and 0x3333333333333333333333333333333333333333",
      detected_mints: [
        "0x2222222222222222222222222222222222222222",
        "0x3333333333333333333333333333333333333333",
      ],
    },
  });

  const resolution = resolveMarketTargetForTurn(context, "coin_inquiry");
  assert(
    resolution.target === null,
    "ambiguous tokens should not auto-resolve",
  );
  assert(
    resolution.ambiguous.length === 2,
    "should preserve ambiguity candidates",
  );
});

Deno.test("public turn context prefers direct parent context over older transcript tokens", () => {
  const parentAddress = "0x7777777777777777777777777777777777777777";
  const olderAddress = "0x8888888888888888888888888888888888888888";
  const context = contextFrom({
    tweet: { tweet_id: "t6", text: "@linkrbot should I hold it?" },
    parent_inbox_tweet: {
      tweet_id: "t5",
      text: `@linkrbot read ${parentAddress}`,
    },
    transcript:
      `user: unrelated old token ${olderAddress}\nassistant: not enough signal`,
  });

  const resolution = resolveMarketTargetForTurn(context, "trade_advice");
  assert(resolution.target !== null, "direct parent token should resolve");
  assert(
    resolution.target.target.address === parentAddress,
    "parent address mismatch",
  );
  assert(resolution.reason === "parent_post", "parent source should win");
});

Deno.test("public turn context does not force stale token context into plain conversation", () => {
  const context = contextFrom({
    tweet: { tweet_id: "t4", text: "@linkrbot thanks" },
    parent_inbox_tweet: {
      tweet_id: "t1",
      text: "@linkrbot check 0x4444444444444444444444444444444444444444",
    },
  });

  const resolution = resolveMarketTargetForTurn(context, "conversation");
  assert(
    resolution.target === null,
    "plain conversation should not fetch token facts",
  );
  assert(resolution.reason === "not_market_relevant", "reason mismatch");
});

Deno.test("public turn context can carry active-state token identity", () => {
  const address = "0x5555555555555555555555555555555555555555";
  const entity = publicMarketEntity({
    target: { chain: "robinhood", address },
    source: "conversation_state",
    confidence: 0.9,
    label: "$STATE",
  });
  const context = contextFrom({
    tweet: { tweet_id: "t5", text: "@linkrbot biggest risk on it?" },
    active_state: { active_entities: [entity] },
  });

  const resolution = resolveMarketTargetForTurn(context, "coin_inquiry");
  assert(resolution.target !== null, "active state token should resolve");
  assert(
    resolution.target.target.address === address,
    "active state address mismatch",
  );
});

Deno.test("public persona facts include authoritative builder identity", () => {
  const facts = linkrPublicPersonaFacts();
  assert(facts.handle === "@linkrbot", "handle mismatch");
  assert(facts.builder === "@S0Ldev", "builder mismatch");
  assert(facts.engine === "LNKR-1", "engine mismatch");
});
