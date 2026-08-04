# Holder airdrop operations runbook

## Current behavior

Holder airdrops are an X-only Solana flow. A creator asks `@linkrcash` to airdrop an exact token amount, `all`, or a percentage of the recorded launch wallet current token balance for a completed Solana launch they own in Linkr. That recorded launch wallet must belong to the requesting creator.

Linkr prepares an immutable holder snapshot, excludes the creator or dev wallet first and the largest remaining holder second, allocates the requested raw token amount pro rata by holder balance, and asks for confirmation. It reports completion in chat only after all sends are confirmed; failed or expired work is reported as stopped, not completed.

Percentages and `all` are calculated from the launch wallet's aggregate token balance for that mint. The current executor signs transfers from one source token account, so a balance split across multiple token accounts may need to be consolidated before a large percentage or `all` request can proceed.

## Bot handle and Edge config

Testing the public X flow against `@linkrcash` requires the Edge environment and bot credentials to agree:

- `X_BOT_HANDLE=linkrcash`;
- `X_BOT_USER_ID` is the numeric X user ID for `@linkrcash`;
- `X_BOT_USERNAME=linkrcash` remains required for the legacy X reply-reconciliation lookup until that path is migrated to `X_BOT_HANDLE`;
- the active X posting credentials pass the Secret Panel posting-auth check for the same user ID and handle.

## Rollout gate

The migration `supabase/migrations/20260804190000_holder_airdrop_durable_flow.sql` creates the durable tables, RPCs, route mapping, and `holder_airdrop_solana` queue stage. It intentionally seeds that stage disabled with `rollout_percent = 0`, and reapplying the migration keeps it disabled. The follow-up migration `supabase/migrations/20260804200000_holder_airdrop_percent_batch_efficiency.sql` must be applied after the durable-flow migration and only with the matching worker code; it enables the current percentage/all parsing expectations and six-recipient batches.

Before enabling production traffic, verify:

- both holder-airdrop migrations above are applied in the target database;
- `worker-holder-airdrop-solana` is deployed from `supabase/config.toml`;
- internal worker auth is configured consistently with the other queue workers;
- Solana RPC access is available through `HELIUS_RPC_URL`, `HELIUS_API_KEY`, or `SOLANA_RPC_URL`;
- a canary creator has a completed Solana Linkr launch and enough token balance in the recorded launch wallet.

Read-only database verification:

```sql
select stage, worker_function, enabled, rollout_percent, canary_user_ids,
       consumer_version, pause_reason
from public.linkr_queue_runtime_config
where stage = 'holder_airdrop_solana';

select stage, state, circuit_open_until, required_consumer_version, last_error_code
from public.linkr_dispatch_stage_state
where stage = 'holder_airdrop_solana';

select slot_number, enabled, lease_owner, lease_expires_at, work_item_id
from public.linkr_worker_capacity_slots
where stage = 'holder_airdrop_solana'
order by slot_number;

select to_regclass('pgmq.q_holder_airdrop_solana') as queue_table;
```

Expected pre-test state after migrations: one `linkr_queue_runtime_config` row for `holder_airdrop_solana`, `enabled = false`, `rollout_percent = 0`, worker function `worker-holder-airdrop-solana`, consumer version `worker-holder-airdrop-solana-v1`, one enabled capacity slot, and a non-null queue table.

Enable only a named canary after approval, replacing the UUID with the canary creator's Linkr `auth.users.id`:

```sql
update public.linkr_queue_runtime_config
set
  enabled = true,
  rollout_percent = 0,
  canary_user_ids = array['00000000-0000-0000-0000-000000000000']::uuid[],
  pause_reason = null,
  updated_at = now()
where stage = 'holder_airdrop_solana';

update public.linkr_dispatch_stage_state
set
  state = 'idle',
  required_consumer_version = null,
  circuit_open_until = null,
  last_error_code = null,
  updated_at = now()
where stage = 'holder_airdrop_solana';
```

Use `enabled = true`, `rollout_percent = 0`, and a non-empty `canary_user_ids` list for named canary testing. Use `rollout_percent = 100` and `canary_user_ids = '{}'::uuid[]` only for full rollout after the canary is accepted. Do not rerun the durable-flow migration after enabling unless intentionally returning the stage to disabled.

## Smoke checks

Use a canary creator on X:

1. Ask an ambiguous request and confirm Linkr asks for the token, exact amount, or percentage.
2. Ask an exact or percentage holder airdrop for the completed Solana launch and confirm Linkr prepares a snapshot, not a transaction.
3. Confirm the pending airdrop only after reviewing the amount and recipient count.
4. Verify chat completion appears only after confirmed sends.

Rollback is to disable the stage:

```sql
update public.linkr_queue_runtime_config
set enabled = false, rollout_percent = 0, canary_user_ids = '{}'::uuid[], updated_at = now()
where stage = 'holder_airdrop_solana';
```
