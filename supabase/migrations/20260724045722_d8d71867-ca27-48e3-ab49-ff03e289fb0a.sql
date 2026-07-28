UPDATE public.linkr_worker_capacity_slots
SET lease_owner = NULL,
    lease_expires_at = NULL,
    work_item_id = NULL,
    fencing_token = fencing_token + 1,
    updated_at = now()
WHERE stage = 'command_prepare';

UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_request_id = NULL,
    updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');

SELECT public.run_linkr_queue_controller_tick();