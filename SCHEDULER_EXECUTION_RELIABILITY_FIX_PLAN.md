# Scheduler Execution Reliability Fix Plan

Date: 2026-07-29  
Repo: `D:\apps\linkr-new`  
Area: `/app/scheduler`, scheduled action Edge Functions, Supabase scheduler tables, scheduler observability

## Objective

Make scheduled actions truly execute the requested user action and make the product state impossible to misread. A recurring buy should either:

1. Create a real transaction for the due occurrence and then schedule the next occurrence, or
2. Stay retryable / failed with a visible error and durable audit trail.

It should never silently advance to the next run in a way that looks successful while no action happened.

## Current Investigation Summary

The active hourly scheduled buy that matched the reported scenario did execute according to the database. The schedule then correctly moved back to `pending` because recurring schedules keep the parent schedule pending while waiting for the next occurrence.

Observed active schedule:

- Schedule id: `7a4d6e05-a476-4028-9f36-a0dc271cf04b`
- Action: `buy`
- Chain: `solana`
- Schedule kind: `interval`
- Interval: `3600` seconds
- Created: `2026-07-29T16:43:38Z` / `2026-07-29 12:43:38 America/Toronto`
- First due time: `2026-07-29T16:45:00Z` / `2026-07-29 12:45:00 America/Toronto`
- Execution completed: `2026-07-29T16:45:06Z` / `2026-07-29 12:45:06 America/Toronto`
- Next due time after execution: `2026-07-29T17:45:00Z` / `2026-07-29 13:45:00 America/Toronto`
- `occurrence_count`: `1`
- `successful_occurrence_count`: `1`
- `failed_occurrence_count`: `0`
- Parent schedule status after execution: `pending`
- Transaction status: `confirmed`
- Transaction amount: `0.005 SOL`
- Transaction id: `bb859e80-b031-486d-bea2-34674b42d2a1`
- Occurrence id: `00d9e168-c313-4398-8e88-4846d618cb12`
- Idempotency key shape: `scheduled-buy:<occurrence-id>`

Related cancelled schedule:

- Schedule id: `30b5e29c-defb-4d1f-aa00-9132740bba39`
- Action: `buy`
- Chain: `solana`
- Interval: `3600` seconds
- Status: `cancelled`
- `occurrence_count`: `0`

Conclusion: for the active schedule inspected, the backend did not skip the buy. The confusing product behavior is real, though: the scheduler UI and observability currently make a successful recurring execution look like a plain reschedule.

## Files Reviewed

- `src/routes/_authenticated.app.scheduler.tsx`
- `src/routes/_authenticated.app.actions.tsx`
- `src/routes/_authenticated.app.history.tsx`
- `src/routes/_authenticated.app.index.tsx`
- `supabase/functions/create-scheduled-action/index.ts`
- `supabase/functions/cron-process-scheduled-actions/index.ts`
- `supabase/functions/_shared/scheduler.ts`
- `supabase/functions/_shared/scheduler_test.ts`
- `supabase/functions/_shared/health.ts`
- `supabase/functions/_shared/cron_auth.ts`
- `supabase/functions/_shared/cron_lock.ts`
- `supabase/functions/agent-history/index.ts`
- `supabase/functions/agent-action-status/index.ts`
- `supabase/migrations/20260715130000_scheduled_actions.sql`
- `supabase/migrations/20260727220000_world_class_policy_scheduler_controls.sql`
- `supabase/migrations/20260727224000_scheduled_action_parity.sql`
- `supabase/migrations/20260727225000_scheduler_api_mutation_polish.sql`
- `supabase/migrations/20260710152000_operational_hardening.sql`

## Findings

### 1. The recurring schedule state is technically correct but product-confusing

`cron-process-scheduled-actions` executes the due occurrence, completes it, and then calls recurrence advancement. For recurring schedules, `markExecuted` updates the parent row back to:

- `status = pending`
- `scheduled_for = next due time`
- `last_execution_at = completed occurrence time`
- `transaction_id` / `transaction_hash` = latest transaction
- incremented occurrence counters

This means a successful recurring action does not stay `executed`. It becomes `pending` again because the next occurrence is waiting. The scheduler page currently emphasizes the parent `pending` status and next run more than the last successful occurrence, so users can reasonably conclude "it did not buy; it only rescheduled."

### 2. The scheduler page does not show occurrence history clearly enough

The database has `linkr_schedule_occurrences`, and the inspected occurrence was marked `succeeded` with a transaction id. The scheduler route mostly shows schedule rows, parent status, next run, and a short transaction hash. It does not provide a first-class "last run succeeded" state or an occurrence ledger per schedule.

The missing display layer is the biggest gap between actual backend behavior and what the user sees.

### 3. `/app/actions` has a Solana display bug that can hide the buy

`src/routes/_authenticated.app.actions.tsx` renders recent transactions with:

```tsx
<strong className="sm-mono">{tx.amount_eth ?? 0} ETH</strong>
```

For Solana buys, `amount_eth` is normally `null` and `amount_sol` contains the amount. A confirmed Solana scheduled buy can therefore appear as `0 ETH`, making it look like nothing was bought even when the transaction exists and is confirmed.

The history and dashboard routes already have better amount formatting logic. The actions route should share that behavior.

### 4. Health events do not durably preserve successful execution minutes

`record_system_health_event` only persists `ok` events when status changes or the sample interval has elapsed. Scheduler executions are recorded as `ok`, so a successful workful cron run can be visible in `system_health_latest` briefly and then replaced by later `no_work` runs without a durable event row for the execution minute.

That makes post-incident investigation harder than it should be. The occurrence and transaction rows provided proof this time, but scheduler worker logs should also preserve executions.

### 5. Interval creation semantics are ambiguous in the dashboard

The scheduler UI currently has both:

- `Run at`
- `Every seconds`

It initializes `Run at` to roughly one hour in the future and `Every seconds` to `3600`.

For interval schedules, the dashboard always sends `scheduled_for` along with `interval_seconds`. That makes the first run occur at the chosen `Run at` time, not necessarily immediately and not automatically "3600 seconds from now" unless the selected run time matches that intent. This is valid backend behavior, but the UI language can mislead users.

### 6. The backend should still enforce a no-false-success invariant

The inspected schedule did create a confirmed transaction, but the system should defensively guarantee that transaction-bearing scheduled actions cannot be marked executed and advanced unless the expected action result exists.

For buy / sell / transfer actions, success should require at least one durable proof:

- `transaction_id`
- transaction signature / hash
- confirmed persisted transaction row
- provider-specific completed order id, if applicable

If no proof exists, the occurrence should be retried or failed. It should not advance recurrence as a success.

## Fix Plan

### Phase 1: Backend execution invariants

Goal: make it impossible for a transaction-bearing scheduled action to silently advance without durable execution proof.

Tasks:

- Add a helper in `supabase/functions/cron-process-scheduled-actions/index.ts` such as `assertTransactionBackedSuccess(row, result)`.
- Apply it before `markExecuted` for buy, sell, and transfer action types.
- Require a persisted transaction id or transaction hash/signature for transaction-bearing success.
- If execution returns "success" without durable transaction proof, throw a retryable execution error.
- Store that error on the occurrence through the existing failure path.
- Ensure the parent schedule remains retryable until retry limits are exhausted.
- Preserve idempotency lookup by occurrence id so a retry can discover an already-created transaction instead of duplicating the trade.

Acceptance criteria:

- A tx-bearing scheduled action cannot call recurrence advancement unless there is transaction proof.
- Retried occurrences use the same occurrence id / idempotency key.
- Existing already-created transactions are reused safely on retry.

### Phase 2: Scheduler occurrence audit API

Goal: expose a clean, user-facing audit trail for each schedule.

Tasks:

- Add a read path for recent occurrences per schedule. Options:
  - Add an RPC like `get_linkr_schedule_occurrence_history_v1(schedule_ids uuid[], limit_per_schedule int)`.
  - Or query `linkr_schedule_occurrences` directly if current RLS and route patterns allow it safely.
- Return:
  - occurrence id
  - due time
  - started time
  - completed time
  - status
  - attempt count
  - transaction id
  - transaction hash/signature
  - error message, redacted where needed
- Join to `transactions` for amount, chain, status, and explorer URL where possible.
- Keep the payload small: latest 5 to 10 occurrences per schedule is enough for the scheduler page.

Acceptance criteria:

- The scheduler page can show the most recent occurrence for every visible recurring schedule.
- A failed or retried occurrence is visible without needing database access.
- The transaction linked to an occurrence can be opened from the UI.

### Phase 3: Scheduler UI state model

Goal: make recurring schedule state read like "last run + next run", not just "pending".

Tasks:

- Update `src/routes/_authenticated.app.scheduler.tsx` schedule cards/rows.
- For recurring schedules with `successful_occurrence_count > 0`, show:
  - Primary status: `Active`
  - Last run: `Succeeded <time>`
  - Next run: `<time>`
  - Transaction: short signature / hash with explorer link
- For failed recurring schedules, show:
  - Primary status: `Needs attention` or `Retrying`
  - Last error summary
  - Next retry / next run if applicable
- Keep parent schedule `pending` as an internal state, but do not present it as the main product status for recurring schedules.
- Add an expandable occurrence history section under each schedule.
- Add empty states:
  - "Waiting for first run"
  - "Last run succeeded"
  - "Retrying after failure"
  - "Stopped after end condition"

Acceptance criteria:

- After an hourly buy succeeds, the row says it succeeded and shows the next run.
- The user can verify the exact occurrence and transaction without leaving the scheduler page.
- A recurring parent schedule waiting for the next run no longer looks like it skipped the current run.

### Phase 4: Fix Solana transaction amount rendering in `/app/actions`

Goal: make scheduled Solana buys visible as real SOL transactions.

Tasks:

- Replace the ETH-only renderer in `src/routes/_authenticated.app.actions.tsx`.
- Introduce or reuse a shared transaction amount formatter that handles:
  - `amount_usd`
  - `amount_eth`
  - `amount_sol`
  - chain-specific native units
  - fallback to token amount if applicable
- For Solana transactions, show `0.005 SOL` instead of `0 ETH`.
- Add status and chain display near the amount so confirmed scheduled buys are obvious.

Acceptance criteria:

- The confirmed scheduled Solana buy found in this investigation would render as `0.005 SOL`.
- Ethereum transactions still render correctly.
- The formatter is covered by a focused unit test.

### Phase 5: Clarify interval scheduling semantics

Goal: prevent users from accidentally scheduling the first run later than intended.

Tasks:

- In the interval scheduler composer, replace ambiguous fields with:
  - `First run`: `Now`, `At date/time`, or `After first interval`
  - `Repeat every`: seconds/minutes/hours control
- If `First run = Now`, send `scheduled_for = now`.
- If `First run = After first interval`, either:
  - omit `scheduled_for` and let `buildTimeTrigger` compute `now + interval`, or
  - send an explicit computed `scheduled_for = now + interval`.
- If `First run = At date/time`, send that explicit time.
- Update review/confirmation copy before creation:
  - "First buy: today at 12:45 PM"
  - "Then every 1 hour"
- Keep API behavior backward compatible for existing clients.

Acceptance criteria:

- A user setting "buy every 3600 seconds" can clearly choose whether the first buy happens now or after one hour.
- The create request body reflects that choice.
- The schedule row mirrors the same wording after creation.

### Phase 6: Durable scheduler worker observability

Goal: make future incidents answerable from logs without reconstructing from several tables.

Tasks:

- Add a durable worker run event when cron claims or executes any work.
- Option A: extend `record_system_health_event` with a `force_persist` flag for workful `ok` scheduler runs.
- Option B: add a small `linkr_scheduler_worker_runs` table.
- Capture per run:
  - run id
  - started at
  - completed at
  - claimed count
  - executed count
  - succeeded count
  - failed count
  - requeued count
  - skipped count
  - lock status
  - error summary
- Keep no-work runs sampled to avoid noise.
- Always persist runs where `claimed > 0`, `executed > 0`, `failed > 0`, or `requeued > 0`.

Acceptance criteria:

- The 12:45 PM execution from this investigation would have a durable worker event.
- `system_health_latest` can still show the latest status.
- Historical investigation does not depend only on sampled `ok` events.

### Phase 7: Tests

Goal: cover both the recurrence engine and the product behaviors that made this confusing.

Backend tests:

- Add unit tests around transaction-backed scheduled success:
  - buy success with transaction id advances recurrence
  - buy success without transaction proof throws retryable error
  - retry discovers existing transaction by occurrence id idempotency key
  - recurring schedule remains `pending` after success with next due time
- Add tests for interval first-run semantics:
  - first run now
  - first run after interval
  - explicit first run time
- Add DB/RPC smoke test script:
  - create due interval schedule
  - claim it
  - begin occurrence
  - complete success
  - verify occurrence count, success count, next scheduled time, and transaction linkage

Frontend tests:

- Add amount formatter tests:
  - Solana amount renders as SOL
  - Ethereum amount renders as ETH
  - USD amount still wins when intended
- Add scheduler row tests:
  - recurring pending with successful occurrence renders as active / last succeeded / next run
  - first pending occurrence renders as waiting for first run
  - failed occurrence renders the error state

Manual staging smoke:

- Schedule a tiny Solana buy with first run now and repeat every 3600 seconds.
- Verify within one cron cycle:
  - occurrence row exists
  - transaction row exists and is confirmed
  - scheduler UI says last run succeeded
  - scheduler UI shows next run one hour later
  - `/app/actions` shows the SOL amount
  - worker run audit row or forced health event exists

Current test status:

- `deno test --allow-env supabase/functions/_shared/scheduler_test.ts`
- Result: 5 tests passed.

### Phase 8: Rollout

Tasks:

- Apply DB migration for any new audit RPC/table.
- Deploy updated Edge Functions:
  - `create-scheduled-action` if interval request semantics change
  - `cron-process-scheduled-actions` for execution invariants and observability
  - `agent-history` / `agent-action-status` only if response shape changes
- Deploy frontend changes.
- Run the staging smoke test above.
- Watch production after deployment:
  - scheduler worker runs
  - schedule occurrences
  - transactions created from `scheduled-*` idempotency keys
  - failed/retry counts
- Confirm the active user-facing scenario:
  - recurring hourly buy executes
  - row shows last success
  - next run is visible
  - action/history pages show correct SOL amount

## Suggested Implementation Order

1. Fix `/app/actions` amount rendering first. It is low-risk and directly addresses the "did not buy" perception for Solana transactions.
2. Update scheduler UI state presentation using existing parent schedule fields: `last_execution_at`, `transaction_id`, `transaction_hash`, `occurrence_count`, and success/failure counts.
3. Add occurrence history loading and display.
4. Add backend transaction-backed success assertions.
5. Add durable worker observability.
6. Clarify interval composer semantics.
7. Add tests and run staging smoke.

## Verification Query Pack

Use these during implementation and rollout. Redact wallet addresses, signatures, and user ids in shared notes.

```sql
select
  id,
  status,
  action_type,
  chain,
  schedule_kind,
  interval_seconds,
  scheduled_for,
  starts_at,
  occurrence_count,
  successful_occurrence_count,
  failed_occurrence_count,
  last_execution_at,
  transaction_id,
  transaction_hash
from scheduled_actions
where id = '<schedule-id>';
```

```sql
select
  id,
  schedule_id,
  occurrence_key,
  due_at,
  started_at,
  completed_at,
  status,
  attempt_count,
  transaction_id,
  transaction_hash,
  error_message
from linkr_schedule_occurrences
where schedule_id = '<schedule-id>'
order by due_at desc;
```

```sql
select
  id,
  created_at,
  action,
  chain,
  status,
  amount_eth,
  amount_sol,
  token_address,
  transaction_hash,
  signature,
  idempotency_key,
  source_surface
from transactions
where idempotency_key like 'scheduled-%'
order by created_at desc
limit 50;
```

```sql
select
  service,
  status,
  checked_at,
  latency_ms,
  details
from system_health_events
where service = 'scheduler'
order by checked_at desc
limit 50;
```

## Definition Of Done

- A recurring scheduled buy that reaches its due time creates a real transaction or remains visibly retrying / failed.
- Successful recurring schedules show last successful run and next due time in `/app/scheduler`.
- The scheduler page exposes occurrence history and transaction links.
- `/app/actions` renders Solana scheduled buys with SOL amounts.
- Workful scheduler cron runs are durably logged.
- Tests cover recurrence advancement, transaction-backed success, amount rendering, and scheduler row states.
- A staging smoke test proves a scheduled hourly buy actually executes and is visible in the UI.

## Immediate Next Patch Set

Recommended first implementation patch:

1. Add shared transaction amount formatter.
2. Use it in `/app/actions`.
3. Update scheduler row status copy for recurring schedules using existing fields.
4. Add occurrence history data loading for visible schedules.
5. Add backend guard before recurring success advancement for tx-bearing actions.
6. Add health/audit persistence for workful scheduler cron runs.

