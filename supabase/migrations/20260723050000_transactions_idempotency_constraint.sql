-- Fix transactions table idempotency constraint for upsert operations
-- Migration: 20260723050000_transactions_idempotency_constraint.sql
-- 
-- PROBLEM:
-- The transactions table has a partial unique index on idempotency_key:
--   CREATE UNIQUE INDEX transactions_idempotency_key_unique 
--   ON public.transactions (idempotency_key) 
--   WHERE idempotency_key IS NOT NULL;
--
-- The application code uses Supabase's .upsert() with { onConflict: "idempotency_key" },
-- which translates to PostgreSQL's INSERT ... ON CONFLICT (idempotency_key) DO UPDATE.
--
-- PostgreSQL requires either:
--   1. A unique CONSTRAINT (not just an index), OR
--   2. A unique index that exactly matches the conflict specification
--
-- Partial indexes CANNOT be used for ON CONFLICT because:
--   - The WHERE predicate means NULL values aren't indexed
--   - PostgreSQL cannot guarantee conflict detection for all possible inserts
--   - This causes: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- SOLUTION:
-- Replace the partial unique index with a full unique constraint.
-- This enables both X bot (@linkrcash) and Agent API (/api/trade) swap execution to work.

-- Step 1: Backfill NULL idempotency_key values with generated unique keys
-- This ensures no rows will violate the upcoming NOT NULL constraint
-- Uses a deterministic pattern: 'backfill_' + id + '_' + epoch timestamp
UPDATE public.transactions
SET idempotency_key = 'backfill_' || id::text || '_' || EXTRACT(EPOCH FROM created_at)::bigint::text
WHERE idempotency_key IS NULL;

-- Step 2: Verify no duplicate non-NULL idempotency_key values exist
-- This query should return 0 rows. If it returns rows, the migration will fail safely.
-- Duplicates would indicate a pre-existing data integrity issue that must be resolved first.
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT idempotency_key
    FROM public.transactions
    WHERE idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot add unique constraint: found % duplicate idempotency_key values. Manual cleanup required.', duplicate_count;
  END IF;
END $$;

-- Step 3: Replace the old partial unique index with a full unique constraint
-- This enforces idempotency at the database level for all swap/transfer/burn operations
-- Both X bot and Agent API paths rely on this for duplicate prevention
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND conname = 'transactions_idempotency_key_unique'
  ) THEN
    DROP INDEX IF EXISTS public.transactions_idempotency_key_unique;

    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_idempotency_key_unique
    UNIQUE (idempotency_key);
  END IF;
END $$;

-- Step 4: Set NOT NULL constraint
-- Ensures all future transactions must have an idempotency_key
-- This is critical for the idempotency guarantee to work
ALTER TABLE public.transactions 
ALTER COLUMN idempotency_key SET NOT NULL;

-- Step 5: Add documentation
COMMENT ON CONSTRAINT transactions_idempotency_key_unique ON public.transactions IS 
  'Ensures idempotent swap/transfer/burn execution - prevents duplicate transactions from the same request. Used by both X bot (@linkrcash) and Agent API (/api/trade).';

COMMENT ON COLUMN public.transactions.idempotency_key IS 
  'Unique identifier for idempotent request processing. Format: <source>-<identifier> (e.g., "x-trade:<tweet_id>", "agent-sol-trade:<api_key_id>:<idempotency_key>", "token-burn-transaction:<user_id>:<mint>"). Required for all transactions.';

-- Verification: Log the number of rows affected by the backfill
DO $$
DECLARE
  backfill_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backfill_count
  FROM public.transactions
  WHERE idempotency_key LIKE 'backfill_%';
  
  SELECT COUNT(*) INTO total_count
  FROM public.transactions;
  
  RAISE NOTICE 'Migration complete: backfilled % idempotency_key values out of % total transactions.', backfill_count, total_count;
END $$;
