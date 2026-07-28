-- The X reply enqueue contract uses bigint/smallint. PostgreSQL resolves
-- PL/pgSQL integer literals as integer, so finalization must cast explicitly.

create or replace function public.finalize_linkr_coin_launch_v1(
  p_work_item_id uuid,
  p_launch_id uuid,
  p_transaction_id uuid,
  p_chain text,
  p_transaction_hash text,
  p_token_address text,
  p_explorer_url text,
  p_reply_text text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_launch public.coin_launches%rowtype;
  v_tx public.linkr_chain_transactions%rowtype;
  v_reply jsonb := null;
begin
  if p_chain not in ('solana', 'robinhood') then raise exception 'unsupported_chain'; end if;
  if octet_length(coalesce(p_details, '{}'::jsonb)::text) > 16384 then
    raise exception 'launch_details_too_large';
  end if;
  if coalesce(length(btrim(p_reply_text)), 0) not between 1 and 280 then
    raise exception 'launch_reply_length_invalid';
  end if;
  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  select * into v_launch from public.coin_launches
  where id = p_launch_id and work_item_id = p_work_item_id for update;
  if not found then raise exception 'coin_launch_not_found'; end if;
  select * into v_tx from public.linkr_chain_transactions
  where id = p_transaction_id and work_item_id = p_work_item_id
    and launch_id = p_launch_id and chain = p_chain for update;
  if not found then raise exception 'chain_transaction_not_found'; end if;
  if v_tx.state <> 'confirmed' then raise exception 'chain_transaction_not_confirmed'; end if;
  if v_tx.transaction_hash is distinct from p_transaction_hash then
    raise exception 'chain_transaction_hash_mismatch';
  end if;

  update public.coin_launches set
    status = 'confirmed', mint = p_token_address,
    token_address = p_token_address, tx_hash = p_transaction_hash,
    tx_signature = p_transaction_hash, explorer_url = p_explorer_url,
    processed_at = coalesce(processed_at, now()), error = null,
    pump_metadata_uri = case when p_chain = 'solana'
      then coalesce(p_details->>'metadata_uri', pump_metadata_uri) else pump_metadata_uri end,
    pump_url = case when p_chain = 'solana'
      then coalesce(p_details->>'pump_url', pump_url) else pump_url end,
    solscan_url = case when p_chain = 'solana'
      then coalesce(p_details->>'solscan_url', solscan_url) else solscan_url end,
    pump_receipt = case when p_chain = 'solana'
      then coalesce(pump_receipt, '{}'::jsonb) || p_details else pump_receipt end,
    factory = case when p_chain = 'robinhood'
      then coalesce(p_details->>'factory', factory) else factory end,
    deployer = case when p_chain = 'robinhood'
      then coalesce(p_details->>'creator', deployer) else deployer end,
    pool = case when p_chain = 'robinhood'
      then coalesce(p_details->>'pool', pool) else pool end,
    launch_metadata = coalesce(launch_metadata, '{}'::jsonb) ||
      jsonb_build_object('queue_finalized', true, 'transaction_id', p_transaction_id) || p_details
  where id = p_launch_id;

  update public.linkr_pending_actions
  set status = 'executed', updated_at = now()
  where work_item_id = p_work_item_id and status in ('confirmed', 'executing');

  if v_item.source_surface = 'x' then
    select public.enqueue_linkr_x_reply_v1(
      p_work_item_id,
      p_reply_text,
      'launch_success',
      1::bigint,
      80::smallint
    ) into v_reply;
  end if;
  return jsonb_build_object(
    'launch_id', p_launch_id,
    'transaction_id', p_transaction_id,
    'reply_work_item_id', v_reply->>'reply_work_item_id'
  );
end;
$$;

revoke all on function public.finalize_linkr_coin_launch_v1(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_linkr_coin_launch_v1(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) to service_role;
