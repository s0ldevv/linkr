// Route decision schema shared by deterministic routing and planner fallback.

export const LINKR_ROUTE_SCHEMA_VERSION = 1;

export const LINKR_ROUTE_NAMES = [
  "small_talk",
  "identity",
  "capability_help",
  "safe_refusal",
  "post_explanation",
  "coin_inquiry",
  "x_search",
  "data_query",
  "wallet_query",
  "draft_continue",
  "transfer_draft",
  "launch_from_post",
  "liquidity_positions",
  "liquidity_draft",
  "confirm_action",
  "cancel_action",
  "ambient_ignore",
  "normal_classifier",
] as const;

export type LinkrRouteName = (typeof LINKR_ROUTE_NAMES)[number];

export const LINKR_ACTION_INTENTS = [
  "buy_token",
  "sell_token",
  "transfer",
  "launch_coin",
  "add_liquidity",
  "remove_liquidity",
  "collect_liquidity_fees",
  "claim_creator_rewards",
  "confirm_action",
  "cancel_action",
] as const;

export type LinkrActionIntent = (typeof LINKR_ACTION_INTENTS)[number];

export interface LinkrRouteDecision {
  schema_version: number;
  route: LinkrRouteName;
  confidence: number;
  intent: string;
  reason: string;
  requires_reply: boolean;
  requires_confirmation: boolean;
  value_moving: boolean;
  allowed_tools: string[];
  entities: string[];
  missing_fields: string[];
  planner_used: boolean;
}

const ROUTE_SET = new Set<string>(LINKR_ROUTE_NAMES);
const ACTION_SET = new Set<string>(LINKR_ACTION_INTENTS);

export function isLinkrRouteName(value: unknown): value is LinkrRouteName {
  return typeof value === "string" && ROUTE_SET.has(value);
}

export function routeCanMoveValue(route: LinkrRouteName): boolean {
  return [
    "transfer_draft",
    "launch_from_post",
    "liquidity_draft",
    "confirm_action",
    "normal_classifier",
  ].includes(route);
}

export function normalizeRouteDecision(input: Partial<LinkrRouteDecision>): LinkrRouteDecision {
  const route = isLinkrRouteName(input.route) ? input.route : "normal_classifier";
  const confidence = clampConfidence(input.confidence);
  const valueMoving = Boolean(input.value_moving && routeCanMoveValue(route));
  const requiresConfirmation =
    valueMoving || Boolean(input.requires_confirmation && routeCanMoveValue(route));

  return {
    schema_version: LINKR_ROUTE_SCHEMA_VERSION,
    route,
    confidence,
    intent: String(input.intent ?? route),
    reason: String(input.reason ?? "route decision").slice(0, 240),
    requires_reply: input.requires_reply ?? !["ambient_ignore", "normal_classifier"].includes(route),
    requires_confirmation: requiresConfirmation,
    value_moving: valueMoving,
    allowed_tools: cleanStringArray(input.allowed_tools),
    entities: cleanStringArray(input.entities),
    missing_fields: cleanStringArray(input.missing_fields),
    planner_used: Boolean(input.planner_used),
  };
}

export function validateRouteDecision(decision: LinkrRouteDecision): string[] {
  const errors: string[] = [];
  if (decision.schema_version !== LINKR_ROUTE_SCHEMA_VERSION) {
    errors.push("unsupported_schema_version");
  }
  if (!isLinkrRouteName(decision.route)) errors.push("invalid_route");
  if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
    errors.push("invalid_confidence");
  }
  if (decision.value_moving && !routeCanMoveValue(decision.route)) {
    errors.push("route_cannot_move_value");
  }
  if (decision.value_moving && !decision.requires_confirmation) {
    errors.push("value_moving_requires_confirmation");
  }
  if (ACTION_SET.has(decision.intent) && !routeCanMoveValue(decision.route)) {
    errors.push("action_intent_on_read_only_route");
  }
  return errors;
}

export function parseRouteDecisionJson(jsonText: string): {
  decision: LinkrRouteDecision;
  errors: string[];
} {
  try {
    const parsed = JSON.parse(String(jsonText ?? ""));
    const decision = normalizeRouteDecision(parsed);
    return { decision, errors: validateRouteDecision(decision) };
  } catch (e) {
    return {
      decision: normalizeRouteDecision({
        route: "normal_classifier",
        confidence: 0,
        reason: "planner json parse failed: " + String(e),
        planner_used: true,
      }),
      errors: ["invalid_json"],
    };
  }
}

export function routeDecisionFromIntent(intent: string, confidence = 0.8): LinkrRouteDecision {
  const normalizedIntent = String(intent ?? "unknown");
  if (normalizedIntent === "confirm_action") {
    return normalizeRouteDecision({
      route: "confirm_action",
      intent: normalizedIntent,
      confidence,
      requires_confirmation: true,
      value_moving: true,
      reason: "explicit confirmation route",
    });
  }
  if (normalizedIntent === "cancel_action") {
    return normalizeRouteDecision({
      route: "cancel_action",
      intent: normalizedIntent,
      confidence,
      reason: "explicit cancellation route",
    });
  }
  if (normalizedIntent === "coin_inquiry") {
    return normalizeRouteDecision({
      route: "coin_inquiry",
      intent: normalizedIntent,
      confidence,
      reason: "read-only market inquiry",
    });
  }
  if (["transaction_history", "launch_history", "agent_history", "recent_activity"].includes(normalizedIntent)) {
    return normalizeRouteDecision({
      route: "data_query",
      intent: normalizedIntent,
      confidence,
      reason: "read-only app data query",
    });
  }
  if (normalizedIntent === "liquidity_positions" || normalizedIntent === "liquidity_position_detail") {
    return normalizeRouteDecision({
      route: "liquidity_positions",
      intent: normalizedIntent,
      confidence,
      reason: "read-only liquidity position query",
    });
  }
  return normalizeRouteDecision({
    route: "normal_classifier",
    intent: normalizedIntent,
    confidence,
    reason: "use existing classifier/executor adapter",
  });
}

function clampConfidence(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, 25);
}
