-- Linkr AI agent API identity, credentials, replay protection, and audit trail.

create table if not exists public.agent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  name text not null,
  agent_type text not null default 'ai_agent',
  status text not null default 'active',
  public_contact text,
  allowed_callback_urls text[],
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint agent_profiles_status_check check (status in ('active','disabled','pending_review')),
  constraint agent_profiles_type_check check (agent_type in ('ai_agent','developer_app','internal'))
);

create index if not exists agent_profiles_user_created_idx
  on public.agent_profiles (user_id, created_at desc);

create index if not exists agent_profiles_wallet_idx
  on public.agent_profiles (wallet_id)
  where wallet_id is not null;

create table if not exists public.agent_onboarding_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active',
  requested_scopes text[] not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint agent_onboarding_tokens_status_check check (status in ('active','used','revoked','expired'))
);

create index if not exists agent_onboarding_tokens_user_created_idx
  on public.agent_onboarding_tokens (user_id, created_at desc);

create table if not exists public.agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  agent_profile_id uuid not null references public.agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  hmac_secret_hash text not null unique,
  scopes text[] not null default '{}',
  status text not null default 'active',
  require_hmac boolean not null default true,
  max_buy_eth numeric,
  max_sell_percent numeric,
  max_transfer_eth numeric,
  max_launch_initial_buy_eth numeric,
  max_liquidity_eth numeric,
  daily_request_limit integer,
  daily_tx_limit integer,
  allowed_ips text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint agent_api_keys_status_check check (status in ('active','revoked','expired'))
);

create index if not exists agent_api_keys_profile_created_idx
  on public.agent_api_keys (agent_profile_id, created_at desc);

create index if not exists agent_api_keys_user_created_idx
  on public.agent_api_keys (user_id, created_at desc);

create unique index if not exists agent_api_keys_prefix_uidx
  on public.agent_api_keys (key_prefix);

create table if not exists public.agent_api_nonces (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references public.agent_api_keys(id) on delete cascade,
  nonce text not null,
  timestamp_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (api_key_id, nonce)
);

create index if not exists agent_api_nonces_created_idx
  on public.agent_api_nonces (created_at);

create table if not exists public.agent_api_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  agent_profile_id uuid references public.agent_profiles(id) on delete set null,
  api_key_id uuid references public.agent_api_keys(id) on delete set null,
  wallet_id uuid references public.wallets(id) on delete set null,
  method text not null,
  path text not null,
  idempotency_key text,
  nonce text,
  status_code integer,
  request_hash text,
  response_hash text,
  error_code text,
  error_message text,
  duration_ms integer,
  ip text,
  user_agent text
);

create unique index if not exists agent_api_requests_key_idempotency_uidx
  on public.agent_api_requests (api_key_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists agent_api_requests_key_created_idx
  on public.agent_api_requests (api_key_id, created_at desc);

alter table public.liquidity_actions
  add column if not exists idempotency_key text;

create unique index if not exists liquidity_actions_idempotency_key_uidx
  on public.liquidity_actions (idempotency_key)
  where idempotency_key is not null;

create or replace function public.touch_agent_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agent_profiles_touch_updated_at on public.agent_profiles;
create trigger agent_profiles_touch_updated_at
  before update on public.agent_profiles
  for each row execute function public.touch_agent_profiles_updated_at();

revoke all on public.agent_profiles from anon, authenticated;
revoke all on public.agent_onboarding_tokens from anon, authenticated;
revoke all on public.agent_api_keys from anon, authenticated;
revoke all on public.agent_api_nonces from anon, authenticated;
revoke all on public.agent_api_requests from anon, authenticated;
grant select, update on public.agent_profiles to authenticated;
grant select on public.agent_api_requests to authenticated;
grant all on public.agent_profiles to service_role;
grant all on public.agent_onboarding_tokens to service_role;
grant all on public.agent_api_keys to service_role;
grant all on public.agent_api_nonces to service_role;
grant all on public.agent_api_requests to service_role;

alter table public.agent_profiles enable row level security;
alter table public.agent_onboarding_tokens enable row level security;
alter table public.agent_api_keys enable row level security;
alter table public.agent_api_nonces enable row level security;
alter table public.agent_api_requests enable row level security;

drop policy if exists "users read own agent profiles" on public.agent_profiles;
create policy "users read own agent profiles"
  on public.agent_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users update own agent profiles" on public.agent_profiles;
create policy "users update own agent profiles"
  on public.agent_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users read own onboarding tokens" on public.agent_onboarding_tokens;
create policy "users read own onboarding tokens"
  on public.agent_onboarding_tokens for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users read own agent api key metadata" on public.agent_api_keys;
create policy "users read own agent api key metadata"
  on public.agent_api_keys for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users update own agent api keys" on public.agent_api_keys;
create policy "users update own agent api keys"
  on public.agent_api_keys for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users read own agent api requests" on public.agent_api_requests;
create policy "users read own agent api requests"
  on public.agent_api_requests for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.prune_agent_api_nonces(p_before timestamptz default now() - interval '30 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.agent_api_nonces
  where created_at < p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_agent_api_nonces(timestamptz) from public, anon, authenticated;
grant execute on function public.prune_agent_api_nonces(timestamptz) to service_role;
