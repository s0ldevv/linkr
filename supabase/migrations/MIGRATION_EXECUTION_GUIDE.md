# Production Migration Execution Guide
## Fix: transactions table idempotency constraint for swap execution

**Migration ID:** `20260723050000_transactions_idempotency_constraint`  
**Date:** 2026-07-23  
**Impact:** Enables swap execution for both X bot (@linkrbot) and Agent API (/api/trade)  
**Risk Level:** LOW (read-only check before write, fails safely on duplicates)  
**Downtime:** NONE (online migration, no table locks beyond row-level updates)

---

## Executive Summary

**Problem:** The `transactions` table has a partial unique index on `idempotency_key`, but the application code uses PostgreSQL's `INSERT ... ON CONFLICT` (via Supabase `.upsert()`), which requires a full unique constraint. This causes all swap operations to fail with:

> "Couldn't complete that command: there is no unique or exclusion constraint matching the ON CONFLICT specification"

**Solution:** Replace the partial unique index with a full unique constraint and NOT NULL column constraint.

**Affected Systems:**
- ✅ X bot swap execution (`@linkrbot buy/sell` commands)
- ✅ Agent API swap execution (`POST /api/trade`)
- ✅ Token burn execution (records burn transactions)

---

## Pre-Migration Checklist

### 1. Verify Current State

Run these queries to understand the current state:

```sql
-- Check current index exists
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE indexname = 'transactions_idempotency_key_unique';

-- Check for NULL idempotency_key values
SELECT COUNT(*) as null_count 
FROM public.transactions 
WHERE idempotency_key IS NULL;

-- Check for duplicate idempotency_key values (should be 0)
SELECT idempotency_key, COUNT(*) as count
FROM public.transactions 
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key 
HAVING COUNT(*) > 1;

-- Get total row count
SELECT COUNT(*) as total_transactions 
FROM public.transactions;
```

**Expected Results:**
- Index exists with `WHERE idempotency_key IS NOT NULL` predicate
- NULL count: Some number (will be backfilled)
- Duplicates: 0 rows (migration will fail safely if > 0)
- Total count: Record for post-migration comparison

### 2. Backup (Optional but Recommended)

```bash
# Export transactions table to CSV
psql -h <host> -U postgres -d postgres \
  -c "\COPY public.transactions TO STDOUT WITH CSV HEADER" \
  > transactions_backup_$(date +%Y%m%d_%H%M%S).csv
```

### 3. Schedule Migration

- **Best Time:** Low-traffic period (though migration is online and safe)
- **Duration:** < 1 minute for typical table sizes (< 1M rows)
- **Rollback:** Possible but requires manual intervention (see Rollback Plan)

---

## Migration Execution

### Step 1: Apply Migration

```bash
# Using Supabase CLI
supabase db push

# OR using psql directly
psql -h <host> -U postgres -d postgres \
  -f supabase/migrations/20260723050000_transactions_idempotency_constraint.sql
```

### Step 2: Monitor Migration Output

The migration will output:
```
NOTICE: Migration complete: backfilled X idempotency_key values out of Y total transactions.
```

**Success Indicators:**
- No errors during execution
- NOTICE message shows backfill count
- Command exits with code 0

**Failure Modes (Safe):**
- `ERROR: Cannot add unique constraint: found X duplicate idempotency_key values`
  - **Action:** Stop! Do not proceed. Investigate duplicates manually.
  - **Cause:** Pre-existing data integrity issue
  - **Resolution:** Clean up duplicates before retrying

---

## Post-Migration Verification

### Step 1: Run Verification Script

```bash
psql -h <host> -U postgres -d postgres \
  -f supabase/migrations/20260723050100_verify_transactions_constraint.sql
```

**Expected Output:**
```
Migration Status    | ✓ PASSED
Index Dropped       | ✓ PASSED
NOT NULL Constraint | ✓ PASSED
No NULL Values      | ✓ PASSED
No Duplicates       | ✓ PASSED
```

### Step 2: Functional Testing

#### Test 1: X Bot Buy Command
```
Tweet: "@linkrbot buy 0.03 SOL worth of Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump"
Expected:
- Bot replies within 60 seconds
- Reply includes explorer URL
- Transaction appears in `transactions` table with:
  - source_surface = 'x'
  - idempotency_key = 'x-trade:<tweet_id>'
  - status = 'submitted' or 'confirmed'
```

#### Test 2: Agent API Buy
```bash
curl -X POST https://<domain>/api/trade \
  -H "Authorization: Bearer <api_key>" \
  -H "Idempotency-Key: test-123" \
  -H "Content-Type: application/json" \
  -d '{
    "side": "buy",
    "amount_sol": 0.01,
    "token_mint": "Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump",
    "chain": "solana"
  }'
```
Expected:
- HTTP 200 response
- Transaction recorded with `source_surface = 'agent_api'`

#### Test 3: Idempotency (Duplicate Prevention)
```bash
# Send same request twice
curl -X POST ... (same as above, same Idempotency-Key)
```
Expected:
- Second request returns existing transaction (no duplicate execution)

---

## Rollback Plan

If issues arise after migration:

### Step 1: Drop Constraint
```sql
ALTER TABLE public.transactions 
DROP CONSTRAINT IF EXISTS transactions_idempotency_key_unique;
```

### Step 2: Recreate Partial Index
```sql
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_key_unique
  ON public.transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### Step 3: Remove NOT NULL Constraint
```sql
ALTER TABLE public.transactions 
ALTER COLUMN idempotency_key DROP NOT NULL;
```

**Note:** Backfilled `idempotency_key` values will remain (this is safe).

### Step 4: Investigate Issues
- Check application logs for new errors
- Review recent transactions for anomalies
- Test swap execution manually

---

## Monitoring

### Key Metrics to Watch

1. **Swap Success Rate**
   ```sql
   SELECT 
     DATE(created_at) as date,
     source_surface,
     COUNT(*) as total,
     COUNT(*) FILTER (WHERE status = 'confirmed') as successful,
     ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'confirmed') / COUNT(*), 2) as success_pct
   FROM public.transactions 
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY DATE(created_at), source_surface
   ORDER BY date DESC, source_surface;
   ```

2. **Error Rate by Source**
   ```sql
   SELECT 
     source_surface,
     COUNT(*) as error_count
   FROM public.transactions 
   WHERE error IS NOT NULL 
     AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY source_surface;
   ```

3. **Constraint Violations** (should be 0)
   ```sql
   SELECT COUNT(*) as violation_count
   FROM public.transactions 
   WHERE idempotency_key IS NULL;
   ```

### Alerting

Set up alerts for:
- ❌ Any NULL `idempotency_key` values (should be impossible after migration)
- ❌ Swap success rate drops below 95%
- ❌ Error rate increases > 2x baseline

---

## Files Modified

| File | Purpose |
|------|---------|
| `supabase/migrations/20260723050000_transactions_idempotency_constraint.sql` | Main migration |
| `supabase/migrations/20260723050100_verify_transactions_constraint.sql` | Verification queries |
| `supabase/migrations/MIGRATION_EXECUTION_GUIDE.md` | This guide |

**Code Changes:** NONE - existing application code is correct.

---

## Success Criteria

✅ **Immediate (Post-Migration):**
- [ ] Constraint exists and is enforced
- [ ] Old index is dropped
- [ ] No NULL `idempotency_key` values
- [ ] No duplicate `idempotency_key` values
- [ ] Verification script shows all PASSED

✅ **Short-Term (24 hours):**
- [ ] X bot swap commands execute successfully
- [ ] Agent API swap requests execute successfully
- [ ] No new errors in application logs
- [ ] Swap success rate ≥ 95%

✅ **Long-Term (7 days):**
- [ ] Zero constraint violations
- [ ] Idempotency working (no duplicate executions)
- [ ] User complaints about swap failures resolved

---

## Support Contacts

- **Database Admin:** [Contact]
- **Backend Lead:** [Contact]
- **On-Call Engineer:** [Contact]

---

## Appendix: Technical Details

### Why Partial Indexs Don't Work with ON CONFLICT

PostgreSQL's `INSERT ... ON CONFLICT` requires the conflict target (columns) to have a unique constraint or index that covers ALL possible insert values. A partial index with `WHERE idempotency_key IS NOT NULL` cannot be used because:

1. **NULL values aren't indexed** - The index doesn't contain entries for NULL `idempotency_key`
2. **Conflict detection incomplete** - PostgreSQL can't guarantee it will detect all conflicts
3. **Predicate mismatch** - The `ON CONFLICT (idempotency_key)` doesn't specify the WHERE predicate

### How the Migration Works

1. **Backfill NULLs:** Generate unique keys for existing NULL rows
2. **Check Duplicates:** Abort if any duplicates found (safe failure)
3. **Add Constraint:** Create unique constraint (automatically creates index)
4. **Set NOT NULL:** Enforce idempotency_key required for all rows
5. **Drop Old Index:** Remove redundant partial index
6. **Document:** Add comments for future maintainers

### Idempotency Key Formats

| Source | Format | Example |
|--------|--------|---------|
| X Bot | `x-trade:{tweet_id}` | `x-trade:1234567890` |
| Agent API (Solana) | `agent-sol-trade:{api_key_id}:{idempotency_key}` | `agent-sol-trade:abc123:unique-key` |
| Agent API (EVM) | `agent-evm-trade:{api_key_id}:{idempotency_key}` | `agent-evm-trade:abc123:unique-key` |
| Token Burn | `token-burn-transaction:{idempotency_key}` | `token-burn-transaction:user123:mint456` |
| Backfill | `backfill_{id}_{epoch}` | `backfill_550e8400-e29b-41d4-a716-446655440000_1721764800` |

---

**Last Updated:** 2026-07-23  
**Version:** 1.0  
**Status:** READY FOR EXECUTION
