
-- =============================================================
-- Linkr complete schema
-- =============================================================

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================
-- profiles
-- =============================================================
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  twitter_id text unique,
  twitter_username text,
  twitter_name text,
  twitter_profile_image_url text,
  profile_completed boolean not null default false,

  default_slippage_bps integer not null default 0,
  max_auto_buy_sol numeric not null default 0,
  max_auto_transfer_sol numeric not null default 0,
  max_auto_sell_percent numeric not null default 0,
  max_auto_dev_buy_sol numeric not null default 0,

  require_confirmation_for_all_tx boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint valid_default_slippage check (default_slippage_bps >= 0 and default_slippage_bps <= 3000),
  constraint valid_max_auto_buy check (max_auto_buy_sol >= 0),
  constraint valid_max_auto_transfer check (max_auto_transfer_sol >= 0),
  constraint valid_max_auto_sell check (max_auto_sell_percent >= 0 and max_auto_sell_percent <= 100),
  constraint valid_max_auto_dev_buy check (max_auto_dev_buy_sol >= 0)
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

create policy "users read own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);

create policy "users insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);

create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, twitter_id, twitter_username, twitter_name, twitter_profile_image_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'provider_id',
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'),
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- wallets
-- =============================================================
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  public_key text not null unique,
  encrypted_private_key text not null,
  encryption_iv text not null,
  encryption_auth_tag text not null,
  created_at timestamptz not null default now()
);

-- Only service role writes/reads encrypted material. Frontend reads public_key
-- via a security-definer RPC so encrypted bytes never travel to the client.
grant all on public.wallets to service_role;

alter table public.wallets enable row level security;

create or replace function public.get_my_wallet_public_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public_key from public.wallets where user_id = auth.uid() limit 1;
$$;

grant execute on function public.get_my_wallet_public_key() to authenticated;

-- =============================================================
-- tweets_inbox
-- =============================================================
create table public.tweets_inbox (
  id uuid primary key default gen_random_uuid(),
  tweet_id text not null unique,
  conversation_id text,
  author_twitter_id text not null,
  author_username text,
  text text not null,
  tweet_url text,
  has_media boolean not null default false,
  media_url text,
  referenced_tweet_id text,
  parent_tweet_id text,
  root_tweet_id text,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint tweets_inbox_status_check check (status in ('pending','processing','awaiting_confirmation','completed','failed','ignored'))
);

create index tweets_inbox_status_created_idx on public.tweets_inbox (status, created_at);
create index tweets_inbox_author_idx on public.tweets_inbox (author_twitter_id);

grant select on public.tweets_inbox to authenticated;
grant all on public.tweets_inbox to service_role;

alter table public.tweets_inbox enable row level security;

create policy "users read own inbound tweets"
  on public.tweets_inbox for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.twitter_id = tweets_inbox.author_twitter_id
    )
  );

-- =============================================================
-- tweet_thread_contexts
-- =============================================================
create table public.tweet_thread_contexts (
  id uuid primary key default gen_random_uuid(),
  tweet_id text not null references public.tweets_inbox(tweet_id) on delete cascade,
  root_tweet_id text,
  parent_tweet_id text,
  context_json jsonb not null,
  flattened_context text,
  detected_mints text[] not null default '{}',
  detected_symbols text[] not null default '{}',
  detected_urls text[] not null default '{}',
  detected_media_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index tweet_thread_contexts_tweet_idx on public.tweet_thread_contexts (tweet_id);

grant select on public.tweet_thread_contexts to authenticated;
grant all on public.tweet_thread_contexts to service_role;

alter table public.tweet_thread_contexts enable row level security;

create policy "users read own thread contexts"
  on public.tweet_thread_contexts for select to authenticated
  using (
    exists (
      select 1 from public.tweets_inbox t
      join public.profiles p on p.twitter_id = t.author_twitter_id
      where t.tweet_id = tweet_thread_contexts.tweet_id and p.user_id = auth.uid()
    )
  );

-- =============================================================
-- agent_runs
-- =============================================================
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tweet_id text references public.tweets_inbox(tweet_id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  user_context jsonb,
  thread_context jsonb,
  classification jsonb,
  extraction jsonb,
  intent text,
  confidence numeric,
  requires_confirmation boolean not null default false,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index agent_runs_user_idx on public.agent_runs (user_id, created_at desc);
create index agent_runs_tweet_idx on public.agent_runs (tweet_id);

grant select on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;

alter table public.agent_runs enable row level security;

create policy "users read own agent runs"
  on public.agent_runs for select to authenticated
  using (auth.uid() = user_id);

-- =============================================================
-- pending_actions
-- =============================================================
create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tweet_id text,
  intent text not null,
  action_payload jsonb not null,
  settings_snapshot jsonb,
  confirmation_phrase text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  executed_at timestamptz,
  constraint pending_actions_status_check check (status in ('pending','confirmed','cancelled','expired','executed','failed'))
);

create index pending_actions_user_status_idx on public.pending_actions (user_id, status, expires_at);

grant select on public.pending_actions to authenticated;
grant all on public.pending_actions to service_role;

alter table public.pending_actions enable row level security;

create policy "users read own pending actions"
  on public.pending_actions for select to authenticated
  using (auth.uid() = user_id);

-- =============================================================
-- transactions
-- =============================================================
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  tweet_id text,
  action text,
  input_mint text,
  output_mint text,
  amount_original numeric,
  amount_original_unit text,
  amount_sol numeric,
  amount_usd numeric,
  sol_price_usd numeric,
  slippage_bps integer,
  tx_signature text,
  status text,
  error text,
  raw_request jsonb,
  raw_result jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index transactions_user_idx on public.transactions (user_id, created_at desc);
create index transactions_tweet_idx on public.transactions (tweet_id);

grant select on public.transactions to authenticated;
grant all on public.transactions to service_role;

alter table public.transactions enable row level security;

create policy "users read own transactions"
  on public.transactions for select to authenticated
  using (auth.uid() = user_id);

-- =============================================================
-- coin_launches
-- =============================================================
create table public.coin_launches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  tweet_id text,
  name text not null,
  symbol text not null,
  description text,
  image_url text,
  mint text unique,
  tx_signature text,
  dev_buy_original_amount numeric,
  dev_buy_original_unit text,
  dev_buy_sol numeric,
  dev_buy_usd numeric,
  sol_price_usd numeric,
  reward_mode text not null default 'none',
  agent_percentage numeric not null default 0,
  creator_rewards_config jsonb,
  launch_metadata jsonb,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  constraint coin_launches_reward_mode_check check (reward_mode in ('none','cashback','mayhem','agent')),
  constraint coin_launches_agent_pct_check check (agent_percentage >= 0 and agent_percentage <= 100)
);

create index coin_launches_user_idx on public.coin_launches (user_id, created_at desc);

grant select on public.coin_launches to anon, authenticated;
grant all on public.coin_launches to service_role;

alter table public.coin_launches enable row level security;

-- Public coin page reads launches by mint
create policy "anyone reads launches"
  on public.coin_launches for select to anon, authenticated
  using (true);

-- =============================================================
-- coin_settings_updates
-- =============================================================
create table public.coin_settings_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  coin_launch_id uuid references public.coin_launches(id) on delete cascade,
  tweet_id text,
  previous_config jsonb,
  new_config jsonb,
  tx_signature text,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);

grant select on public.coin_settings_updates to authenticated;
grant all on public.coin_settings_updates to service_role;

alter table public.coin_settings_updates enable row level security;

create policy "users read own coin settings updates"
  on public.coin_settings_updates for select to authenticated
  using (auth.uid() = user_id);

-- =============================================================
-- twitter_replies
-- =============================================================
create table public.twitter_replies (
  id uuid primary key default gen_random_uuid(),
  tweet_id text,
  reply_text text not null,
  reply_tweet_id text,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create index twitter_replies_tweet_idx on public.twitter_replies (tweet_id);

grant select on public.twitter_replies to authenticated;
grant all on public.twitter_replies to service_role;

alter table public.twitter_replies enable row level security;

create policy "users read replies to their tweets"
  on public.twitter_replies for select to authenticated
  using (
    exists (
      select 1 from public.tweets_inbox t
      join public.profiles p on p.twitter_id = t.author_twitter_id
      where t.tweet_id = twitter_replies.tweet_id and p.user_id = auth.uid()
    )
  );

-- =============================================================
-- token_registry
-- =============================================================
create table public.token_registry (
  id uuid primary key default gen_random_uuid(),
  mint text not null unique,
  symbol text,
  name text,
  logo_url text,
  decimals integer,
  source text,
  verified boolean not null default false,
  possible_spam boolean not null default false,
  raw_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.token_registry to anon, authenticated;
grant all on public.token_registry to service_role;

alter table public.token_registry enable row level security;

create policy "anyone reads token registry"
  on public.token_registry for select to anon, authenticated
  using (true);

create trigger token_registry_updated_at
  before update on public.token_registry
  for each row execute function public.set_updated_at();

-- =============================================================
-- user_memory_index
-- =============================================================
create table public.user_memory_index (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  title text,
  searchable_text text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint memory_source_type_check check (source_type in ('tweet','transaction','launch','coin_settings_update','reply','pending_action','portfolio_snapshot','settings_update'))
);

create index user_memory_user_idx on public.user_memory_index (user_id, created_at desc);
create index user_memory_search_idx on public.user_memory_index using gin (to_tsvector('english', searchable_text));

grant select on public.user_memory_index to authenticated;
grant all on public.user_memory_index to service_role;

alter table public.user_memory_index enable row level security;

create policy "users read own memory"
  on public.user_memory_index for select to authenticated
  using (auth.uid() = user_id);

-- =============================================================
-- sol_price_cache (service-role only)
-- =============================================================
create table public.sol_price_cache (
  id uuid primary key default gen_random_uuid(),
  price_usd numeric not null,
  source text not null,
  fetched_at timestamptz not null default now()
);

create index sol_price_fetched_idx on public.sol_price_cache (fetched_at desc);

grant all on public.sol_price_cache to service_role;
alter table public.sol_price_cache enable row level security;

-- =============================================================
-- app_state (service-role only)
-- =============================================================
create table public.app_state (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

grant all on public.app_state to service_role;
alter table public.app_state enable row level security;

create trigger app_state_updated_at
  before update on public.app_state
  for each row execute function public.set_updated_at();
