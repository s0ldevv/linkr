-- Wire X NFT collection/mint requests through linkr_pending_actions before
-- any Solana NFT worker can execute. Existing enqueue_linkr_nft_solana_v1 is
-- intentionally kept for old queued work and emergency compatibility.

alter table public.nft_collections
  add column if not exists pending_action_id uuid
    references public.linkr_pending_actions(id) on delete set null;

alter table public.nft_mints
  add column if not exists pending_action_id uuid
    references public.linkr_pending_actions(id) on delete set null;

create unique index if not exists nft_collections_pending_action_uidx
  on public.nft_collections (pending_action_id)
  where pending_action_id is not null;

create unique index if not exists nft_mints_pending_action_uidx
  on public.nft_mints (pending_action_id)
  where pending_action_id is not null;

create index if not exists nft_collections_user_status_created_idx
  on public.nft_collections (user_id, status, created_at desc);

create index if not exists nft_collections_user_status_lower_name_idx
  on public.nft_collections (user_id, status, lower(name));

create index if not exists nft_collections_user_status_lower_symbol_idx
  on public.nft_collections (user_id, status, lower(symbol));

create or replace function public.list_linkr_nft_collections_v1(
  p_user_id uuid,
  p_query text default null,
  p_limit integer default 5
)
returns table (
  id uuid,
  name text,
  symbol text,
  mint_address text,
  created_at timestamptz,
  match_kind text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_raw_query text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
begin
  if p_user_id is null then
    raise exception 'nft_collection_user_required';
  end if;

  if v_query = '' then
    return query
      select c.id, c.name, c.symbol, c.mint_address, c.created_at, 'recent'::text
      from public.nft_collections c
      where c.user_id = p_user_id
        and c.status = 'confirmed'
      order by c.created_at desc
      limit v_limit;
    return;
  end if;

  return query
    select c.id, c.name, c.symbol, c.mint_address, c.created_at, 'exact'::text
    from public.nft_collections c
    where c.user_id = p_user_id
      and c.status = 'confirmed'
      and (
        lower(c.name) = v_query
        or lower(c.symbol) = v_query
        or c.mint_address = v_raw_query
        or c.id::text = v_raw_query
      )
    order by c.created_at desc
    limit v_limit;

  if found then
    return;
  end if;

  return query
    select c.id, c.name, c.symbol, c.mint_address, c.created_at, 'fuzzy'::text
    from public.nft_collections c
    where c.user_id = p_user_id
      and c.status = 'confirmed'
      and (
        position(v_query in lower(c.name)) > 0
        or position(v_query in lower(c.symbol)) > 0
      )
    order by c.created_at desc
    limit v_limit;
end;
$$;

create or replace function public.confirm_linkr_nft_action_v1(
  p_pending_action_id uuid,
  p_confirmation_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_pending public.linkr_pending_actions%rowtype;
  v_confirmation public.linkr_work_items%rowtype;
  v_root public.linkr_work_items%rowtype;
  v_wallet public.wallets%rowtype;
  v_payload jsonb;
  v_kind text;
  v_command jsonb;
  v_tweet_id text;
  v_wallet_id uuid;
  v_accept jsonb;
  v_work_item_id uuid;
  v_root_id uuid;
begin
  if p_pending_action_id is null then
    raise exception 'pending_nft_required';
  end if;
  if p_confirmation_work_item_id is null then
    raise exception 'nft_confirmation_work_item_required';
  end if;

  select * into v_pending
  from public.linkr_pending_actions
  where id = p_pending_action_id
  for update;
  if not found then
    raise exception 'pending_nft_not_found';
  end if;
  if v_pending.action_type not in ('nft_create_collection', 'nft_mint') then
    raise exception 'pending_nft_action_type_mismatch';
  end if;

  select * into v_confirmation
  from public.linkr_work_items
  where id = p_confirmation_work_item_id
    and user_id = v_pending.user_id;
  if not found then
    raise exception 'nft_confirmation_work_item_mismatch';
  end if;

  if v_pending.status in ('confirmed', 'executing', 'executed') then
    return jsonb_build_object(
      'duplicate', true,
      'pending_action_id', v_pending.id,
      'work_item_id', v_pending.work_item_id,
      'status', v_pending.status
    );
  end if;
  if v_pending.status <> 'pending' then
    raise exception 'pending_nft_not_confirmable';
  end if;

  v_root_id := case
    when v_pending.deterministic_validation->>'root_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_pending.deterministic_validation->>'root_work_item_id')::uuid
    else v_pending.work_item_id
  end;
  select * into v_root
  from public.linkr_work_items
  where id = coalesce(v_root_id, p_confirmation_work_item_id)
    and user_id = v_pending.user_id
  for update;
  if not found then
    raise exception 'pending_nft_root_work_item_not_found';
  end if;

  if v_pending.expires_at <= now() then
    update public.linkr_pending_actions
    set status = 'expired', updated_at = now()
    where id = v_pending.id;
    update public.linkr_work_items
    set state = 'cancelled',
        terminal_at = now(),
        state_version = state_version + 1,
        last_error_code = 'nft_confirmation_expired',
        last_progress_at = now(),
        updated_at = now()
    where id = v_root.id
      and state in ('waiting_user_input', 'waiting_user_confirmation');
    return jsonb_build_object(
      'expired', true,
      'duplicate', false,
      'pending_action_id', v_pending.id,
      'work_item_id', v_root.id
    );
  end if;

  v_payload := coalesce(v_pending.action_payload, '{}'::jsonb);
  if coalesce(v_payload->>'chain', '') <> 'solana' then
    raise exception 'pending_nft_chain_not_solana';
  end if;
  begin
    v_wallet_id := nullif(v_payload->>'wallet_id', '')::uuid;
  exception when others then
    raise exception 'pending_nft_wallet_invalid';
  end;
  if v_wallet_id is null then
    raise exception 'pending_nft_wallet_required';
  end if;
  select * into v_wallet
  from public.wallets
  where id = v_wallet_id
    and user_id = v_pending.user_id
    and wallet_type = 'solana';
  if not found then
    raise exception 'pending_nft_wallet_mismatch';
  end if;

  v_kind := case
    when v_pending.action_type = 'nft_create_collection' then 'create_collection'
    else 'mint_nft'
  end;
  v_tweet_id := coalesce(
    nullif(v_payload->>'tweet_id', ''),
    nullif(v_root.source_event_id, ''),
    nullif(v_confirmation.source_event_id, '')
  );
  if v_tweet_id is null or length(v_tweet_id) > 64 then
    raise exception 'pending_nft_tweet_id_invalid';
  end if;

  if v_kind = 'create_collection' then
    if coalesce(length(btrim(v_payload->>'name')), 0) = 0 then
      raise exception 'pending_nft_collection_name_required';
    end if;
    if coalesce(length(btrim(v_payload->>'symbol')), 0) = 0 then
      raise exception 'pending_nft_collection_symbol_required';
    end if;
    v_command := jsonb_strip_nulls(jsonb_build_object(
      'kind', 'create_collection',
      'name', btrim(v_payload->>'name'),
      'symbol', upper(btrim(v_payload->>'symbol')),
      'description', nullif(btrim(coalesce(v_payload->>'description', '')), ''),
      'websiteUrl', nullif(btrim(coalesce(v_payload->>'website_url', '')), ''),
      'twitterUrl', nullif(btrim(coalesce(v_payload->>'twitter_url', '')), ''),
      'telegramUrl', nullif(btrim(coalesce(v_payload->>'telegram_url', '')), '')
    ));
  else
    if coalesce(length(btrim(coalesce(
      v_payload->>'collection_id',
      v_payload->>'collection_query',
      v_payload->>'collection_name'
    ))), 0) = 0 then
      raise exception 'pending_nft_collection_required';
    end if;
    v_command := jsonb_strip_nulls(jsonb_build_object(
      'kind', 'mint_nft',
      'collectionId', nullif(btrim(coalesce(v_payload->>'collection_id', '')), ''),
      'collectionQuery', coalesce(
        nullif(btrim(coalesce(v_payload->>'collection_name', '')), ''),
        nullif(btrim(coalesce(v_payload->>'collection_query', '')), ''),
        nullif(btrim(coalesce(v_payload->>'collection_id', '')), '')
      ),
      'name', nullif(btrim(coalesce(v_payload->>'nft_name', '')), '')
    ));
  end if;

  v_accept := public.accept_linkr_work_item(
    p_idempotency_key => 'nft-solana:' || v_pending.id::text || ':v1',
    p_source_surface => 'x',
    p_source_event_id => v_tweet_id,
    p_user_id => v_pending.user_id,
    p_conversation_id => null::uuid,
    p_request_type => case
      when v_kind = 'create_collection' then 'nft_collection_mint'
      else 'nft_mint'
    end,
    p_route => 'nft.solana',
    p_priority => 50::smallint,
    p_resource_type => 'wallet',
    p_resource_key => v_wallet.id::text,
    p_payload => jsonb_build_object(
      'schema_version', 2,
      'pending_action_id', v_pending.id,
      'kind', v_kind,
      'tweet_id', v_tweet_id,
      'command', v_command,
      'parent_work_item_id', v_root.id,
      'input_work_item_id', p_confirmation_work_item_id
    ),
    p_payload_hash => null,
    p_consumer_version => 'worker-nft-solana-v4',
    p_execution_generation => 1
  );
  v_work_item_id := (v_accept->>'work_item_id')::uuid;

  update public.linkr_work_items
  set parent_work_item_id = v_root.id,
      surface_conversation_id = v_pending.surface_conversation_id,
      updated_at = now()
  where id = v_work_item_id;

  update public.linkr_pending_actions
  set status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      work_item_id = v_work_item_id,
      action_payload = v_payload || jsonb_build_object(
        'confirmation_work_item_id', p_confirmation_work_item_id,
        'nft_work_item_id', v_work_item_id
      ),
      deterministic_validation = deterministic_validation ||
        jsonb_build_object('wallet_verified', true, 'chain_user_selected', true),
      updated_at = now()
  where id = v_pending.id;

  update public.linkr_work_items
  set state = 'waiting_prerequisite',
      state_version = state_version + 1,
      terminal_at = null,
      next_attempt_at = null,
      last_error_code = null,
      result_ref = 'nft_work_item:' || v_work_item_id::text,
      last_progress_at = now(),
      updated_at = now()
  where id = v_root.id
    and state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');

  insert into public.linkr_request_events (work_item_id, event_type, state, metadata)
  values (
    v_root.id,
    'nft_user_confirmed',
    'waiting_prerequisite',
    jsonb_build_object(
      'pending_action_id', v_pending.id,
      'nft_work_item_id', v_work_item_id,
      'confirmation_work_item_id', p_confirmation_work_item_id,
      'kind', v_kind
    )
  );

  return jsonb_build_object(
    'pending_action_id', v_pending.id,
    'work_item_id', v_work_item_id,
    'state', v_accept->>'state',
    'message_id', v_accept->>'message_id',
    'duplicate', coalesce((v_accept->>'duplicate')::boolean, false),
    'expired', false
  );
end;
$$;

create or replace function public.cancel_linkr_nft_action_v1(
  p_pending_action_id uuid,
  p_cancellation_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending public.linkr_pending_actions%rowtype;
  v_cancellation public.linkr_work_items%rowtype;
  v_root_id uuid;
begin
  select * into v_pending
  from public.linkr_pending_actions
  where id = p_pending_action_id
  for update;
  if not found then
    raise exception 'pending_nft_not_found';
  end if;
  if v_pending.action_type not in ('nft_create_collection', 'nft_mint') then
    raise exception 'pending_nft_action_type_mismatch';
  end if;
  select * into v_cancellation
  from public.linkr_work_items
  where id = p_cancellation_work_item_id
    and user_id = v_pending.user_id;
  if not found then
    raise exception 'nft_cancellation_work_item_mismatch';
  end if;
  if v_pending.status = 'cancelled' then
    return jsonb_build_object(
      'duplicate', true,
      'pending_action_id', v_pending.id,
      'status', 'cancelled'
    );
  end if;
  if v_pending.status <> 'pending' then
    raise exception 'pending_nft_not_cancellable';
  end if;

  v_root_id := case
    when v_pending.deterministic_validation->>'root_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_pending.deterministic_validation->>'root_work_item_id')::uuid
    else v_pending.work_item_id
  end;

  update public.linkr_pending_actions
  set status = 'cancelled',
      cancelled_at = now(),
      action_payload = coalesce(action_payload, '{}'::jsonb) ||
        jsonb_build_object('cancellation_work_item_id', p_cancellation_work_item_id),
      updated_at = now()
  where id = v_pending.id;

  update public.linkr_work_items
  set state = 'cancelled',
      terminal_at = now(),
      state_version = state_version + 1,
      last_error_code = null,
      last_progress_at = now(),
      updated_at = now()
  where id = v_root_id
    and state in ('waiting_user_input', 'waiting_user_confirmation');

  return jsonb_build_object(
    'duplicate', false,
    'pending_action_id', v_pending.id,
    'status', 'cancelled'
  );
end;
$$;

update public.linkr_queue_runtime_config
set consumer_version = 'worker-nft-solana-v4',
    updated_at = now()
where stage = 'nft_solana';

revoke all on function public.list_linkr_nft_collections_v1(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.list_linkr_nft_collections_v1(uuid, text, integer)
  to service_role;

revoke all on function public.confirm_linkr_nft_action_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_linkr_nft_action_v1(uuid, uuid)
  to service_role;

revoke all on function public.cancel_linkr_nft_action_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_linkr_nft_action_v1(uuid, uuid)
  to service_role;
