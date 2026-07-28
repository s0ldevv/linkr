DO $$
DECLARE
  v_work_item_id uuid := '834af29b-35b1-4727-9e09-a9e71b821f15'::uuid;
BEGIN
  IF to_regclass('pgmq.q_nft_solana') IS NOT NULL THEN
    DELETE FROM pgmq.q_nft_solana
    WHERE msg_id = 1;
  END IF;

  IF EXISTS (SELECT 1 FROM public.linkr_work_items WHERE id = v_work_item_id) THEN
    UPDATE public.linkr_work_items
    SET state = 'queued',
        active_queue_name = NULL,
        active_message_id = NULL,
        lease_expires_at = NULL,
        next_attempt_at = now(),
        last_error_code = 'nft_worker_redeployed_requeued',
        last_progress_at = now(),
        updated_at = now()
    WHERE id = v_work_item_id
      AND state IN ('queued', 'retryable', 'leased');

    PERFORM public.linkr_enqueue_work_item(v_work_item_id, 0);

    UPDATE public.linkr_dispatch_stage_state
    SET state = 'idle', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE stage = 'nft_solana';

    PERFORM public.request_linkr_stage_wake('nft_solana');
  ELSE
    RAISE NOTICE 'Skipping nft_solana historical work item replay; work item % is absent.', v_work_item_id;
  END IF;
END $$;
