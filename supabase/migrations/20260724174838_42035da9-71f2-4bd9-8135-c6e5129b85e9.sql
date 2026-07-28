UPDATE public.linkr_queue_runtime_config
SET consumer_version = 'worker-nft-solana-v4', updated_at = now()
WHERE stage = 'nft_solana';

UPDATE public.linkr_dispatch_stage_state
SET state = 'idle', circuit_open_until = NULL,
    required_consumer_version = NULL, consecutive_failure_count = 0,
    lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
WHERE stage = 'nft_solana';

UPDATE public.linkr_work_items
SET next_attempt_at = now()
WHERE id = '6e86ee10-1c52-41f8-9d56-7c206bd58141';