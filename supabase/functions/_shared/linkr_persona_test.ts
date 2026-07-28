import {
  capabilityPromptFacts,
  capabilityPromptSummary,
} from "./linkr_capabilities.ts";
import {
  LINKR_BUILDER_HANDLE,
  LINKR_ENGINE_NAME,
  LINKR_HANDLE,
  linkrIdentityReply,
  naturalConversationFallbackReply,
  personaSystemPrompt,
  smallTalkReply,
} from "./linkr_persona.ts";
import { lintPublicReply } from "./reply_lint.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("identity replies use stable Linkr persona", () => {
  assert(
    linkrIdentityReply("who").includes(LINKR_HANDLE),
    "who reply should include handle",
  );
  assert(
    linkrIdentityReply("builder").includes(LINKR_BUILDER_HANDLE),
    "builder reply should name builder",
  );
  assert(
    linkrIdentityReply("model").includes(LINKR_ENGINE_NAME),
    "model reply should name LNKR-1",
  );
});

Deno.test("capability summary mentions confirmation for value movement", () => {
  const summary = capabilityPromptSummary();
  assert(
    summary.includes("confirmation"),
    "summary should mention confirmation",
  );
  assert(summary.includes("liquidity"), "summary should include liquidity");
  assert(
    lintPublicReply(summary, "capability_help").ok,
    "summary should pass public lint",
  );
  assert(
    capabilityPromptFacts().includes("Pump.fun"),
    "facts should include Pump.fun launches",
  );
});

Deno.test("persona prompt avoids vendor claims and small talk varies", () => {
  const prompt = personaSystemPrompt("money");
  assert(prompt.includes(LINKR_ENGINE_NAME), "prompt should include engine");
  assert(
    !/openai|gpt/i.test(prompt),
    "prompt should not include vendor/model claims",
  );
  assert(
    smallTalkReply("gm") !== smallTalkReply("hello"),
    "small talk should have variation",
  );
});

Deno.test("terminal small talk stays natural and avoids capability loops", () => {
  const samples = [
    smallTalkReply("what's up linkr"),
    smallTalkReply("damn, no small talk?"),
    naturalConversationFallbackReply(
      "Are you able to have just a regular convo?",
    ),
    naturalConversationFallbackReply("Sounds great, how's your day?"),
  ];

  for (const reply of samples) {
    assert(reply.length > 0, "reply should not be empty");
    assert(
      !reply.includes("I can help with wallet balances"),
      "reply should not use capability loop",
    );
    assert(
      !/Tell me what you want to do\.$/.test(reply),
      "reply should not end with canned command CTA",
    );
  }

  assert(
    /talk|conversation|chat/i.test(samples[1] + " " + samples[2]),
    "regular conversation complaints should be acknowledged",
  );
});
