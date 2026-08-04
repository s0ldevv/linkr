-- Holder-airdrop follow-up hardening:
-- - allow future prepared batches to carry up to 6 recipients per Solana tx;
-- - keep the same immutable ledger and confirmation-gated execution model.
-- Apply only with the matching worker code that accepts 6-recipient batches.

alter table public.linkr_holder_airdrop_batches
  drop constraint if exists linkr_holder_airdrop_batches_recipient_count_check;

alter table public.linkr_holder_airdrop_batches
  add constraint linkr_holder_airdrop_batches_recipient_count_check
  check (recipient_count between 1 and 6);

create index if not exists linkr_holder_airdrop_recipients_batch_ordinal_idx
  on public.linkr_holder_airdrop_recipients(batch_id, ordinal);

create or replace function public.prepare_linkr_holder_airdrop_v1(
  p_input_work_item_id uuid, p_user_id uuid, p_tweet_id text,
  p_surface_conversation_id text, p_launch_id uuid, p_mint text,
  p_wallet_id uuid, p_wallet_address text, p_source_token_account text,
  p_token_decimals integer, p_source_balance_raw numeric,
  p_requested_raw numeric, p_allocated_raw numeric, p_dust_raw numeric,
  p_holder_account_count integer,
  p_snapshot_slot bigint, p_snapshot_provider text,
  p_snapshot_fetched_at timestamptz, p_excluded_dev_wallet text,
  p_excluded_largest_owner text, p_snapshot_provenance jsonb, p_recipients jsonb
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  v_launch public.coin_launches%rowtype;
  v_wallet public.wallets%rowtype;
  v_airdrop public.linkr_holder_airdrops%rowtype;
  v_pending public.linkr_pending_actions%rowtype;
  v_recipient jsonb;
  v_count integer := 0;
  v_sum numeric := 0;
  v_key text;
begin
  if not exists (
    select 1 from public.linkr_work_items
    where id = p_input_work_item_id and user_id = p_user_id
  ) then raise exception 'holder_airdrop_input_work_item_mismatch'; end if;
  select * into v_launch from public.coin_launches
  where id = p_launch_id and user_id = p_user_id and chain = 'solana'
    and status = 'confirmed' and mint = p_mint
    and (token_address is null or token_address = mint);
  if not found then raise exception 'holder_airdrop_owned_completed_launch_required'; end if;
  if p_wallet_id is distinct from v_launch.solana_launch_wallet_id
    and p_wallet_id is distinct from v_launch.launch_signer_wallet_id then
    raise exception 'holder_airdrop_launch_wallet_mismatch';
  end if;
  select * into v_wallet from public.wallets
  where id = p_wallet_id and user_id = p_user_id and wallet_type = 'solana'
    and coalesce(address, public_key) = p_wallet_address;
  if not found then raise exception 'holder_airdrop_launch_wallet_mismatch'; end if;
  if p_source_balance_raw < p_requested_raw or p_requested_raw <= 0
    or p_allocated_raw <= 0 or p_allocated_raw + p_dust_raw <> p_requested_raw then
    raise exception 'holder_airdrop_totals_invalid';
  end if;
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then
    raise exception 'holder_airdrop_recipients_required';
  end if;
  for v_recipient in select value from jsonb_array_elements(p_recipients) loop
    if coalesce(v_recipient->>'owner','') = ''
      or (v_recipient->>'holder_balance_raw')::numeric <= 0
      or (v_recipient->>'allocation_raw')::numeric <= 0 then
      raise exception 'holder_airdrop_recipient_invalid';
    end if;
    v_count := v_count + 1;
    if (v_recipient->>'ordinal')::integer <> v_count then
      raise exception 'holder_airdrop_recipient_ordinal_invalid';
    end if;
    v_sum := v_sum + (v_recipient->>'allocation_raw')::numeric;
  end loop;
  if v_sum <> p_allocated_raw then raise exception 'holder_airdrop_allocation_sum_invalid'; end if;
  if p_holder_account_count < v_count then raise exception 'holder_airdrop_holder_count_invalid'; end if;

  v_key := 'x-holder-airdrop:' || p_tweet_id;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select * into v_airdrop from public.linkr_holder_airdrops where idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'airdrop_id', v_airdrop.id,
      'pending_action_id', v_airdrop.pending_action_id,
      'duplicate', true,
      'recipient_count', v_airdrop.recipient_count,
      'allocated_raw', v_airdrop.allocated_raw::text,
      'dust_raw', v_airdrop.dust_raw::text,
      'requested_raw', v_airdrop.requested_raw::text,
      'snapshot_slot', v_airdrop.snapshot_slot,
      'snapshot_provider', v_airdrop.snapshot_provider,
      'snapshot_fetched_at', v_airdrop.snapshot_fetched_at,
      'snapshot_checksum', v_airdrop.snapshot_checksum,
      'excluded_largest_owner', v_airdrop.excluded_largest_owner
    );
  end if;
  insert into public.linkr_holder_airdrops (
    user_id, launch_id, source_work_item_id, source_tweet_id, mint,
    wallet_id, wallet_address, source_token_account, token_decimals,
    source_balance_raw, requested_raw, allocated_raw, dust_raw,
    recipient_count, holder_account_count, snapshot_slot, snapshot_provider,
    snapshot_fetched_at, snapshot_checksum, snapshot_provenance, excluded_dev_wallet,
    excluded_largest_owner, idempotency_key
  ) values (
    p_user_id, p_launch_id, p_input_work_item_id, p_tweet_id, p_mint,
    p_wallet_id, p_wallet_address, p_source_token_account, p_token_decimals,
    p_source_balance_raw, p_requested_raw, p_allocated_raw, p_dust_raw,
    v_count, p_holder_account_count, p_snapshot_slot, p_snapshot_provider,
    p_snapshot_fetched_at, p_snapshot_provenance->>'checksum', coalesce(p_snapshot_provenance,'{}'::jsonb)
      || jsonb_build_object('provider',p_snapshot_provider,'slot',p_snapshot_slot),
    p_excluded_dev_wallet, p_excluded_largest_owner, v_key
  ) returning * into v_airdrop;
  insert into public.linkr_holder_airdrop_recipients (
    airdrop_id, ordinal, owner_address, holder_balance_raw, allocation_raw
  ) select v_airdrop.id, (x->>'ordinal')::integer, x->>'owner',
      (x->>'holder_balance_raw')::numeric, (x->>'allocation_raw')::numeric
    from jsonb_array_elements(p_recipients) x;
  insert into public.linkr_holder_airdrop_batches (
    airdrop_id, batch_index, first_ordinal, last_ordinal, recipient_count, allocated_raw
  ) select v_airdrop.id, ((ordinal - 1) / 6), min(ordinal), max(ordinal),
      count(*)::integer, sum(allocation_raw)
    from public.linkr_holder_airdrop_recipients where airdrop_id = v_airdrop.id
    group by ((ordinal - 1) / 6);
  update public.linkr_holder_airdrop_recipients r set batch_id = b.id, status = 'batched'
    from public.linkr_holder_airdrop_batches b
    where r.airdrop_id = v_airdrop.id and b.airdrop_id = r.airdrop_id
      and r.ordinal between b.first_ordinal and b.last_ordinal;
  insert into public.linkr_pending_actions (
    user_id, surface, surface_conversation_id, x_thread_id, action_type,
    status, confirmation_phrase, summary, action_payload, risk_summary,
    deterministic_validation, source_refs, idempotency_key, expires_at,
    source_surface, work_item_id
  ) values (
    p_user_id, 'x', p_surface_conversation_id, p_surface_conversation_id,
    'holder_airdrop', 'pending', 'confirm holder airdrop',
    format('Airdrop %s raw units of %s to %s eligible holders', p_allocated_raw, p_mint, v_count),
    jsonb_build_object('airdrop_id',v_airdrop.id,'mint',p_mint,'wallet_id',p_wallet_id,'snapshot_slot',p_snapshot_slot),
    jsonb_build_array('Moves the launched token from your launch wallet','Recipient allocations are immutable after preparation'),
    jsonb_build_object('owned_completed_solana_launch',true,'immutable_snapshot',true,'allocation_sum_raw',p_allocated_raw),
    jsonb_build_array(jsonb_build_object('kind','tweet','id',p_tweet_id)),
    'holder-airdrop-pending:' || v_airdrop.id::text, now()+interval '15 minutes',
    'x', p_input_work_item_id
  ) returning * into v_pending;
  update public.linkr_holder_airdrops set pending_action_id = v_pending.id where id = v_airdrop.id;
  return jsonb_build_object(
    'airdrop_id',v_airdrop.id,'pending_action_id',v_pending.id,'duplicate',false,
    'recipient_count', v_airdrop.recipient_count,
    'allocated_raw', v_airdrop.allocated_raw::text,
    'dust_raw', v_airdrop.dust_raw::text,
    'requested_raw', v_airdrop.requested_raw::text,
    'snapshot_slot', v_airdrop.snapshot_slot,
    'snapshot_provider', v_airdrop.snapshot_provider,
    'snapshot_fetched_at', v_airdrop.snapshot_fetched_at,
    'snapshot_checksum', v_airdrop.snapshot_checksum,
    'excluded_largest_owner', v_airdrop.excluded_largest_owner
  );
end;
$$;
