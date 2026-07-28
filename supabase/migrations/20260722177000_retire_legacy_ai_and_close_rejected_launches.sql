-- Complete the queue cutover: the fetcher now durably accepts each mention
-- through accept_linkr_x_page_v1, so the legacy AI cron must not compete for
-- tweets_inbox rows. Also provide one atomic domain transition for permanent
-- pre-broadcast launch rejection so a dead-letter cannot leave an action
-- indefinitely confirmed/executing.

do $$
declare
  v_job_id bigint;
  v_job_name text;
begin
  if to_regclass('cron.job') is null then return; end if;
  foreach v_job_name in array array[
    'linkr-x-pipeline',
    'linkr-process-ai-tweets',
    'linkr-process-tweets',
    'linkr-process-launches'
  ] loop
    select jobid into v_job_id from cron.job
    where jobname = v_job_name limit 1;
    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
      v_job_id := null;
    end if;
  end loop;
end;
$$;

create or replace function public.run_linkr_x_pipeline_tick()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'retired', true,
    'replacement', 'cron-fetch-mentions + durable queue workers'
  );
$$;

revoke all on function public.run_linkr_x_pipeline_tick()
  from public, anon, authenticated, service_role;
grant execute on function public.run_linkr_x_pipeline_tick() to postgres;

do $migration$
declare
  v_function regprocedure :=
    'public.invoke_linkr_edge_worker(text,text,jsonb)'::regprocedure;
  v_definition text;
  v_old constant text := $old$if p_function_name not in (
    'cron-process-ai-tweets',
    'cron-process-scheduled-actions'
  ) then$old$;
  v_new constant text := $new$if p_function_name not in (
    'cron-process-scheduled-actions'
  ) then$new$;
begin
  select pg_get_functiondef(v_function) into strict v_definition;
  if strpos(v_definition, v_new) > 0 then
    null;
  elsif strpos(v_definition, v_old) > 0 then
    execute replace(v_definition, v_old, v_new);
  else
    raise exception 'invoke_linkr_edge_worker allowlist did not match expected version';
  end if;
end;
$migration$;

create or replace function public.reject_linkr_launch_request_v1(
  p_work_item_id uuid,
  p_reason_code text,
  p_user_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_pending_id uuid;
  v_reply jsonb := null;
begin
  if coalesce(length(btrim(p_reason_code)), 0) not between 1 and 120
     or p_reason_code !~ '^[a-z0-9][a-z0-9:_-]{0,119}$' then
    raise exception 'launch_rejection_reason_invalid';
  end if;
  if coalesce(length(btrim(p_user_message)), 0) not between 1 and 280 then
    raise exception 'launch_rejection_message_invalid';
  end if;

  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;

  update public.linkr_pending_actions
  set status = 'failed',
      deterministic_validation = coalesce(deterministic_validation, '{}'::jsonb)
        || jsonb_build_object(
          'rejected', true,
          'rejection_reason', p_reason_code,
          'rejected_at', now()
        ),
      updated_at = now()
  where work_item_id = p_work_item_id
    and action_type = 'launch_coin'
    and status in ('confirmed', 'executing')
  returning id into v_pending_id;

  if v_pending_id is null then
    raise exception 'active_pending_launch_not_found';
  end if;

  update public.coin_launches
  set status = 'failed',
      error = p_reason_code,
      processed_at = coalesce(processed_at, now())
  where work_item_id = p_work_item_id
    and status in ('pending', 'processing');

  if v_item.source_surface = 'x' then
    select public.enqueue_linkr_x_reply_v1(
      p_work_item_id,
      btrim(p_user_message),
      'launch_rejected',
      greatest(1, v_item.execution_generation),
      80::smallint
    ) into v_reply;
  end if;

  insert into public.linkr_request_events (
    work_item_id, event_type, state, error_code, metadata
  ) values (
    p_work_item_id, 'launch_rejected', 'dead_letter', p_reason_code,
    jsonb_build_object(
      'pending_action_id', v_pending_id,
      'user_notified', v_reply is not null
    )
  );

  return jsonb_build_object(
    'pending_action_id', v_pending_id,
    'reply_work_item_id', v_reply->>'reply_work_item_id'
  );
end;
$$;

revoke all on function public.reject_linkr_launch_request_v1(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reject_linkr_launch_request_v1(uuid, text, text)
  to service_role;

insert into public.linkr_platform_incidents (
  fingerprint, severity, title, details, state, resolved_at
) values (
  'legacy-ai-executor-retired',
  'warning',
  'Legacy AI X executor retired',
  jsonb_build_object(
    'executors', jsonb_build_array('cron-process-ai-tweets', 'run_linkr_x_pipeline_tick'),
    'replacement', 'cron-fetch-mentions + durable queue workers',
    'retired_at', now()
  ),
  'resolved',
  now()
)
on conflict do nothing;
