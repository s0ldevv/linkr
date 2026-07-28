UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    circuit_open_until = NULL,
    consecutive_failure_count = 0,
    required_consumer_version = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_status_code = NULL,
    last_error_code = NULL,
    updated_at = now()
WHERE stage = 'nft_solana';

UPDATE public.linkr_worker_capacity_slots
SET lease_owner = NULL,
    lease_expires_at = NULL,
    work_item_id = NULL,
    fencing_token = fencing_token + 1,
    updated_at = now()
WHERE stage = 'nft_solana';

SELECT public.request_linkr_stage_wake('nft_solana');