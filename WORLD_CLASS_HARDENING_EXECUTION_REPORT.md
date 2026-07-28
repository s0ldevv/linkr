# World-Class Hardening Execution Report

Date: 2026-07-27

Scope: `D:\apps\linkr-upgrade-final`

Database status: migrations prepared, not deployed from this workspace.

## Completed work

- Added DB-backed admin settings and audit controls for launch funding, X user gating, and metadata testing.
- Exposed launch funding modes in `/secretpanel`, including disabled, first eligible launch, and every eligible launch.
- Hardened Solana and Robinhood launch funding with a ledger, chain tracking, first-launch uniqueness, per-launch uniqueness, prepared signed transaction persistence, retry-safe rebroadcast checks, and cap constraints.
- Added early X gating/ban checks for OAuth and mention ingestion before normal queueing or expensive work.
- Added active-ban enforcement to Agent API auth, Telegram flows, dashboard terminal chat, and dashboard action execution.
- Kept GPT-5 Mini as the CometAPI model path and verified no GPT-5 Nano runtime references remain.
- Removed production Google metadata fallback behavior. Google URLs remain only in explicit, disabled metadata testing policy defaults/tests.
- Hardened Robinhood launch metadata to use a stable metadata URI, refresh the same object after CREATE2 token prediction, and default production website metadata to `https://linkr.cash/coin/<token>`.
- Rebuilt scheduled actions around one shared scheduler model with recurring state, occurrence rows, pause/resume/cancel mutation, idempotent occurrence execution, and duplicate X-reply protection.
- Expanded scheduled execution beyond buy/sell/transfer to token launches, creator-reward claims, add liquidity, remove liquidity, and Robinhood collect-fees where the underlying action is supported.
- Wired dashboard scheduler creation/listing/control, Agent API schedule read/write, and terminal natural-language schedule drafts into the same `scheduled_actions` backend model.
- Fixed notification failure handling so a failed scheduled X reply cannot cause the blockchain action to execute again.
- Updated docs/OpenAPI/scheduler UI copy for the expanded scheduler action set.
- Tightened the architecture audit so generated/dependency folders are not scanned as source.
- Aligned direct Agent API timed schedule creation with terminal extraction by supporting `run_at`, `starts_at`, relative delay aliases, and interval-only first-run creation.
- Polished the schedule mutation RPC so update requests apply priority and can intentionally clear nullable recurring limits.
- Reduced high-frequency X mention ingestion database pressure by checking duplicates before ban/gating RPCs and caching author ban/gating decisions within a poll pass.
- Rechecked scheduler, metadata, funding, admin, transfer, creator-reward, launch, X, Telegram, terminal, and Agent API wiring against the hardening plan.

## New migrations

- `supabase/migrations/20260727220000_world_class_policy_scheduler_controls.sql`
- `supabase/migrations/20260727223000_fund_every_launch_policy.sql`
- `supabase/migrations/20260727224000_scheduled_action_parity.sql`
- `supabase/migrations/20260727225000_scheduler_api_mutation_polish.sql`

Apply all pending migrations in order on staging first. They are additive/compatibility-oriented, but they change production policy and scheduler behavior.

## Verification record

Passed locally in this checkout:

- `npm run test:edge` - 239 passed, 0 failed
- `npm run check` - architecture audit, Edge budget, ESLint, TypeScript, production build
- `deno check` on touched scheduler/agent/runtime Edge entrypoints
- `npm test` from `contracts/` - 30 passed, 0 failed, 1 skipped fork test
- `npm audit --audit-level=high` from root - 0 vulnerabilities
- `npm audit --audit-level=high` from `contracts/` - 0 vulnerabilities

Expected non-failing warnings:

- Existing React Fast Refresh lint warnings remain.
- Existing large `src/styles-home-polish.css` architecture warning remains.
- Deno tests print optional native module warnings for websocket/bigint dependencies, but the suite passes.
- Vite/Nitro build prints plugin timing notices.

## Important problems found and corrected

- Scheduled launch replay detection did not match the launch RPC idempotency format; retries can now detect `launch:<surface>:<key>` rows.
- The database action-type constraint still allowed only buy/sell/transfer; the new parity migration widens it to the scheduler action set.
- Recurring market-cap schedule creation was blocked even though the worker/schema can advance recurring conditions; the API and dashboard now support recurring buy/sell conditions.
- The dashboard scheduler composer only created buy/sell/transfer schedules; it now creates launches, rewards, liquidity, and recurring condition schedules.
- Confirmed terminal schedule actions previously threw instead of creating a scheduler row; they now insert idempotently into `scheduled_actions`.
- The architecture audit scanned nested dependency folders and could fail on dependency fixtures; generated/dependency folders are now excluded recursively.
- Direct Agent API schedule creation required an absolute scheduled time even when a caller supplied only a relative delay or interval; the endpoint now accepts relative and interval-first-run inputs.
- Scheduler chain inference could default scheduled Solana-shaped actions to Robinhood when the chain was implicit; action payloads now infer from explicit chain text, native units, active token context, and token address shape.
- The AI conversation prompt still described only scheduled buys, sells, and transfers; it now names launches, creator rewards, liquidity actions, and Robinhood liquidity-fee collection.
- The Agent API schedule-control RPC ignored priority patches and could not clear nullable recurring limits; the replacement migration fixes both behaviors.
- X mention polling could perform ban/gating work for tweets already seen in the inbox; duplicate checks now happen first and author policy decisions are cached per poll pass.

## Residual limitations

- This workspace did not deploy migrations or execute live-chain transactions. Final staging must still exercise real Solana/Robinhood RPCs, X posting, Telegram callbacks, and provider failure cases with funded test wallets.
- Solana PumpSwap collect-fees remains intentionally unsupported as a separate scheduled action; Pump fees are handled through liquidity removal.
- The large CSS file remains a future decomposition target, but it does not fail the release gate.
