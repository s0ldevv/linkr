-- Make "first eligible launch" funding a lifetime one-time claim per user.
--
-- Per-launch funding remains controlled by wallet_funding_events_per_launch_uidx.
-- This migration makes first_launch_minimum match the secretpanel policy: once
-- the first-launch ledger entry exists, the user cannot receive that funding
-- kind again unless the policy is switched to fund_every_eligible_launch.

do $$
begin
  if exists (
    select 1
    from public.wallet_funding_events
    where funding_kind = 'first_launch_minimum'
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'duplicate_first_launch_funding_events_present';
  end if;
end $$;

drop index if exists public.wallet_funding_events_first_launch_uidx;
create unique index wallet_funding_events_first_launch_uidx
  on public.wallet_funding_events (user_id, funding_kind)
  where funding_kind = 'first_launch_minimum';

drop index if exists public.wallet_funding_events_user_cross_chain_idx;
create index wallet_funding_events_user_cross_chain_idx
  on public.wallet_funding_events (user_id, created_at)
  where funding_kind = 'first_launch_minimum';

create or replace function public.claim_solana_first_launch_funding_v1(
  p_launch_id uuid,
  p_user_id uuid,
  p_wallet_id uuid,
  p_source_address text,
  p_destination_address text,
  p_amount_lamports text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_launch public.coin_launches;
  v_event public.wallet_funding_events;
  v_amount numeric;
begin
  if p_launch_id is null or p_user_id is null or p_wallet_id is null then
    raise exception 'solana_funding_identity_required';
  end if;
  if nullif(btrim(p_source_address), '') is null
    or nullif(btrim(p_destination_address), '') is null then
    raise exception 'solana_funding_address_required';
  end if;
  if coalesce(p_amount_lamports, '') !~ '^[0-9]{1,12}$' then
    raise exception 'solana_funding_amount_invalid';
  end if;
  v_amount := p_amount_lamports::numeric;
  if v_amount <= 0 or v_amount > 20000000 then
    raise exception 'solana_first_launch_funding_cap_exceeded';
  end if;

  -- Serialize all first-launch decisions for one user. This prevents two
  -- concurrent launch requests from both becoming the user's first funded
  -- launch.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_launch
  from public.coin_launches
  where id = p_launch_id and user_id = p_user_id
  for update;
  if not found then raise exception 'solana_funding_launch_not_found'; end if;

  if lower(coalesce(v_launch.chain, '')) <> 'solana' then
    return jsonb_build_object('eligible', false, 'reason', 'chain_not_solana');
  end if;
  if coalesce(v_launch.dev_buy_sol, 0) > 0 then
    return jsonb_build_object('eligible', false, 'reason', 'positive_dev_buy');
  end if;
  if lower(coalesce(v_launch.status, 'pending')) in ('failed', 'cancelled', 'rejected') then
    return jsonb_build_object('eligible', false, 'reason', 'launch_terminal');
  end if;

  select * into v_event
  from public.wallet_funding_events
  where user_id = p_user_id
    and funding_kind = 'first_launch_minimum'
  order by created_at, id
  limit 1
  for update;
  if found then
    if v_event.coin_launch_id = p_launch_id
      and lower(coalesce(v_event.status, 'pending')) in ('pending', 'prepared', 'submitted', 'confirmed') then
      if v_event.source_address is distinct from btrim(p_source_address)
        or v_event.destination_address is distinct from btrim(p_destination_address) then
        raise exception 'solana_funding_event_address_conflict';
      end if;
      if v_event.status = 'pending' and v_event.tx_hash is null then
        update public.wallet_funding_events set
          chain = 'solana',
          wallet_id = p_wallet_id,
          amount_wei = p_amount_lamports,
          raw_result = coalesce(raw_result, '{}'::jsonb)
            || jsonb_build_object(
              'chain', 'solana',
              'policy', 'solana_first_launch_minimum_v1',
              'amount_lamports', p_amount_lamports
            ),
          updated_at = now()
        where id = v_event.id
        returning * into v_event;
      end if;
      update public.coin_launches set
        first_launch_subsidy_eligible = true,
        funding_policy = 'solana_first_launch_minimum_v1',
        funding_status = v_event.status,
        funding_amount_wei = v_event.amount_wei,
        funding_tx_hash = v_event.tx_hash,
        funding_error = v_event.error
      where id = p_launch_id;
      return jsonb_build_object('eligible', true, 'event', to_jsonb(v_event));
    end if;
    update public.coin_launches set
      first_launch_subsidy_eligible = false,
      funding_error = 'first_launch_subsidy_reserved_or_used'
    where id = p_launch_id;
    return jsonb_build_object(
      'eligible', false,
      'reason', 'first_launch_subsidy_reserved_or_used'
    );
  end if;

  if exists (
    select 1
    from public.coin_launches prior
    where prior.user_id = p_user_id
      and prior.id <> p_launch_id
      and lower(coalesce(prior.status, 'pending')) not in ('failed', 'cancelled', 'rejected')
      and (prior.created_at, prior.id) < (v_launch.created_at, v_launch.id)
  ) then
    update public.coin_launches set
      first_launch_subsidy_eligible = false,
      funding_error = 'prior_launch_exists'
    where id = p_launch_id;
    return jsonb_build_object('eligible', false, 'reason', 'prior_launch_exists');
  end if;

  insert into public.wallet_funding_events (
    chain, coin_launch_id, user_id, wallet_id, funding_kind, source_address,
    destination_address, amount_wei, status, raw_result
  ) values (
    'solana', p_launch_id, p_user_id, p_wallet_id, 'first_launch_minimum',
    btrim(p_source_address), btrim(p_destination_address), p_amount_lamports,
    'pending', jsonb_build_object(
      'chain', 'solana',
      'policy', 'solana_first_launch_minimum_v1',
      'amount_lamports', p_amount_lamports
    )
  ) returning * into v_event;

  update public.coin_launches set
    first_launch_subsidy_eligible = true,
    funding_policy = 'solana_first_launch_minimum_v1',
    funding_status = 'pending',
    funding_amount_wei = p_amount_lamports,
    funding_tx_hash = null,
    funding_error = null
  where id = p_launch_id;

  return jsonb_build_object('eligible', true, 'event', to_jsonb(v_event));
end;
$$;

revoke all on function public.claim_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text
) to service_role;

comment on index public.wallet_funding_events_first_launch_uidx is
  'Enforces lifetime one-time first-launch funding per user; use per_launch_minimum for fund-every-eligible-launch mode.';
comment on function public.claim_solana_first_launch_funding_v1(
  uuid, uuid, uuid, text, text, text
) is
  'Claims the lifetime one-time Solana first-launch funding ledger entry for a user and launch.';
