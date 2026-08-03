// deno-lint-ignore-file no-explicit-any
// Channel-neutral Linkr runtime contracts.

export type LinkrSurface =
  | "terminal"
  | "cli"
  | "telegram"
  | "sms"
  | "x"
  | "cron"
  | "agent_api"
  | "future";

export type LinkrStatusEvent =
  | "ack"
  | "typing"
  | "context_loading"
  | "route"
  | "tool_start"
  | "tool_result"
  | "delta"
  | "source_ref"
  | "action_draft"
  | "action_required"
  | "execution_start"
  | "execution_status"
  | "receipt"
  | "memory_update"
  | "complete"
  | "error";

export interface LinkrTurnInput {
  surface: LinkrSurface;
  surface_conversation_id: string;
  source_message_id?: string | null;
  user_id: string;
  text: string;
  actor: {
    kind:
      | "authenticated_user"
      | "telegram_user"
      | "sms_user"
      | "x_user"
      | "system_job";
    user_id?: string | null;
    twitter_id?: string | null;
    twitter_username?: string | null;
    display_name?: string | null;
  };
  transport: {
    kind:
      | "terminal_sse"
      | "cli_sse"
      | "telegram_reply"
      | "sms_reply"
      | "x_reply"
      | "cron_job"
      | "api";
    public_output: boolean;
    supports_streaming: boolean;
    max_response_chars?: number;
  };
  conversation?: {
    terminal_conversation_id?: string | null;
    x_thread_id?: string | null;
    cron_job_id?: string | null;
    user_message_id?: string | null;
    assistant_message_id?: string | null;
    run_id?: string | null;
  };
  attachments?: Array<{
    kind: "image" | "url";
    source_url: string;
    storage_path?: string;
    mime_type?: string;
    width?: number;
    height?: number;
    byte_length?: number;
  }>;
  source_refs?: LinkrSourceRefInput[];
  client_context?: {
    timezone?: string;
    route?: string;
    selected_chain?: "robinhood" | "solana" | "all";
    current_page?: string;
    focused_token?: string | null;
    focused_launch_id?: string | null;
  };
  x_context?: {
    tweet_id?: string | null;
    author_handle?: string | null;
    thread_context?: Record<string, unknown> | null;
  };
  cron_context?: {
    job_id?: string | null;
    schedule_id?: string | null;
    trigger_reason?: string | null;
  };
}

export interface LinkrSourceRefInput {
  ref_type:
    | "x_post"
    | "x_thread"
    | "x_user"
    | "linkr_coin"
    | "token"
    | "launch"
    | "transaction"
    | "pending_action"
    | "liquidity_position"
    | "media"
    | "external_url";
  ref_key: string;
  url?: string | null;
  label?: string | null;
  payload?: Record<string, unknown>;
  privacy_label?:
    | "public"
    | "user_private"
    | "recipient_public"
    | "external_untrusted";
}

export interface LinkrTurnOutputSink {
  setStatus(status: string, metadata?: Record<string, unknown>): Promise<void>;
  emit(
    event: LinkrStatusEvent | string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  appendAssistantDelta(delta: string): Promise<void>;
  setAssistantMessage(args: {
    content: string;
    parts?: unknown[];
    status: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  addMessagePart?(part: Record<string, unknown>): Promise<void>;
  addSourceRef?(sourceRef: Record<string, unknown>): Promise<void>;
  createPendingActionCard(payload: Record<string, unknown>): Promise<void>;
  finalize(result: LinkrTurnResult): Promise<void>;
}

export interface LinkrTurnResult {
  status: "completed" | "awaiting_confirmation" | "failed" | "cancelled";
  route: string;
  surface: LinkrSurface;
  assistant_message_id?: string;
  run_id: string;
  pending_action_ids?: string[];
  action_job_ids?: string[];
  memory_event_ids?: string[];
}

export interface LinkrRuntimeContext {
  admin: any;
  input: LinkrTurnInput;
  sink: LinkrTurnOutputSink;
  run_id: string;
}
