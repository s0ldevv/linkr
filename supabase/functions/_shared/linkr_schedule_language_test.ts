import {
  isScheduleCapabilityQuestion,
  scheduleCapabilityReply,
  scheduleClarificationReply,
} from "./linkr_schedule_language.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("schedule ability questions are recognized as capability questions", () => {
  const samples = [
    "@linkrbot are you able to schedule buys/sells?",
    "Can schedule buys?",
    "can you schedule a buy?",
    "do you support scheduled sells",
    "do you support scheduled trades?",
    "are you able to buy later by market cap?",
    "is it possible to transfer later?",
    "can you add liquidity on a schedule?",
  ];

  for (const sample of samples) {
    assert(
      isScheduleCapabilityQuestion(sample),
      `expected capability question: ${sample}`,
    );
  }
});

Deno.test("concrete schedule commands are not downgraded to capability help", () => {
  const samples = [
    "schedule a buy of 0.1 SOL for 6Q3zNnW4JYpX6uDa5x6qXcP2dDz6Yy9JYxLfZz4zpump in 2 hours",
    "can you schedule a sell of half 0x1234567890abcdef1234567890abcdef12345678 when market cap is above $5M",
  ];

  for (const sample of samples) {
    assert(
      !isScheduleCapabilityQuestion(sample),
      `expected concrete schedule command: ${sample}`,
    );
  }
});

Deno.test("schedule replies stay user-facing", () => {
  const replies = [scheduleCapabilityReply(), scheduleClarificationReply()];

  for (const reply of replies) {
    assert(reply.includes("schedule"), "reply should mention scheduling");
    assert(reply.includes("confirm"), "reply should mention confirmation");
    assert(
      !reply.includes("exact_schedule_details"),
      "reply should not expose internal missing field names",
    );
  }
});
