UPDATE public.linkr_work_items
SET state = 'queued',
    attempt_count = 0,
    last_error_code = NULL,
    result_ref = NULL,
    terminal_at = NULL,
    started_at = NULL,
    lease_expires_at = NULL,
    active_message_id = NULL,
    next_attempt_at = now(),
    consumer_version = 'worker-nft-solana-v3'
WHERE route = 'nft.solana'
  AND state IN ('failed','rejected')
  AND updated_at > now() - interval '6 hours';

DO $$
BEGIN
  IF to_regprocedure('public.clear_stale_linkr_dispatches_v1()') IS NOT NULL THEN
    PERFORM public.clear_stale_linkr_dispatches_v1();
  ELSE
    RAISE NOTICE 'Skipping stale dispatch cleanup; clear_stale_linkr_dispatches_v1() is absent.';
  END IF;
END $$;

SELECT public.request_linkr_stage_wake('nft_solana');
SELECT public.dispatch_ready_linkr_workers();
