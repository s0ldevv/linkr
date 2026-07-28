UPDATE public.linkr_work_items
SET state = 'retryable',
    active_queue_name = NULL,
    active_message_id = NULL,
    lease_expires_at = NULL,
    next_attempt_at = now(),
    last_error_code = 'nft_queue_reenqueue_after_shape_fix',
    last_progress_at = now(),
    updated_at = now()
WHERE id IN ('147ec2db-1921-4091-9b4f-ec898a20431f'::uuid, 'b61b66ba-4f40-4b52-9b12-d466aaef12b7'::uuid)
  AND route = 'command.prepare'
  AND state IN ('queued', 'retryable', 'leased');

SELECT public.linkr_enqueue_work_item(id, 0)
FROM public.linkr_work_items
WHERE id IN ('147ec2db-1921-4091-9b4f-ec898a20431f'::uuid, 'b61b66ba-4f40-4b52-9b12-d466aaef12b7'::uuid)
  AND route = 'command.prepare'
  AND state IN ('queued', 'retryable');

UPDATE public.linkr_worker_capacity_slots
SET lease_owner = NULL,
    lease_expires_at = NULL,
    work_item_id = NULL,
    fencing_token = fencing_token + 1,
    updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');

UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_request_id = NULL,
    updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');

SELECT public.run_linkr_queue_controller_tick();