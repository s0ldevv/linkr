UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_request_id = NULL,
    consecutive_failure_count = 0,
    circuit_open_until = NULL,
    required_consumer_version = NULL,
    last_status_code = NULL,
    last_error_code = NULL,
    updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');
SELECT public.request_linkr_stage_wake('command_prepare');
SELECT public.request_linkr_stage_wake('nft_solana');
SELECT public.run_linkr_queue_controller_tick();