-- Add isolated enrichment/image stages and atomically convert a fully prepared
-- draft into one wallet-fenced economic launch. Existing live stages are
-- paused until the matching worker artifacts are deployed by Migration C.

update public.linkr_queue_runtime_config
set enabled = false, updated_at = now()
where stage in ('x_ingress', 'command_prepare', 'media_capture');

do $$
declare v_queue text;
begin
  foreach v_queue in array array['launch_enrich', 'image_generate'] loop
    if to_regclass('pgmq.q_' || v_queue) is null then
      perform pgmq.create(v_queue);
    end if;
  end loop;
end;
$$;

insert into public.linkr_queue_runtime_config (
  stage, worker_function, enabled, batch_size,
  visibility_timeout_seconds, max_concurrency, consumer_version,
  rollout_percent, canary_user_ids
) values
  ('launch_enrich', 'worker-launch-enrich', false, 1, 180, 1,
    'worker-launch-enrich-v1', 100, '{}'::uuid[]),
  ('image_generate', 'worker-image-generate', false, 1, 180, 1,
    'worker-image-generate-v1', 100, '{}'::uuid[])
on conflict (stage) do update set
  worker_function = excluded.worker_function,
  enabled = false,
  batch_size = 1,
  max_concurrency = 1,
  visibility_timeout_seconds = excluded.visibility_timeout_seconds,
  consumer_version = excluded.consumer_version,
  updated_at = now();

insert into public.linkr_dispatch_stage_state (stage)
values ('launch_enrich'), ('image_generate')
on conflict do nothing;

insert into public.linkr_worker_capacity_slots (stage, slot_number)
values ('launch_enrich', 1), ('image_generate', 1)
on conflict do nothing;

create or replace function public.linkr_queue_for_route(
  p_route text,
  p_priority smallint default 50
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case
    when p_route = 'x.ingress' then 'x_ingress'
    when p_route = 'telegram.control' then 'telegram_control'
    when p_route = 'conversation.turn' and p_priority >= 80 then 'conversation_turns_high'
    when p_route = 'conversation.turn' then 'conversation_turns_normal'
    when p_route = 'command.prepare' then 'command_prepare'
    when p_route = 'launch.enrich' then 'launch_enrich'
    when p_route = 'media.capture' then 'media_capture'
    when p_route = 'image.generate' then 'image_generate'
    when p_route = 'action.solana' then 'action_solana'
    when p_route = 'action.robinhood' then 'action_robinhood'
    when p_route = 'launch.solana' then 'launch_solana'
    when p_route = 'launch.robinhood' then 'launch_robinhood'
    when p_route = 'confirm.solana' then 'confirm_solana'
    when p_route = 'confirm.robinhood' then 'confirm_robinhood'
    when p_route = 'reply.x' and p_priority >= 80 then 'reply_x_high'
    when p_route = 'reply.x' then 'reply_x_normal'
    when p_route = 'reply.telegram' and p_priority >= 80 then 'reply_telegram_high'
    when p_route = 'reply.telegram' then 'reply_telegram_normal'
    when p_route = 'reconciliation' then 'reconciliation'
    else null
  end;
$$;

create or replace function public.linkr_queue_for_route(
  p_route text,
  p_priority integer
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case when p_priority between -32768 and 32767
    then public.linkr_queue_for_route(p_route, p_priority::smallint)
    else null end;
$$;

alter table public.tweets_inbox
  add column if not exists queue_generation bigint not null default 0;

create or replace function public.guard_linkr_x_queue_ownership_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.queue_generation > 0
     and new.status in ('processing', 'completed')
     and new.work_item_id is null then
    raise exception 'queue_owned_tweet_requires_work_item';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_linkr_x_queue_ownership on public.tweets_inbox;
create trigger guard_linkr_x_queue_ownership
before insert or update of status, work_item_id, queue_generation
on public.tweets_inbox
for each row execute function public.guard_linkr_x_queue_ownership_v1();

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
  v_root public.linkr_work_items%rowtype;
  v_tweet public.tweets_inbox%rowtype;
  v_reply_work public.linkr_work_items%rowtype;
  v_reply public.twitter_replies%rowtype;
  v_idempotency_key text;
  v_message_id bigint;
  v_inserted boolean := false;
  v_payload_parent uuid;
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
  begin
    if v_parent.payload->>'parent_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_payload_parent := (v_parent.payload->>'parent_work_item_id')::uuid;
    end if;
  exception when others then v_payload_parent := null;
  end;
  select * into v_root from public.linkr_work_items
  where id = coalesce(v_parent.parent_work_item_id, v_payload_parent, v_parent.id);
  if not found then v_root := v_parent; end if;
  select * into v_tweet from public.tweets_inbox
  where work_item_id = v_root.id;
  if not found then
    select * into v_tweet from public.tweets_inbox
    where tweet_id = coalesce(v_root.source_event_id, v_parent.source_event_id);
  end if;
  if not found then raise exception 'parent_x_tweet_not_found'; end if;

  v_idempotency_key := 'reply:' || v_root.id::text || ':' || p_kind || ':' || p_version::text;
  insert into public.linkr_work_items (
    idempotency_key, source_surface, source_event_id, user_id,
    surface_conversation_id, request_type, route, state, priority,
    payload, consumer_version, execution_generation, last_progress_at,
    parent_work_item_id
  ) values (
    v_idempotency_key, 'x', v_tweet.tweet_id, v_root.user_id,
    v_tweet.conversation_id, 'x_reply', 'reply.x', 'queued', p_priority,
    jsonb_build_object(
      'parent_work_item_id', v_root.id,
      'tweet_id', v_tweet.tweet_id,
      'reply_kind', p_kind,
      'reply_version', p_version
    ),
    'x-queue-v2', v_root.execution_generation, now(), v_root.id
  ) on conflict (idempotency_key) do nothing
  returning * into v_reply_work;
  if found then v_inserted := true; end if;
  if not v_inserted then
    select * into v_reply_work from public.linkr_work_items
    where idempotency_key = v_idempotency_key;
  end if;

  insert into public.twitter_replies (
    tweet_id, reply_text, status, idempotency_key, conversation_id,
    author_twitter_id, work_item_id, delivery_lane, reply_kind
  ) values (
    v_tweet.tweet_id, btrim(p_reply_text), 'pending', v_idempotency_key,
    v_tweet.conversation_id, v_tweet.author_twitter_id,
    v_reply_work.id, 'queue', p_kind
  ) on conflict (idempotency_key) where idempotency_key is not null
  do update set work_item_id = excluded.work_item_id
  returning * into v_reply;

  insert into public.linkr_notification_deliveries (
    work_item_id, channel, idempotency_key, destination_ref,
    content_hash, state
  ) values (
    v_reply_work.id, 'x', v_idempotency_key, v_tweet.tweet_id,
    encode(extensions.digest(convert_to(btrim(p_reply_text), 'utf8'), 'sha256'), 'hex'),
    'queued'
  ) on conflict (idempotency_key) do nothing;

  if v_inserted then
    v_message_id := public.linkr_enqueue_work_item(v_reply_work.id, 0);
  end if;
  return jsonb_build_object(
    'reply_work_item_id', v_reply_work.id,
    'reply_id', v_reply.id,
    'message_id', coalesce(v_message_id, v_reply_work.active_message_id),
    'parent_work_item_id', v_root.id,
    'duplicate', not v_inserted
  );
end;
$$;

create or replace function public.queue_linkr_launch_enrichment_v1(
  p_draft_id uuid,
  p_input_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_draft public.linkr_action_drafts%rowtype;
  v_root public.linkr_work_items%rowtype;
  v_accept jsonb;
  v_enrich_id uuid;
begin
  select * into v_draft from public.linkr_action_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'launch_draft_not_found'; end if;
  if cardinality(v_draft.required_fields) > 0 then
    raise exception 'launch_draft_incomplete';
  end if;
  if coalesce(v_draft.filled_fields->>'chain', '') not in ('solana', 'robinhood')
     or coalesce(v_draft.field_provenance->>'chain', '') not in ('user_text', 'thread_context') then
    raise exception 'explicit_launch_chain_provenance_required';
  end if;
  if coalesce((v_draft.generation_context->>'explicit_launch_intent')::boolean, false)
     is not true then raise exception 'explicit_launch_intent_required'; end if;
  select * into v_root from public.linkr_work_items
  where id = v_draft.work_item_id for update;
  if not found then raise exception 'launch_root_work_item_not_found'; end if;

  v_accept := public.accept_linkr_work_item(
    p_idempotency_key => 'launch-enrich:' || v_draft.id::text || ':g' || v_draft.session_generation,
    p_source_surface => 'x',
    p_source_event_id => v_root.source_event_id,
    p_user_id => v_draft.user_id,
    p_conversation_id => null::uuid,
    p_request_type => 'launch_enrichment',
    p_route => 'launch.enrich',
    p_priority => 70::smallint,
    p_payload => jsonb_build_object(
      'schema_version', 1,
      'draft_id', v_draft.id,
      'draft_generation', v_draft.session_generation,
      'parent_work_item_id', v_root.id
    ),
    p_consumer_version => 'worker-launch-enrich-v1',
    p_execution_generation => 1
  );
  v_enrich_id := (v_accept->>'work_item_id')::uuid;
  update public.linkr_work_items set
    parent_work_item_id = v_root.id,
    surface_conversation_id = v_root.surface_conversation_id,
    updated_at = now()
  where id = v_enrich_id;
  update public.linkr_action_drafts set
    status = 'ready', updated_at = now()
  where id = v_draft.id;
  update public.linkr_work_items set
    state = 'waiting_prerequisite',
    state_version = state_version + 1,
    next_attempt_at = null,
    last_error_code = null,
    result_ref = 'launch_enrichment:' || v_enrich_id::text,
    last_progress_at = now(), updated_at = now()
  where id = v_root.id and state in ('waiting_user_input', 'waiting_user_confirmation');
  return v_accept || jsonb_build_object(
    'enrichment_work_item_id', v_enrich_id,
    'root_work_item_id', v_root.id
  );
end;
$$;

create or replace function public.update_linkr_launch_enrichment_v1(
  p_draft_id uuid,
  p_expected_version bigint,
  p_generated_fields jsonb,
  p_generated_provenance jsonb,
  p_generation_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.linkr_action_drafts%rowtype;
  v_fields jsonb;
  v_provenance jsonb;
  v_key text;
begin
  if p_generated_fields is null or jsonb_typeof(p_generated_fields) <> 'object'
     or p_generated_provenance is null or jsonb_typeof(p_generated_provenance) <> 'object'
     or p_generation_context is null or jsonb_typeof(p_generation_context) <> 'object' then
    raise exception 'launch_enrichment_payload_invalid';
  end if;
  if p_generated_fields ? 'chain' or p_generated_provenance ? 'chain' then
    raise exception 'launch_enrichment_cannot_set_chain';
  end if;
  select * into v_draft from public.linkr_action_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'launch_draft_not_found'; end if;
  if v_draft.version <> p_expected_version then
    raise exception 'stale_launch_draft_version';
  end if;
  if coalesce(v_draft.filled_fields->>'chain', '') not in ('solana', 'robinhood')
     or coalesce(v_draft.field_provenance->>'chain', '') not in ('user_text', 'thread_context') then
    raise exception 'explicit_launch_chain_provenance_required';
  end if;
  v_fields := coalesce(v_draft.filled_fields, '{}'::jsonb);
  v_provenance := coalesce(v_draft.field_provenance, '{}'::jsonb);
  foreach v_key in array array[
    'symbol', 'description', 'image_prompt', 'image_negative_prompt',
    'dev_buy_amount'
  ] loop
    if coalesce(length(btrim(v_fields->>v_key)), 0) = 0
       and coalesce(length(btrim(p_generated_fields->>v_key)), 0) > 0 then
      v_fields := jsonb_set(v_fields, array[v_key], p_generated_fields->v_key, true);
      v_provenance := jsonb_set(
        v_provenance, array[v_key],
        to_jsonb(coalesce(p_generated_provenance->>v_key, 'deterministic_fallback')),
        true
      );
    end if;
  end loop;
  update public.linkr_action_drafts set
    filled_fields = v_fields,
    field_provenance = v_provenance,
    generation_context = coalesce(generation_context, '{}'::jsonb) || p_generation_context,
    version = version + 1,
    updated_at = now()
  where id = v_draft.id
  returning * into v_draft;
  return to_jsonb(v_draft);
end;
$$;

create or replace function public.activate_linkr_authorized_launch_v1(
  p_pending_action_id uuid,
  p_authorization_kind text,
  p_confirmation_work_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_pending public.linkr_pending_actions%rowtype;
  v_root public.linkr_work_items%rowtype;
  v_draft public.linkr_action_drafts%rowtype;
  v_payload jsonb;
  v_chain text;
  v_wallet_id uuid;
  v_accept jsonb;
  v_economic_id uuid;
  v_ensure jsonb;
  v_amount numeric;
begin
  if p_authorization_kind not in ('explicit_launch_intent', 'manual_confirmation') then
    raise exception 'launch_authorization_kind_invalid';
  end if;
  select * into v_pending from public.linkr_pending_actions
  where id = p_pending_action_id for update;
  if not found then raise exception 'pending_launch_not_found'; end if;
  if v_pending.status not in ('pending', 'confirmed', 'executing') then
    raise exception 'pending_launch_not_activatable';
  end if;
  if v_pending.expires_at <= now() then raise exception 'pending_launch_expired'; end if;
  select * into v_draft from public.linkr_action_drafts
  where id = v_pending.draft_id for update;
  if not found then raise exception 'launch_draft_not_found'; end if;
  select * into v_root from public.linkr_work_items
  where id = coalesce(
    case when v_pending.deterministic_validation->>'root_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_pending.deterministic_validation->>'root_work_item_id')::uuid else null end,
    v_draft.work_item_id
  ) for update;
  if not found then raise exception 'launch_root_work_item_not_found'; end if;
  v_payload := v_pending.action_payload;
  v_chain := v_payload->>'chain';
  begin v_wallet_id := (v_payload->>'wallet_id')::uuid;
  exception when others then raise exception 'launch_wallet_invalid'; end;
  if coalesce(v_chain, '') not in ('solana', 'robinhood') then raise exception 'launch_chain_missing'; end if;
  if coalesce(v_draft.field_provenance->>'chain', '') not in ('user_text', 'thread_context') then
    raise exception 'explicit_launch_chain_provenance_required';
  end if;
  if not exists (
    select 1 from public.wallets w where w.id = v_wallet_id
      and w.user_id = v_pending.user_id
      and ((v_chain = 'solana' and w.wallet_type = 'solana')
        or (v_chain = 'robinhood' and w.wallet_type = 'evm' and w.chain_id = 4663))
  ) then raise exception 'launch_wallet_mismatch'; end if;

  if v_pending.work_item_id is not null and exists (
    select 1 from public.linkr_work_items w
    where w.id = v_pending.work_item_id and w.parent_work_item_id = v_root.id
      and w.request_type = 'launch_coin'
  ) then
    select id into v_economic_id from public.linkr_work_items
    where id = v_pending.work_item_id;
    select jsonb_build_object('launch_id', id) into v_ensure
    from public.coin_launches where work_item_id = v_economic_id limit 1;
    return jsonb_build_object(
      'economic_work_item_id', v_economic_id,
      'launch_id', v_ensure->>'launch_id', 'duplicate', true
    );
  end if;

  v_accept := public.accept_linkr_work_item(
    p_idempotency_key => 'launch:x:' || v_draft.id::text || ':g' || v_draft.session_generation,
    p_source_surface => 'x',
    p_source_event_id => v_root.source_event_id,
    p_user_id => v_pending.user_id,
    p_conversation_id => null::uuid,
    p_request_type => 'launch_coin',
    p_route => case when v_chain = 'solana' then 'launch.solana' else 'launch.robinhood' end,
    p_priority => 80::smallint,
    p_resource_type => 'wallet',
    p_resource_key => v_wallet_id::text,
    p_payload => jsonb_build_object(
      'schema_version', 1, 'draft_id', v_draft.id,
      'parent_work_item_id', v_root.id, 'chain', v_chain
    ),
    p_payload_hash => encode(
      extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex'
    ),
    p_consumer_version => case when v_chain = 'solana'
      then 'worker-launch-solana-v1' else 'worker-launch-robinhood-v1' end,
    p_execution_generation => 1
  );
  v_economic_id := (v_accept->>'work_item_id')::uuid;
  update public.linkr_work_items set
    parent_work_item_id = v_root.id,
    surface_conversation_id = v_root.surface_conversation_id,
    updated_at = now()
  where id = v_economic_id;
  update public.linkr_pending_actions set
    status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()),
    work_item_id = v_economic_id,
    action_payload = action_payload || jsonb_build_object(
      'confirmation_work_item_id', p_confirmation_work_item_id,
      'authorization_kind', p_authorization_kind
    ),
    deterministic_validation = deterministic_validation || jsonb_build_object(
      'authorization_kind', p_authorization_kind,
      'wallet_verified', true,
      'chain_user_selected', true
    ),
    updated_at = now()
  where id = v_pending.id;

  v_ensure := public.ensure_linkr_coin_launch_v1(
    v_economic_id, v_pending.id,
    v_payload->>'image_url',
    coalesce(v_payload->>'original_image_url', v_payload->>'image_url'),
    v_payload->>'token_logo_storage_path',
    v_payload->>'image_sha256',
    v_payload->>'image_content_type',
    (v_payload->>'image_width')::integer,
    (v_payload->>'image_height')::integer
  );
  v_amount := split_part(v_payload->>'dev_buy_amount', ' ', 1)::numeric;
  update public.coin_launches set
    source_surface = 'x',
    idempotency_key = 'queue-launch:' || v_economic_id::text,
    metadata_website_url = nullif(v_payload->>'website_url', ''),
    metadata_twitter_url = nullif(v_payload->>'twitter_url', ''),
    metadata_telegram_url = nullif(v_payload->>'telegram_url', ''),
    creator_rewards_config = case when jsonb_typeof(v_payload->'creator_rewards_config') = 'object'
      then v_payload->'creator_rewards_config' else null end,
    dev_buy_sol = case when v_chain = 'solana' then v_amount else dev_buy_sol end,
    requested_initial_buy_eth = case when v_chain = 'robinhood' then v_amount else requested_initial_buy_eth end,
    dev_buy_eth = case when v_chain = 'robinhood' then v_amount else dev_buy_eth end,
    launch_method = case when v_chain = 'solana'
      then 'pump_fun_create_v2' else 'single_sided_uniswap_v3_lp' end
  where id = (v_ensure->>'launch_id')::uuid;

  update public.linkr_work_items set
    state = 'waiting_prerequisite', state_version = state_version + 1,
    terminal_at = null, next_attempt_at = null, last_error_code = null,
    result_ref = 'coin_launch:' || (v_ensure->>'launch_id'),
    last_progress_at = now(), updated_at = now()
  where id = v_root.id and state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
  update public.linkr_action_drafts set
    status = 'converted_to_pending', closed_at = coalesce(closed_at, now()),
    authorization_kind = p_authorization_kind,
    auto_launch_authorized_at = case when p_authorization_kind = 'explicit_launch_intent'
      then coalesce(auto_launch_authorized_at, now()) else auto_launch_authorized_at end,
    updated_at = now()
  where id = v_draft.id;
  return jsonb_build_object(
    'economic_work_item_id', v_economic_id,
    'launch_id', v_ensure->>'launch_id',
    'state', v_accept->>'state',
    'duplicate', coalesce((v_accept->>'duplicate')::boolean, false)
  );
end;
$$;

create or replace function public.authorize_linkr_launch_v2(
  p_draft_id uuid,
  p_preparation_work_item_id uuid,
  p_wallet_id uuid,
  p_payload jsonb,
  p_image_url text,
  p_original_image_url text,
  p_storage_path text,
  p_image_sha256 text,
  p_image_content_type text,
  p_image_width integer,
  p_image_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_draft public.linkr_action_drafts%rowtype;
  v_root public.linkr_work_items%rowtype;
  v_profile public.profiles%rowtype;
  v_pending public.linkr_pending_actions%rowtype;
  v_chain text;
  v_amount numeric;
  v_cap numeric;
  v_confirmation boolean;
  v_key text;
  v_activation jsonb := null;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384 then
    raise exception 'launch_payload_invalid';
  end if;
  select * into v_draft from public.linkr_action_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'launch_draft_not_found'; end if;
  if not exists (
    select 1 from public.linkr_work_items w
    where w.id = p_preparation_work_item_id and w.parent_work_item_id = v_draft.work_item_id
      and w.user_id = v_draft.user_id and w.request_type = 'launch_enrichment'
  ) then raise exception 'launch_preparation_work_item_mismatch'; end if;
  select * into v_root from public.linkr_work_items
  where id = v_draft.work_item_id for update;
  if not found then raise exception 'launch_root_work_item_not_found'; end if;
  select * into v_profile from public.profiles
  where user_id = v_draft.user_id;
  if not found then raise exception 'launch_profile_missing'; end if;
  v_chain := p_payload->>'chain';
  if coalesce(v_chain, '') not in ('solana', 'robinhood')
     or v_draft.filled_fields->>'chain' is distinct from v_chain
     or coalesce(v_draft.field_provenance->>'chain', '') not in ('user_text', 'thread_context') then
    raise exception 'explicit_launch_chain_provenance_required';
  end if;
  if coalesce((v_draft.generation_context->>'explicit_launch_intent')::boolean, false)
     is not true then raise exception 'explicit_launch_intent_required'; end if;
  if coalesce(length(btrim(p_payload->>'name')), 0) not between 1 and 80
     or coalesce(length(btrim(p_payload->>'symbol')), 0) not between 2 and 10
     or (p_payload->>'symbol') !~ '^[A-Z0-9]{2,10}$'
     or coalesce(length(btrim(p_payload->>'description')), 0) not between 1 and 250 then
    raise exception 'launch_payload_fields_invalid';
  end if;
  if coalesce(length(btrim(p_image_url)), 0) = 0
     or p_image_sha256 !~ '^[0-9a-f]{64}$'
     or p_image_width not between 1 and 4096
     or p_image_height not between 1 and 4096 then
    raise exception 'launch_image_invalid';
  end if;
  if not exists (
    select 1 from public.wallets w where w.id = p_wallet_id
      and w.user_id = v_draft.user_id and w.is_primary
      and ((v_chain = 'solana' and w.wallet_type = 'solana')
        or (v_chain = 'robinhood' and w.wallet_type = 'evm' and w.chain_id = 4663))
  ) then raise exception 'launch_wallet_mismatch'; end if;
  if coalesce(p_payload->>'dev_buy_amount', '') !~ '^\d+(\.\d{1,18})? (SOL|ETH)$' then
    raise exception 'initial_buy_amount_invalid';
  end if;
  if (v_chain = 'solana' and p_payload->>'dev_buy_amount' !~ ' SOL$')
     or (v_chain = 'robinhood' and p_payload->>'dev_buy_amount' !~ ' ETH$') then
    raise exception 'initial_buy_chain_mismatch';
  end if;
  v_amount := split_part(p_payload->>'dev_buy_amount', ' ', 1)::numeric;
  v_cap := case when v_chain = 'solana'
    then coalesce(v_profile.max_auto_dev_buy_sol, 0)
    else coalesce(v_profile.max_auto_dev_buy_eth, 0) end;
  if v_amount < 0 or v_amount > v_cap then
    raise exception 'initial_buy_exceeds_profile_cap';
  end if;
  v_confirmation := coalesce(v_profile.require_confirmation_for_all_tx, false)
    or jsonb_typeof(p_payload->'creator_rewards_config') = 'object';
  v_key := 'autonomous-launch:' || v_draft.id::text || ':g' || v_draft.session_generation;

  insert into public.linkr_pending_actions (
    user_id, surface, surface_conversation_id, x_thread_id, draft_id,
    action_type, status, confirmation_phrase, summary, action_payload,
    risk_summary, deterministic_validation, source_refs, idempotency_key,
    expires_at, confirmed_at, source_surface, work_item_id, draft_version
  ) values (
    v_draft.user_id, 'x', v_draft.surface_conversation_id, v_draft.x_thread_id,
    v_draft.id, 'launch_coin', case when v_confirmation then 'pending' else 'confirmed' end,
    'confirm launch', left('Launch $' || upper(p_payload->>'symbol') || ' on ' || v_chain, 500),
    p_payload || jsonb_build_object(
      'wallet_id', p_wallet_id,
      'image_url', p_image_url,
      'original_image_url', coalesce(nullif(p_original_image_url, ''), p_image_url),
      'token_logo_storage_path', p_storage_path,
      'image_sha256', p_image_sha256,
      'image_content_type', p_image_content_type,
      'image_width', p_image_width,
      'image_height', p_image_height
    ),
    jsonb_build_array('Token launches are irreversible.'),
    jsonb_build_object(
      'required_fields_complete', true,
      'chain_user_selected', true,
      'chain_provenance', v_draft.field_provenance->>'chain',
      'wallet_verified', true,
      'root_work_item_id', v_root.id,
      'preparation_work_item_id', p_preparation_work_item_id
    ),
    v_draft.source_refs, v_key, now() + interval '24 hours',
    case when v_confirmation then null else now() end,
    'x', v_root.id, v_draft.version
  ) on conflict (user_id, idempotency_key) do update set updated_at = now()
  returning * into v_pending;

  if v_confirmation then
    update public.linkr_work_items set
      state = 'waiting_user_confirmation', state_version = state_version + 1,
      result_ref = 'pending_action:' || v_pending.id::text,
      next_attempt_at = null, last_error_code = null,
      last_progress_at = now(), updated_at = now()
    where id = v_root.id and state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
    update public.linkr_action_drafts set
      status = 'converted_to_pending', closed_at = coalesce(closed_at, now()),
      updated_at = now()
    where id = v_draft.id;
  else
    v_activation := public.activate_linkr_authorized_launch_v1(
      v_pending.id, 'explicit_launch_intent', null
    );
  end if;
  return jsonb_build_object(
    'pending_action_id', v_pending.id,
    'root_work_item_id', v_root.id,
    'decision', case when v_confirmation then 'confirmation_required' else 'auto_authorized' end,
    'activation', v_activation
  );
end;
$$;

create or replace function public.pause_linkr_launch_preparation_v1(
  p_draft_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.linkr_action_drafts%rowtype;
begin
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9:_-]{0,119}$' then
    raise exception 'launch_pause_reason_invalid';
  end if;
  select * into v_draft from public.linkr_action_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'launch_draft_not_found'; end if;
  update public.linkr_action_drafts set
    status = 'awaiting_clarification',
    generation_context = coalesce(generation_context, '{}'::jsonb) ||
      jsonb_build_object('pause_reason', p_reason_code, 'paused_at', now()),
    version = version + 1,
    last_user_input_at = coalesce(last_user_input_at, now()),
    updated_at = now()
  where id = v_draft.id;
  update public.linkr_work_items set
    state = 'waiting_user_input', state_version = state_version + 1,
    next_attempt_at = null, last_error_code = p_reason_code,
    result_ref = 'draft:' || v_draft.id::text,
    last_progress_at = now(), updated_at = now()
  where id = v_draft.work_item_id
    and state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
  return jsonb_build_object(
    'draft_id', v_draft.id,
    'root_work_item_id', v_draft.work_item_id,
    'reason_code', p_reason_code
  );
end;
$$;

create or replace function public.confirm_linkr_launch_action_v2(
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
  v_root_id uuid;
  v_activation jsonb;
begin
  select * into v_pending from public.linkr_pending_actions
  where id = p_pending_action_id for update;
  if not found then raise exception 'pending_launch_not_found'; end if;
  if v_pending.status in ('confirmed', 'executing', 'executed') then
    return jsonb_build_object('duplicate', true, 'pending_action_id', v_pending.id);
  end if;
  if v_pending.status <> 'pending' then raise exception 'pending_launch_not_confirmable'; end if;
  select * into v_confirmation from public.linkr_work_items
  where id = p_confirmation_work_item_id and user_id = v_pending.user_id;
  if not found then raise exception 'confirmation_work_item_mismatch'; end if;
  if v_pending.expires_at <= now() then
    update public.linkr_pending_actions set status = 'expired', updated_at = now()
    where id = v_pending.id;
    v_root_id := case when v_pending.deterministic_validation->>'root_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_pending.deterministic_validation->>'root_work_item_id')::uuid else v_pending.work_item_id end;
    update public.linkr_work_items set
      state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
      last_error_code = 'confirmation_expired', last_progress_at = now(), updated_at = now()
    where id = v_root_id;
    return jsonb_build_object('expired', true, 'pending_action_id', v_pending.id);
  end if;
  update public.linkr_pending_actions set
    status = 'confirmed', confirmed_at = now(), updated_at = now()
  where id = v_pending.id;
  v_activation := public.activate_linkr_authorized_launch_v1(
    v_pending.id, 'manual_confirmation', p_confirmation_work_item_id
  );
  return jsonb_build_object(
    'pending_action_id', v_pending.id,
    'duplicate', false,
    'activation', v_activation
  );
end;
$$;

revoke all on function public.guard_linkr_x_queue_ownership_v1()
  from public, anon, authenticated;
revoke all on function public.queue_linkr_launch_enrichment_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.queue_linkr_launch_enrichment_v1(uuid, uuid)
  to service_role;
revoke all on function public.update_linkr_launch_enrichment_v1(uuid, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_linkr_launch_enrichment_v1(uuid, bigint, jsonb, jsonb, jsonb)
  to service_role;
revoke all on function public.activate_linkr_authorized_launch_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_linkr_authorized_launch_v1(uuid, text, uuid)
  to service_role;
revoke all on function public.authorize_linkr_launch_v2(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.authorize_linkr_launch_v2(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, integer, integer
) to service_role;
revoke all on function public.confirm_linkr_launch_action_v2(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_linkr_launch_action_v2(uuid, uuid)
  to service_role;
revoke all on function public.pause_linkr_launch_preparation_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.pause_linkr_launch_preparation_v1(uuid, text)
  to service_role;
