-- Idle queues need no per-queue history rows. Keep only a five-minute control
-- heartbeat and run expensive capacity catalog scans hourly while idle.

create or replace function public.sample_linkr_platform_active()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_now timestamptz := now();
  v_last timestamptz;
  v_has_activity boolean;
  v_connections integer;
  v_active integer;
  v_metric record;
begin
  select last_active_sample_at into v_last
  from public.linkr_platform_control where singleton for update;
  select exists (
    select 1 from public.linkr_dispatch_stage_state
    where state in ('pending', 'running')
       or last_completed_at > now() - interval '5 minutes'
  ) into v_has_activity;
  if v_last is not null and v_last > v_now -
    (case when v_has_activity then interval '1 minute' else interval '5 minutes' end)
  then return jsonb_build_object('sampled', false, 'reason', 'cadence'); end if;

  select count(*)::integer, count(*) filter (where state = 'active')::integer
  into v_connections, v_active from pg_stat_activity;

  if v_has_activity then
    for v_metric in select * from pgmq.metrics_all()
    loop
      insert into public.linkr_queue_health_buckets (
        stage, bucket_at, sample_count, queue_length_max, oldest_age_seconds_max
      ) values (
        to_jsonb(v_metric)->>'queue_name', date_trunc('minute', v_now), 1,
        coalesce((to_jsonb(v_metric)->>'queue_length')::bigint, 0),
        coalesce((to_jsonb(v_metric)->>'oldest_msg_age_sec')::bigint, 0)
      ) on conflict (stage, bucket_at) do update set
        sample_count = public.linkr_queue_health_buckets.sample_count + 1,
        queue_length_max = greatest(public.linkr_queue_health_buckets.queue_length_max,
          excluded.queue_length_max),
        oldest_age_seconds_max = greatest(
          public.linkr_queue_health_buckets.oldest_age_seconds_max,
          excluded.oldest_age_seconds_max);
    end loop;
  end if;

  update public.linkr_platform_control
  set last_active_sample_at = v_now, metrics_sampled_at = v_now, updated_at = v_now
  where singleton;
  return jsonb_build_object('sampled', true, 'active_work', v_has_activity,
    'connections', v_connections, 'active_connections', v_active);
end;
$$;

create or replace function public.sample_linkr_platform_capacity_deep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_db_size bigint;
  v_queue_size bigint;
  v_dead bigint;
  v_total_connections integer;
  v_active_connections integer;
  v_now timestamptz := now();
  v_has_activity boolean;
  v_last timestamptz;
begin
  select last_deep_sample_at into v_last
  from public.linkr_platform_control where singleton;
  select exists (
    select 1 from public.linkr_dispatch_stage_state
    where state in ('pending', 'running')
       or last_completed_at > now() - interval '10 minutes'
  ) into v_has_activity;
  if v_last is not null and v_last > now() -
    (case when v_has_activity then interval '10 minutes' else interval '1 hour' end)
  then return jsonb_build_object('sampled', false, 'reason', 'cadence'); end if;

  perform set_config('statement_timeout', '5000', true);
  select pg_database_size(current_database()) into v_db_size;
  select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint into v_queue_size
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'pgmq' and (c.relname like 'q_%' or c.relname like 'a_%');
  select coalesce(sum(n_dead_tup), 0)::bigint into v_dead from pg_stat_user_tables;
  select count(*)::integer, count(*) filter (where state = 'active')::integer
  into v_total_connections, v_active_connections from pg_stat_activity;

  insert into public.linkr_platform_capacity_buckets (
    bucket_at, database_size_bytes, queue_size_bytes, active_connections,
    total_connections, dead_tuple_estimate
  ) values (
    date_trunc('hour', v_now), v_db_size, v_queue_size,
    v_active_connections, v_total_connections, v_dead
  ) on conflict (bucket_at) do update set
    database_size_bytes = greatest(public.linkr_platform_capacity_buckets.database_size_bytes,
      excluded.database_size_bytes),
    queue_size_bytes = greatest(public.linkr_platform_capacity_buckets.queue_size_bytes,
      excluded.queue_size_bytes),
    active_connections = greatest(public.linkr_platform_capacity_buckets.active_connections,
      excluded.active_connections),
    total_connections = greatest(public.linkr_platform_capacity_buckets.total_connections,
      excluded.total_connections),
    dead_tuple_estimate = greatest(public.linkr_platform_capacity_buckets.dead_tuple_estimate,
      excluded.dead_tuple_estimate);

  update public.linkr_platform_control
  set last_deep_sample_at = v_now, metrics_sampled_at = v_now, updated_at = v_now
  where singleton;
  return jsonb_build_object('sampled', true, 'active_work', v_has_activity,
    'database_size_bytes', v_db_size, 'queue_size_bytes', v_queue_size);
end;
$$;
