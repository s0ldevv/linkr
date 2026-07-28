-- Linkr market data cache and provider telemetry.
-- Service-role only tables used by Edge Functions to cache normalized
-- Dexscreener and Moralis responses before facts are shown to users.

create table if not exists public.market_token_snapshots (
  id uuid primary key default gen_random_uuid(),
  chain text not null default 'solana',
  mint text,
  pair_address text,
  source text not null,
  symbol text,
  name text,
  logo_url text,
  price_usd numeric,
  price_native text,
  market_cap_usd numeric,
  fdv_usd numeric,
  liquidity_usd numeric,
  volume_5m_usd numeric,
  volume_1h_usd numeric,
  volume_6h_usd numeric,
  volume_24h_usd numeric,
  price_change_5m numeric,
  price_change_1h numeric,
  price_change_6h numeric,
  price_change_24h numeric,
  buys_5m integer,
  buys_1h integer,
  buys_6h integer,
  buys_24h integer,
  sells_5m integer,
  sells_1h integer,
  sells_6h integer,
  sells_24h integer,
  buyers_24h integer,
  sellers_24h integer,
  txns_24h integer,
  score numeric,
  possible_spam boolean,
  is_verified boolean,
  pair_url text,
  raw_json jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists market_token_snapshots_mint_source_fetched_idx
  on public.market_token_snapshots (chain, mint, source, fetched_at desc)
  where mint is not null;

create index if not exists market_token_snapshots_pair_source_fetched_idx
  on public.market_token_snapshots (chain, pair_address, source, fetched_at desc)
  where pair_address is not null;

create index if not exists market_token_snapshots_expires_idx
  on public.market_token_snapshots (expires_at);

create table if not exists public.market_discovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  list_kind text not null,
  chain text not null default 'solana',
  query text,
  sort_by text,
  items jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists market_discovery_snapshots_kind_fetched_idx
  on public.market_discovery_snapshots (source, list_kind, chain, fetched_at desc);

create index if not exists market_discovery_snapshots_expires_idx
  on public.market_discovery_snapshots (expires_at);

create table if not exists public.market_api_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  endpoint text not null,
  status text not null,
  http_status integer,
  latency_ms integer,
  cache_status text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists market_api_events_provider_created_idx
  on public.market_api_events (provider, created_at desc);

create table if not exists public.token_resolution_aliases (
  id uuid primary key default gen_random_uuid(),
  chain text not null default 'solana',
  symbol text,
  name text,
  mint text not null,
  source text not null,
  confidence numeric not null default 0,
  raw_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists token_resolution_aliases_symbol_idx
  on public.token_resolution_aliases (chain, lower(symbol))
  where symbol is not null;

create index if not exists token_resolution_aliases_name_idx
  on public.token_resolution_aliases (chain, lower(name))
  where name is not null;

grant all on public.market_token_snapshots to service_role;
grant all on public.market_discovery_snapshots to service_role;
grant all on public.market_api_events to service_role;
grant all on public.token_resolution_aliases to service_role;

alter table public.market_token_snapshots enable row level security;
alter table public.market_discovery_snapshots enable row level security;
alter table public.market_api_events enable row level security;
alter table public.token_resolution_aliases enable row level security;
