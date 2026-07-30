import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLaunchDraftSlotPatch,
  type LaunchSlotReconciliation,
  sanitizeLaunchSlotReconciliation,
} from "./launch_slot_reconciler.ts";
import {
  type LaunchFields,
  missingLaunchSlots,
  withLaunchStateEcho,
} from "./launch_contract.ts";
import { clarificationReply } from "./x_launch_command.ts";

/**
 * End-to-end replay of the production incident of 2026-07-30.
 *
 * Seven turns, in which the user supplied a name, a ticker, a chain, an image
 * brief and finally a real uploaded image — and never got a launch. Three of
 * the seven replies asked "What should the token be called?" while the draft
 * held name="test" the whole time.
 *
 * This harness mirrors the two pieces of real machinery that produced those
 * replies: `upsert_linkr_launch_draft_v2`'s merge-and-require step, and
 * `worker-command-prepare`'s clarification branch. The model outputs are the
 * ones the model actually returned, so the only thing under test is the
 * pipeline's handling of them.
 */

type DraftState = {
  filled: Record<string, unknown>;
  provenance: Record<string, unknown>;
  clarificationRounds: number;
};

type TurnResult = { reply: string | null; launched: boolean };

/** Mirrors upsert_linkr_launch_draft_v2 + the worker's clarification branch. */
function runTurn(
  draft: DraftState,
  reconciliation: LaunchSlotReconciliation,
  input: {
    latestUserText: string;
    originalLaunchText: string;
    latestMediaUrl?: string | null;
  },
): TurnResult {
  const patch = buildLaunchDraftSlotPatch({
    existingFields: draft.filled as LaunchFields,
    existingProvenance: draft.provenance,
    originalLaunchText: input.originalLaunchText,
    latestUserText: input.latestUserText,
    latestMediaUrl: input.latestMediaUrl ?? null,
    currentMissingFields: missingLaunchSlots(draft.filled, draft.provenance),
    botHandle: "linkrbot",
  }, reconciliation);

  // Draft merge, as the database performs it.
  for (const [key, value] of Object.entries(patch.filledFields)) {
    draft.filled[key] = value;
  }
  Object.assign(draft.provenance, patch.fieldProvenance);
  const missing = missingLaunchSlots(draft.filled, draft.provenance);

  // worker-command-prepare's branch, including the stall breaker.
  const stalling = draft.clarificationRounds >= 2;
  if (patch.needsClarification && !stalling) {
    const question = patch.clarificationQuestion ??
      (missing.length > 0
        ? clarificationReply(missing, draft.filled as LaunchFields)
        : null);
    if (question) {
      draft.clarificationRounds += 1;
      return {
        reply: withLaunchStateEcho(draft.filled, question),
        launched: false,
      };
    }
  }
  if (missing.length > 0) {
    draft.clarificationRounds += 1;
    return {
      reply: clarificationReply(missing, draft.filled as LaunchFields),
      launched: false,
    };
  }
  return { reply: null, launched: true };
}

function newDraft(): DraftState {
  return { filled: {}, provenance: {}, clarificationRounds: 0 };
}

Deno.test("the production launch transcript now reaches a launch", () => {
  const draft = newDraft();
  const original =
    "@linkrbot Launch a coin with the name: test\nticker: test\nImage should be a test tube";

  // Turn 1 — name, ticker and an image brief. No chain yet.
  const turn1 = runTurn(
    draft,
    sanitizeLaunchSlotReconciliation({
      intent: "continue_launch",
      slot_updates: {
        name: {
          action: "set",
          value: "test",
          evidence: "name: test",
          confidence: 0.95,
        },
        symbol: {
          action: "set",
          value: "TEST",
          evidence: "ticker: test",
          confidence: 0.95,
        },
        image_prompt: {
          action: "set",
          value: "a test tube",
          evidence: "Image should be a test tube",
          confidence: 0.9,
        },
      },
      needs_clarification: true,
      clarification_question: null,
    }),
    { latestUserText: original, originalLaunchText: original },
  );
  // Chain is genuinely missing, so one question is correct — but it must ask
  // only for the chain, and it must not ask for the name.
  assertEquals(turn1.launched, false);
  assertEquals(turn1.reply?.includes("Which chain"), true);
  assertEquals(turn1.reply?.includes("What should the token be called"), false);
  assertEquals(turn1.reply?.includes("name test"), true);
  // It must never ask for the things the platform fills in itself.
  for (const forbidden of ["description", "dev buy", "mayhem", "image URL"]) {
    assertEquals(turn1.reply?.toLowerCase().includes(forbidden.toLowerCase()), false);
  }

  // Turn 2 — the user answers the chain and waives the optional fields. This
  // is the turn that previously replied "What should the token be called?".
  const turn2 = runTurn(
    draft,
    sanitizeLaunchSlotReconciliation({
      intent: "continue_launch",
      slot_updates: {
        chain: {
          action: "set",
          value: "solana",
          evidence: "Launch it on Solana",
          confidence: 0.95,
        },
        description: {
          action: "set",
          value: null,
          evidence: "You add whatever description that you like",
          confidence: 0.9,
          edit_intent: true,
        },
        mayhem_mode: {
          action: "set",
          value: null,
          evidence: "no mayhem mode",
          confidence: 0.9,
          edit_intent: true,
        },
        dev_buy_amount: {
          action: "set",
          value: null,
          evidence: "dev buy is 0",
          confidence: 0.9,
          edit_intent: true,
        },
      },
      needs_clarification: true,
      clarification_question: null,
    }),
    {
      latestUserText:
        "@linkrbot Launch it on Solana. You add whatever description that you like and no mayhem mode, and dev buy is 0.",
      originalLaunchText: original,
    },
  );

  assertEquals(turn2.launched, true, "turn 2 must reach a launch");
  assertEquals(turn2.reply, null);
  assertEquals(draft.filled.name, "test");
  assertEquals(draft.filled.symbol, "TEST");
  assertEquals(draft.filled.chain, "solana");
  assertEquals(draft.filled.dev_buy_amount, "0 SOL");
  assertEquals(draft.filled.mayhem_mode, false);
  assertEquals(draft.filled.image_prompt, "a test tube");
  // Two turns, not seven.
  assertEquals(draft.clarificationRounds, 1);
});

Deno.test("the second production session launches on the first reply", () => {
  const draft = newDraft();
  // Everything required arrives at once, with an attached image.
  const result = runTurn(
    draft,
    sanitizeLaunchSlotReconciliation({
      intent: "continue_launch",
      slot_updates: {
        name: {
          action: "set",
          value: "test",
          evidence: "launch a coin called test",
          confidence: 0.95,
        },
        symbol: {
          action: "set",
          value: "TEST",
          evidence: "Ticker is test",
          confidence: 0.95,
        },
        chain: {
          action: "set",
          value: "solana",
          evidence: "on Solana",
          confidence: 0.95,
        },
      },
      // The model still volunteers a request for the optional fields. The
      // pipeline must decline to pass that on to the user.
      needs_clarification: true,
      clarification_question:
        "Please provide a short description, dev buy amount (if any), and whether to enable mayhem mode (yes/no).",
    }),
    {
      latestUserText:
        "@linkrbot launch a coin called test on Solana. Ticker is test.",
      originalLaunchText:
        "@linkrbot launch a coin called test on Solana. Ticker is test.",
      latestMediaUrl: "https://pbs.twimg.com/media/HOgFCsgXsAAlyle.jpg",
    },
  );

  assertEquals(result.launched, true);
  assertEquals(result.reply, null);
  assertEquals(draft.filled.chain, "solana");
  assertEquals(
    draft.filled.image_url,
    "https://pbs.twimg.com/media/HOgFCsgXsAAlyle.jpg",
  );
  assertEquals(draft.clarificationRounds, 0);
});

Deno.test("a name and a chain in one message launch immediately", () => {
  const draft = newDraft();
  const text = "@linkrbot launch a coin called Moon Dog on solana";
  const result = runTurn(
    draft,
    sanitizeLaunchSlotReconciliation({
      intent: "continue_launch",
      slot_updates: {
        name: {
          action: "set",
          value: "Moon Dog",
          evidence: "called Moon Dog",
          confidence: 0.95,
        },
        chain: {
          action: "set",
          value: "solana",
          evidence: "on solana",
          confidence: 0.95,
        },
      },
      needs_clarification: false,
      clarification_question: null,
    }),
    { latestUserText: text, originalLaunchText: text },
  );
  assertEquals(result.launched, true);
  assertEquals(draft.clarificationRounds, 0);
});

Deno.test("a launch missing its chain never loops forever", () => {
  const draft = newDraft();
  const text = "@linkrbot launch a coin called test";
  const noChain = () =>
    sanitizeLaunchSlotReconciliation({
      intent: "continue_launch",
      slot_updates: {
        name: {
          action: "set",
          value: "test",
          evidence: "called test",
          confidence: 0.95,
        },
      },
      needs_clarification: true,
      clarification_question: null,
    });

  // Each round asks for the chain and nothing else, and always echoes state.
  for (let round = 0; round < 4; round++) {
    const result = runTurn(draft, noChain(), {
      latestUserText: text,
      originalLaunchText: text,
    });
    assertEquals(result.launched, false);
    assertEquals(result.reply?.includes("Which chain"), true);
    assertEquals(
      result.reply?.includes("What should the token be called"),
      false,
    );
  }
  // A chain cannot be invented, so it keeps asking — but only ever for the
  // chain, and never for something it already has.
  assertEquals(String(draft.filled.name), "test");
});

// Guards the specific line that produced three of the seven looping replies.
Deno.test("the worker can never synthesise a missing field", () => {
  const source = Deno.readTextFileSync(
    new URL("../worker-command-prepare/index.ts", import.meta.url),
  );
  // Comments are stripped so the note explaining this bug does not trip it.
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  assertEquals(
    /clarificationReply\(\s*missing\.length\s*>\s*0\s*\?\s*missing\s*:\s*\[/
      .test(code),
    false,
    "clarificationReply must never receive a synthetic missing-field list",
  );
  assertEquals(
    /clarificationReply\([^)]*\[\s*"/.test(code),
    false,
    "clarificationReply must only ever receive a computed missing-field list",
  );
});
