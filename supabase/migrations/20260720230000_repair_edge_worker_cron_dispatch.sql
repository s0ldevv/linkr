-- Repair launch and scheduled-action dispatchers that referenced Vault secret
-- names which were never provisioned. Reuse the established X pipeline Vault
-- entries and persist health failures for configuration, enqueue, HTTP response,
-- and missing-response failures without introducing a second cron job.

create table if not exists public.linkr_edge_worker_dispatches (
  request_id bigint primary key,
  function_name text not null,
  health_source text not null,
  dispatched_at timestamptz not null default now()
);

create index if not exists linkr_edge_worker_dispatches_source_time_idx
  on public.linkr_edge_worker_dispatches (health_source, dispatched_at);

alter table public.linkr_edge_worker_dispatches enable row level security;
revoke all on table public.linkr_edge_worker_dispatches from public, anon, authenticated;

create or replace function public.handle_linkr_edge_worker_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.linkr_edge_worker_dispatches%rowtype;
begin
  select *
  into v_dispatch
  from public.linkr_edge_worker_dispatches
  where request_id = new.id;

  if not found then
    return new;
  end if;

  if coalesce(new.timed_out, false)
     or new.error_msg is not null
     or new.status_code is null
     or new.status_code < 200
     or new.status_code >= 300 then
    perform public.record_system_health_event(
      v_dispatch.health_source,
      'down',
      greatest(0, floor(extract(epoch from (now() - v_dispatch.dispatched_at)) * 1000)::integer),
      jsonb_build_object(
        'error', 'cron_dispatch_http_failed',
        'function', v_dispatch.function_name,
        'request_id', new.id,
        'status_code', new.status_code,
        'timed_out', coalesce(new.timed_out, false),
        'message', left(coalesce(new.error_msg, 'non_success_http_status'), 300)
      ),
      1
    );
  end if;

  delete from public.linkr_edge_worker_dispatches where request_id = new.id;
  return new;
end;
$$;

revoke all on function public.handle_linkr_edge_worker_response()
  from public, anon, authenticated;

drop trigger if exists linkr_edge_worker_response_health on net._http_response;
create trigger linkr_edge_worker_response_health
after insert on net._http_response
for each row execute function public.handle_linkr_edge_worker_response();

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
  if nullif(btrim(p_function_name), '') is null then
    raise exception 'function_name_required';
  end if;
  if nullif(btrim(p_health_source), '') is null then
    raise exception 'health_source_required';
  end if;

  select nullif(rtrim(decrypted_secret, '/'), '')
  into v_project_url
  from vault.decrypted_secrets
  where name = 'x_wallet_agent_project_url'
  limit 1;

  select nullif(btrim(decrypted_secret), '')
  into v_internal_key
  from vault.decrypted_secrets
  where name = 'x_wallet_agent_internal_cron_key'
  limit 1;

  if v_project_url is null or v_internal_key is null then
    perform public.record_system_health_event(
      p_health_source,
      'down',
      0,
      jsonb_build_object(
        'error', 'cron_dispatch_configuration_missing',
        'project_url_configured', v_project_url is not null,
        'internal_key_configured', v_internal_key is not null,
        'function', p_function_name
      ),
      1
    );
    return null;
  end if;

  -- pg_net dispatch is asynchronous. An unresolved request from an earlier run
  -- proves that Edge was never reached (or its response was never collected).
  -- Checking it in this same once-per-minute job avoids a separate watchdog cron.
  select count(*)::integer, min(dispatched_at)
  into v_stale_count, v_oldest_stale
  from public.linkr_edge_worker_dispatches
  where health_source = p_health_source
    and dispatched_at < now() - interval '2 minutes';

  if v_stale_count > 0 then
    perform public.record_system_health_event(
      p_health_source,
      'down',
      greatest(0, floor(extract(epoch from (now() - v_oldest_stale)) * 1000)::integer),
      jsonb_build_object(
        'error', 'cron_dispatch_response_missing',
        'function', p_function_name,
        'stale_request_count', v_stale_count,
        'oldest_dispatched_at', v_oldest_stale
      ),
      1
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
  )
  into v_request_id;

  insert into public.linkr_edge_worker_dispatches (
    request_id,
    function_name,
    health_source,
    dispatched_at
  ) values (
    v_request_id,
    p_function_name,
    p_health_source,
    now()
  );

  return v_request_id;
exception
  when others then
    perform public.record_system_health_event(
      p_health_source,
      'down',
      0,
      jsonb_build_object(
        'error', 'cron_dispatch_failed',
        'sqlstate', sqlstate,
        'message', left(sqlerrm, 300),
        'function', p_function_name
      ),
      1
    );
    return null;
end;
$$;

revoke all on function public.invoke_linkr_edge_worker(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.invoke_linkr_edge_worker(text, text, jsonb)
  to postgres, service_role;

do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'linkr-process-launches') then
    perform cron.unschedule('linkr-process-launches');
  end if;
  perform cron.schedule(
    'linkr-process-launches',
    '* * * * *',
    $cron$
      select public.invoke_linkr_edge_worker(
        'cron-process-launches',
        'cron-process-launches',
        jsonb_build_object(
          'source', 'pg_cron',
          'job', 'linkr-process-launches',
          'scheduled_at', now()
        )
      );
    $cron$
  );

  if exists (select 1 from cron.job where jobname = 'linkr-process-scheduled-actions') then
    perform cron.unschedule('linkr-process-scheduled-actions');
  end if;
  perform cron.schedule(
    'linkr-process-scheduled-actions',
    '* * * * *',
    $cron$
      select public.invoke_linkr_edge_worker(
        'cron-process-scheduled-actions',
        'cron-process-scheduled-actions',
        jsonb_build_object(
          'source', 'pg_cron',
          'job', 'linkr-process-scheduled-actions',
          'scheduled_at', now()
        )
      );
    $cron$
  );
end;
$$;
