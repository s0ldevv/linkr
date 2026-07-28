-- One bounded database-local controller tick. Empty queues create no pg_net
-- requests; active and deep sampling are internally cadence-gated. Keeping all
-- controller work in one cron avoids multiplying idle scheduler overhead.

create or replace function public.run_linkr_queue_controller_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch jsonb;
  v_active jsonb;
  v_deep jsonb;
begin
  begin
    v_dispatch := public.dispatch_ready_linkr_workers(8);
  exception when others then
    v_dispatch := jsonb_build_object('error', sqlstate);
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

  if v_dispatch ? 'error' or v_active ? 'error' or v_deep ? 'error' then
    insert into public.linkr_platform_incidents (
      fingerprint, severity, title, details
    ) values (
      'queue-controller-tick-failed', 'critical',
      'Queue controller tick failed',
      jsonb_build_object('dispatch', v_dispatch, 'active', v_active, 'deep', v_deep)
    ) on conflict (fingerprint) where state = 'open' do update
      set occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
          last_seen_at = now(), details = excluded.details;
  end if;

  return jsonb_build_object('dispatch', v_dispatch, 'active', v_active, 'deep', v_deep);
end;
$$;

revoke all on function public.run_linkr_queue_controller_tick()
  from public, anon, authenticated, service_role;
grant execute on function public.run_linkr_queue_controller_tick() to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'linkr-queue-controller') then
    perform cron.unschedule('linkr-queue-controller');
  end if;
  perform cron.schedule(
    'linkr-queue-controller',
    '* * * * *',
    'select public.run_linkr_queue_controller_tick();'
  );
end;
$$;
