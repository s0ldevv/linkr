-- Enable the Solana launch execution pipeline so first launches are actually
-- processed and funded from SOL_FUNDING_WALLET. 20260722174000 reset
-- launch-stage rollout to 0 for the worker cutover and 20260722182000 only
-- re-enabled the preparation stages; without this, worker-launch-solana
-- returns solana_launch_rollout_pending forever and the first-launch subsidy
-- never runs. Reply and reconciliation stages are enabled alongside so launch
-- receipts, paused-for-funds prompts, and ambiguous broadcasts are handled.

update public.linkr_queue_runtime_config set
  consumer_version = case stage
    when 'launch_solana' then 'worker-launch-solana-v1'
    when 'confirm_solana' then 'worker-confirm-solana-v1'
    when 'reply_x_high' then 'worker-reply-x-v2'
    when 'reply_x_normal' then 'worker-reply-x-v2'
    when 'reconciliation' then 'worker-reconcile-v2'
    else consumer_version end,
  enabled = true,
  batch_size = 1,
  max_concurrency = 1,
  rollout_percent = 100,
  updated_at = now()
where stage in (
  'launch_solana', 'confirm_solana',
  'reply_x_high', 'reply_x_normal', 'reconciliation'
);

update public.linkr_dispatch_stage_state set
  state = 'idle', required_consumer_version = null,
  circuit_open_until = null, last_error_code = null,
  updated_at = now()
where stage in (
  'launch_solana', 'confirm_solana',
  'reply_x_high', 'reply_x_normal', 'reconciliation'
);

-- launch_robinhood/confirm_robinhood stay gated (rollout 0) on purpose; this
-- migration only opens the Solana path.
