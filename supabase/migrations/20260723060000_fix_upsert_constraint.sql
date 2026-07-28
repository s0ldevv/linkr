-- Ensure the transactions idempotency key is enforced by a full unique constraint.
-- A unique constraint has a backing index with the same name, so do not try to
-- drop that index when the constraint already exists.

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
  'Unique constraint for idempotent operations. Used by Supabase .upsert() with onConflict: "idempotency_key".';

DO $$
DECLARE
  v_constraint_count integer;
  v_partial_index_count integer;
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

  IF v_constraint_count <> 1 THEN
    RAISE EXCEPTION 'transactions idempotency unique constraint does not exist';
  END IF;

  IF v_partial_index_count <> 0 THEN
    RAISE EXCEPTION 'old partial transactions idempotency index still exists';
  END IF;

  RAISE NOTICE 'Transactions idempotency upsert constraint is clean.';
END $$;
