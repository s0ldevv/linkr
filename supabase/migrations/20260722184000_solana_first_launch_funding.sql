-- Make the Solana first-launch subsidy a database-enforced, crash-safe flow.
-- Signed transfer bytes are public transaction material, not private keys. They
-- are persisted before broadcast so every retry reuses the same signature.

alter table public.wallet_funding_events
  add column if not exists signed_transaction_base64 text,
  add column if not exists signed_transaction_hash text,
  add column if not exists recent_blockhash text,
  add column if not exists last_valid_block_height bigint,
  add column if not exists broadcast_attempt_count integer not null default 0,
  add column if not exists last_broadcast_at timestamptz;

alter table public.wallet_funding_events
  drop constraint if exists wallet_funding_events_signed_transaction_size_check,
  add constraint wallet_funding_events_signed_transaction_size_check
    check (
      signed_transaction_base64 is null
      or length(signed_transaction_base64) between 1 and 4096
    ),
  drop constraint if exists wallet_funding_events_signed_transaction_hash_check,
  add constraint wallet_funding_events_signed_transaction_hash_check
    check (
      signed_transaction_hash is null
      or signed_transaction_hash ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists wallet_funding_events_broadcast_attempt_count_check,
  add constraint wallet_funding_events_broadcast_attempt_count_check
    check (broadcast_attempt_count >= 0);

drop index if exists public.wallet_funding_events_first_launch_uidx;
create unique index wallet_funding_events_first_launch_uidx
  on public.wallet_funding_events (user_id, funding_kind)
  where funding_kind = 'first_launch_minimum'
    and status in ('pending', 'prepared', 'submitted', 'confirmed');

create or replace function public.claim_solana_first_launch_funding_v1(
  p_launch_id uuid,
  p_user_id uuid,
  p_wallet_id uuid,
  p_source_address text,
  p_destination_address text,
  p_amount_lamports text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_launch public.coin_launches;
  v_event public.wallet_funding_events;
  v_amount numeric;
begin
  if p_launch_id is null or p_user_id is null or p_wallet_id is null then
    raise exception 'solana_funding_identity_required';
  end if;
  if nullif(btrim(p_source_address), '') is null
    or nullif(btrim(p_destination_address), '') is null then
    raise exception 'solana_funding_address_required';
  end if;
  if coalesce(p_amount_lamports, '') !~ '^[0-9]{1,12}$' then
    raise exception 'solana_funding_amount_invalid';
  end if;
  v_amount := p_amount_lamports::numeric;
  if v_amount <= 0 or v_amount > 20000000 then
    raise exception 'solana_first_launch_funding_cap_exceeded';
  end if;

  -- Serialize all subsidy decisions for one user. This prevents two concurrent
  -- launch requests from both becoming the user's first subsidized launch.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_launch
  from public.coin_launches
  where id = p_launch_id and user_id = p_user_id
  for update;
  if not found then raise exception 'solana_funding_launch_not_found'; end if;

  if lower(coalesce(v_launch.chain, '')) <> 'solana' then
    return jsonb_build_object('eligible', false, 'reason', 'chain_not_solana');
  end if;
  if coalesce(v_launch.dev_buy_sol, 0) > 0 then
    return jsonb_build_object('eligible', false, 'reason', 'positive_dev_buy');
  end if;
  if lower(coalesce(v_launch.status, 'pending')) in ('failed', 'cancelled', 'rejected') then
    return jsonb_build_object('eligible', false, 'reason', 'launch_terminal');
  end if;

  select * into v_event
  from public.wallet_funding_events
  where user_id = p_user_id
    and funding_kind = 'first_launch_minimum'
    and status in ('pending', 'prepared', 'submitted', 'confirmed')
  order by created_at, id
  limit 1
  for update;
  if found then
    if v_event.coin_launch_id = p_launch_id then
      if v_event.source_address is distinct from btrim(p_source_address)
        or v_event.destination_address is distinct from btrim(p_destination_address) then
        raise exception 'solana_funding_event_address_conflict';
      end if;
      if v_event.status = 'pending' and v_event.tx_hash is null then
        update public.wallet_funding_events set
          wallet_id = p_wallet_id,
          amount_wei = p_amount_lamports,
          raw_result = coalesce(raw_result, '{}'::jsonb)
            || jsonb_build_object('amount_lamports', p_amount_lamports),
          updated_at = now()
        where id = v_event.id
        returning * into v_event;
      end if;
      update public.coin_launches set
        first_launch_subsidy_eligible = true,
        funding_policy = 'solana_first_launch_minimum_v1',
        funding_status = v_event.status,
        funding_amount_wei = v_event.amount_wei,
        funding_tx_hash = v_event.tx_hash,
        funding_error = v_event.error
      where id = p_launch_id;
      return jsonb_build_object('eligible', true, 'event', to_jsonb(v_event));
    end if;
    update public.coin_launches set
      first_launch_subsidy_eligible = false,
      funding_error = 'first_launch_subsidy_reserved_or_used'
    where id = p_launch_id;
    return jsonb_build_object(
      'eligible', false,
      'reason', 'first_launch_subsidy_reserved_or_used'
    );
  end if;

  if exists (
    select 1
    from public.coin_launches prior
    where prior.user_id = p_user_id
      and prior.id <> p_launch_id
      and lower(coalesce(prior.status, 'pending')) not in ('failed', 'cancelled', 'rejected')
      and (prior.created_at, prior.id) < (v_launch.created_at, v_launch.id)
  ) then
    update public.coin_launches set
      first_launch_subsidy_eligible = false,
      funding_error = 'prior_launch_exists'
    where id = p_launch_id;
    return jsonb_build_object('eligible', false, 'reason', 'prior_launch_exists');
  end if;

  insert into public.wallet_funding_events (
    coin_launch_id, user_id, wallet_id, funding_kind, source_address,
    destination_address, amount_wei, status, raw_result
  ) values (
    p_launch_id, p_user_id, p_wallet_id, 'first_launch_minimum',
    btrim(p_source_address), btrim(p_destination_address), p_amount_lamports,
    'pending', jsonb_build_object(
      'chain', 'solana',
      'policy', 'solana_first_launch_minimum_v1',
      'amount_lamports', p_amount_lamports
    )
  ) returning * into v_event;

  update public.coin_launches set
    first_launch_subsidy_eligible = true,
    funding_policy = 'solana_first_launch_minimum_v1',
    funding_status = 'pending',
    funding_amount_wei = p_amount_lamports,
    funding_tx_hash = null,
    funding_error = null
  where id = p_launch_id;

  return jsonb_build_object('eligible', true, 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.prepare_solana_first_launch_funding_v1(
  p_event_id uuid,
  p_user_id uuid,
  p_launch_id uuid,
  p_tx_hash text,
  p_signed_transaction_base64 text,
  p_signed_transaction_hash text,
  p_recent_blockhash text,
  p_last_valid_block_height bigint,
  p_raw_result jsonb default '{}'::jsonb
)
returns public.wallet_funding_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.wallet_funding_events;
  v_bytes bytea;
  v_hash text;
begin
  if coalesce(p_tx_hash, '') !~ '^[1-9A-HJ-NP-Za-km-z]{64,100}$' then
    raise exception 'solana_funding_signature_invalid';
  end if;
  if coalesce(p_recent_blockhash, '') !~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$' then
    raise exception 'solana_funding_blockhash_invalid';
  end if;
  if p_last_valid_block_height is null or p_last_valid_block_height <= 0 then
    raise exception 'solana_funding_last_valid_block_height_invalid';
  end if;
  if coalesce(p_signed_transaction_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'solana_funding_signed_hash_invalid';
  end if;
  if length(coalesce(p_signed_transaction_base64, '')) not between 1 and 4096 then
    raise exception 'solana_funding_signed_transaction_size_invalid';
  end if;
  begin
    v_bytes := decode(p_signed_transaction_base64, 'base64');
  exception when others then
    raise exception 'solana_funding_signed_transaction_base64_invalid';
  end;
  if octet_length(v_bytes) not between 1 and 1232 then
    raise exception 'solana_funding_signed_transaction_size_invalid';
  end if;
  v_hash := encode(extensions.digest(v_bytes, 'sha256'), 'hex');
  if v_hash <> p_signed_transaction_hash then
    raise exception 'solana_funding_signed_transaction_hash_mismatch';
  end if;

  update public.wallet_funding_events set
    status = 'prepared',
    tx_hash = p_tx_hash,
    signed_transaction_base64 = p_signed_transaction_base64,
    signed_transaction_hash = p_signed_transaction_hash,
    recent_blockhash = p_recent_blockhash,
    last_valid_block_height = p_last_valid_block_height,
    raw_result = coalesce(raw_result, '{}'::jsonb) || coalesce(p_raw_result, '{}'::jsonb),
    error = null,
    updated_at = now()
  where id = p_event_id
    and user_id = p_user_id
    and coin_launch_id = p_launch_id
    and funding_kind = 'first_launch_minimum'
    and status = 'pending'
    and tx_hash is null
    and signed_transaction_base64 is null
  returning * into v_row;

  if not found then
    select * into v_row
    from public.wallet_funding_events
    where id = p_event_id
      and user_id = p_user_id
      and coin_launch_id = p_launch_id
      and funding_kind = 'first_launch_minimum'
      and status in ('prepared', 'submitted', 'confirmed')
      and tx_hash = p_tx_hash
      and signed_transaction_hash = p_signed_transaction_hash
      and signed_transaction_base64 = p_signed_transaction_base64;
    if not found then raise exception 'solana_funding_prepare_conflict'; end if;
  end if;

  update public.coin_launches set
    funding_status = v_row.status,
    funding_tx_hash = v_row.tx_hash,
    funding_error = null
  where id = p_launch_id and user_id = p_user_id;
  return v_row;
end;
$$;

create or replace function public.record_solana_first_launch_funding_broadcast_v1(
  p_event_id uuid,
  p_tx_hash text
)
returns public.wallet_funding_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.wallet_funding_events;
begin
  update public.wallet_funding_events set
    status = 'submitted',
    broadcast_attempt_count = broadcast_attempt_count + 1,
    last_broadcast_at = now(),
    error = null,
    updated_at = now()
  where id = p_event_id
    and funding_kind = 'first_launch_minimum'
    and tx_hash = p_tx_hash
    and status in ('prepared', 'submitted')
  returning * into v_row;
  if not found then
    select * into v_row from public.wallet_funding_events
    where id = p_event_id and tx_hash = p_tx_hash and status = 'confirmed';
    if not found then raise exception 'solana_funding_broadcast_conflict'; end if;
  end if;
  update public.coin_launches set
    funding_status = v_row.status,
    funding_tx_hash = v_row.tx_hash,
    funding_error = null
  where id = v_row.coin_launch_id;
  return v_row;
end;
$$;

create or replace function public.confirm_solana_first_launch_funding_v1(
  p_event_id uuid,
  p_tx_hash text,
  p_slot bigint default null,
  p_raw_result jsonb default '{}'::jsonb
)
returns public.wallet_funding_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.wallet_funding_events;
begin
  select * into v_row from public.wallet_funding_events
  where id = p_event_id and funding_kind = 'first_launch_minimum'
  for update;
  if not found or v_row.tx_hash is distinct from p_tx_hash then
    raise exception 'solana_funding_confirmation_conflict';
  end if;
  if v_row.status not in ('prepared', 'submitted', 'confirmed') then
    raise exception 'solana_funding_confirmation_state_invalid';
  end if;

  update public.wallet_funding_events set
    status = 'confirmed',
    confirmed_at = coalesce(confirmed_at, now()),
    error = null,
    raw_result = coalesce(raw_result, '{}'::jsonb)
      || coalesce(p_raw_result, '{}'::jsonb)
      || jsonb_build_object('slot', p_slot, 'tx_hash', p_tx_hash),
    updated_at = now()
  where id = p_event_id
  returning * into v_row;

  update public.coin_launches set
    first_launch_subsidy_eligible = true,
    first_launch_subsidized = true,
    funding_policy = 'solana_first_launch_minimum_v1',
    funding_status = 'confirmed',
    funding_amount_wei = v_row.amount_wei,
    funding_tx_hash = p_tx_hash,
    funding_error = null
  where id = v_row.coin_launch_id and user_id = v_row.user_id;
  if not found then raise exception 'solana_funding_launch_update_failed'; end if;
  return v_row;
end;
$$;

create or replace function public.fail_solana_first_launch_funding_v1(
  p_event_id uuid,
  p_tx_hash text,
  p_error text
)
returns public.wallet_funding_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.wallet_funding_events;
begin
  update public.wallet_funding_events set
    status = 'failed',
    error = left(coalesce(nullif(btrim(p_error), ''), 'solana_funding_failed'), 500),
    updated_at = now()
  where id = p_event_id
    and funding_kind = 'first_launch_minimum'
    and status in ('pending', 'prepared', 'submitted')
    and (p_tx_hash is null or tx_hash = p_tx_hash)
  returning * into v_row;
  if not found then
    select * into v_row from public.wallet_funding_events where id = p_event_id;
    if not found then raise exception 'solana_funding_event_not_found'; end if;
    if v_row.status <> 'confirmed' then raise exception 'solana_funding_failure_conflict'; end if;
    return v_row;
  end if;
  update public.coin_launches set
    funding_status = 'failed',
    funding_tx_hash = v_row.tx_hash,
    funding_error = v_row.error
  where id = v_row.coin_launch_id;
  return v_row;
end;
$$;

revoke all on function public.claim_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text
) to service_role;

revoke all on function public.prepare_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text, text, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.prepare_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text, text, bigint, jsonb
) to service_role;

revoke all on function public.record_solana_first_launch_funding_broadcast_v1(
  uuid, text
) from public, anon, authenticated;
grant execute on function public.record_solana_first_launch_funding_broadcast_v1(
  uuid, text
) to service_role;

revoke all on function public.confirm_solana_first_launch_funding_v1(
  uuid, text, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.confirm_solana_first_launch_funding_v1(
  uuid, text, bigint, jsonb
) to service_role;

revoke all on function public.fail_solana_first_launch_funding_v1(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.fail_solana_first_launch_funding_v1(
  uuid, text, text
) to service_role;

comment on function public.claim_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text
) is 'Atomically reserves the one-time Solana first-launch subsidy for the earliest active zero-buy launch.';
comment on column public.wallet_funding_events.signed_transaction_base64 is
  'Public signed transaction bytes persisted before broadcast for exact-signature retry safety; never contains a private key.';
