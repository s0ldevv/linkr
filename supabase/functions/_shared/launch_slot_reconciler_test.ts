import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLaunchDraftSlotPatch,
  buildLaunchSlotTextContext,
  sanitizeLaunchSlotReconciliation,
} from "./launch_slot_reconciler.ts";

Deno.test("reported chain follow-up cannot overwrite protected name or symbol", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {
      name: {
        action: "set",
        value: "linkrbot",
        evidence: "@linkrbot",
        confidence: 0.95,
        reason: "bad model read the bot mention as a token name",
        edit_intent: false,
      },
      symbol: {
        action: "keep",
        value: null,
        evidence: "ticker test",
        confidence: 0.99,
        reason: "existing user-provided symbol remains in force",
      },
      chain: {
        action: "set",
        value: "Solana",
        evidence: "Use Solana",
        confidence: 0.99,
        reason: "latest reply answers the chain question",
        edit_intent: false,
      },
    },
    needs_clarification: false,
    clarification_question: null,
  });

  const patch = buildLaunchDraftSlotPatch(
    {
      existingFields: { name: "test", symbol: "TEST" },
      existingProvenance: { name: "user_text", symbol: "user_text" },
      originalLaunchText:
        "@linkrbot launch a coin called test with ticker test",
      latestUserText: "@linkrbot Use Solana",
      latestTweetId: "2081983131007984078",
      originalTweetId: "2081982677964427495",
      previousAssistantReplyText:
        "Your launch is saved. Which chain should I use: Solana or Robinhood?",
      currentMissingFields: ["chain"],
      botHandle: "linkrbot",
    },
    reconciliation,
    "2026-07-28T05:59:10.000Z",
  );

  assertEquals(patch.filledFields, { chain: "solana" });
  assertEquals(patch.fieldProvenance, { chain: "user_text" });
  assertEquals(patch.protectedOverwriteAttempts.length, 1);
  assertEquals(patch.protectedOverwriteAttempts[0].slot, "name");
  assertEquals(patch.needsClarification, false);
});

Deno.test("explicit user edit can overwrite a protected user-owned name", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "edit_launch",
    slot_updates: {
      name: {
        action: "set",
        value: "Foo",
        evidence: "change the name to Foo",
        confidence: 0.96,
        reason: "latest reply explicitly edits the name slot",
        edit_intent: true,
      },
    },
    needs_clarification: false,
    clarification_question: null,
  });

  const patch = buildLaunchDraftSlotPatch(
    {
      existingFields: { name: "test", symbol: "TEST", chain: "solana" },
      existingProvenance: {
        name: "user_text",
        symbol: "user_text",
        chain: "user_text",
      },
      originalLaunchText: "launch a coin called test ticker TEST",
      latestUserText: "@linkrbot change the name to Foo",
      latestTweetId: "2",
      botHandle: "linkrbot",
    },
    reconciliation,
    "2026-07-28T06:00:00.000Z",
  );

  assertEquals(patch.filledFields, { name: "Foo" });
  assertEquals(patch.fieldProvenance, { name: "user_text" });
  assertEquals(patch.slotProvenance.name.edit_intent, true);
});

Deno.test("low confidence slot updates ask instead of mutating", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {
      chain: {
        action: "set",
        value: "solana",
        evidence: "maybe Solana",
        confidence: 0.2,
        reason: "low confidence",
      },
    },
    needs_clarification: false,
    clarification_question: null,
  });

  const patch = buildLaunchDraftSlotPatch({
    existingFields: { name: "test", symbol: "TEST" },
    existingProvenance: { name: "user_text", symbol: "user_text" },
    latestUserText: "@linkrbot maybe Solana",
    botHandle: "linkrbot",
  }, reconciliation);

  assertEquals(patch.filledFields, {});
  assertEquals(patch.blockedSlots, ["chain"]);
  assertEquals(patch.needsClarification, true);
});

// Production regression, draft 5b028575-9478-434a-9041-4d9e1878a35f.
//
// Thread: "launch a coin called test on Solana. Ticker is test." + image, then
// "0 dev buy, no description, no mayhem mode." The model read the turn
// perfectly. The pipeline still paused the launch and replied "Your launch is
// saved. What should the token be called?" — for the third time in one session.
// The reconciler JSON below is copied verbatim from that row's
// generation_context.
Deno.test("explicit none answers complete a launch instead of blocking it", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {
      name: {
        action: "keep",
        value: "test",
        evidence: "original_launch_tweet: 'launch a coin called test",
        confidence: 0.95,
        edit_intent: false,
      },
      chain: {
        action: "keep",
        value: "solana",
        evidence: "original_launch_tweet: 'on Solana",
        confidence: 0.95,
        edit_intent: false,
      },
      symbol: {
        action: "keep",
        value: "TEST",
        evidence: "original_launch_tweet: 'Ticker is test",
        confidence: 0.95,
        edit_intent: false,
      },
      image_url: {
        action: "keep",
        value: "https://pbs.twimg.com/media/HOgFCsgXsAAlyle.jpg",
        evidence: "existing_draft_fields image_url from user_media",
        confidence: 0.9,
        edit_intent: false,
      },
      description: {
        action: "clear",
        value: "",
        evidence: "latest_user_tweet: 'no description",
        confidence: 0.9,
        edit_intent: true,
      },
      mayhem_mode: {
        action: "set",
        value: null,
        evidence: "latest_user_tweet: 'no mayhem mode",
        confidence: 0.9,
        edit_intent: true,
      },
      dev_buy_amount: {
        action: "set",
        value: null,
        evidence: "latest_user_tweet: '0 dev buy",
        confidence: 0.9,
        edit_intent: true,
      },
    },
    needs_clarification: true,
    clarification_question: null,
  });

  const patch = buildLaunchDraftSlotPatch({
    existingFields: {
      name: "test",
      chain: "solana",
      symbol: "TEST",
      image_url: "https://pbs.twimg.com/media/HOgFCsgXsAAlyle.jpg",
    },
    existingProvenance: {
      name: "user_text",
      chain: "user_text",
      symbol: "user_text",
      image_url: "user_media",
    },
    originalLaunchText:
      "@linkrbot launch a coin called test on Solana. Ticker is test.",
    latestUserText: "@linkrbot 0 dev buy, no description, no mayhem mode.",
    latestTweetId: "2082920906121261498",
    originalTweetId: "2082920375252291931",
    currentMissingFields: [],
    botHandle: "linkrbot",
  }, reconciliation);

  // The user's answers are applied, not discarded.
  assertEquals(patch.filledFields.dev_buy_amount, "0 SOL");
  assertEquals(patch.filledFields.mayhem_mode, false);
  assertEquals(patch.filledFields.description, null);
  // And nothing required is outstanding, so the launch proceeds.
  assertEquals(patch.needsClarification, false);
  assertEquals(patch.blockedSlots, []);
});

Deno.test("a blocked optional slot never stops a launch that has name and chain", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {
      symbol: {
        action: "set",
        value: "!!!",
        evidence: "unreadable ticker",
        confidence: 0.9,
      },
      description: {
        action: "ask",
        value: null,
        evidence: "model wants a description",
        confidence: 0.9,
      },
    },
    needs_clarification: true,
    clarification_question: "What should the description be?",
  });

  const patch = buildLaunchDraftSlotPatch({
    existingFields: { name: "test", chain: "solana" },
    existingProvenance: { name: "user_text", chain: "user_text" },
    latestUserText: "@linkrbot go ahead",
    botHandle: "linkrbot",
  }, reconciliation);

  assertEquals(patch.needsClarification, false);
  assertEquals(patch.advisorySlots.sort(), ["description", "symbol"]);
});

Deno.test("a blocked required slot still stops the launch", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {
      chain: {
        action: "ask",
        value: null,
        evidence: "user has not chosen a chain",
        confidence: 0.9,
      },
    },
    needs_clarification: false,
    clarification_question: null,
  });

  const patch = buildLaunchDraftSlotPatch({
    existingFields: { name: "test" },
    existingProvenance: { name: "user_text" },
    latestUserText: "@linkrbot launch a coin called test",
    botHandle: "linkrbot",
  }, reconciliation);

  assertEquals(patch.needsClarification, true);
  assertEquals(patch.blockedSlots, ["chain"]);
  assertEquals(patch.advisorySlots, []);
});

Deno.test("a guessed chain is not a user-selected chain", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {},
    needs_clarification: true,
    clarification_question: "Which chain?",
  });

  const patch = buildLaunchDraftSlotPatch({
    existingFields: { name: "test", chain: "solana" },
    // ai_generated is not an accepted chain provenance at the DB boundary.
    existingProvenance: { name: "user_text", chain: "ai_generated" },
    latestUserText: "@linkrbot go ahead",
    botHandle: "linkrbot",
  }, reconciliation);

  assertEquals(patch.needsClarification, true);
});

Deno.test("a described image becomes an image prompt, never an image URL request", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {
      image_prompt: {
        action: "set",
        value: "a test tube on a purple background",
        evidence: "latest_user_tweet: 'image should be a test tube",
        confidence: 0.9,
      },
    },
    needs_clarification: false,
    clarification_question: null,
  });

  const patch = buildLaunchDraftSlotPatch({
    existingFields: { name: "test", chain: "solana" },
    existingProvenance: { name: "user_text", chain: "user_text" },
    latestUserText:
      "@linkrbot the image should be a test tube on a purple background",
    botHandle: "linkrbot",
  }, reconciliation);

  assertEquals(
    patch.filledFields.image_prompt,
    "a test tube on a purple background",
  );
  assertEquals(patch.filledFields.image_url, undefined);
  assertEquals(patch.needsClarification, false);
});

Deno.test("dev buy takes its unit from the chain chosen in the same turn", () => {
  const reconciliation = sanitizeLaunchSlotReconciliation({
    intent: "continue_launch",
    slot_updates: {
      chain: {
        action: "set",
        value: "robinhood",
        evidence: "latest_user_tweet: 'on Robinhood",
        confidence: 0.95,
      },
      dev_buy_amount: {
        action: "set",
        value: "0.05",
        evidence: "latest_user_tweet: 'dev buy 0.05",
        confidence: 0.9,
      },
    },
    needs_clarification: false,
    clarification_question: null,
  });

  const patch = buildLaunchDraftSlotPatch({
    existingFields: { name: "test" },
    existingProvenance: { name: "user_text" },
    latestUserText: "@linkrbot launch it on Robinhood with dev buy 0.05",
    botHandle: "linkrbot",
  }, reconciliation);

  assertEquals(patch.filledFields.chain, "robinhood");
  assertEquals(patch.filledFields.dev_buy_amount, "0.05 ETH");
});

Deno.test("mayhem and cashback are explicit opt-ins, and a no is an answer", () => {
  const patch = buildLaunchDraftSlotPatch({
    existingFields: { name: "test", chain: "solana" },
    existingProvenance: { name: "user_text", chain: "user_text" },
    latestUserText: "@linkrbot enable mayhem mode but no cashback",
    botHandle: "linkrbot",
  }, sanitizeLaunchSlotReconciliation({
    intent: "edit_launch",
    slot_updates: {
      mayhem_mode: {
        action: "set",
        value: true,
        evidence: "latest_user_tweet: 'enable mayhem mode",
        confidence: 0.9,
      },
      cashback_mode: {
        action: "set",
        value: "no",
        evidence: "latest_user_tweet: 'no cashback",
        confidence: 0.9,
      },
    },
    needs_clarification: false,
    clarification_question: null,
  }));

  assertEquals(patch.filledFields.mayhem_mode, true);
  assertEquals(patch.filledFields.cashback_mode, false);
  assertEquals(patch.needsClarification, false);
});

Deno.test("tweet text context separates the bot handle from user content", () => {
  const context = buildLaunchSlotTextContext(
    "@linkrbot Use Solana https://x.com/linkrbot/status/1 @dev",
    "linkrbot",
  );
  assertEquals(context.mentioned_bot_handle, "linkrbot");
  assertEquals(context.mentioned_user_handles, ["dev"]);
  assertEquals(context.urls, ["https://x.com/linkrbot/status/1"]);
  assertEquals(context.clean_user_text, "Use Solana @dev");
});
