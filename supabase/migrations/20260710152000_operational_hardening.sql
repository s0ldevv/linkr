-- Operational hardening for live cron/health paths.
-- Keeps high-frequency health and scheduler telemetry useful without letting
-- operational tables grow unbounded.

create table if not exists public.system_health_latest (
  source text primary key,
  status text not null check (status in ('ok','degraded','down')),
  latency_ms integer,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  last_persisted_at timestamptz,
  updated_at timestamptz not null default now()
);

grant all on public.system_health_latest to service_role;
alter table public.system_health_latest enable row level security;

create index if not exists system_health_events_checked_idx
  on public.system_health_events (checked_at desc);

insert into public.system_health_latest (
  source,
  status,
  latency_ms,
  details,
  checked_at,
  last_persisted_at,
  updated_at
)
select distinct on (source)
  source,
  status,
  latency_ms,
  coalesce(details, '{}'::jsonb),
  checked_at,
  checked_at,
  now()
from public.system_health_events
order by source, checked_at desc
on conflict (source) do update
set
  status = excluded.status,
  latency_ms = excluded.latency_ms,
  details = excluded.details,
  checked_at = excluded.checked_at,
  last_persisted_at = greatest(
    coalesce(public.system_health_latest.last_persisted_at, excluded.last_persisted_at),
    excluded.last_persisted_at
  ),
  updated_at = now();

create or replace function public.record_system_health_event(
  p_source text,
  p_status text,
  p_latency_ms integer,
  p_details jsonb default '{}'::jsonb,
  p_sample_minutes integer default 15
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_prev_status text;
  v_prev_last_persisted_at timestamptz;
  v_should_persist boolean;
  v_sample_minutes integer := greatest(1, least(coalesce(p_sample_minutes, 15), 1440));
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if p_source is null or btrim(p_source) = '' then
    return;
  end if;

  if p_status not in ('ok', 'degraded', 'down') then
    return;
  end if;

  select status, last_persisted_at
  into v_prev_status, v_prev_last_persisted_at
  from public.system_health_latest
  where source = p_source
  for update;

  v_should_persist :=
    p_status <> 'ok'
    or v_prev_status is null
    or v_prev_status is distinct from p_status
    or v_prev_last_persisted_at is null
    or v_prev_last_persisted_at < v_now - make_interval(mins => v_sample_minutes);

  insert into public.system_health_latest (
    source,
    status,
    latency_ms,
    details,
    checked_at,
    last_persisted_at,
    updated_at
  )
  values (
    p_source,
    p_status,
    greatest(0, coalesce(p_latency_ms, 0)),
    v_details,
    v_now,
    case when v_should_persist then v_now else null end,
    v_now
  )
  on conflict (source) do update
  set
    status = excluded.status,
    latency_ms = excluded.latency_ms,
    details = excluded.details,
    checked_at = excluded.checked_at,
    last_persisted_at = case
      when v_should_persist then v_now
      else public.system_health_latest.last_persisted_at
    end,
    updated_at = v_now;

  if v_should_persist then
    insert into public.system_health_events (
      source,
      status,
      latency_ms,
      details,
      checked_at
    )
    values (
      p_source,
      p_status,
      greatest(0, coalesce(p_latency_ms, 0)),
      v_details,
      v_now
    );
  end if;
end;
$$;

revoke all on function public.record_system_health_event(text, text, integer, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.record_system_health_event(text, text, integer, jsonb, integer)
  to service_role;

create or replace function public.prune_operational_logs(
  p_health_retention_days integer default 14,
  p_cron_retention_days integer default 7,
  p_net_response_retention_hours integer default 6,
  p_market_event_retention_days integer default 7,
  p_market_snapshot_retention_days integer default 2,
  p_token_event_retention_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_result jsonb := '{}'::jsonb;
begin
  delete from public.system_health_events
  where checked_at < now() - make_interval(days => greatest(1, coalesce(p_health_retention_days, 14)));
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('system_health_events', v_count);

  if to_regclass('cron.job_run_details') is not null then
    execute
      'delete from cron.job_run_details
       where coalesce(end_time, start_time) < now() - make_interval(days => $1)'
      using greatest(1, coalesce(p_cron_retention_days, 7));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('cron_job_run_details', v_count);
  end if;

  if to_regclass('net._http_response') is not null then
    execute
      'delete from net._http_response
       where created < now() - make_interval(hours => $1)'
      using greatest(1, coalesce(p_net_response_retention_hours, 6));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('net_http_response', v_count);
  end if;

  if to_regclass('public.market_api_events') is not null then
    delete from public.market_api_events
    where created_at < now() - make_interval(days => greatest(1, coalesce(p_market_event_retention_days, 7)));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('market_api_events', v_count);
  end if;

  if to_regclass('public.market_token_snapshots') is not null then
    delete from public.market_token_snapshots
    where expires_at < now() - make_interval(days => greatest(1, coalesce(p_market_snapshot_retention_days, 2)));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('market_token_snapshots', v_count);
  end if;

  if to_regclass('public.market_discovery_snapshots') is not null then
    delete from public.market_discovery_snapshots
    where expires_at < now() - make_interval(days => greatest(1, coalesce(p_market_snapshot_retention_days, 2)));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('market_discovery_snapshots', v_count);
  end if;

  if to_regclass('public.x_bot_token_events') is not null then
    delete from public.x_bot_token_events
    where created_at < now() - make_interval(days => greatest(1, coalesce(p_token_event_retention_days, 30)));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('x_bot_token_events', v_count);
  end if;

  return v_result || jsonb_build_object('pruned_at', now());
end;
$$;

revoke all on function public.prune_operational_logs(integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.prune_operational_logs(integer, integer, integer, integer, integer, integer)
  to service_role;

create index if not exists agent_runs_created_idx
  on public.agent_runs (created_at desc);

create index if not exists tweets_inbox_created_idx
  on public.tweets_inbox (created_at desc);

create index if not exists transactions_status_created_idx
  on public.transactions (status, created_at desc);

create index if not exists transactions_created_idx
  on public.transactions (created_at desc);

create index if not exists coin_launches_status_created_idx
  on public.coin_launches (status, created_at desc);

create or replace function public.get_home_system_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source', source,
        'status', status,
        'latency_ms', latency_ms,
        'checked_at', checked_at
      )
      order by source
    ),
    '[]'::jsonb
  )
  from public.system_health_latest;
$$;

revoke all on function public.get_home_system_status() from public, anon, authenticated;
grant execute on function public.get_home_system_status() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'linkr-prune-operational-logs') then
      perform cron.unschedule('linkr-prune-operational-logs');
    end if;

    perform cron.schedule(
      'linkr-prune-operational-logs',
      '17 * * * *',
      'select public.prune_operational_logs();'
    );
  end if;
end;
$$;
