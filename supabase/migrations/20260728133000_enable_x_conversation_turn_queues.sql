-- Public X coin-opinion/conversation replies route through these stages.
-- They were disabled in the live queue config, which left routed mentions
-- stuck unread in pgmq.q_conversation_turns_normal.

update public.linkr_queue_runtime_config
set
  enabled = true,
  pause_reason = null,
  updated_at = now()
where stage in ('conversation_turns_high', 'conversation_turns_normal');

update public.linkr_dispatch_stage_state
set
  state = case when state = 'paused' then 'idle' else state end,
  circuit_open_until = null,
  consecutive_failure_count = 0,
  last_error_code = null,
  updated_at = now()
where stage in ('conversation_turns_high', 'conversation_turns_normal');
