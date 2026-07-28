import { buildLinkrWorkingFrame } from "./linkr_working_frame.ts";
import { getRouteResourceBundle, validateRouteResourceUse } from "./linkr_route_resources.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("working frame extracts entities and route resource bundles", () => {
  const frame = buildLinkrWorkingFrame({
    tweet: { tweet_id: "t1", text: "@linkrcash what about liquidity for $WIF?" },
    profile: null,
    wallet: null,
    user_context: {},
    thread_context: { flattened_context: "Parent mentions $WIF and a chart." },
    conversation: { conversation_id: "c1", messages: [], total_count: 0 },
    active_state: null,
  });
  assert(frame.entity_ledger.some((entity) => entity.label === "$WIF"), "ticker entity missing");
  assert(frame.fact_ledger.length > 0, "facts missing");
  assert(frame.route_resources.length > 0, "route bundles missing");
});

Deno.test("route bundle validation rejects undeclared tools", () => {
  const bundle = getRouteResourceBundle("coin_inquiry");
  const errors = validateRouteResourceUse({ bundle, tools: ["pending.confirm"] });
  assert(errors.includes("undeclared_tool:pending.confirm"), "should reject undeclared tool");
});
