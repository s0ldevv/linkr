-- Make Solana wallet rules first-class alongside the EVM rule set.

alter table public.profiles
  add column if not exists max_auto_buy_eth numeric,
  add column if not exists max_auto_transfer_eth numeric,
  add column if not exists max_auto_dev_buy_eth numeric,
  add column if not exists max_auto_buy_sol numeric not null default 0.1,
  add column if not exists max_auto_transfer_sol numeric not null default 0,
  add column if not exists max_auto_dev_buy_sol numeric not null default 1;

alter table public.profiles
  alter column max_auto_buy_eth set default 0.1,
  alter column max_auto_transfer_eth set default 0,
  alter column max_auto_dev_buy_eth set default 1,
  alter column max_auto_buy_sol set default 0.1,
  alter column max_auto_transfer_sol set default 0,
  alter column max_auto_dev_buy_sol set default 1;

update public.profiles
set
  max_auto_buy_eth = coalesce(max_auto_buy_eth, max_auto_buy_sol, 0.1),
  max_auto_transfer_eth = coalesce(max_auto_transfer_eth, max_auto_transfer_sol, 0),
  max_auto_dev_buy_eth = coalesce(max_auto_dev_buy_eth, max_auto_dev_buy_sol, 1),
  max_auto_buy_sol = coalesce(max_auto_buy_sol, max_auto_buy_eth, 0.1),
  max_auto_transfer_sol = coalesce(max_auto_transfer_sol, max_auto_transfer_eth, 0),
  max_auto_dev_buy_sol = coalesce(max_auto_dev_buy_sol, max_auto_dev_buy_eth, 1);

alter table public.profiles
  alter column max_auto_buy_sol set not null,
  alter column max_auto_transfer_sol set not null,
  alter column max_auto_dev_buy_sol set not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    user_id,
    twitter_id,
    twitter_username,
    twitter_name,
    twitter_profile_image_url,
    profile_completed,
    default_slippage_bps,
    max_auto_buy_eth,
    max_auto_transfer_eth,
    max_auto_dev_buy_eth,
    max_auto_buy_sol,
    max_auto_transfer_sol,
    max_auto_dev_buy_sol,
    max_auto_sell_percent,
    require_confirmation_for_all_tx,
    default_rules_initialized_at,
    provisioned_source
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub'),
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    true,
    2500,
    0.1,
    0,
    1,
    0.1,
    0,
    1,
    100,
    false,
    now(),
    'auth_signup'
  )
  on conflict (user_id) do update
  set
    twitter_id = coalesce(public.profiles.twitter_id, excluded.twitter_id),
    twitter_username = coalesce(excluded.twitter_username, public.profiles.twitter_username),
    twitter_name = coalesce(excluded.twitter_name, public.profiles.twitter_name),
    twitter_profile_image_url = coalesce(
      excluded.twitter_profile_image_url,
      public.profiles.twitter_profile_image_url
    ),
    default_slippage_bps = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 2500
      else public.profiles.default_slippage_bps
    end,
    max_auto_buy_eth = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 0.1
      else coalesce(public.profiles.max_auto_buy_eth, public.profiles.max_auto_buy_sol, 0.1)
    end,
    max_auto_transfer_eth = coalesce(public.profiles.max_auto_transfer_eth, 0),
    max_auto_dev_buy_eth = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 1
      else coalesce(public.profiles.max_auto_dev_buy_eth, public.profiles.max_auto_dev_buy_sol, 1)
    end,
    max_auto_buy_sol = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 0.1
      else public.profiles.max_auto_buy_sol
    end,
    max_auto_transfer_sol = public.profiles.max_auto_transfer_sol,
    max_auto_dev_buy_sol = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 1
      else public.profiles.max_auto_dev_buy_sol
    end,
    max_auto_sell_percent = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 100
      else public.profiles.max_auto_sell_percent
    end,
    require_confirmation_for_all_tx = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then false
      else public.profiles.require_confirmation_for_all_tx
    end,
    profile_completed = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then true
      else public.profiles.profile_completed
    end,
    default_rules_initialized_at = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then now()
      else public.profiles.default_rules_initialized_at
    end,
    provisioned_source = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and coalesce(public.profiles.max_auto_buy_eth, 0) = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and coalesce(public.profiles.max_auto_dev_buy_eth, 0) = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then coalesce(public.profiles.provisioned_source, 'auth_signup')
      else public.profiles.provisioned_source
    end,
    updated_at = now();

  return new;
end;
$$;
