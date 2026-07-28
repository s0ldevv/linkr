DO $$
BEGIN
  IF to_regprocedure('public.clear_stale_linkr_dispatches_v1()') IS NOT NULL THEN
    PERFORM public.clear_stale_linkr_dispatches_v1();
  ELSE
    RAISE NOTICE 'Skipping stale dispatch cleanup; clear_stale_linkr_dispatches_v1() is absent.';
  END IF;
END $$;

SELECT public.dispatch_ready_linkr_workers();
SELECT public.request_linkr_stage_wake('nft_solana');
