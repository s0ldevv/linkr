-- Domain handoff helpers for the thin X queue workers. Reply delivery gets its
-- own work item so a launch request can wait for user input while its
-- clarification is independently posted and retried.

alter table public.twitter_replies
  add column if not exists delivery_lane text not null default 'legacy';

alter table public.twitter_replies
  drop constraint if exists twitter_replies_delivery_lane_check;
alter table public.twitter_replies
  add constraint twitter_replies_delivery_lane_check
  check (delivery_lane in ('legacy', 'queue'));

create index if not exists twitter_replies_queue_lane_idx
  on public.twitter_replies (status, next_attempt_at, created_at)
  where delivery_lane = 'queue' and status in ('pending', 'posting');

create or replace function public.enqueue_linkr_x_reply_v1(
  p_parent_work_item_id uuid,
  p_reply_text text,
  p_kind text,
  p_version bigint default 1,
  p_priority smallint default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_parent public.linkr_work_items%rowtype;
  v_tweet public.tweets_inbox%rowtype;
  v_reply_work public.linkr_work_items%rowtype;
  v_reply public.twitter_replies%rowtype;
  v_idempotency_key text;
  v_message_id bigint;
  v_inserted boolean := false;
begin
  if p_reply_text is null or octet_length(btrim(p_reply_text)) not between 1 and 1000 then
    raise exception 'invalid_x_reply_text';
  end if;
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'invalid_x_reply_kind';
  end if;
  if p_version < 1 then raise exception 'invalid_x_reply_version'; end if;

  select * into v_parent from public.linkr_work_items
  where id = p_parent_work_item_id for update;
  if not found then raise exception 'parent_work_item_not_found'; end if;
  select * into v_tweet from public.tweets_inbox
  where work_item_id = v_parent.id;
  if not found then raise exception 'parent_x_tweet_not_found'; end if;

  v_idempotency_key := 'reply:' || v_parent.id::text || ':' || p_kind || ':' || p_version::text;
  insert into public.linkr_work_items (
    idempotency_key, source_surface, source_event_id, user_id,
    surface_conversation_id, request_type, route, state, priority,
    payload, consumer_version, execution_generation, last_progress_at
  ) values (
    v_idempotency_key, 'x', v_tweet.tweet_id, v_parent.user_id,
    v_tweet.conversation_id, 'x_reply', 'reply.x', 'queued', p_priority,
    jsonb_build_object(
      'parent_work_item_id', v_parent.id,
      'tweet_id', v_tweet.tweet_id,
      'reply_kind', p_kind,
      'reply_version', p_version
    ),
    'x-queue-v1', v_parent.execution_generation, now()
  ) on conflict (idempotency_key) do nothing
  returning * into v_reply_work;
  if found then v_inserted := true; end if;
  if not v_inserted then
    select * into v_reply_work from public.linkr_work_items
    where idempotency_key = v_idempotency_key;
  end if;

  insert into public.twitter_replies (
    tweet_id, reply_text, status, idempotency_key, conversation_id,
    author_twitter_id, work_item_id, delivery_lane
  ) values (
    v_tweet.tweet_id, btrim(p_reply_text), 'pending', v_idempotency_key,
    v_tweet.conversation_id, v_tweet.author_twitter_id,
    v_reply_work.id, 'queue'
  ) on conflict (idempotency_key) where idempotency_key is not null
  do update set work_item_id = excluded.work_item_id
  returning * into v_reply;

  insert into public.linkr_notification_deliveries (
    work_item_id, channel, idempotency_key, destination_ref,
    content_hash, state
  ) values (
    v_reply_work.id, 'x', v_idempotency_key, v_tweet.tweet_id,
    encode(extensions.digest(convert_to(btrim(p_reply_text), 'utf8'), 'sha256'), 'hex'), 'queued'
  ) on conflict (idempotency_key) do nothing;

  if v_inserted then v_message_id := public.linkr_enqueue_work_item(v_reply_work.id, 0); end if;
  return jsonb_build_object(
    'reply_work_item_id', v_reply_work.id,
    'reply_id', v_reply.id,
    'message_id', coalesce(v_message_id, v_reply_work.active_message_id),
    'duplicate', not v_inserted
  );
end;
$$;

-- Confirmation reserves the wallet sequence but routes through bounded media
-- capture before a chain SDK can be loaded.
create or replace function public.confirm_linkr_launch_action_v1(
  p_pending_action_id uuid,
  p_confirmation_work_item_id uuid,
  p_chain text,
  p_wallet_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_pending public.linkr_pending_actions%rowtype;
  v_item public.linkr_work_items%rowtype;
  v_wallet public.wallets%rowtype;
  v_resource_key text;
  v_resource_sequence bigint;
  v_active_work_item_id uuid;
  v_message_id bigint;
  v_state text;
begin
  if p_chain not in ('solana', 'robinhood') then raise exception 'unsupported_launch_chain'; end if;
  if p_wallet_id is null then raise exception 'launch_wallet_required'; end if;
  select * into v_pending from public.linkr_pending_actions
  where id = p_pending_action_id for update;
  if not found then raise exception 'pending_launch_not_found'; end if;
  select * into v_item from public.linkr_work_items
  where id = v_pending.work_item_id for update;
  if not found then raise exception 'pending_launch_work_item_not_found'; end if;
  select * into v_wallet from public.wallets
  where id = p_wallet_id and user_id = v_pending.user_id;
  if not found then raise exception 'launch_wallet_not_owned'; end if;
  if (p_chain = 'solana' and v_wallet.wallet_type <> 'solana')
     or (p_chain = 'robinhood' and (v_wallet.wallet_type <> 'evm' or v_wallet.chain_id <> 4663)) then
    raise exception 'launch_wallet_chain_mismatch';
  end if;

  if v_pending.status in ('confirmed', 'executing', 'executed') then
    return jsonb_build_object(
      'pending_action_id', v_pending.id, 'work_item_id', v_item.id,
      'state', v_item.state, 'message_id', v_item.active_message_id,
      'duplicate', true
    );
  end if;
  if v_pending.status <> 'pending' then raise exception 'pending_launch_not_confirmable'; end if;
  if v_pending.expires_at <= now() then
    update public.linkr_pending_actions set status = 'expired', updated_at = now()
    where id = v_pending.id;
    update public.linkr_work_items
    set state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
        last_error_code = 'confirmation_expired', last_progress_at = now(), updated_at = now()
    where id = v_pending.work_item_id and state = 'waiting_user_confirmation';
    return jsonb_build_object(
      'pending_action_id', v_pending.id, 'work_item_id', v_pending.work_item_id,
      'state', 'cancelled', 'expired', true, 'duplicate', false
    );
  end if;
  if v_item.state <> 'waiting_user_confirmation' then
    raise exception 'launch_work_item_not_waiting_confirmation';
  end if;

  v_resource_key := p_wallet_id::text;
  insert into public.linkr_resource_heads (
    resource_type, resource_key, active_work_item_id, active_sequence,
    next_sequence, updated_at
  ) values ('wallet', v_resource_key, null, null, 2, now())
  on conflict (resource_type, resource_key) do update set
    next_sequence = public.linkr_resource_heads.next_sequence + 1,
    updated_at = now()
  returning next_sequence - 1, active_work_item_id
  into v_resource_sequence, v_active_work_item_id;

  v_state := case when v_active_work_item_id is null then 'queued' else 'waiting_resource' end;
  update public.linkr_work_items
  set route = 'media.capture', state = v_state,
      state_version = state_version + 1,
      resource_type = 'wallet', resource_key = v_resource_key,
      resource_sequence = v_resource_sequence,
      next_attempt_at = null, last_error_code = null,
      last_progress_at = now(), updated_at = now()
  where id = v_item.id returning * into v_item;

  if v_active_work_item_id is null then
    update public.linkr_resource_heads
    set active_work_item_id = v_item.id, active_sequence = v_resource_sequence,
        updated_at = now()
    where resource_type = 'wallet' and resource_key = v_resource_key;
    v_message_id := public.linkr_enqueue_work_item(v_item.id, 0);
  end if;

  update public.linkr_pending_actions
  set status = 'confirmed', confirmed_at = now(), updated_at = now(),
      action_payload = action_payload || jsonb_build_object(
        'chain', p_chain, 'wallet_id', p_wallet_id,
        'confirmation_work_item_id', p_confirmation_work_item_id
      )
  where id = v_pending.id;
  insert into public.linkr_request_events (work_item_id, event_type, state, metadata)
  values (
    v_item.id, 'user_confirmed', v_state,
    jsonb_build_object(
      'pending_action_id', v_pending.id,
      'confirmation_work_item_id', p_confirmation_work_item_id,
      'chain', p_chain, 'next_route', 'media.capture'
    )
  );
  return jsonb_build_object(
    'pending_action_id', v_pending.id, 'work_item_id', v_item.id,
    'state', v_state, 'message_id', v_message_id, 'duplicate', false
  );
end;
$$;

revoke all on function public.enqueue_linkr_x_reply_v1(uuid, text, text, bigint, smallint)
  from public, anon, authenticated;
grant execute on function public.enqueue_linkr_x_reply_v1(uuid, text, text, bigint, smallint)
  to service_role;

-- Register exact versions but keep every new consumer disabled until its
-- artifact and hosted smoke tests pass.
update public.linkr_queue_runtime_config set
  consumer_version = case stage
    when 'x_ingress' then 'worker-x-ingress-v1'
    when 'conversation_turns_high' then 'worker-conversation-turn-v1'
    when 'conversation_turns_normal' then 'worker-conversation-turn-v1'
    when 'command_prepare' then 'worker-command-prepare-v1'
    when 'media_capture' then 'worker-media-capture-v1'
    when 'reply_x_high' then 'worker-reply-x-v1'
    when 'reply_x_normal' then 'worker-reply-x-v1'
    when 'launch_robinhood' then 'worker-launch-robinhood-v1'
    when 'confirm_robinhood' then 'worker-confirm-robinhood-v1'
    when 'launch_solana' then 'worker-launch-solana-v1'
    when 'confirm_solana' then 'worker-confirm-solana-v1'
    when 'reconciliation' then 'worker-reconcile-v1'
    else consumer_version
  end,
  enabled = false,
  batch_size = 1,
  max_concurrency = 1,
  updated_at = now()
where stage in (
  'x_ingress', 'conversation_turns_high', 'conversation_turns_normal',
  'command_prepare', 'media_capture', 'reply_x_high', 'reply_x_normal',
  'launch_robinhood', 'confirm_robinhood', 'launch_solana',
  'confirm_solana', 'reconciliation'
);
