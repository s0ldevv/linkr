import type { LinkrPrivacyClass, LinkrRouteResourceBundle } from "./linkr_types.ts";
import type { LinkrRouteName } from "./linkr_route_decision.ts";

const PUBLIC_ONLY: LinkrPrivacyClass[] = ["public", "external_untrusted", "recipient_public"];
const SELF_PRIVATE: LinkrPrivacyClass[] = [...PUBLIC_ONLY, "user_private"];

export const LINKR_ROUTE_RESOURCE_BUNDLES: Record<LinkrRouteName, LinkrRouteResourceBundle> = {
  small_talk: bundle("small_talk", ["kernel", "thread"], [], [], ["reply"], PUBLIC_ONLY),
  identity: bundle("identity", ["kernel"], [], [], [], PUBLIC_ONLY),
  capability_help: bundle("capability_help", ["kernel", "capabilities"], [], [], [], PUBLIC_ONLY),
  safe_refusal: bundle("safe_refusal", ["kernel"], [], [], [], PUBLIC_ONLY),
  post_explanation: bundle(
    "post_explanation",
    ["kernel", "thread"],
    ["post_intelligence", "media"],
    ["post.explain"],
    ["reply", "vision"],
    PUBLIC_ONLY,
  ),
  coin_inquiry: bundle(
    "coin_inquiry",
    ["kernel", "thread", "entities"],
    ["market", "conversation"],
    ["market.resolve", "cashtag.resolve"],
    ["reply"],
    PUBLIC_ONLY,
  ),
  x_search: bundle(
    "x_search",
    ["kernel", "thread"],
    ["external_search"],
    ["x.search"],
    ["reply"],
    ["public", "external_untrusted"],
  ),
  data_query: bundle(
    "data_query",
    ["kernel", "account", "user_history"],
    ["conversation", "memory"],
    ["activity.query", "launch.query", "transaction.query", "agent.history_query"],
    ["reply"],
    SELF_PRIVATE,
  ),
  // The asker's own balances. SELF_PRIVATE matches data_query: a user's own
  // private data may be read for them, never another user's. The reply is
  // composed deterministically from the real numbers rather than by a model —
  // a balance is the user's money and must never be paraphrased or invented.
  wallet_query: bundle(
    "wallet_query",
    ["kernel", "account"],
    ["conversation"],
    ["wallet.balance_query"],
    [],
    SELF_PRIVATE,
  ),
  draft_continue: bundle(
    "draft_continue",
    ["kernel", "draft", "thread"],
    ["recipient_lookup", "market"],
    ["draft.status_query", "public.user_lookup"],
    [],
    SELF_PRIVATE,
  ),
  transfer_draft: bundle(
    "transfer_draft",
    ["kernel", "account", "draft"],
    ["recipient_lookup"],
    ["public.user_lookup", "draft.write"],
    ["extraction"],
    SELF_PRIVATE,
    "ask_clarification",
    ["recipient", "amount", "chain"],
  ),
  launch_from_post: bundle(
    "launch_from_post",
    ["kernel", "post_intelligence", "account"],
    ["media", "thread"],
    ["draft.write", "launch.metadata"],
    ["vision", "reply"],
    SELF_PRIVATE,
    "ask_clarification",
    ["chain", "name", "symbol", "image"],
  ),
  liquidity_positions: bundle(
    "liquidity_positions",
    ["kernel", "account"],
    ["market"],
    ["liquidity.position_query"],
    ["reply"],
    SELF_PRIVATE,
  ),
  liquidity_draft: bundle(
    "liquidity_draft",
    ["kernel", "account", "draft"],
    ["market", "position"],
    ["liquidity.position_query", "draft.write"],
    ["extraction"],
    SELF_PRIVATE,
    "ask_clarification",
    ["token", "amount_or_percent"],
  ),
  confirm_action: bundle(
    "confirm_action",
    ["kernel", "account", "pending_action"],
    [],
    ["pending.confirm"],
    [],
    SELF_PRIVATE,
  ),
  cancel_action: bundle(
    "cancel_action",
    ["kernel", "account", "pending_action"],
    [],
    ["pending.cancel"],
    [],
    SELF_PRIVATE,
  ),
  ambient_ignore: bundle(
    "ambient_ignore",
    ["kernel"],
    [],
    [],
    [],
    PUBLIC_ONLY,
    "deterministic_reply",
  ),
  normal_classifier: bundle(
    "normal_classifier",
    ["kernel", "thread", "account"],
    ["history"],
    ["legacy.classifier_adapter"],
    ["classifier", "extraction", "reply"],
    SELF_PRIVATE,
    "normal_classifier",
  ),
};

export function getRouteResourceBundle(route: LinkrRouteName): LinkrRouteResourceBundle {
  return LINKR_ROUTE_RESOURCE_BUNDLES[route];
}

export function validateRouteResourceUse(args: {
  bundle: LinkrRouteResourceBundle;
  tools?: string[];
  model_calls?: string[];
  privacy?: string[];
}): string[] {
  const errors: string[] = [];
  for (const tool of args.tools ?? []) {
    if (!args.bundle.allowed_tools.includes(tool)) errors.push("undeclared_tool:" + tool);
  }
  for (const call of args.model_calls ?? []) {
    if (!args.bundle.allowed_model_calls.includes(call as never)) {
      errors.push("undeclared_model_call:" + call);
    }
  }
  for (const privacy of args.privacy ?? []) {
    if (!args.bundle.privacy_limits.includes(privacy as LinkrPrivacyClass)) {
      errors.push("privacy_not_allowed:" + privacy);
    }
  }
  return errors;
}

function bundle(
  route: LinkrRouteName,
  required_slots: string[],
  optional_slots: string[],
  allowed_tools: string[],
  allowed_model_calls: LinkrRouteResourceBundle["allowed_model_calls"],
  privacy_limits: LinkrPrivacyClass[],
  fallback: LinkrRouteResourceBundle["fallback"] = "deterministic_reply",
  clarification_priority: string[] = [],
): LinkrRouteResourceBundle {
  return {
    route,
    required_slots,
    optional_slots,
    allowed_tools,
    allowed_model_calls,
    privacy_limits,
    fallback,
    clarification_priority,
    tests: [
      `${route}:resource_bundle_declared`,
      `${route}:privacy_limited`,
      `${route}:fallback_defined`,
    ],
  };
}
