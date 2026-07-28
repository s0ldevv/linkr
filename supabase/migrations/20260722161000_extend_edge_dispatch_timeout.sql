-- AI replies legitimately take longer than pg_net's five-second default.
-- Keep the same private allowlist and response tracking, but wait up to one
-- minute so successful AI work is not reported as a false dispatch failure.

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
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 60000
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
