// deno-lint-ignore-file no-explicit-any
// Hardcoded Linkr tool registry. Models may request these names, but code validates inputs.

import type { LinkrSurface } from "./linkr_agent_runtime_types.ts";

export type LinkrToolMode = "read" | "prepare" | "execute";

export interface LinkrToolDefinition {
  name: string;
  description: string;
  mode: LinkrToolMode;
  value_moving: boolean;
  creates_pending_action: boolean;
  allowed_surfaces: LinkrSurface[];
  allowed_routes: string[];
  timeout_ms: number;
  cache_policy: "none" | "short_public" | "conversation";
  privacy:
    | "public"
    | "user_private"
    | "external_untrusted"
    | "internal_telemetry";
  required: string[];
  optional: string[];
}

const ALL_SURFACES: LinkrSurface[] = [
  "terminal",
  "cli",
  "telegram",
  "x",
  "cron",
  "agent_api",
  "future",
];

export const LINKR_TOOL_REGISTRY: Record<string, LinkrToolDefinition> = {
  "conversation.recent_messages": read(
    "conversation.recent_messages",
    "Read recent conversation messages.",
    ["conversation_id"],
  ),
  "conversation.search": read(
    "conversation.search",
    "Search authorized conversation history.",
    [
      "query",
    ],
  ),
  "conversation.source_refs": read(
    "conversation.source_refs",
    "Read source references for a conversation.",
    ["conversation_id"],
  ),
  "memory.search": read("memory.search", "Search durable user memory.", [
    "query",
  ]),
  "x.search": read(
    "x.search",
    "Search recent public X posts.",
    ["query"],
    "external_untrusted",
  ),
  "wallet.balance_query": read(
    "wallet.balance_query",
    "Read current wallet balances.",
    [],
  ),
  "portfolio.query": read("portfolio.query", "Read portfolio holdings.", []),
  "transaction.query": read("transaction.query", "Read user transactions.", []),
  "launch.query": read("launch.query", "Read launched tokens.", []),
  "launch.detail": read("launch.detail", "Read launch/token detail.", [
    "token",
  ]),
  "liquidity.position_query": read(
    "liquidity.position_query",
    "Read liquidity positions.",
    [],
  ),
  "agent.history_query": read(
    "agent.history_query",
    "Read prior Linkr runs/replies.",
    [],
  ),
  "url.parse": read("url.parse", "Parse allowlisted URLs.", ["text"]),
  "x.post_fetch": read(
    "x.post_fetch",
    "Fetch one X post/thread by status URL.",
    ["url"],
    "external_untrusted",
  ),
  "token.resolve": read(
    "token.resolve",
    "Resolve a token address, mint, Linkr URL, or ticker.",
    ["token"],
    "external_untrusted",
  ),
  "market.resolve": read(
    "market.resolve",
    "Resolve market data for a token.",
    ["token"],
    "external_untrusted",
  ),
  "coin.detail": read(
    "coin.detail",
    "Build token detail from market and launch data.",
    ["token"],
    "external_untrusted",
  ),
  "draft.status_query": read(
    "draft.status_query",
    "Read open drafts and pending actions.",
    [],
  ),
  "action.prepare_buy": prepare("action.prepare_buy", "Prepare a buy action.", [
    "chain",
    "token",
    "amount",
  ]),
  "action.prepare_sell": prepare(
    "action.prepare_sell",
    "Prepare a sell action.",
    [
      "chain",
      "token",
      "percent",
    ],
  ),
  "action.prepare_burn": prepare(
    "action.prepare_burn",
    "Prepare an irreversible token burn using an explicit chain, full contract/mint, and exact amount.",
    ["chain", "token", "amount"],
  ),
  "action.prepare_transfer": prepare(
    "action.prepare_transfer",
    "Prepare an ETH, SOL, or Solana USDC transfer.",
    ["chain", "recipient", "amount"],
  ),
  "action.prepare_swap": prepare(
    "action.prepare_swap",
    "Prepare an exact-input SOL/USDC swap on Solana.",
    ["chain", "direction", "amount"],
  ),
  // Only `chain` and `name` come from the user (see launch_contract.ts). The
  // rest are filled by enrichment and image generation, which now run *before*
  // this validation — so this list is a post-autofill assertion that the
  // pipeline produced a complete payload, not a gate the user has to satisfy.
  "action.prepare_launch": prepare(
    "action.prepare_launch",
    "Prepare a token launch.",
    [
      "chain",
      "name",
      "symbol",
      "description",
      "image_url",
    ],
  ),
  "action.prepare_add_liquidity": prepare(
    "action.prepare_add_liquidity",
    "Prepare add-liquidity action.",
    ["chain", "token"],
  ),
  "action.prepare_remove_liquidity": prepare(
    "action.prepare_remove_liquidity",
    "Prepare remove-liquidity action.",
    ["chain", "token", "percent"],
  ),
  "action.prepare_collect_fees": prepare(
    "action.prepare_collect_fees",
    "Prepare collect-fees action.",
    ["position_id"],
  ),
  "action.prepare_claim_creator_rewards": prepare(
    "action.prepare_claim_creator_rewards",
    "Prepare a creator-rewards claim for a user launch.",
    [],
  ),
  "action.prepare_schedule": prepare(
    "action.prepare_schedule",
    "Prepare a supported scheduled action.",
    ["chain", "action_type"],
  ),
  "action.confirm": execute(
    "action.confirm",
    "Confirm exactly one pending action.",
    [
      "pending_action_id",
    ],
  ),
  "action.cancel": execute("action.cancel", "Cancel a pending action.", [
    "pending_action_id",
  ]),
};

export function getLinkrTool(name: string): LinkrToolDefinition | null {
  return LINKR_TOOL_REGISTRY[name] ?? null;
}

export function validateToolInput(
  toolName: string,
  input: Record<string, unknown>,
  surface: LinkrSurface,
): {
  ok: boolean;
  errors: string[];
  tool: LinkrToolDefinition | null;
} {
  const tool = getLinkrTool(toolName);
  if (!tool) return { ok: false, errors: ["unknown_tool"], tool: null };
  const errors: string[] = [];
  if (!tool.allowed_surfaces.includes(surface)) {
    errors.push("surface_not_allowed");
  }
  for (const key of tool.required) {
    const value = input[key];
    if (value == null || String(value).trim() === "") {
      errors.push("missing_" + key);
    }
  }
  for (const key of Object.keys(input)) {
    if (!tool.required.includes(key) && !tool.optional.includes(key)) {
      errors.push("unexpected_" + key);
    }
  }
  return { ok: errors.length === 0, errors, tool };
}

function read(
  name: string,
  description: string,
  required: string[],
  privacy: LinkrToolDefinition["privacy"] = "user_private",
): LinkrToolDefinition {
  return {
    name,
    description,
    mode: "read",
    value_moving: false,
    creates_pending_action: false,
    allowed_surfaces: ALL_SURFACES,
    allowed_routes: [
      "read",
      "answer",
      "context",
      "history",
      "token",
      "post",
      "x_search",
    ],
    timeout_ms: 12_000,
    cache_policy: privacy === "user_private" ? "none" : "short_public",
    privacy,
    required,
    optional: [
      "conversation_id",
      "query",
      "token",
      "chain",
      "limit",
      "kind",
      "sort",
      "url",
      "text",
      "status",
      "action",
    ],
  };
}

function prepare(
  name: string,
  description: string,
  required: string[],
): LinkrToolDefinition {
  return {
    name,
    description,
    mode: "prepare",
    value_moving: true,
    creates_pending_action: true,
    allowed_surfaces: ALL_SURFACES,
    allowed_routes: ["action", "prepare"],
    timeout_ms: 15_000,
    cache_policy: "none",
    privacy: "user_private",
    required,
    optional: [
      "amount",
      "amount_eth",
      "amount_sol",
      "amount_usdc",
      "percent",
      "chain",
      "token",
      "recipient",
      "slippage_bps",
      "priority_fee_lamports",
      "direction",
      "asset",
      "name",
      "symbol",
      "description",
      "image_url",
      "website_url",
      "twitter_url",
      "telegram_url",
      "position_id",
      "launch_id",
      "symbol",
      "latest",
      "trigger_type",
      "scheduled_for",
      "trigger_direction",
      "trigger_value_usd",
    ],
  };
}

function execute(
  name: string,
  description: string,
  required: string[],
): LinkrToolDefinition {
  return {
    name,
    description,
    mode: "execute",
    value_moving: true,
    creates_pending_action: false,
    allowed_surfaces: ALL_SURFACES,
    allowed_routes: ["confirm", "cancel"],
    timeout_ms: 60_000,
    cache_policy: "none",
    privacy: "user_private",
    required,
    optional: ["confirmation_phrase", "conversation_id"],
  };
}
