export const QUEUE_SCHEMA_VERSION = 1 as const;
export const QUEUE_MESSAGE_MAX_BYTES = 4096;

export const LINKR_QUEUE_STAGES = [
  "x_ingress",
  "telegram_control",
  "conversation_turns_high",
  "conversation_turns_normal",
  "command_prepare",
  "launch_enrich",
  "media_capture",
  "image_generate",
  "nft_solana",
  "action_solana",
  "action_robinhood",
  "launch_solana",
  "launch_robinhood",
  "confirm_solana",
  "confirm_robinhood",
  "reply_x_high",
  "reply_x_normal",
  "reply_telegram_high",
  "reply_telegram_normal",
  "reconciliation",
] as const;

export type LinkrQueueStage = (typeof LINKR_QUEUE_STAGES)[number];

export interface QueuePointer {
  schema_version: 1;
  work_item_id: string;
  state_version: number;
  route: string;
  resource_sequence: number | null;
  dispatch_generation: number;
  enqueued_at: string;
}

export interface CanonicalWorkItem {
  id: string;
  idempotency_key: string;
  source_surface: string;
  source_event_id: string | null;
  user_id: string | null;
  conversation_id: string | null;
  request_type: string;
  route: string;
  state: string;
  priority: number;
  resource_type: string | null;
  resource_key: string | null;
  resource_sequence: number | null;
  state_version: number;
  dispatch_generation: number;
  attempt_count: number;
  payload: Record<string, unknown> | null;
  payload_ref: string | null;
  payload_hash: string | null;
  trace_id: string;
  consumer_version: string;
  execution_generation: number;
}

export interface StageClaim {
  message_id: number;
  work_item: CanonicalWorkItem;
  resource_fencing_token: number | null;
  visibility_deadline: string;
  redelivered?: boolean;
}

export interface StageSlot {
  stage: LinkrQueueStage;
  slot_number: number;
  fencing_token: number;
  lease_expires_at: string;
}

export function isLinkrQueueStage(value: unknown): value is LinkrQueueStage {
  return typeof value === "string" &&
    (LINKR_QUEUE_STAGES as readonly string[]).includes(value);
}

// Stage -> edge worker function name. Authoritative source is the
// public.linkr_queue_runtime_config.worker_function column; this map mirrors it
// so the edge fast-handoff can target the correct worker without a DB round-trip.
// Keep in lockstep with the runtime_config seed/updates in supabase/migrations.
// The Record type forces exhaustiveness across every LinkrQueueStage at compile time.
export const LINKR_STAGE_WORKER_FUNCTIONS: Record<LinkrQueueStage, string> = {
  x_ingress: "worker-x-ingress",
  telegram_control: "worker-telegram-control",
  conversation_turns_high: "worker-conversation-turn",
  conversation_turns_normal: "worker-conversation-turn",
  command_prepare: "worker-command-prepare",
  launch_enrich: "worker-launch-enrich",
  media_capture: "worker-media-capture",
  image_generate: "worker-image-generate",
  nft_solana: "worker-nft-solana",
  action_solana: "worker-action-solana",
  action_robinhood: "worker-action-robinhood",
  launch_solana: "worker-launch-solana",
  launch_robinhood: "worker-launch-robinhood",
  confirm_solana: "worker-confirm-solana",
  confirm_robinhood: "worker-confirm-robinhood",
  reply_x_high: "worker-reply-x",
  reply_x_normal: "worker-reply-x",
  reply_telegram_high: "worker-reply-telegram",
  reply_telegram_normal: "worker-reply-telegram",
  reconciliation: "worker-reconcile",
};

// Exact TypeScript mirror of the database function
// public.linkr_queue_for_route(text, smallint). It resolves the stage a work item
// is enqueued into for a given route + priority, so edge fast-handoff wakes the
// identical stage the completion RPC targeted. This MUST stay byte-for-byte
// equivalent to the SQL CASE in
// supabase/migrations/20260722181000_autonomous_launch_acceptance.sql
// (priority >= 80 selects the high-priority lane). Returns null for unknown routes.
export function linkrQueueForRoute(
  route: string,
  priority: number,
): LinkrQueueStage | null {
  const high = Number.isFinite(priority) && priority >= 80;
  switch (route) {
    case "x.ingress":
      return "x_ingress";
    case "telegram.control":
      return "telegram_control";
    case "conversation.turn":
      return high ? "conversation_turns_high" : "conversation_turns_normal";
    case "command.prepare":
      return "command_prepare";
    case "launch.enrich":
      return "launch_enrich";
    case "media.capture":
      return "media_capture";
    case "image.generate":
      return "image_generate";
    case "action.solana":
      return "action_solana";
    case "action.robinhood":
      return "action_robinhood";
    case "launch.solana":
      return "launch_solana";
    case "launch.robinhood":
      return "launch_robinhood";
    case "confirm.solana":
      return "confirm_solana";
    case "confirm.robinhood":
      return "confirm_robinhood";
    case "reply.x":
      return high ? "reply_x_high" : "reply_x_normal";
    case "reply.telegram":
      return high ? "reply_telegram_high" : "reply_telegram_normal";
    case "reconciliation":
      return "reconciliation";
    default:
      return null;
  }
}

export function parseQueuePointer(value: unknown): QueuePointer {
  if (!value || typeof value !== "object") {
    throw new Error("invalid_queue_pointer");
  }
  const pointer = value as Record<string, unknown>;
  if (pointer.schema_version !== QUEUE_SCHEMA_VERSION) {
    throw new Error("unsupported_queue_schema");
  }
  if (!isUuid(pointer.work_item_id)) {
    throw new Error("invalid_queue_work_item_id");
  }
  if (
    !isSafeInteger(pointer.state_version) || Number(pointer.state_version) < 0
  ) {
    throw new Error("invalid_queue_state_version");
  }
  if (
    typeof pointer.route !== "string" || !pointer.route ||
    pointer.route.length > 80
  ) {
    throw new Error("invalid_queue_route");
  }
  if (
    pointer.resource_sequence !== null &&
    (!isSafeInteger(pointer.resource_sequence) ||
      Number(pointer.resource_sequence) < 1)
  ) {
    throw new Error("invalid_queue_resource_sequence");
  }
  if (
    !isSafeInteger(pointer.dispatch_generation) ||
    Number(pointer.dispatch_generation) < 0
  ) {
    throw new Error("invalid_queue_dispatch_generation");
  }
  if (
    typeof pointer.enqueued_at !== "string" ||
    !Number.isFinite(Date.parse(pointer.enqueued_at))
  ) {
    throw new Error("invalid_queue_enqueued_at");
  }
  const serialized = JSON.stringify(pointer);
  if (
    new TextEncoder().encode(serialized).byteLength > QUEUE_MESSAGE_MAX_BYTES
  ) {
    throw new Error("queue_message_too_large");
  }
  return pointer as unknown as QueuePointer;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function isSafeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value);
}
