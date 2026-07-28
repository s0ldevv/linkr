-- Telegram may redeliver updates. Atomically acquire new/failed/stale work so a
-- prior failure is never mistaken for a successfully completed duplicate.

alter table public.telegram_updates
  add column if not exists attempt_count integer not null default 0,
  add column if not exists lease_expires_at timestamptz;

alter table public.telegram_updates
  drop constraint if exists telegram_updates_attempt_count_check;
alter table public.telegram_updates
  add constraint telegram_updates_attempt_count_check check (attempt_count >= 0);

create index if not exists telegram_updates_recovery_idx
  on public.telegram_updates (lease_expires_at, updated_at)
  where status in ('processing', 'failed');

create or replace function public.accept_legacy_telegram_update(
  p_update_id text,
  p_telegram_user_id text,
  p_telegram_chat_id text,
  p_payload jsonb,
  p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.telegram_updates%rowtype;
begin
  if nullif(trim(p_update_id), '') is null or octet_length(p_update_id) > 128 then
    raise exception 'invalid_telegram_update_id';
  end if;
  if p_payload is null or octet_length(p_payload::text) > 1048576 then
    raise exception 'invalid_telegram_payload';
  end if;
  p_lease_seconds := least(greatest(coalesce(p_lease_seconds, 600), 30), 1800);

  insert into public.telegram_updates (
    update_id, telegram_user_id, telegram_chat_id, status, payload,
    attempt_count, lease_expires_at, error, processed_at
  ) values (
    p_update_id, p_telegram_user_id, p_telegram_chat_id, 'processing', p_payload,
    1, now() + make_interval(secs => p_lease_seconds), null, null
  )
  on conflict (update_id) do update
  set telegram_user_id = excluded.telegram_user_id,
      telegram_chat_id = excluded.telegram_chat_id,
      status = 'processing',
      payload = excluded.payload,
      attempt_count = public.telegram_updates.attempt_count + 1,
      lease_expires_at = excluded.lease_expires_at,
      error = null,
      processed_at = null,
      updated_at = now()
  where public.telegram_updates.status = 'failed'
     or (
       public.telegram_updates.status = 'processing'
       and coalesce(public.telegram_updates.lease_expires_at,
         public.telegram_updates.updated_at + interval '10 minutes') < now()
     )
  returning * into v_row;

  if found then
    return jsonb_build_object('disposition', 'accepted',
      'attempt_count', v_row.attempt_count);
  end if;

  select * into v_row from public.telegram_updates where update_id = p_update_id;
  return jsonb_build_object(
    'disposition', case when v_row.status in ('processed', 'ignored')
      then 'duplicate_terminal' else 'duplicate_active' end,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count
  );
end;
$$;

revoke all on function public.accept_legacy_telegram_update(text, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.accept_legacy_telegram_update(text, text, text, jsonb, integer)
  to service_role;
