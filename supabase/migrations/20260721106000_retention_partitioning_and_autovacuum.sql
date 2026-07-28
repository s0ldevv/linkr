-- Bounded cold-path retention; no unbounded delete belongs on a hot request path.

create or replace function public.consume_linkr_rate_limit(
  p_subject_type text,
  p_subject_id text,
  p_window_seconds integer,
  p_limit integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_limit <= 0 then
    return query select true, 2147483647, now();
    return;
  end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid_rate_limit_window';
  end if;
  if nullif(btrim(p_subject_type), '') is null or nullif(btrim(p_subject_id), '') is null then
    raise exception 'invalid_rate_limit_subject';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.linkr_rate_limit_windows (
    subject_type, subject_id, window_seconds, window_start, request_count, updated_at
  ) values (
    left(p_subject_type, 80), left(p_subject_id, 240), p_window_seconds,
    v_window_start, 1, now()
  )
  on conflict (subject_type, subject_id, window_seconds, window_start)
  do update set request_count = public.linkr_rate_limit_windows.request_count + 1,
    updated_at = now()
  where public.linkr_rate_limit_windows.request_count < p_limit
  returning request_count into v_count;

  if v_count is null then
    return query select false, 0, v_window_start + make_interval(secs => p_window_seconds);
  else
    return query select true, greatest(0, p_limit - v_count),
      v_window_start + make_interval(secs => p_window_seconds);
  end if;
end;
$$;

create or replace function public.prune_linkr_queue_operational_data(
  p_row_budget integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget integer := least(greatest(coalesce(p_row_budget, 1000), 1), 10000);
  v_count integer;
  v_result jsonb := '{}'::jsonb;
begin
  perform set_config('statement_timeout', '5000', true);
  perform set_config('lock_timeout', '500', true);

  delete from public.linkr_rate_limit_windows t
  where t.ctid in (
    select ctid from public.linkr_rate_limit_windows
    where window_start + make_interval(secs => window_seconds * 2) < now()
    order by window_start limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('rate_limit_windows', v_count);

  delete from public.linkr_queue_health_buckets t
  where t.ctid in (
    select ctid from public.linkr_queue_health_buckets
    where bucket_at < now() - interval '14 days'
    order by bucket_at limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('queue_health_buckets', v_count);

  delete from public.linkr_edge_dispatch_failures t
  where t.ctid in (
    select ctid from public.linkr_edge_dispatch_failures
    where created_at < now() - interval '30 days'
    order by created_at limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('edge_dispatch_failures', v_count);

  delete from public.linkr_platform_capacity_buckets t
  where t.ctid in (
    select ctid from public.linkr_platform_capacity_buckets
    where bucket_at < now() - interval '90 days'
    order by bucket_at limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('capacity_buckets', v_count);

  delete from public.linkr_idempotency_tombstones t
  where t.ctid in (
    select ctid from public.linkr_idempotency_tombstones
    where expires_at < now()
    order by expires_at limit v_budget
  );
  get diagnostics v_count = row_count;
  return v_result || jsonb_build_object('idempotency_tombstones', v_count, 'pruned_at', now());
end;
$$;

create or replace function public.compact_terminal_linkr_work_items(
  p_older_than interval default interval '30 days',
  p_tombstone_retention interval default interval '180 days',
  p_row_budget integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_count integer := 0;
  v_budget integer := least(greatest(coalesce(p_row_budget, 250), 1), 1000);
begin
  if p_older_than < interval '1 day' or p_tombstone_retention < interval '30 days' then
    raise exception 'unsafe_compaction_retention';
  end if;
  perform set_config('statement_timeout', '5000', true);
  perform set_config('lock_timeout', '500', true);

  for v_item in
    select * from public.linkr_work_items
    where terminal_at < now() - p_older_than
      and state in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
      and (
        state <> 'dead_letter'
        or exists (
          select 1 from public.linkr_dead_letter_items d
          where d.work_item_id = linkr_work_items.id
            and d.redrive_state in ('resolved', 'cancelled')
        )
      )
    order by terminal_at
    for update skip locked
    limit v_budget
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_item.idempotency_key, 0));
    insert into public.linkr_idempotency_tombstones (
      idempotency_key, work_item_id, terminal_state, result_ref, terminal_at, expires_at
    ) values (
      v_item.idempotency_key, v_item.id, v_item.state, v_item.result_ref,
      v_item.terminal_at, greatest(v_item.terminal_at + p_tombstone_retention, now() + interval '30 days')
    ) on conflict (idempotency_key) do update set
      terminal_state = excluded.terminal_state,
      result_ref = excluded.result_ref,
      terminal_at = excluded.terminal_at,
      expires_at = greatest(public.linkr_idempotency_tombstones.expires_at, excluded.expires_at);
    delete from public.linkr_work_items where id = v_item.id;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('compacted', v_count, 'at', now());
end;
$$;

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
  v_budget integer := 1000;
  v_count integer := 0;
  v_result jsonb := '{}'::jsonb;
begin
  perform set_config('statement_timeout', '5000', true);
  perform set_config('lock_timeout', '500', true);

  delete from public.system_health_events t where t.ctid in (
    select ctid from public.system_health_events
    where checked_at < now() - make_interval(days => greatest(1, coalesce(p_health_retention_days, 14)))
    order by checked_at limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('system_health_events', v_count);

  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details t where t.ctid in (
      select ctid from cron.job_run_details
      where coalesce(end_time, start_time) < now() - make_interval(days => $1)
      order by coalesce(end_time, start_time) limit $2)'
      using greatest(1, coalesce(p_cron_retention_days, 7)), v_budget;
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('cron_job_run_details', v_count);
  end if;

  if to_regclass('net._http_response') is not null then
    execute 'delete from net._http_response t where t.ctid in (
      select ctid from net._http_response
      where created < now() - make_interval(hours => $1)
      order by created limit $2)'
      using greatest(1, coalesce(p_net_response_retention_hours, 6)), v_budget;
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('net_http_response', v_count);
  end if;

  if to_regclass('public.market_api_events') is not null then
    delete from public.market_api_events t where t.ctid in (
      select ctid from public.market_api_events
      where created_at < now() - make_interval(days => greatest(1, coalesce(p_market_event_retention_days, 7)))
      order by created_at limit v_budget
    );
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('market_api_events', v_count);
  end if;

  if to_regclass('public.market_token_snapshots') is not null then
    delete from public.market_token_snapshots t where t.ctid in (
      select ctid from public.market_token_snapshots
      where expires_at < now() - make_interval(days => greatest(1, coalesce(p_market_snapshot_retention_days, 2)))
      order by expires_at limit v_budget
    );
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('market_token_snapshots', v_count);
  end if;

  if to_regclass('public.market_discovery_snapshots') is not null then
    delete from public.market_discovery_snapshots t where t.ctid in (
      select ctid from public.market_discovery_snapshots
      where expires_at < now() - make_interval(days => greatest(1, coalesce(p_market_snapshot_retention_days, 2)))
      order by expires_at limit v_budget
    );
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('market_discovery_snapshots', v_count);
  end if;

  if to_regclass('public.x_bot_token_events') is not null then
    delete from public.x_bot_token_events t where t.ctid in (
      select ctid from public.x_bot_token_events
      where created_at < now() - make_interval(days => greatest(1, coalesce(p_token_event_retention_days, 30)))
      order by created_at limit v_budget
    );
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('x_bot_token_events', v_count);
  end if;

  return v_result || public.prune_linkr_queue_operational_data(v_budget)
    || jsonb_build_object('pruned_at', now(), 'row_budget_per_table', v_budget);
end;
$$;

alter table public.linkr_work_items set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_threshold = 500
);
alter table public.linkr_dispatch_stage_state set (
  fillfactor = 80,
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 100
);
alter table public.linkr_worker_capacity_slots set (fillfactor = 80);
alter table public.linkr_resource_heads set (fillfactor = 80);

revoke all on function public.prune_linkr_queue_operational_data(integer) from public, anon, authenticated;
revoke all on function public.compact_terminal_linkr_work_items(interval, interval, integer) from public, anon, authenticated;
grant execute on function public.prune_linkr_queue_operational_data(integer) to service_role, postgres;
grant execute on function public.compact_terminal_linkr_work_items(interval, interval, integer) to service_role, postgres;
