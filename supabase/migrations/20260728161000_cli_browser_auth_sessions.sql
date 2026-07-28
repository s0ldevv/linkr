-- Browser-assisted CLI login sessions. These rows never store plaintext
-- device codes, browser request codes, user-visible codes, or API keys.

create table if not exists public.cli_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique,
  browser_request_hash text not null unique,
  user_code_hash text unique,
  approved_user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending',
  requested_scopes text[] not null default '{}',
  requested_limits jsonb not null default '{}'::jsonb,
  client_name text,
  cli_version text,
  request_ip_hash text,
  request_user_agent_hash text,
  approve_ip_hash text,
  approve_user_agent_hash text,
  failed_attempts integer not null default 0,
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cli_auth_sessions_status_check
    check (status in ('pending','approved','consumed','expired','denied')),
  constraint cli_auth_sessions_failed_attempts_check
    check (failed_attempts between 0 and 5)
);

create index if not exists cli_auth_sessions_pending_expiry_idx
  on public.cli_auth_sessions (expires_at)
  where consumed_at is null;

create index if not exists cli_auth_sessions_browser_request_idx
  on public.cli_auth_sessions (browser_request_hash);

create index if not exists cli_auth_sessions_device_code_idx
  on public.cli_auth_sessions (device_code_hash);

create index if not exists cli_auth_sessions_user_code_idx
  on public.cli_auth_sessions (user_code_hash)
  where user_code_hash is not null;

alter table public.cli_auth_sessions enable row level security;
revoke all on public.cli_auth_sessions from public, anon, authenticated;
grant all on public.cli_auth_sessions to service_role;

create or replace function public.consume_cli_auth_session(
  p_device_code_hash text,
  p_user_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cli_auth_sessions%rowtype;
  v_attempts integer;
begin
  select *
    into v_session
    from public.cli_auth_sessions
    where device_code_hash = p_device_code_hash
    for update;

  if not found then
    return jsonb_build_object('status', 'invalid_device');
  end if;

  if v_session.consumed_at is not null or v_session.status = 'consumed' then
    return jsonb_build_object(
      'status', 'consumed',
      'session_id', v_session.id,
      'expires_at', v_session.expires_at
    );
  end if;

  if v_session.status = 'denied' then
    return jsonb_build_object(
      'status', 'denied',
      'session_id', v_session.id,
      'failed_attempts', v_session.failed_attempts,
      'expires_at', v_session.expires_at
    );
  end if;

  if v_session.expires_at <= now() then
    update public.cli_auth_sessions
      set status = 'expired'
      where id = v_session.id
        and status in ('pending', 'approved');
    return jsonb_build_object(
      'status', 'expired',
      'session_id', v_session.id,
      'expires_at', v_session.expires_at
    );
  end if;

  if v_session.status <> 'approved' or v_session.approved_user_id is null then
    return jsonb_build_object(
      'status', 'pending',
      'session_id', v_session.id,
      'expires_at', v_session.expires_at
    );
  end if;

  if v_session.user_code_hash is distinct from p_user_code_hash then
    v_attempts := least(v_session.failed_attempts + 1, 5);
    update public.cli_auth_sessions
      set
        failed_attempts = v_attempts,
        status = case when v_attempts >= 5 then 'denied' else status end
      where id = v_session.id;
    return jsonb_build_object(
      'status', case when v_attempts >= 5 then 'denied' else 'invalid_code' end,
      'session_id', v_session.id,
      'failed_attempts', v_attempts,
      'expires_at', v_session.expires_at
    );
  end if;

  update public.cli_auth_sessions
    set
      status = 'consumed',
      consumed_at = now()
    where id = v_session.id
      and status = 'approved'
      and consumed_at is null
    returning * into v_session;

  if not found then
    return jsonb_build_object('status', 'race_lost');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'session_id', v_session.id,
    'approved_user_id', v_session.approved_user_id,
    'requested_scopes', v_session.requested_scopes,
    'requested_limits', v_session.requested_limits,
    'client_name', v_session.client_name,
    'cli_version', v_session.cli_version,
    'expires_at', v_session.expires_at
  );
end;
$$;

revoke all on function public.consume_cli_auth_session(text, text) from public, anon, authenticated;
grant execute on function public.consume_cli_auth_session(text, text) to service_role;

create or replace function public.prune_cli_auth_sessions(
  p_before timestamptz default now() - interval '1 day'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.cli_auth_sessions
  where expires_at < p_before
    or (consumed_at is not null and consumed_at < p_before);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_cli_auth_sessions(timestamptz) from public, anon, authenticated;
grant execute on function public.prune_cli_auth_sessions(timestamptz) to service_role;
