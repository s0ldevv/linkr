-- User-owned Uniswap V3 LP positions for Linkr-launched pools.
-- LaunchLocker positions remain permanent launch liquidity and are not user-removable.

create table if not exists public.liquidity_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null,
  token_address text not null,
  token_symbol text,
  token_name text,
  pool_address text not null,
  pool_fee integer not null,
  position_token_id text not null,
  tick_lower integer not null,
  tick_upper integer not null,
  liquidity text not null default '0',
  status text not null default 'active',
  amount_token_wei text,
  amount_weth_wei text,
  uncollected_token_fees_wei text,
  uncollected_weth_fees_wei text,
  value_usd numeric,
  in_range boolean,
  owner_address text,
  last_chain_refresh_at timestamptz,
  opened_tx_hash text,
  closed_tx_hash text,
  last_tx_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint liquidity_positions_status_check check (
    status in ('active','partially_removed','closed','transferred_out','stale','failed_refresh')
  ),
  constraint liquidity_positions_position_token_uidx unique (position_token_id)
);

create index if not exists liquidity_positions_user_created_idx
  on public.liquidity_positions (user_id, created_at desc);

create index if not exists liquidity_positions_wallet_status_idx
  on public.liquidity_positions (lower(wallet_address), status);

create index if not exists liquidity_positions_token_user_idx
  on public.liquidity_positions (lower(token_address), user_id);

grant select on public.liquidity_positions to authenticated;
grant all on public.liquidity_positions to service_role;

alter table public.liquidity_positions enable row level security;

drop policy if exists "users read own liquidity positions" on public.liquidity_positions;
create policy "users read own liquidity positions"
  on public.liquidity_positions for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.liquidity_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pending_action_id uuid references public.pending_actions(id) on delete set null,
  action text not null,
  status text not null default 'draft',
  wallet_address text not null,
  token_address text not null,
  token_symbol text,
  pool_address text,
  pool_fee integer,
  position_token_id text,
  tick_lower integer,
  tick_upper integer,
  requested_eth_wei text,
  requested_token_wei text,
  requested_percent numeric,
  liquidity_delta text,
  amount_token_wei text,
  amount_weth_wei text,
  fees_token_wei text,
  fees_weth_wei text,
  tx_hash text,
  error_message text,
  simulation jsonb not null default '{}'::jsonb,
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint liquidity_actions_action_check check (
    action in ('add_liquidity','remove_liquidity','collect_liquidity_fees','refresh_liquidity_position')
  ),
  constraint liquidity_actions_status_check check (
    status in ('draft','pending_confirmation','queued','submitted','confirmed','failed','cancelled')
  )
);

create index if not exists liquidity_actions_user_created_idx
  on public.liquidity_actions (user_id, created_at desc);

create index if not exists liquidity_actions_pending_action_idx
  on public.liquidity_actions (pending_action_id)
  where pending_action_id is not null;

create index if not exists liquidity_actions_token_status_idx
  on public.liquidity_actions (lower(token_address), status);

grant select on public.liquidity_actions to authenticated;
grant all on public.liquidity_actions to service_role;

alter table public.liquidity_actions enable row level security;

drop policy if exists "users read own liquidity actions" on public.liquidity_actions;
create policy "users read own liquidity actions"
  on public.liquidity_actions for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.touch_liquidity_positions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists liquidity_positions_touch_updated_at on public.liquidity_positions;
create trigger liquidity_positions_touch_updated_at
  before update on public.liquidity_positions
  for each row execute function public.touch_liquidity_positions_updated_at();

create or replace function public.touch_liquidity_actions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists liquidity_actions_touch_updated_at on public.liquidity_actions;
create trigger liquidity_actions_touch_updated_at
  before update on public.liquidity_actions
  for each row execute function public.touch_liquidity_actions_updated_at();
