-- Enhance first-launch funding tracking and cross-chain eligibility
-- This migration adds columns to track user-requested dev buys and funding outcomes

-- Add columns to coin_launches for tracking user dev buy requests
alter table public.coin_launches
  add column if not exists user_requested_dev_buy_wei text,
  add column if not exists user_requested_dev_buy_eth numeric,
  add column if not exists dev_buy_override_reason text,
  add column if not exists funding_purpose text;

-- Add columns to wallet_funding_events for outcome tracking
alter table public.wallet_funding_events
  add column if not exists chain text,
  add column if not exists launch_outcome text,
  add column if not exists launch_outcome_at timestamptz,
  add column if not exists funding_purpose text,
  add column if not exists user_requested_dev_buy_wei text;

update public.wallet_funding_events
set chain = case
  when raw_result->>'chain' in ('solana', 'robinhood') then raw_result->>'chain'
  when destination_address ~* '^0x[0-9a-f]{40}$' then 'robinhood'
  when destination_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$' then 'solana'
  else chain
end
where chain is null;

-- Add check constraint for Robinhood funding cap (0.005 ETH in wei)
alter table public.wallet_funding_events
  drop constraint if exists wallet_funding_events_robinhood_amount_cap_check,
  add constraint wallet_funding_events_robinhood_amount_cap_check
  check (
    funding_kind not in ('first_launch_minimum', 'per_launch_minimum')
    or coalesce(chain, 'unknown') <> 'robinhood'
    or amount_wei::numeric <= 5000000000000000  -- 0.005 ETH in wei
  );

-- Add check constraint for Solana funding cap (0.02 SOL in lamports)
alter table public.wallet_funding_events
  drop constraint if exists wallet_funding_events_solana_amount_cap_check,
  add constraint wallet_funding_events_solana_amount_cap_check
  check (
    funding_kind not in ('first_launch_minimum', 'per_launch_minimum')
    or coalesce(chain, 'unknown') <> 'solana'
    or amount_wei::numeric <= 20000000  -- 0.02 SOL in lamports
  );

-- Create index for cross-chain eligibility checks (faster lookups)
create index if not exists wallet_funding_events_user_cross_chain_idx
  on public.wallet_funding_events (user_id, status, created_at)
  where funding_kind = 'first_launch_minimum'
    and status in ('pending', 'prepared', 'submitted', 'confirmed');

-- Add comment to document the one-subsidy-per-user policy
comment on column public.wallet_funding_events.user_id is 
  'User ID (from auth.users) for tracking one-time first-launch subsidy across all chains. Each user can only receive one first_launch_minimum funding event in their lifetime.';
