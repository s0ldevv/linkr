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
        value: "linkrcash",
        evidence: "@linkrcash",
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
        "@linkrcash launch a coin called test with ticker test",
      latestUserText: "@linkrcash Use Solana",
      latestTweetId: "2081983131007984078",
      originalTweetId: "2081982677964427495",
      previousAssistantReplyText:
        "Your launch is saved. Which chain should I use: Solana or Robinhood?",
      currentMissingFields: ["chain"],
      botHandle: "linkrcash",
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
      latestUserText: "@linkrcash change the name to Foo",
      latestTweetId: "2",
      botHandle: "linkrcash",
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
    latestUserText: "@linkrcash maybe Solana",
    botHandle: "linkrcash",
  }, reconciliation);

  assertEquals(patch.filledFields, {});
  assertEquals(patch.blockedSlots, ["chain"]);
  assertEquals(patch.needsClarification, true);
});

Deno.test("tweet text context separates the bot handle from user content", () => {
  const context = buildLaunchSlotTextContext(
    "@linkrcash Use Solana https://x.com/linkrcash/status/1 @dev",
    "linkrcash",
  );
  assertEquals(context.mentioned_bot_handle, "linkrcash");
  assertEquals(context.mentioned_user_handles, ["dev"]);
  assertEquals(context.urls, ["https://x.com/linkrcash/status/1"]);
  assertEquals(context.clean_user_text, "Use Solana @dev");
});
