-- A launch waiting for user funding is making intentional progress and must
-- not be reported as unattended/stuck work by the queue controller.

create or replace function public.repair_linkr_request_pipeline_v1(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_ids jsonb;
  v_accept jsonb := '{}'::jsonb;
  v_item public.linkr_work_items%rowtype;
  v_tx record;
  v_accepted integer := 0;
  v_reenqueued integer := 0;
  v_recovered integer := 0;
  v_drafts_expired integer := 0;
  v_confirmations_expired integer := 0;
  v_legacy_expired integer := 0;
  v_reconciling integer := 0;
begin
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 50);
  perform set_config('statement_timeout', '1000', true);

  select jsonb_agg(tweet_id) into v_ids
  from (
    select tweet_id from public.tweets_inbox
    where status = 'pending' and work_item_id is null
      and created_at < now() - interval '30 seconds'
    order by created_at for update skip locked limit p_limit
  ) s;
  if jsonb_array_length(coalesce(v_ids, '[]'::jsonb)) > 0 then
    v_accept := public.accept_linkr_x_page_v1(v_ids, 1);
    v_accepted := coalesce((v_accept->>'accepted_count')::integer, 0);
  end if;

  for v_item in
    select * from public.linkr_work_items w
    where w.state in ('queued', 'retryable')
      and (w.next_attempt_at is null or w.next_attempt_at <= now())
      and w.last_progress_at < now() - interval '2 minutes'
      and (
        w.active_message_id is null
        or w.active_queue_name is null
        or not public.linkr_queue_message_exists(
          w.active_queue_name, w.active_message_id
        )
      )
    order by w.last_progress_at for update skip locked limit p_limit
  loop
    update public.linkr_work_items
    set active_queue_name = null, active_message_id = null,
        lease_expires_at = null, last_error_code = 'queue_pointer_repaired',
        recovery_count = recovery_count + 1, updated_at = now()
    where id = v_item.id;
    perform public.linkr_enqueue_work_item(v_item.id, 0);
    v_reenqueued := v_reenqueued + 1;
  end loop;

  for v_item in
    select * from public.linkr_work_items w
    where w.state = 'leased' and w.lease_expires_at < now()
    order by w.lease_expires_at for update skip locked limit p_limit
  loop
    begin
      perform public.recover_stranded_linkr_work_item(v_item.id);
      v_recovered := v_recovered + 1;
    exception when others then
      insert into public.linkr_platform_incidents (
        fingerprint, severity, title, details
      ) values (
        'lease-recovery:' || v_item.id::text, 'critical',
        'Work item lease could not be recovered',
        jsonb_build_object(
          'work_item_id', v_item.id, 'sqlstate', sqlstate,
          'error', left(sqlerrm, 300)
        )
      ) on conflict (fingerprint) where state = 'open' do update set
        occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
        last_seen_at = now(), details = excluded.details;
    end;
  end loop;

  with expired as (
    update public.linkr_action_drafts
    set status = 'expired', closed_at = coalesce(closed_at, now()),
        updated_at = now()
    where id in (
      select id from public.linkr_action_drafts
      where status in ('open', 'awaiting_clarification')
        and expires_at <= now()
      order by expires_at for update skip locked limit p_limit
    ) returning work_item_id
  ), closed as (
    update public.linkr_work_items w
    set state = 'cancelled', terminal_at = now(),
        state_version = state_version + 1,
        last_error_code = 'user_input_expired', last_progress_at = now(),
        updated_at = now()
    from expired e
    where w.id = e.work_item_id and w.state = 'waiting_user_input'
    returning w.id
  )
  select count(*)::integer into v_drafts_expired from expired;

  with expired as (
    update public.linkr_pending_actions
    set status = 'expired', updated_at = now()
    where id in (
      select id from public.linkr_pending_actions
      where status = 'pending' and expires_at <= now()
      order by expires_at for update skip locked limit p_limit
    ) returning work_item_id
  ), closed as (
    update public.linkr_work_items w
    set state = 'cancelled', terminal_at = now(),
        state_version = state_version + 1,
        last_error_code = 'confirmation_expired', last_progress_at = now(),
        updated_at = now()
    from expired e
    where w.id = e.work_item_id and w.state = 'waiting_user_confirmation'
    returning w.id
  )
  select count(*)::integer into v_confirmations_expired from expired;

  with expired as (
    update public.pending_actions
    set status = 'expired'
    where id in (
      select id from public.pending_actions
      where status = 'pending' and expires_at <= now()
      order by expires_at for update skip locked limit p_limit
    ) returning id
  )
  select count(*)::integer into v_legacy_expired from expired;

  for v_tx in
    select t.id as transaction_id, t.work_item_id
    from public.linkr_chain_transactions t
    join public.linkr_work_items w on w.id = t.work_item_id
    where t.state in ('broadcasting', 'broadcast', 'confirming')
      and t.updated_at < now() - interval '15 minutes'
      and w.state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
    order by t.updated_at for update of t skip locked limit p_limit
  loop
    update public.linkr_chain_transactions
    set state = 'reconciling',
        last_error_code = 'confirmation_slo_exceeded', updated_at = now()
    where id = v_tx.transaction_id;
    update public.linkr_work_items
    set route = 'reconciliation', state = 'retryable',
        state_version = state_version + 1,
        active_queue_name = null, active_message_id = null,
        lease_expires_at = null, next_attempt_at = now(),
        last_error_code = 'confirmation_slo_exceeded',
        last_progress_at = now(), updated_at = now()
    where id = v_tx.work_item_id
    returning * into v_item;
    if found then
      perform public.linkr_enqueue_work_item(v_item.id, 0);
      v_reconciling := v_reconciling + 1;
    end if;
  end loop;

  insert into public.linkr_platform_incidents (
    fingerprint, severity, title, details
  )
  select
    'work-item-slo:' || w.id::text,
    case when w.resource_type is not null
           or w.state in ('broadcast', 'reconciling')
      then 'critical' else 'warning' end,
    'Work item exceeded its unattended stage SLO',
    jsonb_build_object(
      'work_item_id', w.id, 'route', w.route, 'state', w.state,
      'last_progress_at', w.last_progress_at,
      'age_seconds', floor(extract(epoch from (now() - w.last_progress_at)))
    )
  from public.linkr_work_items w
  where w.state not in (
      'succeeded', 'rejected', 'cancelled', 'dead_letter',
      'waiting_user_input', 'waiting_user_confirmation',
      'waiting_funds', 'waiting_provider'
    )
    and w.last_progress_at < now() - interval '5 minutes'
  order by w.last_progress_at
  limit p_limit
  on conflict (fingerprint) where state = 'open' do update set
    occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
    last_seen_at = now(), details = excluded.details;

  return jsonb_build_object(
    'accepted', v_accepted,
    'reenqueued', v_reenqueued,
    'leases_recovered', v_recovered,
    'drafts_expired', v_drafts_expired,
    'confirmations_expired', v_confirmations_expired,
    'legacy_actions_expired', v_legacy_expired,
    'moved_to_reconciliation', v_reconciling
  );
end;
$$;

update public.linkr_platform_incidents i
set state = 'resolved', resolved_at = now()
where i.state = 'open'
  and i.fingerprint like 'work-item-slo:%'
  and exists (
    select 1 from public.linkr_work_items w
    where i.fingerprint = 'work-item-slo:' || w.id::text
      and w.state in (
        'succeeded', 'rejected', 'cancelled', 'dead_letter',
        'waiting_user_input', 'waiting_user_confirmation',
        'waiting_funds', 'waiting_provider'
      )
  );

comment on function public.repair_linkr_request_pipeline_v1(integer) is
  'Repairs orphaned queue work and reports unattended work while excluding intentional user/provider/funding waits.';
