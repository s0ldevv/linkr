-- Robinhood first-launch funding RPC functions
-- These complement the existing wallet_funding_events table and fundFirstLaunchIfNeeded() helper

create or replace function public.fail_robinhood_first_launch_funding_v1(
  p_event_id uuid,
  p_tx_hash text,
  p_error text
)
returns public.wallet_funding_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.wallet_funding_events;
begin
  update public.wallet_funding_events set
    status = 'failed',
    error = left(coalesce(nullif(btrim(p_error), ''), 'robinhood_funding_failed'), 500),
    updated_at = now()
  where id = p_event_id
    and funding_kind = 'first_launch_minimum'
    and status in ('pending', 'submitted')
    and (p_tx_hash is null or tx_hash = p_tx_hash)
  returning * into v_row;
  if not found then
    select * into v_row from public.wallet_funding_events where id = p_event_id;
    if not found then raise exception 'robinhood_funding_event_not_found'; end if;
    if v_row.status <> 'confirmed' then raise exception 'robinhood_funding_failure_conflict'; end if;
    return v_row;
  end if;
  update public.coin_launches set
    funding_status = 'failed',
    funding_tx_hash = v_row.tx_hash,
    funding_error = v_row.error
  where id = v_row.coin_launch_id;
  return v_row;
end;
$$;

revoke all on function public.fail_robinhood_first_launch_funding_v1(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.fail_robinhood_first_launch_funding_v1(
  uuid, text, text
) to service_role;

comment on function public.fail_robinhood_first_launch_funding_v1(
  uuid, text, text
) is 'Marks a Robinhood first-launch funding event as failed when the transaction fails or is no longer needed.';
