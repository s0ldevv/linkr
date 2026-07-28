-- 1. Reply delivery worker version drift: config pinned v2 while deployed worker is v3,
-- which made every X reply dispatch fail with 409 and paused the reply stages.
UPDATE public.linkr_queue_runtime_config
SET consumer_version = 'worker-reply-x-v3', updated_at = now()
WHERE stage IN ('reply_x_high', 'reply_x_normal');

UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    circuit_open_until = NULL,
    consecutive_failure_count = 0,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
    required_consumer_version = NULL,
    updated_at = now()
WHERE stage IN ('reply_x_high', 'reply_x_normal');

-- 2. Solana transfer auto-cap defaulted to 0, so every X transfer command was
-- rejected as "cap disabled" and funds were never sent. Align it with the
-- existing 0.1 SOL auto-buy cap default.
ALTER TABLE public.profiles ALTER COLUMN max_auto_transfer_sol SET DEFAULT 0.1;

UPDATE public.profiles
SET max_auto_transfer_sol = 0.1, updated_at = now()
WHERE COALESCE(max_auto_transfer_sol, 0) = 0;