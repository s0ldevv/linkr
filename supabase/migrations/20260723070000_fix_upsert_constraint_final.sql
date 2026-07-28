-- Final idempotency constraint guard for transactions.
-- This migration is intentionally idempotent because previous repair attempts
-- may have already converted the partial index into a full unique constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND conname = 'transactions_idempotency_key_unique'
      AND contype = 'u'
  ) THEN
    DROP INDEX IF EXISTS public.transactions_idempotency_key_unique;

    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_idempotency_key_unique
    UNIQUE (idempotency_key);
  END IF;
END $$;

ALTER TABLE public.transactions
ALTER COLUMN idempotency_key SET NOT NULL;

COMMENT ON CONSTRAINT transactions_idempotency_key_unique ON public.transactions IS
  'Unique constraint enabling idempotent swap operations. Required for Supabase .upsert() with onConflict: "idempotency_key". Prevents duplicate transaction execution from the same request.';

COMMENT ON COLUMN public.transactions.idempotency_key IS
  'Unique identifier for idempotent request processing. Format varies by source: "x-trade:<tweet_id>" for X bot, "agent-sol-trade:<api_key_id>:<key>" for Agent API, "token-burn-transaction:<key>" for burns. Required for all transactions.';

DO $$
DECLARE
  v_constraint_count integer;
  v_partial_index_count integer;
  v_null_count integer;
  v_total_count integer;
BEGIN
  SELECT count(*) INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.transactions'::regclass
    AND conname = 'transactions_idempotency_key_unique'
    AND contype = 'u';

  SELECT count(*) INTO v_partial_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'transactions'
    AND indexname = 'transactions_idempotency_key_unique'
    AND indexdef ILIKE '%WHERE%idempotency_key IS NOT NULL%';

  SELECT count(*) INTO v_null_count
  FROM public.transactions
  WHERE idempotency_key IS NULL;

  SELECT count(*) INTO v_total_count
  FROM public.transactions;

  IF v_constraint_count <> 1 THEN
    RAISE EXCEPTION 'transactions idempotency unique constraint was not created';
  END IF;

  IF v_partial_index_count <> 0 THEN
    RAISE EXCEPTION 'old partial transactions idempotency index still exists';
  END IF;

  IF v_null_count <> 0 THEN
    RAISE EXCEPTION 'transactions.idempotency_key has % null values', v_null_count;
  END IF;

  RAISE NOTICE 'Transactions idempotency final verification passed for % rows.', v_total_count;
END $$;
