-- Fence every economic outbox mutation against both the stage capacity lease
-- and the ordered wallet/resource lease. A resumed stale Edge invocation must
-- never persist or advance an economic transaction.

create or replace function public.persist_linkr_signed_transaction(
  p_work_item_id uuid,
  p_worker_id text,
  p_stage text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_resource_fencing_token bigint,
  p_expected_state_version bigint,
  p_chain text,
  p_wallet_id uuid,
  p_launch_id uuid,
  p_attempt_number integer,
  p_signed_transaction_base64 text,
  p_signed_transaction_hash text,
  p_encrypted_key_material_base64 text default null,
  p_transaction_hash text default null,
  p_nonce numeric default null,
  p_signature text default null,
  p_blockhash text default null,
  p_last_valid_block_height bigint default null,
  p_predicted_address text default null,
  p_payload_hash text default null,
  p_gas_policy jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_existing public.linkr_chain_transactions%rowtype;
  v_created public.linkr_chain_transactions%rowtype;
  v_signed bytea;
  v_key bytea;
  v_hash text;
begin
  if p_chain not in ('solana', 'robinhood') then raise exception 'unsupported_chain'; end if;
  if p_attempt_number < 1 then raise exception 'invalid_attempt_number'; end if;
  if p_signed_transaction_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_signed_transaction_hash';
  end if;

  begin
    v_signed := decode(p_signed_transaction_base64, 'base64');
    v_key := case when p_encrypted_key_material_base64 is null then null
      else decode(p_encrypted_key_material_base64, 'base64') end;
  exception when others then
    raise exception 'invalid_transaction_encoding';
  end;
  if octet_length(v_signed) not between 1 and 65536 then
    raise exception 'signed_transaction_size_invalid';
  end if;
  if v_key is not null and octet_length(v_key) > 4096 then
    raise exception 'encrypted_key_material_size_invalid';
  end if;
  v_hash := encode(digest(v_signed, 'sha256'), 'hex');
  if v_hash <> p_signed_transaction_hash then
    raise exception 'signed_transaction_integrity_mismatch';
  end if;

  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  if v_item.state <> 'leased' or v_item.state_version <> p_expected_state_version then
    raise exception 'stale_work_item_version';
  end if;
  if not exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = p_stage and slot_number = p_slot_number
      and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token
      and lease_expires_at >= now()
  ) then raise exception 'stale_capacity_fence'; end if;
  if v_item.resource_type is null or not exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type
      and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id
      and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token
      and lease_expires_at >= now()
  ) then raise exception 'stale_resource_fence'; end if;
  if p_wallet_id is null then raise exception 'wallet_id_required'; end if;

  select * into v_existing from public.linkr_chain_transactions
  where work_item_id = p_work_item_id and attempt_number = p_attempt_number;
  if found then
    if v_existing.signed_transaction_hash <> v_hash
       or v_existing.signed_transaction <> v_signed
       or v_existing.chain <> p_chain
       or v_existing.wallet_id is distinct from p_wallet_id then
      raise exception 'transaction_attempt_conflict';
    end if;
    return jsonb_build_object(
      'id', v_existing.id, 'work_item_id', v_existing.work_item_id,
      'chain', v_existing.chain, 'attempt_number', v_existing.attempt_number,
      'signed_transaction_hash', v_existing.signed_transaction_hash,
      'state', v_existing.state, 'existing', true
    );
  end if;

  insert into public.linkr_chain_transactions (
    work_item_id, chain, wallet_id, launch_id, attempt_number,
    transaction_hash, nonce, signature, blockhash, last_valid_block_height,
    predicted_address, signed_transaction, signed_transaction_hash,
    encrypted_key_material, payload_hash, gas_policy, state
  ) values (
    p_work_item_id, p_chain, p_wallet_id, p_launch_id, p_attempt_number,
    p_transaction_hash, p_nonce, p_signature, p_blockhash,
    p_last_valid_block_height, p_predicted_address, v_signed, v_hash,
    v_key, p_payload_hash, p_gas_policy, 'signed'
  ) returning * into v_created;

  return jsonb_build_object(
    'id', v_created.id, 'work_item_id', v_created.work_item_id,
    'chain', v_created.chain, 'attempt_number', v_created.attempt_number,
    'signed_transaction_hash', v_created.signed_transaction_hash,
    'state', v_created.state, 'existing', false
  );
end;
$$;

create or replace function public.transition_linkr_chain_transaction(
  p_transaction_id uuid,
  p_work_item_id uuid,
  p_worker_id text,
  p_stage text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_resource_fencing_token bigint,
  p_expected_state_version bigint,
  p_expected_transaction_state text,
  p_new_transaction_state text,
  p_transaction_hash text default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_tx public.linkr_chain_transactions%rowtype;
begin
  if p_new_transaction_state not in
    ('signed', 'broadcasting', 'broadcast', 'confirming', 'confirmed', 'failed', 'reconciling', 'replaced')
  then raise exception 'invalid_transaction_state'; end if;

  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found or v_item.state <> 'leased' or v_item.state_version <> p_expected_state_version then
    raise exception 'stale_work_item_version';
  end if;
  if not exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = p_stage and slot_number = p_slot_number
      and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token
      and lease_expires_at >= now()
  ) then raise exception 'stale_capacity_fence'; end if;
  if v_item.resource_type is null or not exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type
      and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id
      and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token
      and lease_expires_at >= now()
  ) then raise exception 'stale_resource_fence'; end if;

  update public.linkr_chain_transactions
  set state = p_new_transaction_state,
      transaction_hash = coalesce(p_transaction_hash, transaction_hash),
      broadcast_at = case
        when p_new_transaction_state in ('broadcast', 'confirming', 'confirmed')
          then coalesce(broadcast_at, now()) else broadcast_at end,
      confirmed_at = case when p_new_transaction_state = 'confirmed'
        then coalesce(confirmed_at, now()) else confirmed_at end,
      last_error_code = p_error_code,
      updated_at = now()
  where id = p_transaction_id and work_item_id = p_work_item_id
    and state = p_expected_transaction_state
  returning * into v_tx;
  if not found then raise exception 'transaction_transition_rejected'; end if;

  return jsonb_build_object('id', v_tx.id, 'state', v_tx.state,
    'transaction_hash', v_tx.transaction_hash);
end;
$$;

revoke all on function public.persist_linkr_signed_transaction(
  uuid, text, text, smallint, bigint, bigint, bigint, text, uuid, uuid,
  integer, text, text, text, text, numeric, text, text, bigint, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_linkr_signed_transaction(
  uuid, text, text, smallint, bigint, bigint, bigint, text, uuid, uuid,
  integer, text, text, text, text, numeric, text, text, bigint, text, text, jsonb
) to service_role;

revoke all on function public.transition_linkr_chain_transaction(
  uuid, uuid, text, text, smallint, bigint, bigint, bigint, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.transition_linkr_chain_transaction(
  uuid, uuid, text, text, smallint, bigint, bigint, bigint, text, text, text, text
) to service_role;
