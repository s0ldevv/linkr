-- Fixed-row dispatch control and bounded aggregate health.

create table public.linkr_queue_runtime_config (
  stage text primary key,
  worker_function text not null,
  enabled boolean not null default false,
  min_concurrency smallint not null default 0,
  max_concurrency smallint not null default 1,
  batch_size smallint not null default 1,
  visibility_timeout_seconds integer not null default 120,
  target_oldest_age_seconds integer not null default 60,
  dispatch_weight smallint not null default 1,
  pause_reason text,
  updated_at timestamptz not null default now(),
  constraint linkr_queue_runtime_concurrency_check check (
    min_concurrency between 0 and 256
    and max_concurrency between 1 and 256
    and min_concurrency <= max_concurrency
  ),
  constraint linkr_queue_runtime_batch_check check (batch_size between 1 and 20),
  constraint linkr_queue_runtime_visibility_check check (visibility_timeout_seconds between 10 and 3600),
  constraint linkr_queue_runtime_target_age_check check (target_oldest_age_seconds between 1 and 86400),
  constraint linkr_queue_runtime_weight_check check (dispatch_weight between 1 and 100)
);

create table public.linkr_platform_control (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'normal',
  threshold_band text not null default 'normal',
  reason text,
  metrics_sampled_at timestamptz,
  last_active_sample_at timestamptz,
  last_deep_sample_at timestamptz,
  controller_fencing_token bigint not null default 0,
  configured_storage_budget_bytes bigint,
  updated_at timestamptz not null default now(),
  constraint linkr_platform_mode_check check (
    mode in ('normal', 'degraded', 'commands_paused', 'intake_paused')
  ),
  constraint linkr_platform_band_check check (
    threshold_band in ('normal', 'warning', 'critical')
  )
);

insert into public.linkr_platform_control (singleton) values (true)
on conflict do nothing;

create table public.linkr_dispatch_stage_state (
  stage text primary key references public.linkr_queue_runtime_config(stage) on delete cascade,
  wake_generation bigint not null default 0,
  state text not null default 'idle',
  lease_owner text,
  lease_expires_at timestamptz,
  last_request_id bigint,
  last_requested_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  success_count bigint not null default 0,
  failure_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint linkr_dispatch_stage_state_check check (state in ('idle', 'pending', 'running', 'paused')),
  constraint linkr_dispatch_generation_check check (wake_generation >= 0),
  constraint linkr_dispatch_counts_check check (success_count >= 0 and failure_count >= 0)
);

create table public.linkr_queue_health_buckets (
  stage text not null,
  bucket_at timestamptz not null,
  sample_count integer not null default 0,
  queue_length_max bigint not null default 0,
  oldest_age_seconds_max bigint not null default 0,
  dispatch_success_count bigint not null default 0,
  dispatch_failure_count bigint not null default 0,
  primary key (stage, bucket_at),
  constraint linkr_queue_health_bucket_minute check (bucket_at = date_trunc('minute', bucket_at))
);

create table public.linkr_edge_dispatch_failures (
  id bigint generated always as identity primary key,
  stage text not null,
  request_id bigint,
  wake_generation bigint,
  status_code integer,
  timed_out boolean not null default false,
  error_code text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index linkr_edge_dispatch_failures_stage_time_idx
  on public.linkr_edge_dispatch_failures (stage, created_at desc);

create table public.linkr_provider_health (
  provider_label text primary key,
  provider_kind text not null,
  endpoint_identity text not null,
  state text not null default 'unknown',
  consecutive_failures integer not null default 0,
  latency_ms_ema numeric,
  cooldown_until timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  sampled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint linkr_provider_state_check check (state in ('unknown', 'healthy', 'degraded', 'open', 'probing')),
  constraint linkr_provider_failure_count_check check (consecutive_failures >= 0)
);

create table public.linkr_platform_incidents (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  severity text not null,
  state text not null default 'open',
  title text not null,
  details jsonb not null default '{}'::jsonb,
  occurrence_count bigint not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint linkr_platform_incident_severity_check check (severity in ('warning', 'critical')),
  constraint linkr_platform_incident_state_check check (state in ('open', 'resolved')),
  constraint linkr_platform_incident_details_size check (octet_length(details::text) <= 16384)
);

create unique index linkr_platform_incidents_open_uidx
  on public.linkr_platform_incidents (fingerprint)
  where state = 'open';

create table public.linkr_platform_capacity_buckets (
  bucket_at timestamptz primary key,
  database_size_bytes bigint not null,
  queue_size_bytes bigint not null,
  active_connections integer,
  total_connections integer,
  dead_tuple_estimate bigint,
  details jsonb not null default '{}'::jsonb,
  constraint linkr_platform_capacity_bucket_check check (bucket_at = date_trunc('hour', bucket_at)),
  constraint linkr_platform_capacity_details_size check (octet_length(details::text) <= 16384)
);

insert into public.linkr_queue_runtime_config (
  stage, worker_function, enabled, batch_size, visibility_timeout_seconds
)
values
  ('x_ingress', 'worker-x-ingress', false, 10, 120),
  ('telegram_control', 'worker-telegram-control', false, 5, 120),
  ('conversation_turns_high', 'worker-conversation-turn', false, 1, 600),
  ('conversation_turns_normal', 'worker-conversation-turn', false, 1, 600),
  ('command_prepare', 'worker-command-prepare', false, 1, 600),
  ('media_capture', 'worker-media-capture', false, 5, 180),
  ('action_solana', 'worker-action-solana', false, 1, 600),
  ('action_robinhood', 'worker-action-robinhood', false, 1, 600),
  ('launch_solana', 'worker-launch-solana', false, 1, 600),
  ('launch_robinhood', 'worker-launch-robinhood', false, 1, 600),
  ('confirm_solana', 'worker-confirm-solana', false, 10, 120),
  ('confirm_robinhood', 'worker-confirm-robinhood', false, 10, 120),
  ('reply_x_high', 'worker-reply-x', false, 5, 120),
  ('reply_x_normal', 'worker-reply-x', false, 5, 120),
  ('reply_telegram_high', 'worker-reply-telegram', false, 5, 120),
  ('reply_telegram_normal', 'worker-reply-telegram', false, 5, 120),
  ('reconciliation', 'worker-reconcile', false, 5, 180)
on conflict (stage) do nothing;

insert into public.linkr_dispatch_stage_state (stage)
select stage from public.linkr_queue_runtime_config
on conflict do nothing;

create or replace function public.request_linkr_stage_wake(p_stage text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.linkr_dispatch_stage_state%rowtype;
begin
  update public.linkr_dispatch_stage_state d
  set wake_generation = wake_generation + 1,
      state = 'pending',
      lease_owner = null,
      lease_expires_at = now() + interval '2 minutes',
      updated_at = now()
  from public.linkr_queue_runtime_config c
  where d.stage = p_stage
    and c.stage = d.stage
    and c.enabled
    and (d.state = 'idle' or d.lease_expires_at < now())
  returning d.* into v_row;

  return jsonb_build_object(
    'requested', found,
    'stage', p_stage,
    'wake_generation', v_row.wake_generation
  );
end;
$$;

create or replace function public.mark_linkr_dispatch_started(
  p_stage text,
  p_wake_generation bigint,
  p_worker_id text,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.linkr_dispatch_stage_state
  set state = 'running', lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds, 10), 3600)),
      last_started_at = now(), updated_at = now()
  where stage = p_stage and wake_generation = p_wake_generation
    and state = 'pending' and lease_expires_at >= now();
  return found;
end;
$$;

create or replace function public.mark_linkr_dispatch_finished(
  p_stage text,
  p_wake_generation bigint,
  p_worker_id text,
  p_backlog_remains boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.linkr_dispatch_stage_state
  set state = case when p_backlog_remains then 'pending' else 'idle' end,
      wake_generation = case when p_backlog_remains then wake_generation + 1 else wake_generation end,
      lease_owner = null,
      lease_expires_at = case when p_backlog_remains then now() + interval '2 minutes' else null end,
      last_completed_at = now(), updated_at = now()
  where stage = p_stage and wake_generation = p_wake_generation
    and state = 'running' and lease_owner = p_worker_id;
  return found;
end;
$$;

create or replace function public.dispatch_ready_linkr_workers(p_global_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_project_url text;
  v_internal_key text;
  v_config public.linkr_queue_runtime_config%rowtype;
  v_dispatch public.linkr_dispatch_stage_state%rowtype;
  v_metric jsonb;
  v_queue_length bigint;
  v_active_leases integer;
  v_request_id bigint;
  v_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_platform_mode text;
begin
  p_global_limit := least(greatest(coalesce(p_global_limit, 8), 1), 8);
  perform public.release_expired_linkr_leases();

  select mode into v_platform_mode from public.linkr_platform_control where singleton;
  if v_platform_mode in ('commands_paused', 'intake_paused') then
    return jsonb_build_object('dispatched', 0, 'mode', v_platform_mode);
  end if;

  select nullif(rtrim(decrypted_secret, '/'), '') into v_project_url
  from vault.decrypted_secrets where name = 'x_wallet_agent_project_url' limit 1;
  select nullif(btrim(decrypted_secret), '') into v_internal_key
  from vault.decrypted_secrets where name = 'x_wallet_agent_internal_cron_key' limit 1;

  if v_project_url is null or v_internal_key is null then
    insert into public.linkr_platform_incidents (fingerprint, severity, title, details)
    values ('queue-dispatch-config-missing', 'critical', 'Queue dispatcher configuration missing',
      jsonb_build_object('project_url_configured', v_project_url is not null, 'internal_key_configured', v_internal_key is not null))
    on conflict (fingerprint) where state = 'open'
    do update set occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
      last_seen_at = now(), details = excluded.details;
    return jsonb_build_object('dispatched', 0, 'error', 'configuration_missing');
  end if;

  for v_config in
    select * from public.linkr_queue_runtime_config
    where enabled
    order by dispatch_weight desc, stage
  loop
    exit when v_count >= p_global_limit;

    select to_jsonb(m) into v_metric
    from pgmq.metrics_all() m
    where to_jsonb(m)->>'queue_name' = v_config.stage;
    v_queue_length := coalesce((v_metric->>'queue_length')::bigint, 0);
    if v_queue_length <= 0 then continue; end if;

    select count(*)::integer into v_active_leases
    from public.linkr_worker_capacity_slots
    where stage = v_config.stage and enabled
      and lease_owner is not null and lease_expires_at >= now();
    if v_active_leases >= v_config.max_concurrency then continue; end if;

    update public.linkr_dispatch_stage_state
    set state = 'pending', wake_generation = wake_generation + 1,
        lease_owner = null, lease_expires_at = now() + interval '2 minutes',
        last_requested_at = now(), updated_at = now()
    where stage = v_config.stage
      and (state = 'idle' or lease_expires_at < now())
    returning * into v_dispatch;
    if not found then continue; end if;

    select net.http_post(
      url := v_project_url || '/functions/v1/' || v_config.worker_function,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_internal_key),
      body := jsonb_build_object('stage', v_config.stage, 'wake_generation', v_dispatch.wake_generation)
    ) into v_request_id;

    update public.linkr_dispatch_stage_state
    set last_request_id = v_request_id, updated_at = now()
    where stage = v_config.stage and wake_generation = v_dispatch.wake_generation;

    v_count := v_count + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'stage', v_config.stage, 'request_id', v_request_id,
      'wake_generation', v_dispatch.wake_generation
    ));
  end loop;

  return jsonb_build_object('dispatched', v_count, 'items', v_results, 'mode', v_platform_mode);
exception when others then
  insert into public.linkr_edge_dispatch_failures (stage, error_code, error_message)
  values ('dispatcher', sqlstate, left(sqlerrm, 500));
  return jsonb_build_object('dispatched', v_count, 'error', sqlstate);
end;
$$;

create or replace function public.handle_linkr_queue_dispatch_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage text;
begin
  select stage into v_stage from public.linkr_dispatch_stage_state
  where last_request_id = new.id;
  if not found then return new; end if;

  if coalesce(new.timed_out, false) or new.error_msg is not null
     or new.status_code is null or new.status_code < 200 or new.status_code >= 300 then
    update public.linkr_dispatch_stage_state
    set state = 'idle', lease_owner = null, lease_expires_at = null,
        failure_count = failure_count + 1, updated_at = now()
    where stage = v_stage and last_request_id = new.id;
    insert into public.linkr_edge_dispatch_failures (
      stage, request_id, wake_generation, status_code, timed_out, error_code, error_message
    )
    select stage, new.id, wake_generation, new.status_code,
      coalesce(new.timed_out, false), 'edge_dispatch_http_failed', left(coalesce(new.error_msg, 'non_success_http_status'), 500)
    from public.linkr_dispatch_stage_state where stage = v_stage;
  else
    update public.linkr_dispatch_stage_state
    set success_count = success_count + 1, updated_at = now()
    where stage = v_stage and last_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists linkr_queue_dispatch_response_health on net._http_response;
create trigger linkr_queue_dispatch_response_health
after insert on net._http_response
for each row execute function public.handle_linkr_queue_dispatch_response();

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
  select last_active_sample_at into v_last from public.linkr_platform_control where singleton for update;
  select exists (
    select 1 from public.linkr_dispatch_stage_state
    where state in ('pending', 'running') or last_completed_at > now() - interval '5 minutes'
  ) into v_has_activity;
  if v_last is not null
     and v_last > v_now - (case when v_has_activity then interval '1 minute' else interval '5 minutes' end) then
    return jsonb_build_object('sampled', false, 'reason', 'cadence');
  end if;

  select count(*)::integer, count(*) filter (where state = 'active')::integer
  into v_connections, v_active from pg_stat_activity;

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
      queue_length_max = greatest(public.linkr_queue_health_buckets.queue_length_max, excluded.queue_length_max),
      oldest_age_seconds_max = greatest(public.linkr_queue_health_buckets.oldest_age_seconds_max, excluded.oldest_age_seconds_max);
  end loop;

  update public.linkr_platform_control
  set last_active_sample_at = v_now, metrics_sampled_at = v_now, updated_at = v_now
  where singleton;
  return jsonb_build_object('sampled', true, 'connections', v_connections, 'active_connections', v_active);
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
begin
  if exists (
    select 1 from public.linkr_platform_control
    where singleton and last_deep_sample_at > now() - interval '10 minutes'
  ) then return jsonb_build_object('sampled', false, 'reason', 'cadence'); end if;

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
    database_size_bytes = greatest(public.linkr_platform_capacity_buckets.database_size_bytes, excluded.database_size_bytes),
    queue_size_bytes = greatest(public.linkr_platform_capacity_buckets.queue_size_bytes, excluded.queue_size_bytes),
    active_connections = greatest(public.linkr_platform_capacity_buckets.active_connections, excluded.active_connections),
    total_connections = greatest(public.linkr_platform_capacity_buckets.total_connections, excluded.total_connections),
    dead_tuple_estimate = greatest(public.linkr_platform_capacity_buckets.dead_tuple_estimate, excluded.dead_tuple_estimate);

  update public.linkr_platform_control
  set last_deep_sample_at = v_now, metrics_sampled_at = v_now, updated_at = v_now
  where singleton;
  return jsonb_build_object('sampled', true, 'database_size_bytes', v_db_size, 'queue_size_bytes', v_queue_size);
end;
$$;

alter table public.linkr_queue_runtime_config enable row level security;
alter table public.linkr_platform_control enable row level security;
alter table public.linkr_dispatch_stage_state enable row level security;
alter table public.linkr_queue_health_buckets enable row level security;
alter table public.linkr_edge_dispatch_failures enable row level security;
alter table public.linkr_provider_health enable row level security;
alter table public.linkr_platform_incidents enable row level security;
alter table public.linkr_platform_capacity_buckets enable row level security;

revoke all on public.linkr_queue_runtime_config, public.linkr_platform_control,
  public.linkr_dispatch_stage_state, public.linkr_queue_health_buckets,
  public.linkr_edge_dispatch_failures, public.linkr_provider_health,
  public.linkr_platform_incidents, public.linkr_platform_capacity_buckets
  from public, anon, authenticated;
grant all on public.linkr_queue_runtime_config, public.linkr_platform_control,
  public.linkr_dispatch_stage_state, public.linkr_queue_health_buckets,
  public.linkr_edge_dispatch_failures, public.linkr_provider_health,
  public.linkr_platform_incidents, public.linkr_platform_capacity_buckets
  to service_role;
grant usage, select on sequence public.linkr_edge_dispatch_failures_id_seq to service_role;

revoke all on function public.request_linkr_stage_wake(text) from public, anon, authenticated;
revoke all on function public.mark_linkr_dispatch_started(text, bigint, text, integer) from public, anon, authenticated;
revoke all on function public.mark_linkr_dispatch_finished(text, bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.dispatch_ready_linkr_workers(integer) from public, anon, authenticated, service_role;
revoke all on function public.sample_linkr_platform_active() from public, anon, authenticated;
revoke all on function public.sample_linkr_platform_capacity_deep() from public, anon, authenticated;
grant execute on function public.request_linkr_stage_wake(text) to service_role;
grant execute on function public.mark_linkr_dispatch_started(text, bigint, text, integer) to service_role;
grant execute on function public.mark_linkr_dispatch_finished(text, bigint, text, boolean) to service_role;
grant execute on function public.dispatch_ready_linkr_workers(integer) to postgres;
grant execute on function public.sample_linkr_platform_active() to postgres, service_role;
grant execute on function public.sample_linkr_platform_capacity_deep() to postgres, service_role;
