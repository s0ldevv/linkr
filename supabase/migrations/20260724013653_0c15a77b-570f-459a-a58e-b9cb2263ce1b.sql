
create or replace function public.linkr_reconcile_resource_heads_v1(
  p_max_batch integer default 50
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_head public.linkr_resource_heads%rowtype;
  v_active public.linkr_work_items%rowtype;
  v_next public.linkr_work_items%rowtype;
  v_healed integer := 0;
  v_needs_heal boolean;
begin
  for v_head in
    select h.* from public.linkr_resource_heads h
    where h.active_work_item_id is null
       or exists (
         select 1 from public.linkr_work_items w
         where w.id = h.active_work_item_id
           and w.terminal_at is not null
           and w.state in ('cancelled','succeeded','rejected','dead_letter')
       )
    order by h.updated_at
    limit p_max_batch
    for update skip locked
  loop
    v_needs_heal := true;
    v_active := null;
    if v_head.active_work_item_id is not null then
      select * into v_active from public.linkr_work_items
      where id = v_head.active_work_item_id for update;
      if v_active.id is null then
        v_needs_heal := true;
      elsif v_active.terminal_at is null then
        v_needs_heal := false;
      end if;
    end if;

    if not v_needs_heal then
      continue;
    end if;

    select * into v_next
    from public.linkr_work_items
    where resource_type = v_head.resource_type
      and resource_key = v_head.resource_key
      and terminal_at is null
      and state = 'waiting_resource'
      and (v_head.active_sequence is null
           or resource_sequence > v_head.active_sequence)
    order by resource_sequence
    for update skip locked
    limit 1;

    if found then
      update public.linkr_work_items
      set state = 'queued', state_version = state_version + 1,
          last_progress_at = now(), updated_at = now()
      where id = v_next.id;

      update public.linkr_resource_heads
      set active_work_item_id = v_next.id,
          active_sequence = v_next.resource_sequence,
          lease_owner = null, lease_expires_at = null,
          fencing_token = fencing_token + 1,
          updated_at = now()
      where resource_type = v_head.resource_type
        and resource_key = v_head.resource_key;

      perform public.linkr_enqueue_work_item(v_next.id, 0);

      insert into public.linkr_request_events (work_item_id, event_type, state, metadata)
      values (v_next.id, 'promoted', 'queued',
              jsonb_build_object('source','resource_head_reconciler',
                                 'previous_active', v_head.active_work_item_id));
      v_healed := v_healed + 1;
    else
      update public.linkr_resource_heads
      set active_work_item_id = null, active_sequence = null,
          lease_owner = null, lease_expires_at = null, updated_at = now()
      where resource_type = v_head.resource_type
        and resource_key = v_head.resource_key;
    end if;
  end loop;
  return v_healed;
end;
$$;

revoke all on function public.linkr_reconcile_resource_heads_v1(integer) from public;
grant execute on function public.linkr_reconcile_resource_heads_v1(integer) to service_role;


create or replace function public.reset_user_launch_state(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items integer := 0;
  v_launches integer := 0;
  v_txs integer := 0;
  v_funding integer := 0;
  v_heads integer := 0;
begin
  with reaped as (
    update public.linkr_work_items
    set state = 'cancelled', terminal_at = now(),
        state_version = state_version + 1,
        last_error_code = 'manual_reset',
        active_queue_name = null, active_message_id = null,
        lease_expires_at = null,
        last_progress_at = now(), updated_at = now()
    where user_id = p_user_id and terminal_at is null
    returning id
  )
  select count(*) into v_items from reaped;

  with cleared as (
    update public.linkr_resource_heads
    set active_work_item_id = null, active_sequence = null,
        lease_owner = null, lease_expires_at = null,
        fencing_token = fencing_token + 1,
        updated_at = now()
    where resource_type = 'wallet'
      and resource_key in (
        select id::text from public.wallets where user_id = p_user_id
      )
    returning 1
  )
  select count(*) into v_heads from cleared;

  with dtx as (
    delete from public.linkr_chain_transactions
    where launch_id in (select id from public.coin_launches where user_id = p_user_id)
    returning id
  )
  select count(*) into v_txs from dtx;

  with dl as (
    delete from public.coin_launches where user_id = p_user_id returning id
  )
  select count(*) into v_launches from dl;

  with df as (
    delete from public.wallet_funding_events
    where user_id = p_user_id and funding_kind = 'first_launch_minimum'
    returning id
  )
  select count(*) into v_funding from df;

  delete from public.linkr_pending_actions
    where user_id = p_user_id and status = 'pending';
  delete from public.linkr_agent_locks where user_id = p_user_id;

  perform public.linkr_reconcile_resource_heads_v1(50);

  return jsonb_build_object(
    'work_items_terminated', v_items,
    'resource_heads_cleared', v_heads,
    'chain_transactions_deleted', v_txs,
    'launches_deleted', v_launches,
    'funding_events_deleted', v_funding
  );
end;
$$;

revoke all on function public.reset_user_launch_state(uuid) from public;
grant execute on function public.reset_user_launch_state(uuid) to service_role;


do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'linkr-reconcile-resource-heads') then
      perform cron.unschedule('linkr-reconcile-resource-heads');
    end if;
    perform cron.schedule(
      'linkr-reconcile-resource-heads',
      '* * * * *',
      $cron$select public.linkr_reconcile_resource_heads_v1(50);$cron$
    );
  end if;
end $$;

select public.linkr_reconcile_resource_heads_v1(200);
