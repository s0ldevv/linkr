-- Durable delivery ownership, bounded repair, versioned action preparation,
-- and resource-aware circuit breaking for the real request pipeline.

alter table public.linkr_queue_runtime_config
  add column if not exists consumer_version text not null default 'unverified';

alter table public.linkr_dispatch_stage_state
  add column if not exists consecutive_failure_count integer not null default 0,
  add column if not exists last_status_code integer,
  add column if not exists last_error_code text,
  add column if not exists last_failure_at timestamptz,
  add column if not exists circuit_open_until timestamptz,
  add column if not exists required_consumer_version text;

alter table public.linkr_dispatch_stage_state
  drop constraint if exists linkr_dispatch_consecutive_failure_check;
alter table public.linkr_dispatch_stage_state
  add constraint linkr_dispatch_consecutive_failure_check
  check (consecutive_failure_count >= 0);

create or replace function public.linkr_queue_message_exists(
  p_queue_name text,
  p_message_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_relation regclass;
  v_exists boolean := false;
begin
  if p_queue_name !~ '^[a-z][a-z0-9_]{0,79}$' or p_message_id is null then
    return false;
  end if;
  if not exists (
    select 1 from public.linkr_queue_runtime_config where stage = p_queue_name
  ) then
    return false;
  end if;
  v_relation := to_regclass(format('pgmq.q_%s', p_queue_name));
  if v_relation is null then return false; end if;
  execute format('select exists(select 1 from %s where msg_id = $1)', v_relation)
    into v_exists using p_message_id;
  return coalesce(v_exists, false);
end;
$$;

create or replace function public.queue_linkr_stage_delay_notices_v1(
  p_stage text,
  p_error_code text,
  p_consumer_version text,
  p_limit integer default 25
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  p_limit := least(greatest(coalesce(p_limit, 25), 1), 50);
  insert into public.twitter_replies (
    tweet_id, reply_text, status, idempotency_key, conversation_id,
    author_twitter_id, reply_kind, work_item_id
  )
  select
    t.tweet_id,
    'Your request is safely queued, but this processing stage is temporarily paused. Linkr will resume it automatically; please do not submit it again.',
    'pending',
    'stage-delay:' || w.id::text || ':' || md5(coalesce(p_consumer_version, 'unknown')),
    t.conversation_id,
    t.author_twitter_id,
    'pipeline_delay',
    w.id
  from public.linkr_work_items w
  join public.tweets_inbox t on t.tweet_id = w.source_event_id
  where w.source_surface = 'x'
    and public.linkr_queue_for_route(w.route, w.priority) = p_stage
    and w.state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
  order by w.accepted_at
  limit p_limit
  on conflict (idempotency_key) where idempotency_key is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.request_linkr_stage_wake(p_stage text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config public.linkr_queue_runtime_config%rowtype;
  v_dispatch public.linkr_dispatch_stage_state%rowtype;
begin
  select * into v_config from public.linkr_queue_runtime_config
  where stage = p_stage for update;
  if not found then return jsonb_build_object('requested', false, 'reason', 'unknown_stage'); end if;
  if not v_config.enabled then return jsonb_build_object('requested', false, 'reason', 'disabled'); end if;

  select * into v_dispatch from public.linkr_dispatch_stage_state
  where stage = p_stage for update;
  if v_dispatch.required_consumer_version is not null
     and v_dispatch.required_consumer_version <> v_config.consumer_version then
    update public.linkr_dispatch_stage_state
    set state = 'idle', circuit_open_until = null,
        required_consumer_version = null, consecutive_failure_count = 0,
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where stage = p_stage returning * into v_dispatch;
  elsif v_dispatch.circuit_open_until is not null
        and v_dispatch.circuit_open_until <> 'infinity'::timestamptz
        and v_dispatch.circuit_open_until <= now() then
    update public.linkr_dispatch_stage_state
    set state = 'idle', circuit_open_until = null,
        consecutive_failure_count = 0, lease_owner = null,
        lease_expires_at = null, updated_at = now()
    where stage = p_stage returning * into v_dispatch;
  end if;

  if v_dispatch.circuit_open_until is not null and v_dispatch.circuit_open_until > now() then
    return jsonb_build_object('requested', false, 'reason', 'circuit_open');
  end if;

  update public.linkr_dispatch_stage_state
  set wake_generation = wake_generation + 1,
      state = 'pending', lease_owner = null,
      lease_expires_at = now() + interval '2 minutes', updated_at = now()
  where stage = p_stage and (state = 'idle' or lease_expires_at < now())
  returning * into v_dispatch;
  return jsonb_build_object(
    'requested', found, 'stage', p_stage,
    'wake_generation', v_dispatch.wake_generation,
    'consumer_version', v_config.consumer_version
  );
end;
$$;

create or replace function public.get_linkr_route_readiness_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_stages jsonb;
  v_unready integer;
  v_invalid integer;
  v_backlog integer;
begin
  with required(stage) as (
    select unnest(array[
      'x_ingress', 'command_prepare', 'media_capture',
      'launch_robinhood', 'confirm_robinhood',
      'launch_solana', 'confirm_solana',
      'reply_x_high', 'reply_x_normal', 'reconciliation'
    ]::text[])
  ), rows as (
    select r.stage, c.worker_function, c.consumer_version, c.enabled,
      d.state as dispatch_state, d.circuit_open_until,
      d.required_consumer_version, d.last_status_code, d.last_error_code,
      coalesce((m.value->>'queue_length')::bigint, 0) as queue_length,
      coalesce((m.value->>'oldest_msg_age_sec')::bigint, 0) as oldest_age_seconds,
      (
        c.enabled
        and c.consumer_version <> 'unverified'
        and not (
          d.circuit_open_until is not null and d.circuit_open_until > now()
          and (
            d.required_consumer_version is null
            or d.required_consumer_version = c.consumer_version
          )
        )
      ) as ready
    from required r
    left join public.linkr_queue_runtime_config c on c.stage = r.stage
    left join public.linkr_dispatch_stage_state d on d.stage = r.stage
    left join (
      select to_jsonb(x) as value from pgmq.metrics_all() x
    ) m on m.value->>'queue_name' = r.stage
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by stage), '[]'::jsonb),
    count(*) filter (where not coalesce(ready, false))::integer
  into v_stages, v_unready from rows;

  select count(*)::integer into v_invalid
  from public.linkr_work_items w
  where (
    w.state in ('queued', 'retryable')
    and (w.next_attempt_at is null or w.next_attempt_at <= now())
    and (w.active_queue_name is null or w.active_message_id is null)
  ) or (
    w.state in ('waiting_user_input', 'waiting_user_confirmation', 'waiting_provider')
    and w.last_progress_at is null
  ) or (
    w.state = 'leased' and w.lease_expires_at is null
  );

  select count(*)::integer into v_backlog
  from public.linkr_work_items
  where state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
    and last_progress_at < now() - interval '5 minutes'
    and state not in ('waiting_user_input', 'waiting_user_confirmation', 'waiting_provider');

  return jsonb_build_object(
    'ready', v_unready = 0 and v_invalid = 0 and v_backlog = 0,
    'required_stage_failures', v_unready,
    'invariant_violations', v_invalid,
    'overdue_work_items', v_backlog,
    'stages', v_stages,
    'sampled_at', now()
  );
end;
$$;

create or replace function public.run_linkr_queue_controller_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_repair jsonb;
  v_dispatch jsonb;
  v_active jsonb;
  v_deep jsonb;
  v_readiness jsonb;
begin
  begin
    v_repair := public.repair_linkr_request_pipeline_v1(50);
  exception when others then
    v_repair := jsonb_build_object('error', sqlstate, 'message', left(sqlerrm, 200));
  end;
  begin
    v_dispatch := public.dispatch_ready_linkr_workers(8);
  exception when others then
    v_dispatch := jsonb_build_object('error', sqlstate, 'message', left(sqlerrm, 200));
  end;
  begin
    v_active := public.sample_linkr_platform_active();
  exception when others then
    v_active := jsonb_build_object('error', sqlstate);
  end;
  begin
    v_deep := public.sample_linkr_platform_capacity_deep();
  exception when others then
    v_deep := jsonb_build_object('error', sqlstate);
  end;
  begin
    v_readiness := public.get_linkr_route_readiness_v1();
  exception when others then
    v_readiness := jsonb_build_object('ready', false, 'error', sqlstate);
  end;

  if v_repair ? 'error' or v_dispatch ? 'error' or v_active ? 'error'
     or v_deep ? 'error' or v_readiness ? 'error' then
    insert into public.linkr_platform_incidents (fingerprint, severity, title, details)
    values (
      'queue-controller-tick-failed', 'critical', 'Queue controller tick failed',
      jsonb_build_object(
        'repair', v_repair, 'dispatch', v_dispatch, 'active', v_active,
        'deep', v_deep, 'readiness', v_readiness
      )
    ) on conflict (fingerprint) where state = 'open' do update set
      occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
      last_seen_at = now(), details = excluded.details;
  end if;

  if coalesce((v_readiness->>'ready')::boolean, false) is false then
    update public.linkr_platform_control
    set threshold_band = 'critical', reason = 'x_command_route_not_ready', updated_at = now()
    where singleton;
  elsif not exists (
    select 1 from public.linkr_platform_incidents where state = 'open' and severity = 'critical'
  ) then
    update public.linkr_platform_control
    set threshold_band = 'normal', reason = null, updated_at = now()
    where singleton;
  end if;

  return jsonb_build_object(
    'repair', v_repair, 'dispatch', v_dispatch, 'active', v_active,
    'deep', v_deep, 'readiness', v_readiness
  );
end;
$$;

create or replace function public.get_linkr_admin_platform_health()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_control jsonb;
  v_queues jsonb;
  v_slots jsonb;
  v_incidents jsonb;
  v_providers jsonb;
  v_dlq bigint;
  v_cron jsonb;
  v_readiness jsonb;
begin
  perform set_config('statement_timeout', '3000', true);
  select to_jsonb(c) - 'configured_storage_budget_bytes'
  into v_control from public.linkr_platform_control c where singleton;

  with metrics as materialized (
    select to_jsonb(m) as value from pgmq.metrics_all() m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'stage', c.stage, 'enabled', c.enabled,
    'worker_function', c.worker_function, 'consumer_version', c.consumer_version,
    'max_concurrency', c.max_concurrency, 'batch_size', c.batch_size,
    'queue_length', coalesce((m.value->>'queue_length')::bigint, 0),
    'oldest_age_seconds', coalesce((m.value->>'oldest_msg_age_sec')::bigint, 0),
    'dispatch_state', d.state, 'last_started_at', d.last_started_at,
    'last_completed_at', d.last_completed_at,
    'dispatch_success_count', d.success_count,
    'dispatch_failure_count', d.failure_count,
    'consecutive_failure_count', d.consecutive_failure_count,
    'last_status_code', d.last_status_code, 'last_error_code', d.last_error_code,
    'circuit_open_until', d.circuit_open_until,
    'required_consumer_version', d.required_consumer_version
  ) order by c.stage), '[]'::jsonb)
  into v_queues
  from public.linkr_queue_runtime_config c
  left join metrics m on m.value->>'queue_name' = c.stage
  left join public.linkr_dispatch_stage_state d on d.stage = c.stage;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.stage), '[]'::jsonb)
  into v_slots from (
    select stage, count(*) filter (where enabled)::integer as enabled_slots,
      count(*) filter (where enabled and lease_owner is not null
        and lease_expires_at >= now())::integer as active_slots
    from public.linkr_worker_capacity_slots group by stage
  ) s;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.last_seen_at desc), '[]'::jsonb)
  into v_incidents from (
    select id, fingerprint, severity, title, occurrence_count,
      first_seen_at, last_seen_at
    from public.linkr_platform_incidents where state = 'open'
    order by last_seen_at desc limit 50
  ) i;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.provider_label), '[]'::jsonb)
  into v_providers from (
    select provider_label, provider_kind, endpoint_identity, state,
      consecutive_failures, latency_ms_ema, cooldown_until, sampled_at
    from public.linkr_provider_health
  ) p;
  select count(*) into v_dlq from public.linkr_dead_letter_items
  where redrive_state in ('pending', 'validated');
  select to_jsonb(j) into v_cron from (
    select jobid, jobname, schedule, active
    from cron.job where jobname = 'linkr-queue-controller' limit 1
  ) j;
  v_readiness := public.get_linkr_route_readiness_v1();

  return jsonb_build_object(
    'control', v_control, 'readiness', v_readiness, 'queues', v_queues,
    'slots', v_slots, 'open_incidents', v_incidents, 'providers', v_providers,
    'pending_dlq_count', v_dlq, 'controller_cron', v_cron
  );
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
    values (
      'queue-dispatch-config-missing', 'critical', 'Queue dispatcher configuration missing',
      jsonb_build_object(
        'project_url_configured', v_project_url is not null,
        'internal_key_configured', v_internal_key is not null
      )
    ) on conflict (fingerprint) where state = 'open' do update set
      occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
      last_seen_at = now(), details = excluded.details;
    return jsonb_build_object('dispatched', 0, 'error', 'configuration_missing');
  end if;

  for v_config in
    select * from public.linkr_queue_runtime_config where enabled
    order by dispatch_weight desc, stage
  loop
    exit when v_count >= p_global_limit;
    select * into v_dispatch from public.linkr_dispatch_stage_state
    where stage = v_config.stage for update;

    if v_dispatch.required_consumer_version is not null
       and v_dispatch.required_consumer_version <> v_config.consumer_version then
      update public.linkr_dispatch_stage_state
      set state = 'idle', circuit_open_until = null,
          required_consumer_version = null, consecutive_failure_count = 0,
          lease_owner = null, lease_expires_at = null, updated_at = now()
      where stage = v_config.stage returning * into v_dispatch;
    elsif v_dispatch.circuit_open_until is not null
          and v_dispatch.circuit_open_until <> 'infinity'::timestamptz
          and v_dispatch.circuit_open_until <= now() then
      update public.linkr_dispatch_stage_state
      set state = 'idle', circuit_open_until = null,
          consecutive_failure_count = 0, lease_owner = null,
          lease_expires_at = null, updated_at = now()
      where stage = v_config.stage returning * into v_dispatch;
    end if;
    if v_dispatch.circuit_open_until is not null and v_dispatch.circuit_open_until > now() then
      continue;
    end if;

    select to_jsonb(m) into v_metric from pgmq.metrics_all() m
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
    where stage = v_config.stage and (state = 'idle' or lease_expires_at < now())
    returning * into v_dispatch;
    if not found then continue; end if;

    select net.http_post(
      url := v_project_url || '/functions/v1/' || v_config.worker_function,
      headers := jsonb_build_object(
        'Content-Type', 'application/json', 'x-internal-key', v_internal_key
      ),
      body := jsonb_build_object(
        'stage', v_config.stage,
        'wake_generation', v_dispatch.wake_generation,
        'consumer_version', v_config.consumer_version
      ),
      timeout_milliseconds := 60000
    ) into v_request_id;
    update public.linkr_dispatch_stage_state
    set last_request_id = v_request_id, updated_at = now()
    where stage = v_config.stage and wake_generation = v_dispatch.wake_generation;

    v_count := v_count + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'stage', v_config.stage, 'request_id', v_request_id,
      'wake_generation', v_dispatch.wake_generation,
      'consumer_version', v_config.consumer_version
    ));
  end loop;
  return jsonb_build_object('dispatched', v_count, 'items', v_results, 'mode', v_platform_mode);
exception when others then
  insert into public.linkr_edge_dispatch_failures (stage, error_code, error_message)
  values ('dispatcher', sqlstate, left(sqlerrm, 500));
  return jsonb_build_object('dispatched', v_count, 'error', sqlstate);
end;
$$;

create or replace function public.record_linkr_dispatch_result_v1(
  p_stage text,
  p_request_id bigint,
  p_status_code integer,
  p_timed_out boolean default false,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumer_version text;
  v_previous_failures integer;
  v_next_failures integer;
  v_error_code text;
  v_open_until timestamptz;
  v_open boolean := false;
begin
  select c.consumer_version, d.consecutive_failure_count
  into v_consumer_version, v_previous_failures
  from public.linkr_dispatch_stage_state d
  join public.linkr_queue_runtime_config c on c.stage = d.stage
  where d.stage = p_stage for update of d;
  if not found then raise exception 'unknown_dispatch_stage:%', p_stage; end if;

  if coalesce(p_timed_out, false) or p_error_message is not null
     or p_status_code is null or p_status_code < 200 or p_status_code >= 300 then
    v_next_failures := coalesce(v_previous_failures, 0) + 1;
    v_error_code := case
      when p_status_code = 546 then 'WORKER_RESOURCE_LIMIT'
      when p_status_code = 503 then 'EDGE_BOOT_OR_UNAVAILABLE'
      when coalesce(p_timed_out, false) then 'EDGE_DISPATCH_TIMEOUT'
      else 'EDGE_DISPATCH_HTTP_FAILED'
    end;
    if p_status_code = 546 then
      v_open := true;
      v_open_until := 'infinity'::timestamptz;
    elsif p_status_code = 503 then
      v_open := true;
      v_open_until := now() + interval '15 minutes';
    elsif v_next_failures >= 3 then
      v_open := true;
      v_open_until := now() + interval '5 minutes';
    end if;

    update public.linkr_dispatch_stage_state
    set state = case when v_open then 'paused' else 'idle' end,
        lease_owner = null, lease_expires_at = null,
        failure_count = failure_count + 1,
        consecutive_failure_count = v_next_failures,
        last_status_code = p_status_code,
        last_error_code = v_error_code,
        last_failure_at = now(),
        circuit_open_until = case when v_open then v_open_until else circuit_open_until end,
        required_consumer_version = case
          when p_status_code = 546 then v_consumer_version
          else required_consumer_version
        end,
        updated_at = now()
    where stage = p_stage;

    insert into public.linkr_edge_dispatch_failures (
      stage, request_id, wake_generation, status_code, timed_out, error_code, error_message
    ) select
      stage, p_request_id, wake_generation, p_status_code,
      coalesce(p_timed_out, false), v_error_code,
      left(coalesce(p_error_message, 'non_success_http_status'), 500)
    from public.linkr_dispatch_stage_state where stage = p_stage;

    if v_open then
      insert into public.linkr_platform_incidents (fingerprint, severity, title, details)
      values (
        'stage-circuit:' || p_stage || ':' || v_consumer_version,
        'critical', 'Queue worker circuit opened',
        jsonb_build_object(
          'stage', p_stage, 'consumer_version', v_consumer_version,
          'status_code', p_status_code, 'error_code', v_error_code,
          'open_until', v_open_until
        )
      ) on conflict (fingerprint) where state = 'open' do update set
        occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
        last_seen_at = now(), details = excluded.details;
      perform public.queue_linkr_stage_delay_notices_v1(
        p_stage, v_error_code, v_consumer_version, 25
      );
      update public.linkr_platform_control
      set threshold_band = 'critical',
          reason = 'queue_stage_circuit_open:' || p_stage,
          updated_at = now()
      where singleton;
    end if;
  else
    update public.linkr_dispatch_stage_state
    set success_count = success_count + 1,
        consecutive_failure_count = 0,
        last_status_code = p_status_code,
        last_error_code = null,
        updated_at = now()
    where stage = p_stage;
  end if;

  return jsonb_build_object(
    'stage', p_stage,
    'consumer_version', v_consumer_version,
    'circuit_opened', v_open,
    'circuit_open_until', v_open_until,
    'error_code', v_error_code,
    'consecutive_failure_count', case when v_error_code is null then 0 else v_next_failures end
  );
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
  select stage into v_stage
  from public.linkr_dispatch_stage_state
  where last_request_id = new.id;
  if not found then return new; end if;
  perform public.record_linkr_dispatch_result_v1(
    v_stage, new.id, new.status_code,
    coalesce(new.timed_out, false), new.error_msg
  );
  return new;
end;
$$;

-- The trigger was installed by 20260721105000. Supabase owns pg_net's
-- net._http_response relation, so later migration roles cannot replace that
-- trigger. CREATE OR REPLACE above updates the function the existing trigger
-- invokes without requiring ownership of the extension relation.

create or replace function public.accept_linkr_x_page_v1(
  p_tweet_ids jsonb,
  p_execution_generation bigint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_input_count integer;
  v_inserted_ids uuid[] := array[]::uuid[];
  v_messages jsonb[] := array[]::jsonb[];
  v_message_ids bigint[] := array[]::bigint[];
  v_index integer;
  v_items jsonb;
  v_rejected jsonb;
begin
  if jsonb_typeof(p_tweet_ids) <> 'array'
     or jsonb_array_length(p_tweet_ids) < 1
     or jsonb_array_length(p_tweet_ids) > 100 then
    raise exception 'invalid_x_page';
  end if;
  if p_execution_generation < 1 then raise exception 'invalid_execution_generation'; end if;

  select count(*)::integer into v_input_count
  from (select distinct value from jsonb_array_elements_text(p_tweet_ids)) i;

  with input as materialized (
    select distinct value as tweet_id
    from jsonb_array_elements_text(p_tweet_ids)
    where value ~ '^[0-9]{1,32}$'
  ), source as materialized (
    select t.tweet_id, t.conversation_id, t.author_twitter_id, p.user_id
    from public.tweets_inbox t
    join input i on i.tweet_id = t.tweet_id
    left join public.profiles p on p.twitter_id = t.author_twitter_id
    where t.status in ('pending', 'processing')
    order by t.created_at, t.tweet_id
    for update of t
  ), inserted as (
    insert into public.linkr_work_items (
      idempotency_key, source_surface, source_event_id, user_id,
      surface_conversation_id, request_type, route, state, priority,
      state_version, dispatch_generation, payload, consumer_version,
      execution_generation, last_progress_at
    )
    select
      'x:' || s.tweet_id, 'x', s.tweet_id, s.user_id,
      nullif(s.conversation_id, ''), 'x_ingress', 'x.ingress', 'queued', 50,
      0, 1, jsonb_build_object('tweet_id', s.tweet_id),
      'x-queue-v1', p_execution_generation, now()
    from source s
    on conflict (idempotency_key) do nothing
    returning id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_inserted_ids from inserted;

  update public.tweets_inbox t
  set work_item_id = w.id,
      error = case when t.error like 'pipeline_cutover_pending%' then null else t.error end
  from public.linkr_work_items w
  where w.idempotency_key = 'x:' || t.tweet_id
    and t.tweet_id in (select distinct value from jsonb_array_elements_text(p_tweet_ids))
    and (t.work_item_id is null or t.work_item_id = w.id);

  if cardinality(v_inserted_ids) > 0 then
    select array_agg(jsonb_build_object(
      'schema_version', 1,
      'work_item_id', w.id,
      'state_version', w.state_version,
      'route', w.route,
      'resource_sequence', w.resource_sequence,
      'dispatch_generation', w.dispatch_generation,
      'enqueued_at', now()
    ) order by w.id)
    into v_messages
    from public.linkr_work_items w where w.id = any(v_inserted_ids);

    select coalesce(array_agg(s.msg_id), array[]::bigint[])
    into v_message_ids
    from pgmq.send_batch('x_ingress', v_messages, 0) as s(msg_id);
    if cardinality(v_message_ids) <> cardinality(v_inserted_ids) then
      raise exception 'x_accept_queue_pointer_count_mismatch';
    end if;

    for v_index in 1..cardinality(v_inserted_ids) loop
      update public.linkr_work_items
      set active_queue_name = 'x_ingress',
          active_message_id = v_message_ids[v_index],
          last_enqueued_at = now(),
          last_progress_at = now(),
          updated_at = now()
      where id = v_inserted_ids[v_index];
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tweet_id', t.tweet_id,
    'work_item_id', w.id,
    'state', w.state,
    'duplicate', not (w.id = any(v_inserted_ids))
  ) order by t.created_at, t.tweet_id), '[]'::jsonb)
  into v_items
  from public.tweets_inbox t
  join public.linkr_work_items w on w.id = t.work_item_id
  where t.tweet_id in (select distinct value from jsonb_array_elements_text(p_tweet_ids));

  select coalesce(jsonb_agg(i.tweet_id order by i.tweet_id), '[]'::jsonb)
  into v_rejected
  from (
    select distinct value as tweet_id from jsonb_array_elements_text(p_tweet_ids)
  ) i
  where i.tweet_id !~ '^[0-9]{1,32}$'
     or not exists (select 1 from public.tweets_inbox t where t.tweet_id = i.tweet_id);

  return jsonb_build_object(
    'input_count', v_input_count,
    'accepted_count', cardinality(v_inserted_ids),
    'duplicate_count', jsonb_array_length(v_items) - cardinality(v_inserted_ids),
    'rejected_count', jsonb_array_length(v_rejected),
    'items', v_items,
    'rejected_ids', v_rejected
  );
end;
$$;

create or replace function public.upsert_linkr_launch_draft_v1(
  p_input_work_item_id uuid,
  p_user_id uuid,
  p_surface_conversation_id text,
  p_source_tweet_id text,
  p_required_fields text[],
  p_filled_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.linkr_action_drafts%rowtype;
  v_key text;
  v_required text[];
begin
  if p_user_id is null then raise exception 'draft_user_required'; end if;
  if not exists (select 1 from public.linkr_work_items where id = p_input_work_item_id) then
    raise exception 'draft_input_work_item_not_found';
  end if;
  if p_filled_fields is null or jsonb_typeof(p_filled_fields) <> 'object' then
    raise exception 'draft_fields_object_required';
  end if;
  select coalesce(array_agg(distinct f order by f), array[]::text[])
  into v_required from unnest(coalesce(p_required_fields, array[]::text[])) f
  where f ~ '^[a-z][a-z0-9_]{0,63}$';
  v_key := 'launch_coin:' || coalesce(
    nullif(p_surface_conversation_id, ''), nullif(p_source_tweet_id, ''), p_user_id::text
  );

  insert into public.linkr_action_drafts (
    user_id, conversation_id, source_tweet_id, draft_key, action_type,
    status, required_fields, filled_fields, entity_refs, privacy_label,
    idempotency_key, expires_at, surface, surface_conversation_id,
    x_thread_id, source_refs, source_surface, work_item_id,
    last_input_work_item_id, version, updated_at
  ) values (
    p_user_id, p_surface_conversation_id, p_source_tweet_id, v_key, 'launch_coin',
    case when cardinality(v_required) > 0 then 'awaiting_clarification' else 'open' end,
    v_required, p_filled_fields, '[]'::jsonb, 'user_private',
    'draft:' || md5(p_user_id::text || ':' || v_key), now() + interval '30 minutes',
    'x', p_surface_conversation_id, p_surface_conversation_id,
    jsonb_build_array(jsonb_build_object('tweet_id', p_source_tweet_id)),
    'x', p_input_work_item_id, p_input_work_item_id, 1, now()
  )
  on conflict (user_id, draft_key)
    where status in ('open', 'awaiting_clarification')
  do update set
    source_tweet_id = excluded.source_tweet_id,
    status = excluded.status,
    required_fields = excluded.required_fields,
    filled_fields = public.linkr_action_drafts.filled_fields || excluded.filled_fields,
    surface_conversation_id = excluded.surface_conversation_id,
    x_thread_id = excluded.x_thread_id,
    source_refs = public.linkr_action_drafts.source_refs || excluded.source_refs,
    last_input_work_item_id = excluded.last_input_work_item_id,
    version = public.linkr_action_drafts.version + 1,
    expires_at = now() + interval '30 minutes',
    updated_at = now()
  returning * into v_draft;

  update public.linkr_work_items
  set user_id = coalesce(user_id, p_user_id),
      surface_conversation_id = coalesce(surface_conversation_id, p_surface_conversation_id),
      result_ref = 'draft:' || v_draft.id::text,
      last_progress_at = now(), updated_at = now()
  where id = p_input_work_item_id;

  return to_jsonb(v_draft);
end;
$$;

create or replace function public.create_linkr_launch_confirmation_v1(
  p_draft_id uuid,
  p_action_payload jsonb,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.linkr_action_drafts%rowtype;
  v_pending public.linkr_pending_actions%rowtype;
  v_key text;
begin
  select * into v_draft from public.linkr_action_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'launch_draft_not_found'; end if;
  if v_draft.expires_at <= now() then raise exception 'launch_draft_expired'; end if;
  if cardinality(v_draft.required_fields) > 0 then raise exception 'launch_draft_incomplete'; end if;
  if p_action_payload is null or jsonb_typeof(p_action_payload) <> 'object' then
    raise exception 'launch_action_payload_required';
  end if;
  v_key := 'confirm:' || v_draft.id::text || ':' || v_draft.version::text;

  insert into public.linkr_pending_actions (
    user_id, surface, surface_conversation_id, x_thread_id, draft_id,
    action_type, status, confirmation_phrase, summary, action_payload,
    risk_summary, deterministic_validation, source_refs, idempotency_key,
    expires_at, source_surface, work_item_id, draft_version
  ) values (
    v_draft.user_id, 'x', v_draft.surface_conversation_id,
    v_draft.x_thread_id, v_draft.id, 'launch_coin', 'pending',
    'confirm launch', left(coalesce(nullif(btrim(p_summary), ''), 'Confirm token launch'), 500),
    p_action_payload, jsonb_build_array('Token launches are irreversible.'),
    jsonb_build_object('required_fields_complete', true, 'draft_version', v_draft.version),
    v_draft.source_refs, v_key, now() + interval '15 minutes', 'x',
    v_draft.work_item_id, v_draft.version
  )
  on conflict (user_id, idempotency_key) do update set updated_at = now()
  returning * into v_pending;

  update public.linkr_action_drafts
  set status = 'converted_to_pending', closed_at = now(), updated_at = now()
  where id = v_draft.id and version = v_draft.version;

  update public.linkr_work_items
  set state = 'waiting_user_confirmation',
      state_version = state_version + 1,
      result_ref = 'pending_action:' || v_pending.id::text,
      next_attempt_at = null, last_error_code = null,
      last_progress_at = now(), updated_at = now()
  where id = v_draft.work_item_id and state = 'waiting_user_input';

  return to_jsonb(v_pending);
end;
$$;

create or replace function public.confirm_linkr_launch_action_v1(
  p_pending_action_id uuid,
  p_confirmation_work_item_id uuid,
  p_chain text,
  p_wallet_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_pending public.linkr_pending_actions%rowtype;
  v_item public.linkr_work_items%rowtype;
  v_resource_key text;
  v_resource_sequence bigint;
  v_active_work_item_id uuid;
  v_message_id bigint;
  v_state text;
begin
  if p_chain not in ('solana', 'robinhood') then raise exception 'unsupported_launch_chain'; end if;
  if p_wallet_id is null then raise exception 'launch_wallet_required'; end if;
  select * into v_pending from public.linkr_pending_actions
  where id = p_pending_action_id for update;
  if not found then raise exception 'pending_launch_not_found'; end if;

  select * into v_item from public.linkr_work_items
  where id = v_pending.work_item_id for update;
  if not found then raise exception 'pending_launch_work_item_not_found'; end if;

  if v_pending.status in ('confirmed', 'executing', 'executed') then
    return jsonb_build_object(
      'pending_action_id', v_pending.id,
      'work_item_id', v_item.id,
      'state', v_item.state,
      'message_id', v_item.active_message_id,
      'duplicate', true
    );
  end if;
  if v_pending.status <> 'pending' then raise exception 'pending_launch_not_confirmable'; end if;
  if v_pending.expires_at <= now() then
    update public.linkr_pending_actions set status = 'expired', updated_at = now()
    where id = v_pending.id;
    update public.linkr_work_items
    set state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
        last_error_code = 'confirmation_expired', last_progress_at = now(), updated_at = now()
    where id = v_pending.work_item_id and state = 'waiting_user_confirmation';
    return jsonb_build_object(
      'pending_action_id', v_pending.id,
      'work_item_id', v_pending.work_item_id,
      'state', 'cancelled',
      'expired', true,
      'duplicate', false
    );
  end if;
  if v_item.state <> 'waiting_user_confirmation' then
    raise exception 'launch_work_item_not_waiting_confirmation';
  end if;

  v_resource_key := p_wallet_id::text;
  insert into public.linkr_resource_heads (
    resource_type, resource_key, active_work_item_id, active_sequence,
    next_sequence, updated_at
  ) values ('wallet', v_resource_key, null, null, 2, now())
  on conflict (resource_type, resource_key) do update set
    next_sequence = public.linkr_resource_heads.next_sequence + 1,
    updated_at = now()
  returning next_sequence - 1, active_work_item_id
  into v_resource_sequence, v_active_work_item_id;

  v_state := case when v_active_work_item_id is null then 'queued' else 'waiting_resource' end;
  update public.linkr_work_items
  set route = case when p_chain = 'solana' then 'launch.solana' else 'launch.robinhood' end,
      state = v_state,
      state_version = state_version + 1,
      resource_type = 'wallet',
      resource_key = v_resource_key,
      resource_sequence = v_resource_sequence,
      next_attempt_at = null,
      last_error_code = null,
      last_progress_at = now(),
      updated_at = now()
  where id = v_item.id returning * into v_item;

  if v_active_work_item_id is null then
    update public.linkr_resource_heads
    set active_work_item_id = v_item.id,
        active_sequence = v_resource_sequence,
        updated_at = now()
    where resource_type = 'wallet' and resource_key = v_resource_key;
    v_message_id := public.linkr_enqueue_work_item(v_item.id, 0);
  end if;

  update public.linkr_pending_actions
  set status = 'confirmed', confirmed_at = now(), updated_at = now(),
      action_payload = action_payload || jsonb_build_object(
        'chain', p_chain,
        'wallet_id', p_wallet_id,
        'confirmation_work_item_id', p_confirmation_work_item_id
      )
  where id = v_pending.id;

  insert into public.linkr_request_events (work_item_id, event_type, state, metadata)
  values (
    v_item.id, 'user_confirmed', v_state,
    jsonb_build_object(
      'pending_action_id', v_pending.id,
      'confirmation_work_item_id', p_confirmation_work_item_id,
      'chain', p_chain
    )
  );
  return jsonb_build_object(
    'pending_action_id', v_pending.id,
    'work_item_id', v_item.id,
    'state', v_state,
    'message_id', v_message_id,
    'duplicate', false
  );
end;
$$;

create or replace function public.cancel_linkr_launch_action_v1(
  p_pending_action_id uuid,
  p_cancellation_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending public.linkr_pending_actions%rowtype;
begin
  select * into v_pending from public.linkr_pending_actions
  where id = p_pending_action_id for update;
  if not found then raise exception 'pending_launch_not_found'; end if;
  if v_pending.status = 'cancelled' then
    return jsonb_build_object('cancelled', true, 'duplicate', true, 'work_item_id', v_pending.work_item_id);
  end if;
  if v_pending.status <> 'pending' then raise exception 'pending_launch_not_cancellable'; end if;

  update public.linkr_pending_actions
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = v_pending.id;
  update public.linkr_action_drafts
  set status = 'cancelled', closed_at = coalesce(closed_at, now()), updated_at = now()
  where id = v_pending.draft_id and status not in ('completed', 'cancelled', 'expired', 'failed');
  update public.linkr_work_items
  set state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
      last_error_code = null, last_progress_at = now(), updated_at = now()
  where id = v_pending.work_item_id and state = 'waiting_user_confirmation';
  insert into public.linkr_request_events (work_item_id, event_type, state, metadata)
  values (
    v_pending.work_item_id, 'user_cancelled', 'cancelled',
    jsonb_build_object('cancellation_work_item_id', p_cancellation_work_item_id)
  );
  return jsonb_build_object('cancelled', true, 'duplicate', false, 'work_item_id', v_pending.work_item_id);
end;
$$;

create or replace function public.complete_linkr_stage_work(
  p_queue_name text,
  p_message_id bigint,
  p_work_item_id uuid,
  p_worker_id text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_resource_fencing_token bigint,
  p_expected_state_version bigint,
  p_new_state text,
  p_next_route text default null,
  p_result_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_next public.linkr_work_items%rowtype;
  v_next_message_id bigint;
  v_terminal boolean;
  v_waiting boolean;
begin
  v_terminal := p_new_state in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
  v_waiting := p_new_state in (
    'waiting_prerequisite', 'waiting_user_input', 'waiting_user_confirmation',
    'waiting_funds', 'waiting_provider'
  );
  if not v_terminal and not v_waiting and p_next_route is null then
    raise exception 'next_route_required';
  end if;
  if (v_terminal or v_waiting) and p_next_route is not null then
    raise exception 'next_route_not_allowed_for_state:%', p_new_state;
  end if;
  if p_next_route is not null and public.linkr_queue_for_route(p_next_route, 50) is null then
    raise exception 'unsupported_next_route';
  end if;

  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  if v_item.state <> 'leased' or v_item.state_version <> p_expected_state_version then
    raise exception 'stale_work_item_version';
  end if;
  if v_item.active_queue_name is distinct from p_queue_name
     or v_item.active_message_id is distinct from p_message_id then
    raise exception 'stale_queue_pointer';
  end if;
  if not exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = p_queue_name and slot_number = p_slot_number
      and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token
      and lease_expires_at >= now() and work_item_id = p_work_item_id
  ) then raise exception 'stale_capacity_fence'; end if;
  if v_item.resource_type is not null and not exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type
      and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id
      and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token
      and lease_expires_at >= now()
  ) then raise exception 'stale_resource_fence'; end if;

  perform pgmq.delete(p_queue_name, p_message_id);
  update public.linkr_work_items
  set state = p_new_state,
      route = coalesce(p_next_route, route),
      state_version = state_version + 1,
      result_ref = coalesce(p_result_ref, result_ref),
      terminal_at = case when v_terminal then now() else null end,
      next_attempt_at = null,
      last_error_code = null,
      active_queue_name = null,
      active_message_id = null,
      lease_expires_at = null,
      last_progress_at = now(),
      updated_at = now()
  where id = p_work_item_id
  returning * into v_item;

  update public.linkr_worker_capacity_slots
  set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
  where stage = p_queue_name and slot_number = p_slot_number
    and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token;

  if v_item.resource_type is not null then
    update public.linkr_resource_heads
    set lease_owner = null, lease_expires_at = null, updated_at = now()
    where resource_type = v_item.resource_type and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token;

    if v_terminal then
      select * into v_next
      from public.linkr_work_items
      where resource_type = v_item.resource_type
        and resource_key = v_item.resource_key
        and state = 'waiting_resource'
        and resource_sequence > v_item.resource_sequence
      order by resource_sequence for update skip locked limit 1;
      if found then
        update public.linkr_work_items
        set state = 'queued', state_version = state_version + 1,
            last_progress_at = now(), updated_at = now()
        where id = v_next.id returning * into v_next;
        update public.linkr_resource_heads
        set active_work_item_id = v_next.id,
            active_sequence = v_next.resource_sequence,
            lease_owner = null, lease_expires_at = null, updated_at = now()
        where resource_type = v_item.resource_type
          and resource_key = v_item.resource_key
          and active_work_item_id = v_item.id
          and fencing_token = p_resource_fencing_token;
        v_next_message_id := public.linkr_enqueue_work_item(v_next.id, 0);
      else
        update public.linkr_resource_heads
        set active_work_item_id = null, active_sequence = null,
            lease_owner = null, lease_expires_at = null, updated_at = now()
        where resource_type = v_item.resource_type
          and resource_key = v_item.resource_key
          and active_work_item_id = v_item.id
          and fencing_token = p_resource_fencing_token;
      end if;
    end if;
  end if;

  if not v_terminal and not v_waiting then
    v_next_message_id := public.linkr_enqueue_work_item(v_item.id, 0);
  end if;

  insert into public.linkr_request_events (work_item_id, event_type, state, metadata)
  values (
    v_item.id,
    case when v_terminal then 'terminal' when v_waiting then 'waiting' else 'stage_completed' end,
    v_item.state,
    jsonb_build_object('stage', p_queue_name, 'next_route', p_next_route)
  );

  return jsonb_build_object(
    'work_item_id', v_item.id,
    'state', v_item.state,
    'state_version', v_item.state_version,
    'next_message_id', v_next_message_id
  );
end;
$$;

create or replace function public.retry_linkr_stage_work(
  p_queue_name text,
  p_message_id bigint,
  p_work_item_id uuid,
  p_worker_id text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_resource_fencing_token bigint,
  p_expected_state_version bigint,
  p_error_code text,
  p_delay_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_message_id bigint;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 604800 then raise exception 'invalid_retry_delay'; end if;
  select * into v_item from public.linkr_work_items where id = p_work_item_id for update;
  if not found or v_item.state <> 'leased' or v_item.state_version <> p_expected_state_version then
    raise exception 'stale_work_item_version';
  end if;
  if v_item.active_queue_name is distinct from p_queue_name
     or v_item.active_message_id is distinct from p_message_id then
    raise exception 'stale_queue_pointer';
  end if;
  if not exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = p_queue_name and slot_number = p_slot_number
      and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token
      and lease_expires_at >= now() and work_item_id = p_work_item_id
  ) then raise exception 'stale_capacity_fence'; end if;
  if v_item.resource_type is not null and not exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token and lease_expires_at >= now()
  ) then raise exception 'stale_resource_fence'; end if;

  perform pgmq.delete(p_queue_name, p_message_id);
  update public.linkr_work_items
  set state = 'retryable', state_version = state_version + 1,
      next_attempt_at = now() + make_interval(secs => p_delay_seconds),
      last_error_code = left(p_error_code, 120),
      active_queue_name = null, active_message_id = null,
      lease_expires_at = null, last_progress_at = now(), updated_at = now()
  where id = p_work_item_id returning * into v_item;

  update public.linkr_worker_capacity_slots
  set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
  where stage = p_queue_name and slot_number = p_slot_number
    and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token;
  if v_item.resource_type is not null then
    update public.linkr_resource_heads
    set lease_owner = null, lease_expires_at = null, updated_at = now()
    where resource_type = v_item.resource_type and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token;
  end if;

  v_message_id := public.linkr_enqueue_work_item(v_item.id, p_delay_seconds);
  insert into public.linkr_worker_attempt_details (
    work_item_id, stage, attempt_number, worker_id, outcome, error_code, completed_at
  ) values (
    v_item.id, p_queue_name, v_item.attempt_count, p_worker_id,
    'retryable', left(p_error_code, 120), now()
  );
  return jsonb_build_object(
    'work_item_id', v_item.id, 'state', v_item.state, 'message_id', v_message_id
  );
end;
$$;

create or replace function public.recover_stranded_linkr_work_item(p_work_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_stage text;
  v_message_id bigint;
begin
  select * into v_item from public.linkr_work_items where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  if v_item.state <> 'leased' then raise exception 'work_item_not_leased'; end if;
  if v_item.lease_expires_at is null or v_item.lease_expires_at >= now() then
    raise exception 'work_item_lease_active';
  end if;
  v_stage := public.linkr_queue_for_route(v_item.route, v_item.priority);
  if exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = v_stage and work_item_id = v_item.id
      and lease_owner is not null and lease_expires_at >= now()
  ) then raise exception 'stage_still_has_active_worker'; end if;
  if v_item.resource_type is not null and exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id and lease_owner is not null
      and lease_expires_at >= now()
  ) then raise exception 'resource_still_leased'; end if;

  if v_item.active_queue_name is not null and v_item.active_message_id is not null then
    perform pgmq.delete(v_item.active_queue_name, v_item.active_message_id);
  end if;
  update public.linkr_work_items
  set state = 'retryable', state_version = state_version + 1,
      next_attempt_at = now(), last_error_code = 'recovered_stranded_claim',
      active_queue_name = null, active_message_id = null, lease_expires_at = null,
      recovery_count = recovery_count + 1, last_progress_at = now(), updated_at = now()
  where id = v_item.id returning * into v_item;
  v_message_id := public.linkr_enqueue_work_item(v_item.id, 0);
  insert into public.linkr_request_events (work_item_id, event_type, state, error_code)
  values (v_item.id, 'lease_recovered', v_item.state, 'recovered_stranded_claim');
  return jsonb_build_object(
    'work_item_id', v_item.id, 'state', v_item.state, 'message_id', v_message_id
  );
end;
$$;

create or replace function public.linkr_enqueue_work_item(
  p_work_item_id uuid,
  p_delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_queue text;
  v_message jsonb;
  v_message_id bigint;
begin
  if p_delay_seconds < 0 or p_delay_seconds > 604800 then
    raise exception 'invalid_queue_delay';
  end if;

  update public.linkr_work_items
  set dispatch_generation = dispatch_generation + 1,
      last_progress_at = now(),
      updated_at = now()
  where id = p_work_item_id
  returning * into v_item;
  if not found then raise exception 'work_item_not_found'; end if;

  if v_item.state in (
    'waiting_resource', 'waiting_prerequisite', 'waiting_user_input',
    'waiting_user_confirmation', 'waiting_funds', 'waiting_provider',
    'succeeded', 'rejected', 'cancelled', 'dead_letter'
  ) then
    raise exception 'work_item_not_enqueueable:%', v_item.state;
  end if;

  v_queue := public.linkr_queue_for_route(v_item.route, v_item.priority);
  if v_queue is null then raise exception 'unsupported_work_route:%', v_item.route; end if;

  v_message := jsonb_build_object(
    'schema_version', 1,
    'work_item_id', v_item.id,
    'state_version', v_item.state_version,
    'route', v_item.route,
    'resource_sequence', v_item.resource_sequence,
    'dispatch_generation', v_item.dispatch_generation,
    'enqueued_at', now()
  );
  if octet_length(v_message::text) > 4096 then raise exception 'queue_message_too_large'; end if;

  select pgmq.send(v_queue, v_message, p_delay_seconds) into v_message_id;
  update public.linkr_work_items
  set active_queue_name = v_queue,
      active_message_id = v_message_id,
      last_enqueued_at = now(),
      lease_expires_at = null,
      last_progress_at = now(),
      updated_at = now()
  where id = v_item.id;
  return v_message_id;
end;
$$;

create or replace function public.claim_linkr_stage_work(
  p_queue_name text,
  p_worker_id text,
  p_visibility_seconds integer,
  p_batch_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_slot public.linkr_worker_capacity_slots%rowtype;
  v_message record;
  v_item public.linkr_work_items%rowtype;
  v_resource_fence bigint;
  v_message_state_version bigint;
  v_is_expired_redelivery boolean;
begin
  if not exists (
    select 1 from public.linkr_worker_capacity_slots where stage = p_queue_name
  ) then raise exception 'unknown_stage'; end if;
  if p_visibility_seconds < 10 or p_visibility_seconds > 3600 then
    raise exception 'invalid_visibility_timeout';
  end if;
  if coalesce(p_batch_quantity, 1) <> 1 then raise exception 'single_item_claim_required'; end if;

  select * into v_slot
  from public.linkr_worker_capacity_slots
  where stage = p_queue_name and enabled
    and (lease_owner is null or lease_expires_at < now())
  order by slot_number for update skip locked limit 1;
  if not found then return jsonb_build_object('claims', '[]'::jsonb, 'slot', null); end if;

  update public.linkr_worker_capacity_slots
  set lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_visibility_seconds),
      work_item_id = null,
      fencing_token = fencing_token + 1,
      updated_at = now()
  where stage = v_slot.stage and slot_number = v_slot.slot_number
  returning * into v_slot;

  select * into v_message from pgmq.read(p_queue_name, p_visibility_seconds, 1) limit 1;
  if not found then
    update public.linkr_worker_capacity_slots
    set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
    where stage = v_slot.stage and slot_number = v_slot.slot_number
      and lease_owner = p_worker_id and fencing_token = v_slot.fencing_token;
    return jsonb_build_object('claims', '[]'::jsonb, 'slot', null);
  end if;

  begin
    v_message_state_version := (v_message.message->>'state_version')::bigint;
    select * into v_item from public.linkr_work_items
    where id = nullif(v_message.message->>'work_item_id', '')::uuid for update;
  exception when others then
    perform pgmq.delete(p_queue_name, v_message.msg_id);
    v_item := null;
  end;

  if v_item.id is null
     or v_item.state in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
     or public.linkr_queue_for_route(v_item.route, v_item.priority) <> p_queue_name
     or v_item.active_queue_name is distinct from p_queue_name
     or v_item.active_message_id is distinct from v_message.msg_id then
    perform pgmq.delete(p_queue_name, v_message.msg_id);
    update public.linkr_worker_capacity_slots
    set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
    where stage = v_slot.stage and slot_number = v_slot.slot_number
      and lease_owner = p_worker_id and fencing_token = v_slot.fencing_token;
    return jsonb_build_object('claims', '[]'::jsonb, 'slot', null, 'discarded_stale_pointer', true);
  end if;

  v_is_expired_redelivery := v_item.state = 'leased'
    and v_item.lease_expires_at < now()
    and v_item.state_version > v_message_state_version;
  if v_item.state_version <> v_message_state_version and not v_is_expired_redelivery then
    perform pgmq.delete(p_queue_name, v_message.msg_id);
    update public.linkr_work_items
    set active_queue_name = null, active_message_id = null,
        last_error_code = 'stale_queue_pointer_removed', updated_at = now()
    where id = v_item.id and active_message_id = v_message.msg_id;
    update public.linkr_worker_capacity_slots
    set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
    where stage = v_slot.stage and slot_number = v_slot.slot_number
      and lease_owner = p_worker_id and fencing_token = v_slot.fencing_token;
    return jsonb_build_object('claims', '[]'::jsonb, 'slot', null, 'discarded_stale_version', true);
  end if;

  v_resource_fence := null;
  if v_item.resource_type is not null then
    update public.linkr_resource_heads
    set lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(secs => p_visibility_seconds),
        fencing_token = fencing_token + 1,
        updated_at = now()
    where resource_type = v_item.resource_type and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id and active_sequence = v_item.resource_sequence
      and (lease_owner is null or lease_expires_at < now() or lease_owner = p_worker_id)
    returning fencing_token into v_resource_fence;
    if v_resource_fence is null then
      update public.linkr_worker_capacity_slots
      set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
      where stage = v_slot.stage and slot_number = v_slot.slot_number
        and lease_owner = p_worker_id and fencing_token = v_slot.fencing_token;
      return jsonb_build_object('claims', '[]'::jsonb, 'slot', null, 'waiting_resource', true);
    end if;
  end if;

  update public.linkr_work_items
  set state = 'leased',
      state_version = state_version + 1,
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()),
      lease_expires_at = now() + make_interval(secs => p_visibility_seconds),
      last_progress_at = now(),
      updated_at = now()
  where id = v_item.id returning * into v_item;

  update public.linkr_worker_capacity_slots
  set work_item_id = v_item.id, updated_at = now()
  where stage = v_slot.stage and slot_number = v_slot.slot_number
    and lease_owner = p_worker_id and fencing_token = v_slot.fencing_token;

  return jsonb_build_object(
    'claims', jsonb_build_array(jsonb_build_object(
      'message_id', v_message.msg_id,
      'work_item', to_jsonb(v_item),
      'resource_fencing_token', v_resource_fence,
      'visibility_deadline', v_message.vt,
      'redelivered', v_is_expired_redelivery
    )),
    'slot', jsonb_build_object(
      'stage', v_slot.stage,
      'slot_number', v_slot.slot_number,
      'fencing_token', v_slot.fencing_token,
      'lease_expires_at', v_slot.lease_expires_at
    )
  );
end;
$$;

create or replace function public.repair_linkr_request_pipeline_v1(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_ids jsonb;
  v_accept jsonb := '{}'::jsonb;
  v_item public.linkr_work_items%rowtype;
  v_tx record;
  v_accepted integer := 0;
  v_reenqueued integer := 0;
  v_recovered integer := 0;
  v_drafts_expired integer := 0;
  v_confirmations_expired integer := 0;
  v_legacy_expired integer := 0;
  v_reconciling integer := 0;
begin
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 50);
  perform set_config('statement_timeout', '1000', true);

  select jsonb_agg(tweet_id) into v_ids
  from (
    select tweet_id from public.tweets_inbox
    where status = 'pending' and work_item_id is null
      and created_at < now() - interval '30 seconds'
    order by created_at for update skip locked limit p_limit
  ) s;
  if jsonb_array_length(coalesce(v_ids, '[]'::jsonb)) > 0 then
    v_accept := public.accept_linkr_x_page_v1(v_ids, 1);
    v_accepted := coalesce((v_accept->>'accepted_count')::integer, 0);
  end if;

  for v_item in
    select * from public.linkr_work_items w
    where w.state in ('queued', 'retryable')
      and (w.next_attempt_at is null or w.next_attempt_at <= now())
      and w.last_progress_at < now() - interval '2 minutes'
      and (
        w.active_message_id is null
        or w.active_queue_name is null
        or not public.linkr_queue_message_exists(w.active_queue_name, w.active_message_id)
      )
    order by w.last_progress_at for update skip locked limit p_limit
  loop
    update public.linkr_work_items
    set active_queue_name = null, active_message_id = null,
        lease_expires_at = null, last_error_code = 'queue_pointer_repaired',
        recovery_count = recovery_count + 1, updated_at = now()
    where id = v_item.id;
    perform public.linkr_enqueue_work_item(v_item.id, 0);
    v_reenqueued := v_reenqueued + 1;
  end loop;

  for v_item in
    select * from public.linkr_work_items w
    where w.state = 'leased' and w.lease_expires_at < now()
    order by w.lease_expires_at for update skip locked limit p_limit
  loop
    begin
      perform public.recover_stranded_linkr_work_item(v_item.id);
      v_recovered := v_recovered + 1;
    exception when others then
      insert into public.linkr_platform_incidents (
        fingerprint, severity, title, details
      ) values (
        'lease-recovery:' || v_item.id::text, 'critical',
        'Work item lease could not be recovered',
        jsonb_build_object('work_item_id', v_item.id, 'sqlstate', sqlstate, 'error', left(sqlerrm, 300))
      ) on conflict (fingerprint) where state = 'open' do update set
        occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
        last_seen_at = now(), details = excluded.details;
    end;
  end loop;

  with expired as (
    update public.linkr_action_drafts
    set status = 'expired', closed_at = coalesce(closed_at, now()), updated_at = now()
    where id in (
      select id from public.linkr_action_drafts
      where status in ('open', 'awaiting_clarification') and expires_at <= now()
      order by expires_at for update skip locked limit p_limit
    ) returning work_item_id
  ), closed as (
    update public.linkr_work_items w
    set state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
        last_error_code = 'user_input_expired', last_progress_at = now(), updated_at = now()
    from expired e where w.id = e.work_item_id and w.state = 'waiting_user_input'
    returning w.id
  )
  select count(*)::integer into v_drafts_expired from expired;

  with expired as (
    update public.linkr_pending_actions
    set status = 'expired', updated_at = now()
    where id in (
      select id from public.linkr_pending_actions
      where status = 'pending' and expires_at <= now()
      order by expires_at for update skip locked limit p_limit
    ) returning work_item_id
  ), closed as (
    update public.linkr_work_items w
    set state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
        last_error_code = 'confirmation_expired', last_progress_at = now(), updated_at = now()
    from expired e where w.id = e.work_item_id and w.state = 'waiting_user_confirmation'
    returning w.id
  )
  select count(*)::integer into v_confirmations_expired from expired;

  with expired as (
    update public.pending_actions
    set status = 'expired'
    where id in (
      select id from public.pending_actions
      where status = 'pending' and expires_at <= now()
      order by expires_at for update skip locked limit p_limit
    ) returning id
  ) select count(*)::integer into v_legacy_expired from expired;

  for v_tx in
    select t.id as transaction_id, t.work_item_id
    from public.linkr_chain_transactions t
    join public.linkr_work_items w on w.id = t.work_item_id
    where t.state in ('broadcasting', 'broadcast', 'confirming')
      and t.updated_at < now() - interval '15 minutes'
      and w.state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
    order by t.updated_at for update of t skip locked limit p_limit
  loop
    update public.linkr_chain_transactions
    set state = 'reconciling', last_error_code = 'confirmation_slo_exceeded', updated_at = now()
    where id = v_tx.transaction_id;
    update public.linkr_work_items
    set route = 'reconciliation', state = 'retryable', state_version = state_version + 1,
        active_queue_name = null, active_message_id = null, lease_expires_at = null,
        next_attempt_at = now(), last_error_code = 'confirmation_slo_exceeded',
        last_progress_at = now(), updated_at = now()
    where id = v_tx.work_item_id
    returning * into v_item;
    if found then
      perform public.linkr_enqueue_work_item(v_item.id, 0);
      v_reconciling := v_reconciling + 1;
    end if;
  end loop;

  insert into public.linkr_platform_incidents (fingerprint, severity, title, details)
  select
    'work-item-slo:' || w.id::text,
    case when w.resource_type is not null or w.state in ('broadcast', 'reconciling')
      then 'critical' else 'warning' end,
    'Work item exceeded its unattended stage SLO',
    jsonb_build_object(
      'work_item_id', w.id, 'route', w.route, 'state', w.state,
      'last_progress_at', w.last_progress_at,
      'age_seconds', floor(extract(epoch from (now() - w.last_progress_at)))
    )
  from public.linkr_work_items w
  where w.state not in (
      'succeeded', 'rejected', 'cancelled', 'dead_letter',
      'waiting_user_input', 'waiting_user_confirmation', 'waiting_provider'
    )
    and w.last_progress_at < now() - interval '5 minutes'
  order by w.last_progress_at
  limit p_limit
  on conflict (fingerprint) where state = 'open' do update set
    occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
    last_seen_at = now(), details = excluded.details;

  return jsonb_build_object(
    'accepted', v_accepted,
    'reenqueued', v_reenqueued,
    'leases_recovered', v_recovered,
    'drafts_expired', v_drafts_expired,
    'confirmations_expired', v_confirmations_expired,
    'legacy_actions_expired', v_legacy_expired,
    'moved_to_reconciliation', v_reconciling
  );
end;
$$;

revoke all on function public.linkr_queue_message_exists(text, bigint)
  from public, anon, authenticated;
revoke all on function public.accept_linkr_x_page_v1(jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.upsert_linkr_launch_draft_v1(uuid, uuid, text, text, text[], jsonb)
  from public, anon, authenticated;
revoke all on function public.create_linkr_launch_confirmation_v1(uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.confirm_linkr_launch_action_v1(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_linkr_launch_action_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.queue_linkr_stage_delay_notices_v1(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.record_linkr_dispatch_result_v1(text, bigint, integer, boolean, text)
  from public, anon, authenticated;
revoke all on function public.repair_linkr_request_pipeline_v1(integer)
  from public, anon, authenticated;
revoke all on function public.get_linkr_route_readiness_v1()
  from public, anon, authenticated;
revoke all on function public.get_linkr_admin_platform_health()
  from public, anon, authenticated;
revoke all on function public.run_linkr_queue_controller_tick()
  from public, anon, authenticated, service_role;

grant execute on function public.linkr_queue_message_exists(text, bigint) to service_role;
grant execute on function public.accept_linkr_x_page_v1(jsonb, bigint) to service_role;
grant execute on function public.upsert_linkr_launch_draft_v1(uuid, uuid, text, text, text[], jsonb) to service_role;
grant execute on function public.create_linkr_launch_confirmation_v1(uuid, jsonb, text) to service_role;
grant execute on function public.confirm_linkr_launch_action_v1(uuid, uuid, text, uuid) to service_role;
grant execute on function public.cancel_linkr_launch_action_v1(uuid, uuid) to service_role;
grant execute on function public.queue_linkr_stage_delay_notices_v1(text, text, text, integer) to service_role;
grant execute on function public.record_linkr_dispatch_result_v1(text, bigint, integer, boolean, text) to service_role;
grant execute on function public.repair_linkr_request_pipeline_v1(integer) to postgres, service_role;
grant execute on function public.get_linkr_route_readiness_v1() to postgres, service_role;
grant execute on function public.get_linkr_admin_platform_health() to service_role;
grant execute on function public.run_linkr_queue_controller_tick() to postgres;

update public.linkr_queue_runtime_config
set batch_size = 1, max_concurrency = 1, updated_at = now();
