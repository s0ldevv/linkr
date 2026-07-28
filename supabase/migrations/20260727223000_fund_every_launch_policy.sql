-- Complete the database-backed launch funding policy modes.
--
-- This is additive and safe to apply over existing deployments. It makes the
-- admin setting validator accept the per-launch mode and adds the ledger fence
-- that prevents duplicate funding for the same launch request.

alter table public.wallet_funding_events
  add column if not exists chain text;

update public.wallet_funding_events
set chain = case
  when raw_result->>'chain' in ('solana', 'robinhood') then raw_result->>'chain'
  when destination_address ~* '^0x[0-9a-f]{40}$' then 'robinhood'
  when destination_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$' then 'solana'
  else chain
end
where chain is null;

alter table public.wallet_funding_events
  drop constraint if exists wallet_funding_events_chain_check,
  add constraint wallet_funding_events_chain_check
    check (chain is null or chain in ('solana', 'robinhood')) not valid;
alter table public.wallet_funding_events
  validate constraint wallet_funding_events_chain_check;

alter table public.wallet_funding_events
  drop constraint if exists wallet_funding_events_robinhood_amount_cap_check,
  add constraint wallet_funding_events_robinhood_amount_cap_check
  check (
    funding_kind not in ('first_launch_minimum', 'per_launch_minimum')
    or coalesce(chain, 'unknown') <> 'robinhood'
    or amount_wei::numeric <= 5000000000000000
  );

alter table public.wallet_funding_events
  drop constraint if exists wallet_funding_events_solana_amount_cap_check,
  add constraint wallet_funding_events_solana_amount_cap_check
  check (
    funding_kind not in ('first_launch_minimum', 'per_launch_minimum')
    or coalesce(chain, 'unknown') <> 'solana'
    or amount_wei::numeric <= 20000000
  );

create unique index if not exists wallet_funding_events_per_launch_uidx
  on public.wallet_funding_events (coin_launch_id, funding_kind)
  where funding_kind = 'per_launch_minimum'
    and coin_launch_id is not null
    and status in ('pending', 'prepared', 'submitted', 'confirmed');

create index if not exists wallet_funding_events_per_launch_status_idx
  on public.wallet_funding_events (coin_launch_id, status, created_at desc)
  where funding_kind = 'per_launch_minimum';

drop index if exists public.wallet_funding_events_user_cross_chain_idx;
create index wallet_funding_events_user_cross_chain_idx
  on public.wallet_funding_events (user_id, status, created_at)
  where funding_kind = 'first_launch_minimum'
    and status in ('pending', 'prepared', 'submitted', 'confirmed');

create or replace function public.linkr_validate_admin_setting(
  p_key text,
  p_value jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_mode text;
  v_result jsonb;
  v_enabled boolean;
  v_min_followers integer;
  v_min_following integer;
  v_min_posts integer;
  v_website text;
  v_twitter text;
  v_telegram text;
begin
  if p_key = 'launch_funding_policy' then
    v_mode := coalesce(nullif(p_value->>'mode', ''), 'first_eligible_launch');
    if v_mode not in ('funding_disabled', 'first_eligible_launch', 'fund_every_eligible_launch') then
      raise exception 'invalid_launch_funding_mode';
    end if;
    return jsonb_build_object('mode', v_mode);
  end if;

  if p_key = 'x_user_gating_policy' then
    v_min_followers := greatest(coalesce((p_value->>'min_followers')::integer, 0), 0);
    v_min_following := greatest(coalesce((p_value->>'min_following')::integer, 0), 0);
    v_min_posts := greatest(coalesce((p_value->>'min_posts')::integer, 0), 0);
    if v_min_followers > 1000000000
      or v_min_following > 1000000000
      or v_min_posts > 1000000000 then
      raise exception 'x_gating_threshold_out_of_range';
    end if;
    return jsonb_build_object(
      'min_followers_enabled', coalesce((p_value->>'min_followers_enabled')::boolean, false),
      'min_followers', v_min_followers,
      'min_following_enabled', coalesce((p_value->>'min_following_enabled')::boolean, false),
      'min_following', v_min_following,
      'min_posts_enabled', coalesce((p_value->>'min_posts_enabled')::boolean, false),
      'min_posts', v_min_posts
    );
  end if;

  if p_key = 'metadata_testing_policy' then
    v_enabled := coalesce((p_value->>'enabled')::boolean, false);
    v_website := nullif(btrim(coalesce(p_value->>'test_website_url', '')), '');
    v_twitter := nullif(btrim(coalesce(p_value->>'test_twitter_url', '')), '');
    v_telegram := nullif(btrim(coalesce(p_value->>'test_telegram_url', '')), '');
    if v_enabled then
      if v_website is null or v_website !~* '^https://[^[:space:]]+$' then
        raise exception 'invalid_metadata_test_website_url';
      end if;
      if v_twitter is not null and v_twitter !~* '^https://(x\.com|twitter\.com)(/.*)?$' then
        raise exception 'invalid_metadata_test_twitter_url';
      end if;
      if v_telegram is not null and v_telegram !~* '^https://(t\.me|telegram\.me)(/.*)?$' then
        raise exception 'invalid_metadata_test_telegram_url';
      end if;
    end if;
    v_result := jsonb_build_object(
      'enabled', v_enabled,
      'test_website_url', coalesce(v_website, 'https://google.com'),
      'test_twitter_url', coalesce(v_twitter, 'https://x.com'),
      'test_telegram_url', coalesce(v_telegram, 'https://t.me/')
    );
    return v_result;
  end if;

  raise exception 'unknown_admin_setting:%', p_key;
end;
$$;

comment on index public.wallet_funding_events_per_launch_uidx is
  'Prevents duplicate active fund-every-launch ledger entries for the same launch request.';
comment on column public.wallet_funding_events.chain is
  'Funding chain used for amount caps, reconciliation, and cross-chain audit reporting.';
