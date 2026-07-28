UPDATE public.linkr_dispatch_stage_state
SET state = 'idle', last_request_id = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');
SELECT public.run_linkr_queue_controller_tick();