-- 1. Throttled fast dispatch sweep -------------------------------------------
create or replace function public.linkr_fast_dispatch_sweep_v1(
  p_limit integer default 8,
  p_min_interval_ms integer default 750
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  p_limit := least(greatest(coalesce(p_limit, 8), 1), 16);
  p_min_interval_ms := least(greatest(coalesce(p_min_interval_ms, 750), 0), 60000);

  -- Only one sweep at a time; never block a worker waiting on it.
  if not pg_try_advisory_xact_lock(hashtext('linkr_fast_dispatch_sweep_v1')) then
    return jsonb_build_object('skipped', 'sweep_in_flight');
  end if;

  select (value->>'last_sweep_at')::timestamptz into v_last
  from public.app_state where key = 'linkr_fast_sweep';

  if v_last is not null
     and v_now - v_last < make_interval(secs => p_min_interval_ms / 1000.0) then
    return jsonb_build_object('skipped', 'throttled');
  end if;

  insert into public.app_state(key, value, updated_at)
  values ('linkr_fast_sweep', jsonb_build_object('last_sweep_at', v_now), now())
  on conflict (key) do update
    set value = jsonb_build_object('last_sweep_at', v_now), updated_at = now();

  begin
    v_result := public.dispatch_ready_linkr_workers(p_limit);
  exception when others then
    v_result := jsonb_build_object('error', sqlstate, 'message', left(sqlerrm, 200));
  end;

  return jsonb_build_object('swept', true, 'dispatch', v_result);
end;
$$;

revoke all on function public.linkr_fast_dispatch_sweep_v1(integer, integer) from public;
grant execute on function public.linkr_fast_dispatch_sweep_v1(integer, integer) to service_role;

-- 2. Concurrency for burst launch traffic -------------------------------------
update public.linkr_queue_runtime_config set max_concurrency = 4, batch_size = greatest(batch_size, 1), updated_at = now() where stage = 'launch_solana';
update public.linkr_queue_runtime_config set max_concurrency = 4, batch_size = greatest(batch_size, 2), updated_at = now() where stage = 'command_prepare';
update public.linkr_queue_runtime_config set max_concurrency = 6, updated_at = now() where stage = 'confirm_solana';
update public.linkr_queue_runtime_config set max_concurrency = 3, updated_at = now() where stage = 'launch_enrich';
update public.linkr_queue_runtime_config set max_concurrency = 2, updated_at = now() where stage = 'nft_solana';
update public.linkr_queue_runtime_config set max_concurrency = 4, updated_at = now() where stage = 'x_ingress';

insert into public.linkr_worker_capacity_slots(stage, slot_number, enabled, fencing_token, updated_at)
select c.stage, gs.slot_number::smallint, true, 0, now()
from public.linkr_queue_runtime_config c
cross join lateral generate_series(1, c.max_concurrency) as gs(slot_number)
where c.stage in ('launch_solana','command_prepare','confirm_solana','launch_enrich','nft_solana','x_ingress')
on conflict (stage, slot_number) do update set enabled = true, updated_at = now();

-- 3. Latency observability -----------------------------------------------------
create or replace view public.linkr_pipeline_latency_v1 as
select
  route,
  request_type,
  count(*) as samples,
  round(percentile_cont(0.5) within group (order by extract(epoch from (terminal_at - created_at)))::numeric, 1) as p50_seconds,
  round(percentile_cont(0.95) within group (order by extract(epoch from (terminal_at - created_at)))::numeric, 1) as p95_seconds,
  round(max(extract(epoch from (terminal_at - created_at)))::numeric, 1) as max_seconds
from public.linkr_work_items
where terminal_at is not null
  and created_at > now() - interval '24 hours'
group by route, request_type;

revoke all on public.linkr_pipeline_latency_v1 from anon, authenticated;
grant select on public.linkr_pipeline_latency_v1 to service_role;