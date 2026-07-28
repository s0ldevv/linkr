-- Contain the production 546 retry storm before enabling the replacement
-- queue consumers. Intake remains live; actionable requests stay durable in
-- tweets_inbox until the real X acceptance migration is applied.

create or replace function public.run_linkr_x_pipeline_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ai_request bigint;
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
  where status = 'pending' and ai_processing_lane = 'legacy';

  if v_ai_backlog > 0 then
    v_ai_request := public.invoke_linkr_edge_worker(
      'cron-process-ai-tweets', 'cron-process-ai-tweets',
      jsonb_build_object(
        'source', 'pg_cron',
        'backlog', v_ai_backlog,
        'scheduled_at', now()
      )
    );
  end if;

  if v_oldest_ai < now() - interval '2 minutes' then
    perform public.record_system_health_event(
      'x-ai-backlog', 'degraded',
      least(
        2147483647,
        floor(extract(epoch from (now() - v_oldest_ai)) * 1000)::bigint
      )::integer,
      jsonb_build_object(
        'pending', v_ai_backlog,
        'oldest_created_at', v_oldest_ai
      ),
      1
    );
  end if;

  return jsonb_build_object(
    'ai_backlog', v_ai_backlog,
    'legacy_backlog_held', v_legacy_backlog,
    'ai_request_id', v_ai_request,
    'legacy_dispatch_suppressed', true
  );
end;
$$;

revoke all on function public.run_linkr_x_pipeline_tick()
  from public, anon, authenticated, service_role;
grant execute on function public.run_linkr_x_pipeline_tick() to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'linkr-process-tweets') then
    perform cron.unschedule('linkr-process-tweets');
  end if;
end;
$$;

insert into public.linkr_platform_incidents (
  fingerprint, severity, state, title, details
) values (
  'x-command-legacy-worker-resource-limit',
  'critical',
  'open',
  'X command processor disabled after WORKER_RESOURCE_LIMIT',
  jsonb_build_object(
    'status_code', 546,
    'error_code', 'WORKER_RESOURCE_LIMIT',
    'legacy_worker', 'cron-process-tweets',
    'containment', 'dispatch_suppressed',
    'replacement', 'durable_queue_pipeline'
  )
) on conflict (fingerprint) where state = 'open'
do update set
  occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
  last_seen_at = now(),
  details = excluded.details;

update public.linkr_platform_control
set threshold_band = 'critical',
    reason = 'x_command_pipeline_cutover',
    updated_at = now()
where singleton;

delete from public.linkr_edge_worker_dispatches
where function_name = 'cron-process-tweets';
