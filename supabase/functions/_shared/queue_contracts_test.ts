import {
  isLinkrQueueStage,
  LINKR_QUEUE_STAGES,
  LINKR_STAGE_WORKER_FUNCTIONS,
  linkrQueueForRoute,
  parseQueuePointer,
  QUEUE_MESSAGE_MAX_BYTES,
} from "./queue_contracts.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("queue pointer accepts the compact canonical envelope", () => {
  const pointer = parseQueuePointer({
    schema_version: 1,
    work_item_id: "d9b0c2f2-68a0-4f73-8719-4aeb4d2e7436",
    state_version: 2,
    route: "command.prepare",
    resource_sequence: null,
    dispatch_generation: 3,
    enqueued_at: "2026-07-21T00:00:00.000Z",
  });
  assert(pointer.route === "command.prepare", "route mismatch");
  assert(
    new TextEncoder().encode(JSON.stringify(pointer)).byteLength <
      QUEUE_MESSAGE_MAX_BYTES,
    "not compact",
  );
});

Deno.test("queue pointer rejects duplicated payload fields and oversized envelopes", () => {
  let rejected = false;
  try {
    parseQueuePointer({
      schema_version: 1,
      work_item_id: "d9b0c2f2-68a0-4f73-8719-4aeb4d2e7436",
      state_version: 2,
      route: `command.${"x".repeat(5000)}`,
      resource_sequence: null,
      dispatch_generation: 3,
      enqueued_at: "2026-07-21T00:00:00.000Z",
      payload: { forbidden: true },
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "oversized pointer should be rejected");
});

Deno.test("queue stages are allowlisted", () => {
  assert(isLinkrQueueStage("launch_solana"), "known stage rejected");
  assert(isLinkrQueueStage("launch_enrich"), "enrichment stage rejected");
  assert(isLinkrQueueStage("image_generate"), "image stage rejected");
  assert(!isLinkrQueueStage("caller_selected_queue"), "unknown stage accepted");
});

Deno.test("route resolution mirrors public.linkr_queue_for_route exactly", () => {
  // Every case below must match the SQL CASE in
  // supabase/migrations/20260722181000_autonomous_launch_acceptance.sql.
  const cases: Array<[string, number, string | null]> = [
    ["x.ingress", 50, "x_ingress"],
    ["telegram.control", 50, "telegram_control"],
    ["conversation.turn", 50, "conversation_turns_normal"],
    ["conversation.turn", 79, "conversation_turns_normal"],
    ["conversation.turn", 80, "conversation_turns_high"],
    ["conversation.turn", 100, "conversation_turns_high"],
    ["sms.turn", 50, "sms_turns_normal"],
    ["sms.turn", 80, "sms_turns_high"],
    ["command.prepare", 50, "command_prepare"],
    ["launch.enrich", 50, "launch_enrich"],
    ["media.capture", 50, "media_capture"],
    ["image.generate", 50, "image_generate"],
    ["action.solana", 50, "action_solana"],
    ["action.robinhood", 50, "action_robinhood"],
    ["launch.solana", 50, "launch_solana"],
    ["launch.robinhood", 50, "launch_robinhood"],
    ["confirm.solana", 50, "confirm_solana"],
    ["confirm.robinhood", 50, "confirm_robinhood"],
    ["reply.x", 50, "reply_x_normal"],
    ["reply.x", 80, "reply_x_high"],
    ["reply.telegram", 50, "reply_telegram_normal"],
    ["reply.telegram", 80, "reply_telegram_high"],
    ["reply.sms", 50, "reply_sms_normal"],
    ["reply.sms", 80, "reply_sms_high"],
    ["reconciliation", 50, "reconciliation"],
    ["nonexistent.route", 50, null],
    ["nft.solana", 50, null],
  ];
  for (const [route, priority, expected] of cases) {
    const actual = linkrQueueForRoute(route, priority);
    assert(
      actual === expected,
      `route ${route}@${priority} -> ${actual}, expected ${expected}`,
    );
  }
});

Deno.test("every queue stage maps to a worker function, and resolved stages are real", () => {
  for (const stage of LINKR_QUEUE_STAGES) {
    const fn = LINKR_STAGE_WORKER_FUNCTIONS[stage];
    assert(
      typeof fn === "string" && fn.startsWith("worker-"),
      `stage ${stage} has no valid worker function`,
    );
  }
  // Any stage the router can produce must be a known, allowlisted stage with a
  // worker function — otherwise fast handoff could target a nonexistent function.
  const routedStages = [
    "conversation.turn",
    "command.prepare",
    "reply.x",
    "reply.telegram",
    "sms.turn",
    "reply.sms",
  ].flatMap((route) => [
    linkrQueueForRoute(route, 50),
    linkrQueueForRoute(route, 80),
  ]);
  for (const stage of routedStages) {
    assert(
      stage !== null && isLinkrQueueStage(stage),
      "router produced unknown stage",
    );
    assert(
      typeof LINKR_STAGE_WORKER_FUNCTIONS[stage] === "string",
      `routed stage ${stage} missing worker function`,
    );
  }
});
