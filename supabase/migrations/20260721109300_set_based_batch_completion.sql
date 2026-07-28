-- Set-based completion is restricted to unordered, deterministic work. External
-- economic/provider effects continue to persist one item at a time.

create or replace function public.complete_linkr_stage_batch(
  p_queue_name text,
  p_worker_id text,
  p_slot_number smallint,
  p_slot_fencing_token bigint,
  p_completions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_count integer;
  v_invalid integer;
  v_queue record;
  v_messages jsonb[];
begin
  if jsonb_typeof(p_completions) <> 'array' then raise exception 'batch_array_required'; end if;
  v_count := jsonb_array_length(p_completions);
  if v_count < 1 or v_count > 20 then raise exception 'invalid_batch_size'; end if;
  if (
    select count(distinct x->>'work_item_id') <> v_count
      or count(distinct x->>'message_id') <> v_count
    from jsonb_array_elements(p_completions) x
  ) then raise exception 'duplicate_batch_identity'; end if;

  if not exists (
    select 1 from public.linkr_worker_capacity_slots
    where stage = p_queue_name and slot_number = p_slot_number
      and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token
      and lease_expires_at >= now()
  ) then raise exception 'stale_capacity_fence'; end if;

  with input as (
    select * from jsonb_to_recordset(p_completions) as x(
      message_id bigint, work_item_id uuid, expected_state_version bigint,
      new_state text, next_route text, result_ref text
    )
  )
  select count(*)::integer into v_invalid
  from input i
  left join public.linkr_work_items w on w.id = i.work_item_id
  where w.id is null or w.resource_type is not null
    or w.state_version <> i.expected_state_version
    or i.new_state not in ('queued', 'ready', 'confirmed', 'succeeded', 'rejected', 'cancelled')
    or (i.new_state in ('succeeded', 'rejected', 'cancelled') and i.next_route is not null)
    or (i.new_state not in ('succeeded', 'rejected', 'cancelled') and public.linkr_queue_for_route(i.next_route, w.priority) is null);
  if v_invalid > 0 then raise exception 'invalid_or_stale_batch_item'; end if;

  with input as (
    select * from jsonb_to_recordset(p_completions) as x(
      message_id bigint, work_item_id uuid, expected_state_version bigint,
      new_state text, next_route text, result_ref text
    )
  )
  update public.linkr_work_items w
  set state = i.new_state,
      route = coalesce(i.next_route, w.route),
      state_version = w.state_version + 1,
      dispatch_generation = w.dispatch_generation + case when i.next_route is null then 0 else 1 end,
      result_ref = coalesce(i.result_ref, w.result_ref),
      terminal_at = case when i.new_state in ('succeeded', 'rejected', 'cancelled') then now() else null end,
      next_attempt_at = null,
      last_error_code = null,
      updated_at = now()
  from input i
  where w.id = i.work_item_id and w.state_version = i.expected_state_version;

  perform pgmq.delete(
    p_queue_name,
    array(
      select (x->>'message_id')::bigint from jsonb_array_elements(p_completions) x
    )
  );

  for v_queue in
    with input as (
      select * from jsonb_to_recordset(p_completions) as x(
        message_id bigint, work_item_id uuid, expected_state_version bigint,
        new_state text, next_route text, result_ref text
      )
    )
    select public.linkr_queue_for_route(w.route, w.priority) as queue_name,
      array_agg(jsonb_build_object(
        'schema_version', 1, 'work_item_id', w.id,
        'state_version', w.state_version, 'route', w.route,
        'resource_sequence', w.resource_sequence,
        'dispatch_generation', w.dispatch_generation, 'enqueued_at', now()
      ) order by w.accepted_at) as messages
    from input i join public.linkr_work_items w on w.id = i.work_item_id
    where i.next_route is not null
    group by public.linkr_queue_for_route(w.route, w.priority)
  loop
    v_messages := v_queue.messages;
    if exists (select 1 from unnest(v_messages) m where octet_length(m::text) > 4096) then
      raise exception 'queue_message_too_large';
    end if;
    perform pgmq.send_batch(v_queue.queue_name, v_messages, 0);
  end loop;

  update public.linkr_worker_capacity_slots
  set lease_owner = null, lease_expires_at = null, work_item_id = null, updated_at = now()
  where stage = p_queue_name and slot_number = p_slot_number
    and lease_owner = p_worker_id and fencing_token = p_slot_fencing_token;

  return jsonb_build_object('completed', v_count);
end;
$$;

revoke all on function public.complete_linkr_stage_batch(text, text, smallint, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_linkr_stage_batch(text, text, smallint, bigint, jsonb)
  to service_role;
