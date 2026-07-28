-- The queue workers are the sole launch executors. The old launch cron had no
-- backlog at cutover and must not be recreated or invoked after this point.

do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is null then return; end if;
  select jobid into v_job_id from cron.job
  where jobname = 'linkr-process-launches' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;

  -- Defensive cleanup for historical names. The X monolith was already
  -- unscheduled by the containment migration.
  select jobid into v_job_id from cron.job
  where jobname = 'linkr-process-tweets' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end;
$$;

do $migration$
declare
  v_function regprocedure :=
    'public.invoke_linkr_edge_worker(text,text,jsonb)'::regprocedure;
  v_definition text;
  v_old constant text := $old$if p_function_name not in (
    'cron-process-ai-tweets',
    'cron-process-tweets',
    'cron-process-launches',
    'cron-process-scheduled-actions'
  ) then$old$;
  v_new constant text := $new$if p_function_name not in (
    'cron-process-ai-tweets',
    'cron-process-scheduled-actions'
  ) then$new$;
begin
  select pg_get_functiondef(v_function) into strict v_definition;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'invoke_linkr_edge_worker allowlist did not match expected version';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

insert into public.linkr_platform_incidents (
  fingerprint, severity, title, details, state, resolved_at
) values (
  'legacy-launch-executors-retired',
  'warning',
  'Legacy launch executors retired',
  jsonb_build_object(
    'executors', jsonb_build_array('cron-process-tweets', 'cron-process-launches'),
    'replacement', 'fenced single-item queue workers',
    'retired_at', now()
  ),
  'resolved',
  now()
)
on conflict do nothing;
