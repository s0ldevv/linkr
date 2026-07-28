-- Database-backed cron locks for stateless Edge Function cron workers.
-- Duplicate invocations skip instead of overlapping queue work.

create table if not exists public.cron_locks (
  lock_name text primary key,
  owner text not null,
  locked_until timestamptz not null,
  last_claimed_at timestamptz not null default now(),
  last_released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on public.cron_locks to service_role;
alter table public.cron_locks enable row level security;

create index if not exists cron_locks_locked_until_idx
  on public.cron_locks (locked_until);

create or replace function public.claim_cron_lock(
  p_lock_name text,
  p_owner text,
  p_ttl_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_ttl integer := greatest(10, least(coalesce(p_ttl_seconds, 300), 3600));
begin
  if p_lock_name is null or btrim(p_lock_name) = '' then
    return false;
  end if;

  insert into public.cron_locks (
    lock_name,
    owner,
    locked_until,
    last_claimed_at,
    updated_at
  )
  values (
    p_lock_name,
    p_owner,
    v_now + make_interval(secs => v_ttl),
    v_now,
    v_now
  )
  on conflict (lock_name) do update
  set
    owner = excluded.owner,
    locked_until = excluded.locked_until,
    last_claimed_at = excluded.last_claimed_at,
    updated_at = excluded.updated_at
  where public.cron_locks.locked_until < v_now
     or public.cron_locks.owner = p_owner;

  return found;
end;
$$;

revoke all on function public.claim_cron_lock(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_cron_lock(text, text, integer)
  to service_role;

create or replace function public.release_cron_lock(
  p_lock_name text,
  p_owner text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cron_locks
  set
    locked_until = now(),
    last_released_at = now(),
    updated_at = now()
  where lock_name = p_lock_name
    and owner = p_owner;

  return found;
end;
$$;

revoke all on function public.release_cron_lock(text, text)
  from public, anon, authenticated;
grant execute on function public.release_cron_lock(text, text)
  to service_role;

