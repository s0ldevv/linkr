-- Restore the X AI pipeline with a lightweight AI intake lane and a durable,
-- backlog-aware database tick. Fetch-time chaining remains an optimization;
-- pg_cron is the recovery guarantee.

alter table public.tweets_inbox
  add column if not exists ai_processing_lane text,
  add column if not exists ai_route_kind text,
  add column if not exists ai_route_reason text,
  add column if not exists ai_route_attempt_count integer not null default 0,
  add column if not exists ai_routed_at timestamptz;

alter table public.tweets_inbox
  drop constraint if exists tweets_inbox_ai_processing_lane_check;
alter table public.tweets_inbox
  add constraint tweets_inbox_ai_processing_lane_check
  check (ai_processing_lane is null or ai_processing_lane in ('reply', 'legacy'));

create index if not exists tweets_inbox_ai_intake_pending_idx
  on public.tweets_inbox (created_at)
  where status = 'pending' and ai_processing_lane is null;
create index if not exists tweets_inbox_legacy_pending_idx
  on public.tweets_inbox (created_at)
  where status = 'pending' and ai_processing_lane = 'legacy';

-- Keep this dispatcher private and allow only the explicitly scheduled Linkr
-- pipeline workers. Health source must still match the function exactly.
create or replace function public.invoke_linkr_edge_worker(
  p_function_name text,
  p_health_source text,
  p_body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_url text;
  v_internal_key text;
  v_request_id bigint;
  v_stale_count integer := 0;
  v_oldest_stale timestamptz;
begin
  if p_function_name not in (
    'cron-process-ai-tweets',
    'cron-process-tweets',
    'cron-process-launches',
    'cron-process-scheduled-actions'
  ) then
    raise exception 'edge_worker_not_allowed';
  end if;
  if p_health_source is distinct from p_function_name then
    raise exception 'health_source_mismatch';
  end if;

  select nullif(rtrim(decrypted_secret, '/'), '') into v_project_url
  from vault.decrypted_secrets where name = 'x_wallet_agent_project_url' limit 1;
  select nullif(btrim(decrypted_secret), '') into v_internal_key
  from vault.decrypted_secrets where name = 'x_wallet_agent_internal_cron_key' limit 1;

  if v_project_url is null or v_internal_key is null then
    perform public.record_system_health_event(
      p_health_source, 'down', 0,
      jsonb_build_object(
        'error', 'cron_dispatch_configuration_missing',
        'project_url_configured', v_project_url is not null,
        'internal_key_configured', v_internal_key is not null,
        'function', p_function_name
      ), 1
    );
    return null;
  end if;

  select count(*)::integer, min(dispatched_at)
  into v_stale_count, v_oldest_stale
  from public.linkr_edge_worker_dispatches
  where health_source = p_health_source
    and dispatched_at < now() - interval '2 minutes';

  if v_stale_count > 0 then
    perform public.record_system_health_event(
      p_health_source, 'down',
      greatest(0, floor(extract(epoch from (now() - v_oldest_stale)) * 1000)::integer),
      jsonb_build_object(
        'error', 'cron_dispatch_response_missing',
        'function', p_function_name,
        'stale_request_count', v_stale_count,
        'oldest_dispatched_at', v_oldest_stale
      ), 1
    );
    delete from public.linkr_edge_worker_dispatches
    where health_source = p_health_source
      and dispatched_at < now() - interval '2 minutes';
  end if;

  select net.http_post(
    url := v_project_url || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', v_internal_key
    ),
    body := coalesce(p_body, '{}'::jsonb)
  ) into v_request_id;

  insert into public.linkr_edge_worker_dispatches (
    request_id, function_name, health_source, dispatched_at
  ) values (v_request_id, p_function_name, p_health_source, now());
  return v_request_id;
exception when others then
  perform public.record_system_health_event(
    p_health_source, 'down', 0,
    jsonb_build_object(
      'error', 'cron_dispatch_failed',
      'sqlstate', sqlstate,
      'message', left(sqlerrm, 300),
      'function', p_function_name
    ), 1
  );
  return null;
end;
$$;

revoke all on function public.invoke_linkr_edge_worker(text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.invoke_linkr_edge_worker(text, text, jsonb) to postgres;

create or replace function public.run_linkr_x_pipeline_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ai_request bigint;
  v_legacy_request bigint;
  v_ai_backlog integer;
  v_legacy_backlog integer;
  v_oldest_ai timestamptz;
begin
  select count(*)::integer, min(created_at)
  into v_ai_backlog, v_oldest_ai
  from public.tweets_inbox
  where (
    status = 'pending' and ai_processing_lane is null
    and (next_attempt_at is null or next_attempt_at <= now())
  ) or (
    status = 'processing' and ai_processing_lane is null
    and last_attempt_at < now() - interval '15 minutes'
  );

  select count(*)::integer into v_legacy_backlog
  from public.tweets_inbox
  where status = 'pending' and ai_processing_lane = 'legacy'
    and (next_attempt_at is null or next_attempt_at <= now());

  if v_ai_backlog > 0 then
    v_ai_request := public.invoke_linkr_edge_worker(
      'cron-process-ai-tweets', 'cron-process-ai-tweets',
      jsonb_build_object('source', 'pg_cron', 'backlog', v_ai_backlog, 'scheduled_at', now())
    );
  end if;
  if v_legacy_backlog > 0 then
    v_legacy_request := public.invoke_linkr_edge_worker(
      'cron-process-tweets', 'cron-process-tweets',
      jsonb_build_object('source', 'pg_cron', 'backlog', v_legacy_backlog, 'scheduled_at', now())
    );
  end if;

  if v_oldest_ai < now() - interval '2 minutes' then
    perform public.record_system_health_event(
      'x-ai-backlog', 'degraded',
      least(
        2147483647,
        floor(extract(epoch from (now() - v_oldest_ai)) * 1000)::bigint
      )::integer,
      jsonb_build_object('pending', v_ai_backlog, 'oldest_created_at', v_oldest_ai), 1
    );
  end if;

  return jsonb_build_object(
    'ai_backlog', v_ai_backlog,
    'legacy_backlog', v_legacy_backlog,
    'ai_request_id', v_ai_request,
    'legacy_request_id', v_legacy_request
  );
end;
$$;

drop function if exists public.deliver_pending_schedule_capability_replies(integer);

revoke all on function public.run_linkr_x_pipeline_tick()
  from public, anon, authenticated, service_role;
grant execute on function public.run_linkr_x_pipeline_tick() to postgres;

do $$
begin
  if to_regnamespace('cron') is null then return; end if;
  if exists (select 1 from cron.job where jobname = 'linkr-process-tweets') then
    perform cron.unschedule('linkr-process-tweets');
  end if;
  if exists (select 1 from cron.job where jobname = 'linkr-process-ai-tweets') then
    perform cron.unschedule('linkr-process-ai-tweets');
  end if;
  if exists (select 1 from cron.job where jobname = 'linkr-schedule-capability-fallback') then
    perform cron.unschedule('linkr-schedule-capability-fallback');
  end if;
  if exists (select 1 from cron.job where jobname = 'linkr-x-pipeline') then
    perform cron.unschedule('linkr-x-pipeline');
  end if;
  perform cron.schedule(
    'linkr-x-pipeline', '* * * * *',
    'select public.run_linkr_x_pipeline_tick();'
  );
end;
$$;
