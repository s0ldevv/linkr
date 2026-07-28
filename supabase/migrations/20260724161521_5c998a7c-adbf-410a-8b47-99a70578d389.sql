DO $$
BEGIN
  IF to_regprocedure('public.linkr_reconcile_resource_heads_v2()') IS NOT NULL THEN
    PERFORM public.linkr_reconcile_resource_heads_v2();
  ELSIF to_regprocedure('public.linkr_reconcile_resource_heads_v1(integer)') IS NOT NULL THEN
    PERFORM public.linkr_reconcile_resource_heads_v1(50);
  ELSE
    RAISE NOTICE 'Skipping resource-head reconciliation; no compatible reconcile function exists.';
  END IF;
END $$;

SELECT public.request_linkr_stage_wake('nft_solana');
