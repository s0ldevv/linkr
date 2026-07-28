
create or replace function public.linkr_watchdog_reap_stalled_v1(
  p_timeout_seconds integer default 900,
  p_max_batch integer default 25
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_next public.linkr_work_items%rowtype;
  v_count integer := 0;
  v_reason text;
  v_reply_text text;
  v_reply_kind text;
begin
  for v_item in
    select * from public.linkr_work_items
    where terminal_at is null
      and state in ('waiting_funds','waiting_prerequisite','queued','leased','preparing','signing','broadcasting','confirming')
      and route in ('launch.solana','launch.robinhood','launch.enrich','command.prepare')
      and coalesce(last_progress_at, updated_at) < now() - make_interval(secs => p_timeout_seconds)
    order by updated_at
    limit p_max_batch
    for update skip locked
  loop
    v_reason := 'watchdog_timeout_' || v_item.state;
    if v_item.state = 'waiting_funds' then
      v_reply_kind := 'launch_watchdog_timeout';
      v_reply_text := 'Launch cancelled — I didn''t detect funding within the wait window. Fund your wallet and reply "retry launch" to resume.';
    else
      v_reply_kind := 'stage_watchdog_timeout';
      v_reply_text := 'Something took too long on our side and I had to abort this request. Please try again.';
    end if;

    begin
      perform public.enqueue_linkr_x_reply_v1(v_item.id, v_reply_text, v_reply_kind, 1, 50::smallint);
    exception when others then null;
    end;

    update public.linkr_work_items
    set state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
        last_error_code = v_reason, active_queue_name = null, active_message_id = null,
        lease_expires_at = null, last_progress_at = now(), updated_at = now()
    where id = v_item.id;

    if v_item.resource_type is not null then
      select * into v_next
      from public.linkr_work_items
      where resource_type = v_item.resource_type
        and resource_key = v_item.resource_key
        and state = 'waiting_resource'
        and resource_sequence > coalesce(v_item.resource_sequence, 0)
      order by resource_sequence for update skip locked limit 1;
      if found then
        update public.linkr_work_items
        set state = 'queued', state_version = state_version + 1,
            last_progress_at = now(), updated_at = now()
        where id = v_next.id;
        update public.linkr_resource_heads
        set active_work_item_id = v_next.id, active_sequence = v_next.resource_sequence,
            lease_owner = null, lease_expires_at = null, updated_at = now()
        where resource_type = v_item.resource_type
          and resource_key = v_item.resource_key
          and active_work_item_id = v_item.id;
        perform public.linkr_enqueue_work_item(v_next.id, 0);
      else
        update public.linkr_resource_heads
        set active_work_item_id = null, active_sequence = null,
            lease_owner = null, lease_expires_at = null, updated_at = now()
        where resource_type = v_item.resource_type
          and resource_key = v_item.resource_key
          and active_work_item_id = v_item.id;
      end if;
    end if;

    insert into public.linkr_request_events (work_item_id, event_type, state, metadata)
    values (v_item.id, 'terminal', 'cancelled',
            jsonb_build_object('reason', v_reason, 'source', 'watchdog'));

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.linkr_watchdog_reap_stalled_v1(integer, integer) from public;
grant execute on function public.linkr_watchdog_reap_stalled_v1(integer, integer) to service_role;

create or replace function public.reset_user_launch_state(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet uuid;
  v_items integer := 0;
  v_launches integer := 0;
  v_txs integer := 0;
  v_funding integer := 0;
begin
  select id into v_wallet from public.wallets where user_id = p_user_id limit 1;

  with reaped as (
    update public.linkr_work_items
    set state = 'cancelled', terminal_at = now(), state_version = state_version + 1,
        last_error_code = 'manual_reset', active_queue_name = null, active_message_id = null,
        lease_expires_at = null, last_progress_at = now(), updated_at = now()
    where user_id = p_user_id and terminal_at is null
    returning id
  )
  select count(*) into v_items from reaped;

  if v_wallet is not null then
    update public.linkr_resource_heads
    set active_work_item_id = null, active_sequence = null,
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where resource_type = 'wallet' and resource_key = v_wallet::text;
  end if;

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

  delete from public.linkr_pending_actions where user_id = p_user_id and status = 'pending';
  delete from public.linkr_agent_locks where user_id = p_user_id;

  return jsonb_build_object(
    'work_items_terminated', v_items,
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
    if exists (select 1 from cron.job where jobname = 'linkr-watchdog-reap-stalled') then
      perform cron.unschedule('linkr-watchdog-reap-stalled');
    end if;
    perform cron.schedule(
      'linkr-watchdog-reap-stalled',
      '* * * * *',
      $cron$select public.linkr_watchdog_reap_stalled_v1(900, 25);$cron$
    );
  end if;
end $$;

select public.reset_user_launch_state('ef402c94-b8b9-49d1-bcd3-ff0a68fc7c5c'::uuid);
