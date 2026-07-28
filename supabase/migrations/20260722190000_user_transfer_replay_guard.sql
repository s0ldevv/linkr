-- Replay/double-submit guard for user-initiated wallet transfers
-- (transfer-sol / transfer-eth / transfer-usdc). A row is claimed atomically
-- before signing; a duplicate claim within the guard window is rejected. When
-- the client supplies an explicit idempotency key the recorded result is
-- replayed instead of re-executing.

create table if not exists public.user_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guard_key text not null,
  explicit_idempotency boolean not null default false,
  chain text not null,
  asset text not null,
  recipient text not null,
  amount_text text not null,
  status text not null default 'executing',
  tx_hash text,
  response jsonb,
  constraint user_transfer_requests_status_check
    check (status in ('executing', 'succeeded', 'failed')),
  constraint user_transfer_requests_guard_key_check
    check (length(guard_key) between 1 and 200)
);

create unique index if not exists user_transfer_requests_guard_uidx
  on public.user_transfer_requests (user_id, guard_key)
  where status in ('executing', 'succeeded');

create index if not exists user_transfer_requests_user_created_idx
  on public.user_transfer_requests (user_id, created_at desc);

grant all on public.user_transfer_requests to service_role;
alter table public.user_transfer_requests enable row level security;

-- Claims the guard row. Returns:
--   {claimed:true,  request_id}                     -> proceed with the transfer
--   {claimed:false, reason:'duplicate_in_flight'}   -> concurrent identical send
--   {claimed:false, reason:'replayed', response}    -> explicit key already done
create or replace function public.claim_user_transfer_request_v1(
  p_user_id uuid,
  p_guard_key text,
  p_explicit boolean,
  p_chain text,
  p_asset text,
  p_recipient text,
  p_amount_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.user_transfer_requests%rowtype;
  v_row public.user_transfer_requests%rowtype;
begin
  if p_user_id is null then raise exception 'transfer_user_required'; end if;
  if coalesce(length(btrim(p_guard_key)), 0) not between 1 and 200 then
    raise exception 'transfer_guard_key_invalid';
  end if;

  select * into v_existing from public.user_transfer_requests
  where user_id = p_user_id and guard_key = btrim(p_guard_key)
    and status in ('executing', 'succeeded')
  limit 1;
  if found then
    if v_existing.status = 'succeeded' and p_explicit then
      return jsonb_build_object(
        'claimed', false, 'reason', 'replayed',
        'response', coalesce(v_existing.response, '{}'::jsonb)
      );
    end if;
    -- Auto-derived keys expire after 90 seconds so a legitimate repeat send of
    -- the same amount is possible; explicit keys never re-execute.
    if not p_explicit
      and v_existing.status = 'succeeded'
      and v_existing.updated_at < now() - interval '90 seconds' then
      update public.user_transfer_requests
      set status = 'failed', updated_at = now()
      where id = v_existing.id;
    else
      return jsonb_build_object(
        'claimed', false,
        'reason', case when v_existing.status = 'executing'
          then 'duplicate_in_flight' else 'duplicate_recent' end
      );
    end if;
  end if;

  insert into public.user_transfer_requests (
    user_id, guard_key, explicit_idempotency, chain, asset, recipient,
    amount_text
  ) values (
    p_user_id, btrim(p_guard_key), coalesce(p_explicit, false),
    left(coalesce(p_chain, 'unknown'), 40), left(coalesce(p_asset, 'unknown'), 40),
    left(coalesce(p_recipient, ''), 120), left(coalesce(p_amount_text, ''), 80)
  ) returning * into v_row;
  return jsonb_build_object('claimed', true, 'request_id', v_row.id);
exception when unique_violation then
  return jsonb_build_object('claimed', false, 'reason', 'duplicate_in_flight');
end;
$$;

create or replace function public.settle_user_transfer_request_v1(
  p_request_id uuid,
  p_status text,
  p_tx_hash text default null,
  p_response jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'transfer_settle_status_invalid';
  end if;
  update public.user_transfer_requests set
    status = p_status,
    tx_hash = coalesce(p_tx_hash, tx_hash),
    response = coalesce(p_response, response),
    updated_at = now()
  where id = p_request_id and status = 'executing';
end;
$$;

revoke all on function public.claim_user_transfer_request_v1(
  uuid, text, boolean, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_user_transfer_request_v1(
  uuid, text, boolean, text, text, text, text
) to service_role;
revoke all on function public.settle_user_transfer_request_v1(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.settle_user_transfer_request_v1(
  uuid, text, text, jsonb
) to service_role;
