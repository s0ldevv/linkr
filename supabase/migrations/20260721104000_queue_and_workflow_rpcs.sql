-- Atomic acceptance, bounded claims, fenced completion, retry, and DLQ RPCs.

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
    when p_route = 'media.capture' then 'media_capture'
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

create or replace function public.linkr_enqueue_work_item(
  p_work_item_id uuid,
  p_delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_queue text;
  v_message jsonb;
  v_message_id bigint;
begin
  if p_delay_seconds < 0 or p_delay_seconds > 604800 then
    raise exception 'invalid_queue_delay';
  end if;

  update public.linkr_work_items
  set dispatch_generation = dispatch_generation + 1,
      updated_at = now()
  where id = p_work_item_id
  returning * into v_item;

  if not found then
    raise exception 'work_item_not_found';
  end if;

  if v_item.state in ('waiting_resource', 'waiting_prerequisite', 'waiting_user_confirmation',
      'waiting_funds', 'waiting_provider', 'succeeded', 'rejected', 'cancelled', 'dead_letter') then
    raise exception 'work_item_not_enqueueable:%', v_item.state;
  end if;

  v_queue := public.linkr_queue_for_route(v_item.route, v_item.priority);
  if v_queue is null then
    raise exception 'unsupported_work_route:%', v_item.route;
  end if;

  v_message := jsonb_build_object(
    'schema_version', 1,
    'work_item_id', v_item.id,
    'state_version', v_item.state_version,
    'route', v_item.route,
    'resource_sequence', v_item.resource_sequence,
    'dispatch_generation', v_item.dispatch_generation,
    'enqueued_at', now()
  );

  if octet_length(v_message::text) > 4096 then
    raise exception 'queue_message_too_large';
  end if;

  select pgmq.send(v_queue, v_message, p_delay_seconds) into v_message_id;
  return v_message_id;
end;
$$;

create or replace function public.accept_linkr_work_item(
  p_idempotency_key text,
  p_source_surface text,
  p_source_event_id text,
  p_user_id uuid,
  p_conversation_id uuid,
  p_request_type text,
  p_route text,
  p_priority smallint default 50,
  p_resource_type text default null,
  p_resource_key text default null,
  p_payload jsonb default null,
  p_payload_ref text default null,
  p_payload_hash text default null,
  p_consumer_version text default 'async_v1',
  p_execution_generation bigint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_id uuid := gen_random_uuid();
  v_existing public.linkr_work_items%rowtype;
  v_tombstone public.linkr_idempotency_tombstones%rowtype;
  v_resource_sequence bigint;
  v_active_work_item_id uuid;
  v_state text := 'queued';
  v_message_id bigint;
begin
  p_idempotency_key := btrim(coalesce(p_idempotency_key, ''));
  if octet_length(p_idempotency_key) < 1 or octet_length(p_idempotency_key) > 256 then
    raise exception 'invalid_idempotency_key';
  end if;
  if public.linkr_queue_for_route(p_route, p_priority) is null then
    raise exception 'unsupported_work_route:%', p_route;
  end if;
  if (p_resource_type is null) <> (p_resource_key is null) then
    raise exception 'incomplete_resource_identity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  select * into v_existing
  from public.linkr_work_items
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'work_item_id', v_existing.id,
      'request_id', v_existing.id,
      'state', v_existing.state,
      'result_ref', v_existing.result_ref,
      'duplicate', true,
      'enqueued', false
    );
  end if;

  select * into v_tombstone
  from public.linkr_idempotency_tombstones
  where idempotency_key = p_idempotency_key
    and expires_at > now();
  if found then
    return jsonb_build_object(
      'work_item_id', v_tombstone.work_item_id,
      'request_id', v_tombstone.work_item_id,
      'state', v_tombstone.terminal_state,
      'result_ref', v_tombstone.result_ref,
      'duplicate', true,
      'tombstone', true,
      'enqueued', false
    );
  end if;

  if p_resource_type is not null then
    insert into public.linkr_resource_heads (
      resource_type, resource_key, active_work_item_id, active_sequence,
      next_sequence, updated_at
    ) values (
      p_resource_type, p_resource_key, null, null, 2, now()
    )
    on conflict (resource_type, resource_key)
    do update set
      next_sequence = public.linkr_resource_heads.next_sequence + 1,
      updated_at = now()
    returning next_sequence - 1, active_work_item_id
    into v_resource_sequence, v_active_work_item_id;

    if v_active_work_item_id is not null then
      v_state := 'waiting_resource';
    end if;
  end if;

  insert into public.linkr_work_items (
    id, idempotency_key, source_surface, source_event_id, user_id,
    conversation_id, request_type, route, state, priority,
    resource_type, resource_key, resource_sequence, payload, payload_ref,
    payload_hash, consumer_version, execution_generation
  ) values (
    v_id, p_idempotency_key, p_source_surface, nullif(p_source_event_id, ''),
    p_user_id, p_conversation_id, p_request_type, p_route, v_state, p_priority,
    p_resource_type, p_resource_key, v_resource_sequence, p_payload, p_payload_ref,
    p_payload_hash, p_consumer_version, p_execution_generation
  );

  if p_resource_type is not null and v_active_work_item_id is null then
    update public.linkr_resource_heads
    set active_work_item_id = v_id,
        active_sequence = v_resource_sequence,
        updated_at = now()
    where resource_type = p_resource_type
      and resource_key = p_resource_key;
  end if;

  if v_state = 'queued' then
    v_message_id := public.linkr_enqueue_work_item(v_id, 0);
  end if;

  return jsonb_build_object(
    'work_item_id', v_id,
    'request_id', v_id,
    'state', v_state,
    'duplicate', false,
    'enqueued', v_state = 'queued',
    'message_id', v_message_id,
    'resource_sequence', v_resource_sequence
  );
end;
$$;

create or replace function public.claim_linkr_stage_work(
  p_queue_name text,
  p_worker_id text,
  p_visibility_seconds integer,
  p_batch_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_allowed_queue boolean;
  v_slot public.linkr_worker_capacity_slots%rowtype;
  v_message record;
  v_item public.linkr_work_items%rowtype;
  v_resource_fence bigint;
  v_claims jsonb := '[]'::jsonb;
begin
  select exists (
    select 1 from public.linkr_worker_capacity_slots where stage = p_queue_name
  ) into v_allowed_queue;
  if not v_allowed_queue then raise exception 'unknown_stage'; end if;
  if p_visibility_seconds < 10 or p_visibility_seconds > 3600 then
    raise exception 'invalid_visibility_timeout';
  end if;
  p_batch_quantity := least(greatest(coalesce(p_batch_quantity, 1), 1), 20);

  select * into v_slot
  from public.linkr_worker_capacity_slots
  where stage = p_queue_name
    and enabled
    and (lease_owner is null or lease_expires_at < now())
  order by slot_number
  for update skip locked
  limit 1;

  if not found then return jsonb_build_object('claims', v_claims, 'slot', null); end if;

  update public.linkr_worker_capacity_slots
  set lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_visibility_seconds),
      work_item_id = null,
      fencing_token = fencing_token + 1,
      updated_at = now()
  where stage = v_slot.stage and slot_number = v_slot.slot_number
  returning * into v_slot;

  for v_message in
    select * from pgmq.read(p_queue_name, p_visibility_seconds, p_batch_quantity)
  loop
    select * into v_item
    from public.linkr_work_items
    where id = nullif(v_message.message->>'work_item_id', '')::uuid
    for update;

    if not found
       or v_item.state in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
       or v_item.state_version <> coalesce((v_message.message->>'state_version')::bigint, -1)
       or public.linkr_queue_for_route(v_item.route, v_item.priority) <> p_queue_name then
      perform pgmq.delete(p_queue_name, v_message.msg_id);
      continue;
    end if;

    v_resource_fence := null;
    if v_item.resource_type is not null then
      update public.linkr_resource_heads
      set lease_owner = p_worker_id,
          lease_expires_at = now() + make_interval(secs => p_visibility_seconds),
          fencing_token = fencing_token + 1,
          updated_at = now()
      where resource_type = v_item.resource_type
        and resource_key = v_item.resource_key
        and active_work_item_id = v_item.id
        and active_sequence = v_item.resource_sequence
        and (lease_owner is null or lease_expires_at < now() or lease_owner = p_worker_id)
      returning fencing_token into v_resource_fence;
      if v_resource_fence is null then continue; end if;
    end if;

    update public.linkr_work_items
    set state = 'leased',
        state_version = state_version + 1,
        attempt_count = attempt_count + 1,
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = v_item.id
    returning * into v_item;

    v_claims := v_claims || jsonb_build_array(jsonb_build_object(
      'message_id', v_message.msg_id,
      'work_item', to_jsonb(v_item),
      'resource_fencing_token', v_resource_fence,
      'visibility_deadline', v_message.vt
    ));
  end loop;

  if jsonb_array_length(v_claims) = 0 then
    update public.linkr_worker_capacity_slots
    set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
    where stage = v_slot.stage and slot_number = v_slot.slot_number
      and lease_owner = p_worker_id and fencing_token = v_slot.fencing_token;
    return jsonb_build_object('claims', v_claims, 'slot', null);
  end if;

  return jsonb_build_object(
    'claims', v_claims,
    'slot', jsonb_build_object(
      'stage', v_slot.stage,
      'slot_number', v_slot.slot_number,
      'fencing_token', v_slot.fencing_token,
      'lease_expires_at', v_slot.lease_expires_at
    )
  );
end;
$$;

create or replace function public.complete_linkr_stage_work(
  p_queue_name text,
  p_message_id bigint,
  p_work_item_id uuid,
  p_worker_id text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_resource_fencing_token bigint,
  p_expected_state_version bigint,
  p_new_state text,
  p_next_route text default null,
  p_result_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_next public.linkr_work_items%rowtype;
  v_next_message_id bigint;
  v_terminal boolean;
begin
  v_terminal := p_new_state in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
  if not v_terminal and p_next_route is null then raise exception 'next_route_required'; end if;
  if p_next_route is not null and public.linkr_queue_for_route(p_next_route, 50) is null then
    raise exception 'unsupported_next_route';
  end if;

  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  if v_item.state_version <> p_expected_state_version then raise exception 'stale_work_item_version'; end if;

  if v_item.resource_type is not null and not exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type
      and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id
      and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token
      and lease_expires_at >= now()
  ) then
    raise exception 'stale_resource_fence';
  end if;

  if not exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = p_queue_name and slot_number = p_slot_number
      and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token
      and lease_expires_at >= now()
  ) then
    raise exception 'stale_capacity_fence';
  end if;

  update public.linkr_work_items
  set state = p_new_state,
      route = coalesce(p_next_route, route),
      state_version = state_version + 1,
      result_ref = coalesce(p_result_ref, result_ref),
      terminal_at = case when v_terminal then now() else null end,
      next_attempt_at = null,
      last_error_code = null,
      updated_at = now()
  where id = p_work_item_id
  returning * into v_item;

  perform pgmq.delete(p_queue_name, p_message_id);

  update public.linkr_worker_capacity_slots
  set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
  where stage = p_queue_name and slot_number = p_slot_number
    and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token;

  if v_item.resource_type is not null then
    if v_terminal then
      select * into v_next
      from public.linkr_work_items
      where resource_type = v_item.resource_type
        and resource_key = v_item.resource_key
        and state = 'waiting_resource'
        and resource_sequence > v_item.resource_sequence
      order by resource_sequence
      for update skip locked
      limit 1;

      if found then
        update public.linkr_work_items
        set state = 'queued', state_version = state_version + 1, updated_at = now()
        where id = v_next.id returning * into v_next;
        update public.linkr_resource_heads
        set active_work_item_id = v_next.id,
            active_sequence = v_next.resource_sequence,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where resource_type = v_item.resource_type
          and resource_key = v_item.resource_key
          and active_work_item_id = v_item.id
          and fencing_token = p_resource_fencing_token;
        v_next_message_id := public.linkr_enqueue_work_item(v_next.id, 0);
      else
        update public.linkr_resource_heads
        set active_work_item_id = null, active_sequence = null,
            lease_owner = null, lease_expires_at = null, updated_at = now()
        where resource_type = v_item.resource_type
          and resource_key = v_item.resource_key
          and active_work_item_id = v_item.id
          and fencing_token = p_resource_fencing_token;
      end if;
    else
      update public.linkr_resource_heads
      set lease_owner = null, lease_expires_at = null, updated_at = now()
      where resource_type = v_item.resource_type
        and resource_key = v_item.resource_key
        and active_work_item_id = v_item.id
        and lease_owner = p_worker_id
        and fencing_token = p_resource_fencing_token;
    end if;
  end if;

  if not v_terminal then
    v_next_message_id := public.linkr_enqueue_work_item(v_item.id, 0);
  end if;

  return jsonb_build_object(
    'work_item_id', v_item.id,
    'state', v_item.state,
    'state_version', v_item.state_version,
    'next_message_id', v_next_message_id
  );
end;
$$;

create or replace function public.retry_linkr_stage_work(
  p_queue_name text,
  p_message_id bigint,
  p_work_item_id uuid,
  p_worker_id text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_resource_fencing_token bigint,
  p_expected_state_version bigint,
  p_error_code text,
  p_delay_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_message_id bigint;
begin
  if p_delay_seconds < 1 or p_delay_seconds > 604800 then raise exception 'invalid_retry_delay'; end if;
  select * into v_item from public.linkr_work_items where id = p_work_item_id for update;
  if not found or v_item.state_version <> p_expected_state_version then raise exception 'stale_work_item_version'; end if;

  if not exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = p_queue_name and slot_number = p_slot_number
      and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token
      and lease_expires_at >= now()
  ) then
    raise exception 'stale_capacity_fence';
  end if;
  if v_item.resource_type is not null and not exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type
      and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id
      and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token
      and lease_expires_at >= now()
  ) then
    raise exception 'stale_resource_fence';
  end if;

  update public.linkr_work_items
  set state = 'retryable', state_version = state_version + 1,
      next_attempt_at = now() + make_interval(secs => p_delay_seconds),
      last_error_code = left(p_error_code, 120), updated_at = now()
  where id = p_work_item_id returning * into v_item;

  perform pgmq.delete(p_queue_name, p_message_id);
  v_message_id := public.linkr_enqueue_work_item(v_item.id, p_delay_seconds);

  update public.linkr_worker_capacity_slots
  set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
  where stage = p_queue_name and slot_number = p_slot_number
    and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token;
  if v_item.resource_type is not null then
    update public.linkr_resource_heads
    set lease_owner = null, lease_expires_at = null, updated_at = now()
    where resource_type = v_item.resource_type and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id and lease_owner = p_worker_id
      and fencing_token = p_resource_fencing_token;
  end if;

  insert into public.linkr_worker_attempt_details (
    work_item_id, stage, attempt_number, worker_id, outcome, error_code, completed_at
  ) values (
    v_item.id, p_queue_name, v_item.attempt_count, p_worker_id,
    'retryable', left(p_error_code, 120), now()
  );

  return jsonb_build_object('work_item_id', v_item.id, 'state', v_item.state, 'message_id', v_message_id);
end;
$$;

create or replace function public.dead_letter_linkr_stage_work(
  p_queue_name text,
  p_message_id bigint,
  p_work_item_id uuid,
  p_worker_id text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_resource_fencing_token bigint,
  p_expected_state_version bigint,
  p_reason_code text,
  p_error_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_result jsonb;
begin
  v_result := public.complete_linkr_stage_work(
    p_queue_name, p_message_id, p_work_item_id, p_worker_id,
    p_slot_number, p_slot_fencing_token, p_resource_fencing_token,
    p_expected_state_version, 'dead_letter', null, null
  );

  insert into public.linkr_dead_letter_items (
    work_item_id, pgmq_message_id, route, reason_code, error_fingerprint
  )
  select id, p_message_id, route, left(p_reason_code, 120), left(p_error_fingerprint, 256)
  from public.linkr_work_items where id = p_work_item_id
  on conflict (work_item_id) do update set
    pgmq_message_id = excluded.pgmq_message_id,
    reason_code = excluded.reason_code,
    error_fingerprint = excluded.error_fingerprint,
    updated_at = now();

  return v_result;
end;
$$;

create or replace function public.release_expired_linkr_leases()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_resources integer;
begin
  update public.linkr_worker_capacity_slots
  set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
  where lease_expires_at < now();
  get diagnostics v_capacity = row_count;

  update public.linkr_resource_heads
  set lease_owner = null, lease_expires_at = null, updated_at = now()
  where lease_expires_at < now();
  get diagnostics v_resources = row_count;

  return jsonb_build_object('capacity_slots', v_capacity, 'resource_heads', v_resources);
end;
$$;

revoke all on function public.linkr_queue_for_route(text, smallint) from public, anon, authenticated;
revoke all on function public.linkr_enqueue_work_item(uuid, integer) from public, anon, authenticated;
revoke all on function public.accept_linkr_work_item(text, text, text, uuid, uuid, text, text, smallint, text, text, jsonb, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.claim_linkr_stage_work(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_linkr_stage_work(text, bigint, uuid, text, smallint, bigint, bigint, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.retry_linkr_stage_work(text, bigint, uuid, text, smallint, bigint, bigint, bigint, text, integer) from public, anon, authenticated;
revoke all on function public.dead_letter_linkr_stage_work(text, bigint, uuid, text, smallint, bigint, bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function public.release_expired_linkr_leases() from public, anon, authenticated;

grant execute on function public.accept_linkr_work_item(text, text, text, uuid, uuid, text, text, smallint, text, text, jsonb, text, text, text, bigint) to service_role;
grant execute on function public.claim_linkr_stage_work(text, text, integer, integer) to service_role;
grant execute on function public.complete_linkr_stage_work(text, bigint, uuid, text, smallint, bigint, bigint, bigint, text, text, text) to service_role;
grant execute on function public.retry_linkr_stage_work(text, bigint, uuid, text, smallint, bigint, bigint, bigint, text, integer) to service_role;
grant execute on function public.dead_letter_linkr_stage_work(text, bigint, uuid, text, smallint, bigint, bigint, bigint, text, text) to service_role;
grant execute on function public.release_expired_linkr_leases() to service_role;
