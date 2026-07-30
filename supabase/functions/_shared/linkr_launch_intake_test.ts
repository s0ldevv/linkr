import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyResolvedDevBuy,
  carryableDraftFields,
  clarificationFor,
  decideRoute,
  describedImagePrompt,
  explicitLaunchChain,
  extractActionPayload,
  launchConfirmationText,
  launchName,
  mergeDraftPayload,
  missingFields,
  openDraftFor,
} from "./linkr_agent_runtime.ts";
import { launchStateSummary, missingLaunchSlots } from "./launch_contract.ts";

const CONVERSATION_ID = "8f7b5f2e-2f8a-4d3f-9c11-2a5e5a1c9d10";

function turnInput(overrides: Record<string, unknown> = {}) {
  return {
    surface: "terminal",
    surface_conversation_id: CONVERSATION_ID,
    source_message_id: "m1",
    user_id: "u1",
    text: "",
    actor: { kind: "authenticated_user", user_id: "u1" },
    transport: {
      kind: "terminal_sse",
      public_output: false,
      supports_streaming: true,
    },
    attachments: [],
    source_refs: [],
    client_context: {},
    ...overrides,
  } as never;
}

function runtimeState(overrides: Record<string, unknown> = {}) {
  return {
    conversation: null,
    recent_messages: [],
    pending_actions: [],
    drafts: [],
    source_refs: [],
    profile: null,
    memory_snippets: [],
    ...overrides,
  } as never;
}

function launchDraft(filledFields: Record<string, unknown>) {
  return {
    id: "draft-1",
    action_type: "launch_coin",
    status: "awaiting_clarification",
    surface_conversation_id: CONVERSATION_ID,
    updated_at: new Date().toISOString(),
    filled_fields: filledFields,
    field_provenance: { name: "user_text" },
  };
}

// The reported terminal failure: an image attached on turn one is gone by turn
// two, because the clients clear attachments after send and extraction only
// ever read the current message. Answering the agent's question erased the
// answer that came before it.
Deno.test("an attached image survives the next turn", () => {
  const firstTurn = extractActionPayload(
    "launch a coin called Test on solana",
    "launch_coin",
    [],
    runtimeState(),
    [{ kind: "image", source_url: "https://cdn.linkr.cash/u/test.png" }],
  );
  assertEquals(firstTurn.image_url, "https://cdn.linkr.cash/u/test.png");

  const draft = launchDraft(firstTurn);
  const secondTurn = mergeDraftPayload(
    carryableDraftFields("launch_coin", draft.filled_fields),
    extractActionPayload(
      "ticker is TEST",
      "launch_coin",
      [],
      runtimeState(),
      [],
    ),
  );

  assertEquals(secondTurn.image_url, "https://cdn.linkr.cash/u/test.png");
  assertEquals(secondTurn.name, "Test");
  assertEquals(secondTurn.symbol, "TEST");
  assertEquals(secondTurn.chain, "solana");
  assertEquals(missingFields("launch_coin", secondTurn), []);
});

Deno.test("a follow-up with no action word continues the open launch", () => {
  const state = runtimeState({ drafts: [launchDraft({ name: "test" })] });
  const decision = decideRoute(
    turnInput({ text: "Name: test and ticker: test" }),
    [],
    state,
  );
  assertEquals(decision.route, "prepare_action");
  assertEquals(decision.action_type, "launch_coin");
});

Deno.test("an open launch does not swallow an unrelated question", () => {
  const state = runtimeState({ drafts: [launchDraft({ name: "test" })] });
  for (
    const [text, route] of [
      ["what's my wallet balance?", "wallet"],
      ["what do I hold?", "portfolio"],
      ["what can you do?", "capabilities"],
    ] as const
  ) {
    assertEquals(decideRoute(turnInput({ text }), [], state).route, route);
  }
});

Deno.test("a stale draft stops absorbing new messages", () => {
  const stale = {
    ...launchDraft({ name: "test" }),
    updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  };
  assertEquals(
    openDraftFor(runtimeState({ drafts: [stale] }), turnInput(), "launch_coin"),
    null,
  );
});

Deno.test("a draft from another conversation never leaks in", () => {
  const foreign = {
    ...launchDraft({ name: "other" }),
    surface_conversation_id: "11111111-2222-3333-4444-555555555555",
  };
  assertEquals(
    openDraftFor(
      runtimeState({ drafts: [foreign] }),
      turnInput(),
      "launch_coin",
    ),
    null,
  );
});

// The launch chain is the one slot that is never inferred. `inferChain`
// defaults to robinhood, which would have prepared a launch on a chain the user
// never named.
Deno.test("a launch chain is never guessed", () => {
  const payload = extractActionPayload(
    "launch a coin called Test",
    "launch_coin",
    [],
    runtimeState(),
    [],
  );
  assertEquals(payload.chain, null);
  // Never asserted either way on a turn that says nothing about a chain, so a
  // chain chosen on an earlier turn cannot be erased by a later one.
  assertEquals(payload.chain_explicit, undefined);
  assertEquals(missingFields("launch_coin", payload), ["chain"]);
});

Deno.test("a chain chosen earlier is not erased by a later silent turn", () => {
  const first = extractActionPayload(
    "launch a coin called Test on solana",
    "launch_coin",
    [],
    runtimeState(),
    [],
  );
  assertEquals(first.chain_explicit, true);

  const second = mergeDraftPayload(
    carryableDraftFields("launch_coin", first),
    extractActionPayload("no dev buy", "launch_coin", [], runtimeState(), []),
  );
  assertEquals(second.chain, "solana");
  assertEquals(second.chain_explicit, true);
  assertEquals(missingFields("launch_coin", second), []);
});

Deno.test("naming both chains asks instead of picking one", () => {
  assertEquals(explicitLaunchChain("launch on solana or robinhood"), {
    chain: null,
    ambiguous: true,
  });
  assertEquals(explicitLaunchChain("launch it on solana"), {
    chain: "solana",
    ambiguous: false,
  });
  assertEquals(explicitLaunchChain("launch it on robinhood chain"), {
    chain: "robinhood",
    ambiguous: false,
  });
  // "Ethereum" in a token name is not a chain signal.
  assertEquals(explicitLaunchChain("launch a coin called Ethereum Killer"), {
    chain: null,
    ambiguous: false,
  });
});

Deno.test("name and chain alone are enough to launch", () => {
  const payload = extractActionPayload(
    "launch a coin called Moon Dog on solana",
    "launch_coin",
    [],
    runtimeState(),
    [],
  );
  assertEquals(payload.name, "Moon Dog");
  assertEquals(payload.chain, "solana");
  // No ticker, description or image supplied — and nothing is outstanding.
  assertEquals(payload.symbol, undefined);
  assertEquals(payload.description, null);
  assertEquals(payload.image_url, null);
  assertEquals(missingFields("launch_coin", payload), []);
});

Deno.test("natural launch phrasings are understood", () => {
  assertEquals(launchName("launch a coin called Test on solana"), "Test");
  assertEquals(launchName("launch a coin named Moon Dog on solana"), "Moon Dog");
  assertEquals(launchName("Launch a coin with the name: test"), "test");
  assertEquals(launchName("what's my balance"), null);
});

Deno.test("a described image is a brief, not a missing URL", () => {
  assertEquals(
    describedImagePrompt("the image should be a test tube on a purple background"),
    "a test tube on a purple background",
  );
  assertEquals(
    describedImagePrompt("go ahead and generate an image of a test tube"),
    "a test tube",
  );
  assertEquals(describedImagePrompt("launch a coin called test"), null);
});

Deno.test("clarification leads with what is already saved", () => {
  const payload = {
    name: "test",
    symbol: "TEST",
    image_url: "https://cdn.linkr.cash/u/test.png",
  };
  const question = clarificationFor("launch_coin", ["chain"], payload);
  assertEquals(question.includes("Saved so far"), true);
  assertEquals(question.includes("name test"), true);
  assertEquals(question.includes("ticker TEST"), true);
  assertEquals(question.includes("your image"), true);
  assertEquals(question.includes("Which chain"), true);
  // It must never ask for something it already has.
  assertEquals(question.includes("What should the token be called"), false);
});

Deno.test("the configured wallet dev buy is used when the user names no amount", () => {
  const solana = applyResolvedDevBuy(
    { dev_buy_amount: "0.25 SOL", initial_buy_sol: null },
    "solana",
  );
  assertEquals(solana.initial_buy_sol, 0.25);

  const robinhood = applyResolvedDevBuy(
    { dev_buy_amount: "0.02 ETH", initial_buy_eth: null },
    "robinhood",
  );
  assertEquals(robinhood.initial_buy_eth, 0.02);
});

Deno.test("an amount the user stated for this launch wins over the default", () => {
  const result = applyResolvedDevBuy(
    { dev_buy_amount: "0.25 SOL", initial_buy_sol: 1 },
    "solana",
  );
  assertEquals(result.initial_buy_sol, 1);
});

Deno.test("a dev buy is never relabelled across chains or past its cap", () => {
  // A SOL amount must not become an ETH amount.
  assertEquals(
    applyResolvedDevBuy({ dev_buy_amount: "0.25 SOL" }, "robinhood")
      .initial_buy_eth,
    undefined,
  );
  // Above the per-chain maximum, leave it alone rather than launch with it.
  assertEquals(
    applyResolvedDevBuy({ dev_buy_amount: "9 SOL" }, "solana").initial_buy_sol,
    undefined,
  );
  assertEquals(
    applyResolvedDevBuy({ dev_buy_amount: "0 SOL" }, "solana").initial_buy_sol,
    0,
  );
});

Deno.test("mayhem and cashback stay off unless explicitly asked for", () => {
  const quiet = extractActionPayload(
    "launch a coin called Test on solana",
    "launch_coin",
    [],
    runtimeState(),
    [],
  );
  assertEquals(quiet.mayhem_mode, undefined);
  assertEquals(quiet.cashback_mode, undefined);

  const asked = extractActionPayload(
    "launch a coin called Test on solana with mayhem mode",
    "launch_coin",
    [],
    runtimeState(),
    [],
  );
  assertEquals(asked.mayhem_mode, true);

  const declined = extractActionPayload(
    "launch a coin called Test on solana, no mayhem mode",
    "launch_coin",
    [],
    runtimeState(),
    [],
  );
  assertEquals(declined.mayhem_mode, false);
});

Deno.test("the confirmation card shows what the agent decided", () => {
  const text = launchConfirmationText({
    name: "Moon Dog",
    symbol: "MOON",
    chain: "solana",
    description: "Moon Dog is a community token.",
    initial_buy_sol: 0.25,
    launch_field_provenance: {
      symbol: "ai_generated",
      description: "ai_generated",
      image_prompt: "ai_generated",
    },
  });
  assertEquals(text.includes("Moon Dog ($MOON) on Solana"), true);
  assertEquals(text.includes("Dev buy: 0.25 SOL"), true);
  assertEquals(text.includes("I chose the ticker, description, image"), true);
});

Deno.test("only name and chain are ever required", () => {
  assertEquals(missingLaunchSlots({}), ["name", "chain"]);
  assertEquals(missingLaunchSlots({ name: "test" }), ["chain"]);
  assertEquals(missingLaunchSlots({ name: "test", chain: "solana" }), []);
  // A chain that did not come from the user does not count as chosen.
  assertEquals(
    missingLaunchSlots({ name: "test", chain: "solana" }, {
      chain: "inferred",
    }),
    ["chain"],
  );
  assertEquals(
    missingLaunchSlots({ name: "test", chain: "solana" }, {
      chain: "user_text",
    }),
    [],
  );
  // Ambiguity is treated as absence.
  assertEquals(
    missingLaunchSlots({ name: "test", chain: "solana", chain_ambiguous: true }),
    ["chain"],
  );
});

Deno.test("the state summary reads back everything captured", () => {
  assertEquals(launchStateSummary({}), "");
  assertEquals(
    launchStateSummary({
      name: "test",
      symbol: "test",
      chain: "solana",
      image_url: "https://cdn.linkr.cash/u/test.png",
      dev_buy_amount: "0 SOL",
    }),
    "Saved so far: name test · ticker TEST · Solana · your image · dev buy 0 SOL.",
  );
});

// Trades, transfers and burns are single-shot. Reviving a stale amount or
// recipient from an abandoned draft would be far worse than asking again.
Deno.test("only launches carry draft state forward", () => {
  assertEquals(
    carryableDraftFields("launch_coin", { name: "test", chain: "solana" }),
    { name: "test", chain: "solana" },
  );
  assertEquals(
    carryableDraftFields("transfer", { recipient: "0xabc", amount: 5 }),
    {},
  );
  assertEquals(carryableDraftFields("buy", { token: "abc", amount_sol: 2 }), {});
});
