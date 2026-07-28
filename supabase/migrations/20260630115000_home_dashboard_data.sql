-- =============================================================
-- Real-data home dashboard support
-- =============================================================

create table if not exists public.system_health_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null check (status in ('ok','degraded','down')),
  latency_ms integer,
  details jsonb,
  checked_at timestamptz not null default now()
);

create index if not exists system_health_events_source_checked_idx
  on public.system_health_events (source, checked_at desc);

grant all on public.system_health_events to service_role;
alter table public.system_health_events enable row level security;

create table if not exists public.public_achievements (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  detail text,
  metric_value numeric,
  threshold numeric,
  achieved_at timestamptz not null default now(),
  metadata jsonb
);

create index if not exists public_achievements_achieved_idx
  on public.public_achievements (achieved_at desc);

grant select on public.public_achievements to anon, authenticated;
grant all on public.public_achievements to service_role;
alter table public.public_achievements enable row level security;

drop policy if exists "anyone reads public achievements" on public.public_achievements;
create policy "anyone reads public achievements"
  on public.public_achievements for select to anon, authenticated
  using (true);

create or replace function public.get_home_public_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with successful_tx as (
    select *
    from public.transactions
    where coalesce(action, '') in ('buy', 'sell', 'transfer')
      and (
        tx_signature is not null
        or coalesce(status, '') in ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )
  ),
  successful_tx_30d as (
    select *
    from successful_tx
    where created_at >= now() - interval '30 days'
  ),
  health_30d as (
    select status
    from public.system_health_events
    where checked_at >= now() - interval '30 days'
  ),
  health_summary as (
    select
      count(*)::int as total,
      count(*) filter (where status = 'ok')::int as ok
    from health_30d
  )
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'trades30d', (select count(*) from successful_tx_30d),
    'tradesTotal', (select count(*) from successful_tx),
    'volumeUsd30d', (
      select nullif(sum(coalesce(amount_usd, amount_sol * sol_price_usd)), 0)
      from successful_tx_30d
    ),
    'volumeUsdTotal', (
      select nullif(sum(coalesce(amount_usd, amount_sol * sol_price_usd)), 0)
      from successful_tx
    ),
    'launchesTotal', (
      select count(*)
      from public.coin_launches
      where coalesce(status, '') <> 'failed'
    ),
    'uptime30d', (
      select case
        when total >= 24 then round((ok::numeric / nullif(total, 0)) * 100, 2)
        else null
      end
      from health_summary
    ),
    'generatedAt', now()
  );
$$;

revoke all on function public.get_home_public_metrics() from public, anon, authenticated;
grant execute on function public.get_home_public_metrics() to service_role;

create or replace function public.get_home_top_traders_30d(limit_count integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      row_number() over (
        order by
          count(t.id) desc,
          coalesce(sum(coalesce(t.amount_usd, t.amount_sol * t.sol_price_usd)), 0) desc
      ) as rank,
      coalesce(p.twitter_username, 'user_' || left(md5(t.user_id::text), 6)) as handle,
      count(t.id)::int as trades,
      coalesce(sum(coalesce(t.amount_usd, t.amount_sol * t.sol_price_usd)), 0) as volume_usd,
      coalesce(sum(t.amount_sol), 0) as amount_sol
    from public.transactions t
    left join public.profiles p on p.user_id = t.user_id
    where t.user_id is not null
      and t.created_at >= now() - interval '30 days'
      and coalesce(t.action, '') in ('buy', 'sell', 'transfer')
      and (
        t.tx_signature is not null
        or coalesce(t.status, '') in ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )
    group by t.user_id, p.twitter_username
  )
  select coalesce(jsonb_agg(to_jsonb(ranked) order by rank), '[]'::jsonb)
  from ranked
  where rank <= greatest(1, least(coalesce(limit_count, 5), 20));
$$;

revoke all on function public.get_home_top_traders_30d(integer) from public, anon, authenticated;
grant execute on function public.get_home_top_traders_30d(integer) to service_role;
