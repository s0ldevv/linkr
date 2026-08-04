# Deployment checklist

## Current execution status

The world-class hardening migrations have been added to the project but have not been applied to any database in this execution. Keep them undeployed until the database rollout is explicitly approved.

Relevant migration tail:

- `supabase/migrations/20260727220000_world_class_policy_scheduler_controls.sql`
- `supabase/migrations/20260727223000_fund_every_launch_policy.sql`
- `supabase/migrations/20260727224000_scheduled_action_parity.sql`
- `supabase/migrations/20260727225000_scheduler_api_mutation_polish.sql`

## 1. Rotate exposed configuration

The source package received for this review contained populated, live-looking local environment files and a temporary internal secret. Treat every value in those files as exposed and rotate it before deploying this revision, including Supabase service/database credentials, internal cron and encryption secrets, X credentials/tokens, Telegram bot/webhook credentials, CometAPI/provider keys, Vercel/deployment tokens, and market-data provider keys.

Do not copy old values into the new example files. Load replacements from a secret manager or the deployment platform's encrypted environment configuration.

## 2. Validate locally

```bash
npm ci
npm run audit:architecture
npm run check:edge-budget
npm run test:edge
npm run check
```

Run the contract test suite separately from `contracts/` when contract tooling is installed.

## 3. Apply database changes

Only after database rollout approval, apply all pending migrations to staging first. Confirm the `pg_cron` extension is available and verify the `linkr-runtime-maintenance` job exists after migration.

For this hardening revision, also verify the policy/funding/scheduler migrations installed:

```sql
select key, value
from public.get_linkr_admin_settings_v1()
where key in (
  'launch_funding_policy',
  'x_user_gating_policy',
  'metadata_testing_policy'
);

select schedule_kind, status, count(*)
from public.scheduled_actions
group by schedule_kind, status;

select funding_kind, chain, status, count(*)
from public.wallet_funding_events
group by funding_kind, chain, status;

select n.nspname as schema_name, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'mutate_linkr_schedule_v1';
```

Validate:

```sql
select public.run_linkr_runtime_maintenance();
select jobname, schedule, command
from cron.job
where jobname = 'linkr-runtime-maintenance';
```

## 4. Deploy Edge Functions

Deploy from `supabase/config.toml`. Do not use `--no-verify-jwt` globally; the file intentionally opts out only for public callbacks, internal workers, cron endpoints, and HMAC/API-key endpoints that enforce their own application-level authorization.

Set at least:

- `LINKR_GATEWAY_CONNECT_TIMEOUT_MS=30000`
- `LINKR_GATEWAY_STREAM_IDLE_TIMEOUT_MS=45000`
- `LINKR_GATEWAY_RESPONSE_IDLE_TIMEOUT_MS=30000`
- `COMET_STREAM_TIMEOUT_MS=120000`
- `LINKR_ACTION_EXECUTOR_TIMEOUT_MS=240000`
- a unique `LINKR_INTERNAL_KEY` shared only by trusted Edge functions

The terminal emits keepalives every 15 seconds, so an idle timeout detects stalled streams without breaking a healthy long-running turn.

## 5. Staging acceptance tests

Exercise each surface end to end with separate test users:

1. Dashboard sign-in, wallet creation/import/export, balances, transfers, swaps, liquidity, schedules, token launch, NFT launch, and creator rewards.
2. Terminal conversational request, attachment, token-burn preview/confirmation, creator-reward preview/claim, cancellation, network interruption, duplicate `client_message_id`, and provider timeout.
3. X mention ingestion, duplicate mention, launch thread, trade command, natural reply, posting-rate limit, ambiguous post, reconciliation, and revoked X token.
4. Telegram private chat, group verification, duplicate update, callback confirmation, launch with uploaded image, typed action confirmation, and bot-token/webhook-secret rotation.
5. Agent API HMAC signing, nonce replay, stale timestamp, missing scope, duplicate idempotency key, and rate limits.
6. Solana and Robinhood-chain insufficient balance, RPC timeout, failed transaction, delayed confirmation, and reconciliation.

## 6. Operational alerts

Alert on queue age, dead-letter growth, repeated circuit opening, stale run/action reconciliation counts, `transactions.status = 'reconciliation_required'`, stale `user_transfer_requests.status = 'executing'`, ambiguous X replies, provider timeout rate, failed chain confirmations, Telegram webhook failures, and maintenance-job failures. Include `X-Request-ID`, work item ID, run ID, and provider request ID in operational logs where available—never private keys, bearer tokens, raw signed payloads, or wallet secret material.

## 7. Rollout

Use staging, then a small production cohort, then full traffic. Keep the queue controller and maintenance job enabled during rollout. Roll back application code independently from database migrations; the migration in this revision is additive and its functions can remain installed if the frontend/Edge deployment is rolled back.

For holder airdrops, follow `docs/HOLDER_AIRDROP_RUNBOOK.md`. Applying `20260804190000_holder_airdrop_durable_flow.sql` and `20260804200000_holder_airdrop_percent_batch_efficiency.sql` installs the current flow, but leaves `holder_airdrop_solana` disabled with `rollout_percent = 0` until an operator explicitly enables a canary or full rollout.
