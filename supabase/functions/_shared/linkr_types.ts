// Core Linkr agent contracts. Keep this module Edge-safe and dependency-free.

export type LinkrPrivacyClass =
  | "public"
  | "user_private"
  | "recipient_public"
  | "external_untrusted"
  | "internal_telemetry";

export type LinkrFactSource =
  | "current_tweet"
  | "parent_post"
  | "root_post"
  | "quoted_post"
  | "thread_context"
  | "conversation_memory"
  | "market_resolver"
  | "app_database"
  | "user_owned_ledger"
  | "x_search"
  | "post_intelligence"
  | "action_validator"
  | "tool_result";

export type LinkrEntityKind =
  | "tweet"
  | "x_handle"
  | "token"
  | "pool_position"
  | "pending_action"
  | "action_draft"
  | "amount"
  | "chain"
  | "url"
  | "media"
  | "unknown";

export interface LinkrEntityRef {
  id: string;
  kind: LinkrEntityKind;
  label: string;
  value: string | Record<string, unknown> | null;
  source: LinkrFactSource;
  confidence: number;
  freshness: "current" | "recent" | "stale" | "unknown";
  privacy: LinkrPrivacyClass;
  evidence_fact_ids: string[];
}

export interface LinkrFact {
  id: string;
  source: LinkrFactSource;
  privacy: LinkrPrivacyClass;
  summary: string;
  value?: unknown;
  confidence: number;
  freshness: "current" | "recent" | "stale" | "unknown";
  evidence?: string | null;
}

export interface LinkrToolResult<TFacts = Record<string, unknown>> {
  tool: string;
  ok: boolean;
  facts: TFacts;
  summary: string;
  freshness: "live" | "cached" | "stale" | "unknown";
  confidence: number;
  privacy: LinkrPrivacyClass;
  redactions: string[];
  answerable: boolean;
  error?: string | null;
}

export interface LinkrWorldState {
  tweet: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  wallet: Record<string, unknown> | null;
  user_context: Record<string, unknown>;
  thread_context: Record<string, unknown> | null;
  conversation: {
    conversation_id: string | null;
    messages: Array<Record<string, unknown>>;
    total_count: number;
  };
  active_state: Record<string, unknown> | null;
  tool_cache?: Record<string, LinkrToolResult>;
}

export type LinkrModelCall = "planner" | "classifier" | "reply" | "vision" | "extraction";

export interface LinkrRouteResourceBundle {
  route: string;
  required_slots: string[];
  optional_slots: string[];
  allowed_tools: string[];
  allowed_model_calls: LinkrModelCall[];
  privacy_limits: LinkrPrivacyClass[];
  fallback: "ask_clarification" | "safe_refusal" | "normal_classifier" | "deterministic_reply";
  clarification_priority: string[];
  tests: string[];
}

export interface LinkrWorkingFrame {
  frame_id: string;
  tweet_id: string;
  user_ask: string;
  resolved_references: LinkrEntityRef[];
  entity_ledger: LinkrEntityRef[];
  fact_ledger: LinkrFact[];
  route_resources: LinkrRouteResourceBundle[];
  selected_route: string | null;
  constraints: {
    public_reply: boolean;
    value_moving_requires_confirmation: boolean;
    no_private_cross_user_data: boolean;
    max_reply_chars: number;
  };
  outcome?: LinkrTurnOutcome;
}

export type LinkrTurnStatus =
  | "completed"
  | "awaiting_confirmation"
  | "ignored"
  | "failed"
  | "retry"
  | "delegated";

export interface LinkrReplyPlan {
  mode:
    | "none"
    | "deterministic"
    | "model"
    | "clarification"
    | "refusal"
    | "confirmation"
    | "execution_receipt";
  intent: string;
  text?: string | null;
  facts: LinkrFact[];
  privacy: LinkrPrivacyClass[];
  prompt?: LinkrPromptSpec | null;
  fallback_text: string;
  idempotency_key: string;
  reply_kind?: string | null;
}

export interface LinkrTurnOutcome {
  status: LinkrTurnStatus;
  route: string;
  reply_plan?: LinkrReplyPlan | null;
  telemetry?: Record<string, unknown>;
  error?: string | null;
  retry_after_seconds?: number | null;
}

export interface LinkrPromptSpec {
  name: string;
  version: string;
  model_tier: "nano" | "mini" | "vision";
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  max_output_chars: number;
  input_slots: Record<string, string>;
  privacy: LinkrPrivacyClass[];
}
