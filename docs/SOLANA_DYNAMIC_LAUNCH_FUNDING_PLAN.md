# Solana Dynamic Launch Funding Plan

## Goal

Fund eligible Solana token launches with the minimum launch cost plus a very small buffer, instead of using the current fixed `0.02 SOL` reserve as the funding target.

The funded amount must exclude dev buy amounts. If a launch has a positive dev buy, the user funds that dev buy from their own wallet and Linkr funding should not cover it.

Example target behavior:

- Estimated non-dev launch debit: `0.00754 SOL`
- Buffer: `0.00015 SOL`
- User wallet balance: `0 SOL`
- Linkr funding transfer: `0.00769 SOL`

## Current State

The relevant Solana funding path is already mostly isolated and crash-safe:

- `supabase/functions/worker-launch-solana/index.ts` loads the launch, checks the user wallet balance, computes `requiredSol`, then funds the deficit before loading the user's wallet secret and preparing the launch transaction.
- `supabase/functions/_shared/solana_launch/pump_adapter.ts` contains `estimatePumpFunLaunchRequiredSol()`, which currently returns:
  - `initialBuySol`
  - plus `PUMP_FUN_LAUNCH_RESERVE_SOL`, default `0.02`
  - plus `PUMP_FUN_FEE_SHARING_RESERVE_SOL`, default `0.01` when fee sharing is enabled
- `supabase/functions/_shared/solana_launch/funding.ts` sends the exact `amountLamports` it is given and persists a `wallet_funding_events` row before broadcast.
- `supabase/functions/_shared/x_launch_balance_guard.ts` also has a Solana minimum balance default of `0.02 SOL` via `X_LAUNCH_MIN_BALANCE_SOL`.

The current worker is therefore funding based on a coarse reserve, not the actual transaction cost. The `0.02 SOL` constant should remain a safety cap unless we intentionally change subsidy policy, but it should stop being the normal funding target.

## Key Technical Constraint

The exact Pump.fun launch transaction is already assembled and simulated in `preparePumpFunLaunch()`, but today that happens after the worker has decided the wallet has enough SOL or after it has funded the wallet.

To estimate the minimum amount before funding, we need a pre-funding quote path that uses the same instruction builder as the real launch without broadcasting the transaction.

Solana primitives that support this:

- `getFeeForMessage` returns the lamports the cluster would charge for a serialized message at the requested commitment.
- `simulateTransaction` runs a signed transaction against current chain state without broadcasting it and returns useful fields such as `err`, `fee`, `unitsConsumed`, `preBalances`, and `postBalances`.
- Priority fees are based on requested compute unit limit and compute unit price, not actual compute used, so the estimator must use the same compute budget settings as the real transaction.

References:

- https://solana.com/docs/rpc/http/getfeeformessage
- https://solana.com/docs/rpc/http/simulatetransaction
- https://solana.com/docs/core/fees
- https://solana.com/docs/core/fees/compute-budget

## Recommended Design

### 1. Add a Pump.fun launch cost estimator

Create a new estimator in `supabase/functions/_shared/solana_launch/pump_adapter.ts`:

```ts
export type PumpFunLaunchCostEstimate = {
  minimumLaunchLamports: bigint;
  bufferLamports: bigint;
  fundingTargetLamports: bigint;
  feeLamports: bigint;
  payerDebitLamports: bigint;
  simulationUnitsConsumed: number | null;
  source: "quote_wallet_simulation" | "fallback_reserve";
  raw: Record<string, unknown>;
};

export async function estimatePumpFunLaunchFundingLamports(
  input: PumpLaunchInput,
  options: {
    creatorWalletAddress: string;
    quoteWalletSecret?: Uint8Array;
    forceInitialBuySol?: 0;
  },
): Promise<PumpFunLaunchCostEstimate>;
```

Estimator rules:

- Include creator rewards and mayhem/cashback options because those can alter the instruction set.
- Use the same compute unit limit and priority micro-lamports as `preparePumpFunLaunch()`.
- Use a dedicated estimate wallet from `SOL_LAUNCH_ESTIMATE_WALLET`.
- Sign only for simulation and never broadcast.
- Compute `minimumLaunchLamports` from the simulated payer debit:
  - preferred: `preBalances[payerIndex] - postBalances[payerIndex]`
  - fallback: `simulation.value.fee` or `getFeeForMessage()`, plus a conservative fallback reserve if balances are unavailable
- Set `bufferLamports` to a tiny configurable buffer:
  - default: `150_000` lamports (`0.00015 SOL`)
  - env override: `PUMP_FUN_LAUNCH_FUNDING_BUFFER_LAMPORTS`
  - optional max: `300_000` lamports
- Set `fundingTargetLamports = minimumLaunchLamports + bufferLamports`.

Do not reuse the funding wallet as the default quote wallet. A small, separately funded estimate wallet keeps operational duties separate from the wallet that sends user subsidies.

### 2. Refactor Pump launch assembly so estimate and execution share one builder

Split `preparePumpFunLaunch()` into reusable internal pieces:

- `buildPumpFunLaunchInstructions()`
- `buildCreatorRewardsInstructions()`
- `compilePumpFunLaunchTransaction()`
- `preparePumpFunLaunch()`
- `estimatePumpFunLaunchFundingLamports()`

The estimator and real prepare path should share instruction construction. That is the best guard against the estimate drifting away from actual execution.

The estimator does not need to upload Pump metadata. It can use a bounded placeholder URI such as `https://linkr.cash/coin/<quote-mint>` because SOL debit is not determined by HTTP content. The real launch path should keep uploading metadata exactly as it does today.

### 3. Update the Solana worker funding decision

In `supabase/functions/worker-launch-solana/index.ts`, replace the current fixed helper call:

```ts
const requiredSol = pump.estimatePumpFunLaunchRequiredSol(initialBuySol, ...);
const requiredLamports = Math.ceil(requiredSol * 1_000_000_000);
```

with:

```ts
const launchCost = await pump.estimatePumpFunLaunchFundingLamports(...);
const minimumLaunchLamports = launchCost.fundingTargetLamports;
const requiredLamports = minimumLaunchLamports + initialBuyLamports;
```

Funding decision:

- If `initialBuySol > 0`, do not fund. The user must hold `minimum launch cost + dev buy`.
- If `initialBuySol === 0` and funding policy is enabled:
  - read confirmed wallet balance
  - compute `deficit = max(0, fundingTargetLamports - balanceLamports)`
  - fund exactly that deficit if it is `> 0` and `<= SOL_FIRST_LAUNCH_FUNDING_LAMPORTS`
- Keep the existing split-invocation behavior:
  - fund
  - return retry
  - re-read confirmed user balance
  - only then load the user's wallet secret and prepare the real launch

This preserves the current safety property that Linkr never prepares or signs the launch transaction until funding has actually landed.

### 4. Keep the cap as a cap, not a target

Rename or alias the Solana cap in `funding.ts` to make intent explicit:

```ts
export const SOL_LAUNCH_FUNDING_CAP_LAMPORTS = 20_000_000n;
export const SOL_FIRST_LAUNCH_FUNDING_LAMPORTS = SOL_LAUNCH_FUNDING_CAP_LAMPORTS;
```

Then update new code and tests to refer to the cap name. This avoids future confusion where `0.02 SOL` looks like "the amount we fund" instead of "the maximum we are willing to fund".

Database constraints already cap Solana `wallet_funding_events.amount_wei` at `20_000_000` lamports for launch funding. Leave that in place unless product decides to raise the subsidy ceiling.

### 5. Store estimate details for auditability

Add a small migration that records estimate details on `coin_launches`, or store them in the existing `launch_metadata` JSON if avoiding schema changes is preferred.

Recommended columns:

```sql
alter table public.coin_launches
  add column if not exists estimated_launch_cost_lamports text,
  add column if not exists launch_cost_buffer_lamports text,
  add column if not exists launch_cost_estimate_source text,
  add column if not exists launch_cost_estimate jsonb;
```

At worker time, persist:

- `minimum_launch_lamports`
- `buffer_lamports`
- `funding_target_lamports`
- `wallet_balance_lamports`
- `funding_deficit_lamports`
- `initial_buy_lamports`
- `simulation_units_consumed`
- `fee_lamports`
- estimate source
- estimator version

Also add the same data to `wallet_funding_events.raw_result` when funding occurs.

### 6. Sync user-facing balance checks and dry-runs

The worker should be source of truth, but visible surfaces should stop implying a fixed `0.02 SOL` requirement.

Update `supabase/functions/_shared/x_launch_balance_guard.ts`:

- Replace `X_LAUNCH_MIN_BALANCE_SOL` default `0.02` with a shared constant or a light estimate helper.
- Keep dev buy excluded from funding eligibility.
- For self-funded positive dev-buy launches, display `minimum launch cost + dev buy`.
- For eligible zero-dev launches, allow the request when the dynamic deficit is under the cap.

Update `supabase/functions/agent-launch-token/index.ts` dry-run:

- For Solana dry-runs, return:
  - `minimum_launch_cost_lamports`
  - `minimum_launch_cost_sol`
  - `funding_buffer_lamports`
  - `funding_target_lamports`
  - `initial_buy_lamports`
  - `required_balance_lamports`
  - `dev_buy_excluded_from_linkr_funding: true`

Dashboard launch acceptance can stay thin, but any displayed "needs SOL" copy should read from the same value or avoid showing a hardcoded amount.

### 7. Fallback behavior

If estimation fails because `SOL_LAUNCH_ESTIMATE_WALLET` is missing, underfunded, or RPC simulation is unavailable:

- Emit a `recordHealthEvent(admin, "solana_launch_cost_estimate", "down", ...)`.
- Use a conservative fallback only if product wants availability over precision:
  - fallback target: current `PUMP_FUN_LAUNCH_RESERVE_SOL` behavior
  - source: `fallback_reserve`
- Otherwise pause the launch with a clear `solana_launch_cost_estimate_unavailable` reason and ask for manual funding.

Recommended production posture:

- Use fallback during rollout.
- After estimator confidence is proven, switch to fail-closed for estimator outages if overfunding is more costly than delayed launches.

### 8. Tests

Add unit tests in `supabase/functions/_shared/solana_launch/funding_test.ts`:

- `firstLaunchFundingDeficit(0, 7_690_000)` returns `7_690_000n`.
- Partial balance is subtracted from dynamic funding target.
- Funding cap still rejects values above `20_000_000n`.
- Positive dev buy remains ineligible for funding.

Add new tests for the Pump estimator with mocked dependencies:

- estimator forces `initialBuySol` to `0` for funded launches
- estimator adds the configured tiny buffer
- estimator uses simulated payer debit when pre/post balances are present
- estimator falls back deterministically when simulation lacks balances
- estimator includes creator reward instructions when `should_update_on_chain` is true
- estimator never broadcasts

Update `x_launch_balance_guard_test.ts`:

- replace fixed `20_000_000n` Solana requirement expectations with dynamic estimate/cap expectations
- keep the explicit positive dev-buy rejection

Add a worker-level test with mocked `pump.estimatePumpFunLaunchFundingLamports()`:

- wallet balance `0`
- estimate minimum `7_540_000`
- buffer `150_000`
- expected funding call amount `7_690_000`
- no user wallet secret loaded before funding retry

Run:

```bash
npm run test:edge
npm run typecheck
npm run build
```

## Rollout Plan

1. Ship estimator behind `SOLANA_DYNAMIC_LAUNCH_FUNDING_ENABLED=false`.
2. Deploy with the old reserve fallback still active.
3. Enable in staging with `SOL_LAUNCH_ESTIMATE_WALLET` funded and monitor:
   - estimated cost
   - actual confirmed payer debit
   - difference between estimate and actual
   - funding amount sent
   - launch success/failure
4. Enable for canary users or a low rollout percentage.
5. If estimate-to-actual deltas stay within the buffer, enable globally.
6. After confidence, reduce fallback use or make estimator outages pause launches rather than returning to 0.02 funding.

## Acceptance Criteria

- A zero-dev-buy Solana launch whose simulated non-dev cost is `0.00754 SOL` receives about `0.00769 SOL`, not `0.02 SOL`.
- Linkr funding never includes `dev_buy_sol`, `initial_buy_sol`, or any user-selected dev buy alias.
- A user with an existing partial SOL balance receives only the deficit above `estimated minimum + buffer`.
- A launch with `dev_buy_sol > 0` does not receive Linkr funding.
- `wallet_funding_events.amount_wei`, `coin_launches.funding_amount_wei`, and `wallet_funding_events.raw_result.amount_lamports` all match the exact transferred lamports.
- The existing crash-safe funding transaction persistence and signature validation remain unchanged.
- If the quote estimator is unavailable, behavior is explicit and observable through health events.

## Implementation Order

1. Add the estimator types and pure instruction builder refactor in `pump_adapter.ts`.
2. Add focused estimator tests with mocked connection and quote wallet.
3. Update `worker-launch-solana/index.ts` to use dynamic `fundingTargetLamports`.
4. Rename the cap constant in `funding.ts` while preserving backwards-compatible exports.
5. Add audit fields or JSON metadata writes for estimates.
6. Update X balance guard and Agent API dry-run outputs.
7. Run the edge test suite and a staged dry-run/launch canary.
8. Enable `SOLANA_DYNAMIC_LAUNCH_FUNDING_ENABLED` gradually.
