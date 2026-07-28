-- Replace the first retention pass with small bounded deletes so cleanup cannot
-- monopolize the database or hit API statement timeouts on large log tables.

do $$
begin
  execute format('alter database %I set cron.log_run = off', current_database());
  execute format('alter database %I set cron.log_statement = off', current_database());
exception
  when others then
    raise notice 'Skipping pg_cron logging settings: %', sqlerrm;
end;
$$;

drop function if exists public.prune_operational_logs(integer, integer, integer, integer, integer, integer);

create or replace function public.prune_operational_logs(
  p_health_retention_days integer default 14,
  p_cron_retention_days integer default 7,
  p_net_response_retention_hours integer default 6,
  p_market_event_retention_days integer default 7,
  p_market_snapshot_retention_days integer default 2,
  p_token_event_retention_days integer default 30,
  p_batch_size integer default 250,
  p_max_rows_per_table integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 250), 5000));
  v_max_rows integer := greatest(1, least(coalesce(p_max_rows_per_table, 1000), 50000));
  v_limit integer;
  v_deleted integer := 0;
  v_total integer := 0;
  v_result jsonb := '{}'::jsonb;
begin
  v_total := 0;
  loop
    v_limit := least(v_batch_size, v_max_rows - v_total);
    exit when v_limit <= 0;

    with doomed as (
      select ctid
      from public.system_health_events
      where checked_at < now() - make_interval(days => greatest(1, coalesce(p_health_retention_days, 14)))
      limit v_limit
    )
    delete from public.system_health_events target
    using doomed
    where target.ctid = doomed.ctid;

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted = 0 or v_total >= v_max_rows;
  end loop;
  v_result := v_result || jsonb_build_object('system_health_events', v_total);

  if to_regclass('cron.job_run_details') is not null then
    v_total := 0;
    loop
      v_limit := least(v_batch_size, v_max_rows - v_total);
      exit when v_limit <= 0;

      execute
        'with doomed as (
           select ctid
           from cron.job_run_details
           where coalesce(end_time, start_time) < now() - make_interval(days => $1)
           limit $2
         )
         delete from cron.job_run_details target
         using doomed
         where target.ctid = doomed.ctid'
      using greatest(1, coalesce(p_cron_retention_days, 7)), v_limit;

      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      exit when v_deleted = 0 or v_total >= v_max_rows;
    end loop;
    v_result := v_result || jsonb_build_object('cron_job_run_details', v_total);
  end if;

  if to_regclass('net._http_response') is not null then
    v_total := 0;
    loop
      v_limit := least(v_batch_size, v_max_rows - v_total);
      exit when v_limit <= 0;

      execute
        'with doomed as (
           select ctid
           from net._http_response
           where created < now() - make_interval(hours => $1)
           limit $2
         )
         delete from net._http_response target
         using doomed
         where target.ctid = doomed.ctid'
      using greatest(1, coalesce(p_net_response_retention_hours, 6)), v_limit;

      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      exit when v_deleted = 0 or v_total >= v_max_rows;
    end loop;
    v_result := v_result || jsonb_build_object('net_http_response', v_total);
  end if;

  if to_regclass('public.market_api_events') is not null then
    v_total := 0;
    loop
      v_limit := least(v_batch_size, v_max_rows - v_total);
      exit when v_limit <= 0;

      with doomed as (
        select ctid
        from public.market_api_events
        where created_at < now() - make_interval(days => greatest(1, coalesce(p_market_event_retention_days, 7)))
        limit v_limit
      )
      delete from public.market_api_events target
      using doomed
      where target.ctid = doomed.ctid;

      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      exit when v_deleted = 0 or v_total >= v_max_rows;
    end loop;
    v_result := v_result || jsonb_build_object('market_api_events', v_total);
  end if;

  if to_regclass('public.market_token_snapshots') is not null then
    v_total := 0;
    loop
      v_limit := least(v_batch_size, v_max_rows - v_total);
      exit when v_limit <= 0;

      with doomed as (
        select ctid
        from public.market_token_snapshots
        where expires_at < now() - make_interval(days => greatest(1, coalesce(p_market_snapshot_retention_days, 2)))
        limit v_limit
      )
      delete from public.market_token_snapshots target
      using doomed
      where target.ctid = doomed.ctid;

      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      exit when v_deleted = 0 or v_total >= v_max_rows;
    end loop;
    v_result := v_result || jsonb_build_object('market_token_snapshots', v_total);
  end if;

  if to_regclass('public.market_discovery_snapshots') is not null then
    v_total := 0;
    loop
      v_limit := least(v_batch_size, v_max_rows - v_total);
      exit when v_limit <= 0;

      with doomed as (
        select ctid
        from public.market_discovery_snapshots
        where expires_at < now() - make_interval(days => greatest(1, coalesce(p_market_snapshot_retention_days, 2)))
        limit v_limit
      )
      delete from public.market_discovery_snapshots target
      using doomed
      where target.ctid = doomed.ctid;

      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      exit when v_deleted = 0 or v_total >= v_max_rows;
    end loop;
    v_result := v_result || jsonb_build_object('market_discovery_snapshots', v_total);
  end if;

  if to_regclass('public.x_bot_token_events') is not null then
    v_total := 0;
    loop
      v_limit := least(v_batch_size, v_max_rows - v_total);
      exit when v_limit <= 0;

      with doomed as (
        select ctid
        from public.x_bot_token_events
        where created_at < now() - make_interval(days => greatest(1, coalesce(p_token_event_retention_days, 30)))
        limit v_limit
      )
      delete from public.x_bot_token_events target
      using doomed
      where target.ctid = doomed.ctid;

      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      exit when v_deleted = 0 or v_total >= v_max_rows;
    end loop;
    v_result := v_result || jsonb_build_object('x_bot_token_events', v_total);
  end if;

  return v_result
    || jsonb_build_object(
      'batch_size', v_batch_size,
      'max_rows_per_table', v_max_rows,
      'pruned_at', now()
    );
end;
$$;

revoke all on function public.prune_operational_logs(integer, integer, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.prune_operational_logs(integer, integer, integer, integer, integer, integer, integer, integer)
  to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'linkr-prune-operational-logs') then
      perform cron.unschedule('linkr-prune-operational-logs');
    end if;

    perform cron.schedule(
      'linkr-prune-operational-logs',
      '*/5 * * * *',
      'select public.prune_operational_logs();'
    );
  end if;
end;
$$;
