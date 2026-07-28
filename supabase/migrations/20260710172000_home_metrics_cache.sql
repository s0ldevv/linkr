-- Small public-home cache so unauthenticated homepage traffic does not need
-- to run aggregate scans over hot operational tables.

create table if not exists public.home_metrics_cache (
  cache_key text primary key,
  data jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  build_status text not null default 'ok'
    check (build_status in ('ok','degraded','failed')),
  error text,
  updated_at timestamptz not null default now()
);

grant all on public.home_metrics_cache to service_role;
grant select on public.home_metrics_cache to anon, authenticated;
alter table public.home_metrics_cache enable row level security;

drop policy if exists "anyone reads home metrics cache" on public.home_metrics_cache;
create policy "anyone reads home metrics cache"
  on public.home_metrics_cache for select to anon, authenticated
  using (true);

create index if not exists home_metrics_cache_expires_idx
  on public.home_metrics_cache (expires_at);

