-- Repeated worker terminations can advance the canonical leased state more than
-- once while the original durable pointer remains. Any older pointer is a
-- legitimate redelivery after the bounded stage slot becomes reclaimable.

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
  v_message_state_version bigint;
  v_is_expired_redelivery boolean;
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
  where stage = p_queue_name and enabled
    and (lease_owner is null or lease_expires_at < now())
  order by slot_number for update skip locked limit 1;
  if not found then return jsonb_build_object('claims', v_claims, 'slot', null); end if;

  update public.linkr_worker_capacity_slots
  set lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_visibility_seconds),
      work_item_id = null, fencing_token = fencing_token + 1, updated_at = now()
  where stage = v_slot.stage and slot_number = v_slot.slot_number
  returning * into v_slot;

  for v_message in select * from pgmq.read(p_queue_name, p_visibility_seconds, p_batch_quantity)
  loop
    begin
      v_message_state_version := (v_message.message->>'state_version')::bigint;
    exception when others then
      perform pgmq.delete(p_queue_name, v_message.msg_id);
      continue;
    end;

    select * into v_item from public.linkr_work_items
    where id = nullif(v_message.message->>'work_item_id', '')::uuid for update;
    if not found
       or v_item.state in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
       or public.linkr_queue_for_route(v_item.route, v_item.priority) <> p_queue_name then
      perform pgmq.delete(p_queue_name, v_message.msg_id);
      continue;
    end if;

    v_is_expired_redelivery := v_item.state = 'leased'
      and v_item.state_version > v_message_state_version;
    if v_item.state_version <> v_message_state_version and not v_is_expired_redelivery then
      perform pgmq.delete(p_queue_name, v_message.msg_id);
      continue;
    end if;

    v_resource_fence := null;
    if v_item.resource_type is not null then
      update public.linkr_resource_heads
      set lease_owner = p_worker_id,
          lease_expires_at = now() + make_interval(secs => p_visibility_seconds),
          fencing_token = fencing_token + 1, updated_at = now()
      where resource_type = v_item.resource_type and resource_key = v_item.resource_key
        and active_work_item_id = v_item.id and active_sequence = v_item.resource_sequence
        and (lease_owner is null or lease_expires_at < now() or lease_owner = p_worker_id)
      returning fencing_token into v_resource_fence;
      if v_resource_fence is null then continue; end if;
    end if;

    update public.linkr_work_items
    set state = 'leased', state_version = state_version + 1,
        attempt_count = attempt_count + 1, started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = v_item.id returning * into v_item;

    v_claims := v_claims || jsonb_build_array(jsonb_build_object(
      'message_id', v_message.msg_id, 'work_item', to_jsonb(v_item),
      'resource_fencing_token', v_resource_fence, 'visibility_deadline', v_message.vt,
      'redelivered', v_is_expired_redelivery
    ));
  end loop;

  if jsonb_array_length(v_claims) = 0 then
    update public.linkr_worker_capacity_slots
    set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
    where stage = v_slot.stage and slot_number = v_slot.slot_number
      and lease_owner = p_worker_id and fencing_token = v_slot.fencing_token;
    return jsonb_build_object('claims', v_claims, 'slot', null);
  end if;

  return jsonb_build_object('claims', v_claims, 'slot', jsonb_build_object(
    'stage', v_slot.stage, 'slot_number', v_slot.slot_number,
    'fencing_token', v_slot.fencing_token, 'lease_expires_at', v_slot.lease_expires_at
  ));
end;
$$;

create or replace function public.recover_stranded_linkr_work_item(p_work_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_stage text;
  v_message_id bigint;
begin
  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  if v_item.state <> 'leased' then raise exception 'work_item_not_leased'; end if;
  v_stage := public.linkr_queue_for_route(v_item.route, v_item.priority);
  if exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = v_stage and lease_owner is not null and lease_expires_at >= now()
  ) then raise exception 'stage_still_has_active_worker'; end if;
  if v_item.resource_type is not null and exists (
    select 1 from public.linkr_resource_heads
    where resource_type = v_item.resource_type and resource_key = v_item.resource_key
      and active_work_item_id = v_item.id and lease_owner is not null and lease_expires_at >= now()
  ) then raise exception 'resource_still_leased'; end if;

  update public.linkr_work_items
  set state = 'retryable', state_version = state_version + 1,
      next_attempt_at = now(), last_error_code = 'recovered_stranded_claim', updated_at = now()
  where id = v_item.id returning * into v_item;
  v_message_id := public.linkr_enqueue_work_item(v_item.id, 0);
  return jsonb_build_object('work_item_id', v_item.id, 'state', v_item.state, 'message_id', v_message_id);
end;
$$;

revoke all on function public.claim_linkr_stage_work(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_linkr_stage_work(text, text, integer, integer)
  to service_role;
revoke all on function public.recover_stranded_linkr_work_item(uuid)
  from public, anon, authenticated;
grant execute on function public.recover_stranded_linkr_work_item(uuid)
  to service_role;
