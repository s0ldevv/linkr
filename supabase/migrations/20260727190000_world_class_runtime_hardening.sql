-- Runtime self-healing and bounded ephemera retention.

create index if not exists linkr_agent_runs_running_started_idx
  on public.linkr_agent_runs (started_at, id)
  where status = 'running';

create index if not exists linkr_action_jobs_running_started_idx
  on public.linkr_action_jobs (started_at, id)
  where status = 'running';

create index if not exists user_transfer_requests_executing_updated_idx
  on public.user_transfer_requests (updated_at, id)
  where status = 'executing';

create or replace function public.reconcile_stale_linkr_terminal_runs(
  p_stale_after interval default interval '20 minutes',
  p_row_budget integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_budget integer := least(greatest(coalesce(p_row_budget, 100), 1), 500);
  v_runs integer := 0;
  v_messages integer := 0;
begin
  if p_stale_after < interval '5 minutes' then
    raise exception 'unsafe_terminal_stale_threshold';
  end if;
  perform set_config('statement_timeout', '5000', true);
  perform set_config('lock_timeout', '500', true);

  for v_run in
    select r.id, r.user_id, r.assistant_message_id
    from public.linkr_agent_runs r
    where r.surface = 'terminal'
      and r.status = 'running'
      and coalesce(r.started_at, r.created_at) < now() - p_stale_after
      and not exists (
        select 1
        from public.linkr_agent_locks l
        where l.run_id = r.id and l.expires_at > now()
      )
    order by coalesce(r.started_at, r.created_at), r.id
    limit v_budget
    for update skip locked
  loop
    update public.linkr_agent_runs
    set status = 'failed',
        error = 'stale_terminal_run_reconciled',
        completed_at = now(),
        updated_at = now()
    where id = v_run.id and status = 'running';
    if found then
      v_runs := v_runs + 1;
    end if;

    if v_run.assistant_message_id is not null then
      update public.linkr_terminal_messages
      set content = case
            when nullif(btrim(content), '') is null
              then 'Linkr could not complete this turn. Please try again.'
            else content
          end,
          status = 'failed',
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object(
              'failure_phase', 'reconciliation',
              'error_code', 'stale_terminal_run_reconciled'
            ),
          updated_at = now()
      where id = v_run.assistant_message_id
        and user_id = v_run.user_id
        and status in ('typing', 'sending');
      if found then
        v_messages := v_messages + 1;
      end if;
    end if;
  end loop;

  delete from public.linkr_agent_locks l
  where l.ctid in (
    select ctid
    from public.linkr_agent_locks
    where expires_at < now() - interval '10 minutes'
    order by expires_at
    limit v_budget
  );

  return jsonb_build_object(
    'runs_reconciled', v_runs,
    'messages_reconciled', v_messages,
    'checked_at', now()
  );
end;
$$;

create or replace function public.reconcile_stale_linkr_action_jobs(
  p_stale_after interval default interval '20 minutes',
  p_row_budget integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_budget integer := least(greatest(coalesce(p_row_budget, 100), 1), 500);
  v_jobs integer := 0;
  v_pending integer := 0;
begin
  if p_stale_after < interval '5 minutes' then
    raise exception 'unsafe_action_stale_threshold';
  end if;
  perform set_config('statement_timeout', '5000', true);
  perform set_config('lock_timeout', '500', true);

  for v_job in
    select j.id, j.pending_action_id, j.user_id
    from public.linkr_action_jobs j
    where j.status = 'running'
      and coalesce(j.started_at, j.created_at) < now() - p_stale_after
    order by coalesce(j.started_at, j.created_at), j.id
    limit v_budget
    for update skip locked
  loop
    update public.linkr_action_jobs
    set status = 'awaiting_receipt',
        error_code = 'execution_outcome_unknown',
        error_message = 'Execution exceeded its response window and requires reconciliation.',
        updated_at = now()
    where id = v_job.id and status = 'running';
    if found then
      v_jobs := v_jobs + 1;
    end if;

    if v_job.pending_action_id is not null then
      update public.linkr_pending_actions
      set status = 'confirmed', updated_at = now()
      where id = v_job.pending_action_id
        and user_id = v_job.user_id
        and status = 'executing';
      if found then
        v_pending := v_pending + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'jobs_marked_for_reconciliation', v_jobs,
    'pending_actions_fenced', v_pending,
    'checked_at', now()
  );
end;
$$;

create or replace function public.prune_linkr_runtime_ephemera(
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

  delete from public.agent_api_nonces t
  where t.ctid in (
    select ctid from public.agent_api_nonces
    where created_at < now() - interval '30 minutes'
    order by created_at limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('agent_api_nonces', v_count);

  delete from public.linkr_terminal_events t
  where t.ctid in (
    select ctid from public.linkr_terminal_events
    where created_at < now() - interval '30 days'
    order by created_at limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('terminal_events', v_count);

  delete from public.linkr_external_data_cache t
  where t.ctid in (
    select ctid from public.linkr_external_data_cache
    where expires_at < now() - interval '7 days'
    order by expires_at limit v_budget
  );
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('external_cache', v_count);

  return v_result || jsonb_build_object('pruned_at', now());
end;
$$;

create or replace function public.run_linkr_runtime_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'terminal_reconciliation', public.reconcile_stale_linkr_terminal_runs(),
    'action_reconciliation', public.reconcile_stale_linkr_action_jobs(),
    'retention', public.prune_linkr_runtime_ephemera()
  );
end;
$$;

revoke all on function public.reconcile_stale_linkr_terminal_runs(interval, integer)
  from public, anon, authenticated;
revoke all on function public.reconcile_stale_linkr_action_jobs(interval, integer)
  from public, anon, authenticated;
revoke all on function public.prune_linkr_runtime_ephemera(integer)
  from public, anon, authenticated;
revoke all on function public.run_linkr_runtime_maintenance()
  from public, anon, authenticated;
grant execute on function public.reconcile_stale_linkr_terminal_runs(interval, integer)
  to service_role, postgres;
grant execute on function public.reconcile_stale_linkr_action_jobs(interval, integer)
  to service_role, postgres;
grant execute on function public.prune_linkr_runtime_ephemera(integer)
  to service_role, postgres;
grant execute on function public.run_linkr_runtime_maintenance()
  to service_role, postgres;

do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (
      select 1 from cron.job where jobname = 'linkr-runtime-maintenance'
    ) then
      perform cron.unschedule('linkr-runtime-maintenance');
    end if;
    perform cron.schedule(
      'linkr-runtime-maintenance',
      '*/5 * * * *',
      'select public.run_linkr_runtime_maintenance();'
    );
  end if;
end;
$$;
