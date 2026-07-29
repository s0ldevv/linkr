-- Make cancelled schedules terminal at the data layer, not just by status.
-- The cron worker already claims only pending/processing rows, but clearing due
-- cursors prevents stale "next run" surfaces and removes any active occurrence
-- pointer left behind by a processing-time cancellation.

create or replace function public.mutate_linkr_schedule_v1(
  p_user_id uuid,
  p_schedule_id uuid,
  p_action text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.scheduled_actions%rowtype;
  v_action text := lower(coalesce(p_action, ''));
  v_interval integer;
  v_priority integer;
  v_scheduled_for timestamptz;
  v_next_check_at timestamptz;
  v_ends_at timestamptz;
  v_max_occurrences integer;
begin
  select *
  into v_schedule
  from public.scheduled_actions
  where id = p_schedule_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'schedule_not_found';
  end if;

  v_schedule := null;

  if v_action = 'pause' then
    update public.scheduled_actions
    set status = 'paused',
        paused_at = now(),
        processing_started_at = null,
        worker_id = null,
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status in ('pending', 'processing')
    returning * into v_schedule;
  elsif v_action = 'resume' then
    update public.scheduled_actions
    set status = 'pending',
        resumed_at = now(),
        paused_at = null,
        processing_started_at = null,
        worker_id = null,
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status = 'paused'
    returning * into v_schedule;
  elsif v_action = 'cancel' then
    update public.scheduled_actions
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = nullif(left(coalesce(p_patch->>'reason', 'user_cancelled'), 240), ''),
        scheduled_for = null,
        next_check_at = null,
        processing_started_at = null,
        worker_id = null,
        active_occurrence_id = null,
        active_occurrence_key = null,
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status in ('pending', 'processing', 'paused')
    returning * into v_schedule;

    update public.linkr_schedule_occurrences
    set status = 'cancelled',
        completed_at = now(),
        error = coalesce(error, 'schedule_cancelled'),
        updated_at = now()
    where schedule_id = p_schedule_id
      and status in ('running', 'retrying');
  elsif v_action = 'update' then
    v_interval := nullif(p_patch->>'interval_seconds', '')::integer;
    if v_interval is not null and (v_interval < 60 or v_interval > 31536000) then
      raise exception 'invalid_interval_seconds';
    end if;

    v_priority := nullif(p_patch->>'priority', '')::integer;
    if v_priority is not null and (v_priority < 0 or v_priority > 100) then
      raise exception 'invalid_priority';
    end if;

    v_scheduled_for := nullif(p_patch->>'scheduled_for', '')::timestamptz;
    v_next_check_at := nullif(p_patch->>'next_check_at', '')::timestamptz;
    v_ends_at := nullif(p_patch->>'ends_at', '')::timestamptz;
    v_max_occurrences := nullif(p_patch->>'max_occurrences', '')::integer;
    if v_max_occurrences is not null and (v_max_occurrences < 1 or v_max_occurrences > 10000) then
      raise exception 'invalid_max_occurrences';
    end if;

    update public.scheduled_actions
    set interval_seconds = coalesce(v_interval, interval_seconds),
        priority = coalesce(v_priority, priority),
        scheduled_for = coalesce(v_scheduled_for, scheduled_for),
        next_check_at = coalesce(v_next_check_at, next_check_at),
        ends_at = case
          when p_patch ? 'ends_at' then v_ends_at
          else ends_at
        end,
        max_occurrences = case
          when p_patch ? 'max_occurrences' then v_max_occurrences
          else max_occurrences
        end,
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status in ('pending', 'paused')
    returning * into v_schedule;
  else
    raise exception 'invalid_schedule_mutation';
  end if;

  if v_schedule.id is null then
    raise exception 'schedule_not_mutable';
  end if;

  return to_jsonb(v_schedule);
end;
$$;

revoke all on function public.mutate_linkr_schedule_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_linkr_schedule_v1(uuid, uuid, text, jsonb)
  to service_role, postgres;
