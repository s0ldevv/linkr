# 🚀 QUICK START: Fix Swap Execution

## ⚡ 30-Second Summary

**Problem:** Swaps fail with "no unique or exclusion constraint matching the ON CONFLICT specification"  
**Fix:** Apply migration `20260723050000_transactions_idempotency_constraint.sql`  
**Time:** < 1 minute  
**Risk:** LOW (fails safely, no data loss)  
**Downtime:** NONE

---

## ✅ Execute (3 Steps)

### 1. Apply Migration
```bash
cd D:\apps\x-wallet-agent
supabase db push
```

### 2. Verify Success
```bash
psql -h <host> -U postgres -d postgres \
  -f supabase/migrations/20260723050100_verify_transactions_constraint.sql
```
**Look for:** All 5 checks show `✓ PASSED`

### 3. Test Swap
Tweet: `@linkrcash buy 0.03 SOL worth of Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump`

**Expected:** Bot replies with explorer URL within 60 seconds

---

## 🚨 If It Fails

**Error:** "Cannot add unique constraint: found X duplicate idempotency_key values"

**Action:** STOP. Do not proceed. Contact backend team.

**Cause:** Pre-existing data integrity issue (should be 0 duplicates)

---

## 📋 Pre-Flight Check (Optional)

```sql
-- Check current state
SELECT COUNT(*) as null_count FROM public.transactions WHERE idempotency_key IS NULL;
SELECT COUNT(*) as duplicate_count FROM (
  SELECT idempotency_key FROM public.transactions 
  WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*) > 1
) d;
```

**Expected:** Some NULLs (will be backfilled), 0 duplicates

---

## 📚 Full Documentation

- **Detailed Guide:** `MIGRATION_EXECUTION_GUIDE.md`
- **Migration SQL:** `20260723050000_transactions_idempotency_constraint.sql`
- **Verification SQL:** `20260723050100_verify_transactions_constraint.sql`

---

## 🎯 Success Criteria

- ✅ Constraint exists (`transactions_idempotency_key_unique`)
- ✅ Old index dropped
- ✅ No NULL `idempotency_key` values
- ✅ No duplicate `idempotency_key` values
- ✅ X bot swaps work
- ✅ Agent API swaps work

---

## 🔍 Post-Migration Monitoring

```sql
-- Check swap success rate (should be >95%)
SELECT 
  source_surface,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'confirmed') as success,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'confirmed') / COUNT(*), 2) as success_pct
FROM public.transactions 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY source_surface;
```

---

**Questions?** See `MIGRATION_EXECUTION_GUIDE.md` for full details.
