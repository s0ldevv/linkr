-- Post-migration verification for 20260723050000_transactions_idempotency_constraint.sql.
-- This file must be safe to run through Supabase migrations, so it performs
-- read-only checks and raises on failed invariants.

DO $$
DECLARE
  v_constraint_count integer;
  v_nullable text;
  v_null_count integer;
  v_duplicate_count integer;
  v_partial_index_count integer;
BEGIN
  SELECT count(*) INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.transactions'::regclass
    AND conname = 'transactions_idempotency_key_unique'
    AND contype = 'u';

  IF v_constraint_count <> 1 THEN
    RAISE EXCEPTION 'transactions idempotency unique constraint is missing';
  END IF;

  SELECT is_nullable INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'transactions'
    AND column_name = 'idempotency_key';

  IF v_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'transactions.idempotency_key is still nullable';
  END IF;

  SELECT count(*) INTO v_null_count
  FROM public.transactions
  WHERE idempotency_key IS NULL;

  IF v_null_count <> 0 THEN
    RAISE EXCEPTION 'transactions.idempotency_key still has % null values', v_null_count;
  END IF;

  SELECT count(*) INTO v_duplicate_count
  FROM (
    SELECT idempotency_key
    FROM public.transactions
    GROUP BY idempotency_key
    HAVING count(*) > 1
  ) duplicates;

  IF v_duplicate_count <> 0 THEN
    RAISE EXCEPTION 'transactions.idempotency_key still has % duplicate values', v_duplicate_count;
  END IF;

  SELECT count(*) INTO v_partial_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'transactions'
    AND indexname = 'transactions_idempotency_key_unique'
    AND indexdef ILIKE '%WHERE%idempotency_key IS NOT NULL%';

  IF v_partial_index_count <> 0 THEN
    RAISE EXCEPTION 'old partial transactions idempotency index still exists';
  END IF;

  RAISE NOTICE 'Transactions idempotency constraint verification passed.';
END $$;
