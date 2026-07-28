
UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    circuit_open_until = NULL,
    consecutive_failure_count = 0,
    last_error_code = NULL,
    last_status_code = 200,
    wake_generation = wake_generation + 1,
    updated_at = now()
WHERE stage = 'nft_solana';

UPDATE public.linkr_work_items
SET state = 'queued',
    consumer_version = 'worker-nft-solana-v3',
    attempt_count = 0,
    next_attempt_at = NULL,
    lease_expires_at = NULL,
    active_queue_name = NULL,
    active_message_id = NULL,
    last_error_code = NULL,
    updated_at = now()
WHERE route = 'nft.solana'
  AND state IN ('queued', 'retryable', 'in_progress');

SELECT public.request_linkr_stage_wake('nft_solana');
