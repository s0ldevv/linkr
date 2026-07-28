import {
  LINKR_ROUTE_SCHEMA_VERSION,
  normalizeRouteDecision,
  parseRouteDecisionJson,
  routeCanMoveValue,
  routeDecisionFromIntent,
  validateRouteDecision,
} from "./linkr_route_decision.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("route decisions normalize to one shared schema", () => {
  const decision = normalizeRouteDecision({
    route: "coin_inquiry",
    confidence: 3,
    intent: "coin_inquiry",
    reason: "read market facts",
    allowed_tools: ["market.resolve", "market.resolve"],
  });

  assert(decision.schema_version === LINKR_ROUTE_SCHEMA_VERSION, "schema version mismatch");
  assert(decision.confidence === 1, "confidence should clamp");
  assert(decision.allowed_tools.length === 1, "tools should be unique");
  assert(validateRouteDecision(decision).length === 0, "read-only route should validate");
});

Deno.test("planner parser rejects malformed json without throwing", () => {
  const result = parseRouteDecisionJson("{not json");
  assert(result.decision.route === "normal_classifier", "bad json should fall back");
  assert(result.errors.includes("invalid_json"), "bad json should report invalid_json");
});

Deno.test("value-moving compatibility is enforced", () => {
  assert(!routeCanMoveValue("coin_inquiry"), "coin inquiry must remain read-only");
  const decision = normalizeRouteDecision({
    route: "coin_inquiry",
    intent: "buy_token",
    value_moving: true,
    requires_confirmation: true,
  });
  const errors = validateRouteDecision(decision);
  assert(errors.includes("action_intent_on_read_only_route"), "action intent must be rejected");
});

Deno.test("classifier intents map onto canonical route decisions", () => {
  assert(routeDecisionFromIntent("confirm_action").route === "confirm_action", "confirm route");
  assert(routeDecisionFromIntent("coin_inquiry").route === "coin_inquiry", "coin route");
  assert(routeDecisionFromIntent("transaction_history").route === "data_query", "data route");
  assert(
    routeDecisionFromIntent("buy_token").route === "normal_classifier",
    "executor intents stay behind adapter",
  );
});
