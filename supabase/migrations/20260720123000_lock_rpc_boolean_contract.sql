-- Make lock contention return an explicit false rather than SQL null.

create or replace function public.acquire_linkr_agent_lock(
  p_lock_key text,
  p_user_id uuid,
  p_surface text,
  p_scope_type text,
  p_scope_id text,
  p_run_id uuid,
  p_owner_id text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id text;
begin
  insert into public.linkr_agent_locks (
    lock_key,
    user_id,
    surface,
    scope_type,
    scope_id,
    run_id,
    owner_id,
    expires_at
  ) values (
    p_lock_key,
    p_user_id,
    p_surface,
    p_scope_type,
    p_scope_id,
    p_run_id,
    p_owner_id,
    p_expires_at
  )
  on conflict (lock_key)
  do update set
    user_id = excluded.user_id,
    surface = excluded.surface,
    scope_type = excluded.scope_type,
    scope_id = excluded.scope_id,
    run_id = excluded.run_id,
    owner_id = excluded.owner_id,
    expires_at = excluded.expires_at,
    updated_at = now()
  where public.linkr_agent_locks.expires_at < now()
  returning owner_id into v_owner_id;

  return coalesce(v_owner_id = p_owner_id, false);
end;
$$;

revoke all on function public.acquire_linkr_agent_lock(text, uuid, text, text, text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.acquire_linkr_agent_lock(text, uuid, text, text, text, uuid, text, timestamptz)
  to service_role;
