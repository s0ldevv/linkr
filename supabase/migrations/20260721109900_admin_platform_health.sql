-- One bounded, sanitized admin health projection. It samples PGMQ metrics once
-- and avoids exact counts over hot canonical tables.

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
begin
  perform set_config('statement_timeout', '3000', true);

  select to_jsonb(c) - 'configured_storage_budget_bytes'
  into v_control from public.linkr_platform_control c where singleton;

  with metrics as materialized (
    select to_jsonb(m) as value from pgmq.metrics_all() m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'stage', c.stage,
    'enabled', c.enabled,
    'worker_function', c.worker_function,
    'max_concurrency', c.max_concurrency,
    'batch_size', c.batch_size,
    'queue_length', coalesce((m.value->>'queue_length')::bigint, 0),
    'oldest_age_seconds', coalesce((m.value->>'oldest_msg_age_sec')::bigint, 0),
    'dispatch_state', d.state,
    'last_started_at', d.last_started_at,
    'last_completed_at', d.last_completed_at,
    'dispatch_success_count', d.success_count,
    'dispatch_failure_count', d.failure_count
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

  return jsonb_build_object(
    'control', v_control,
    'queues', v_queues,
    'slots', v_slots,
    'open_incidents', v_incidents,
    'providers', v_providers,
    'pending_dlq_count', v_dlq,
    'controller_cron', v_cron
  );
end;
$$;

revoke all on function public.get_linkr_admin_platform_health()
  from public, anon, authenticated;
grant execute on function public.get_linkr_admin_platform_health() to service_role;
