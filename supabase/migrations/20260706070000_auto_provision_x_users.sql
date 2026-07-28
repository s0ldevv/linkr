-- Auto-provision X users with default Linkr rules.
--
-- This migration keeps auth.users as the canonical user table while making
-- profile defaults nonzero for first-login and tweet-first accounts.

alter table public.profiles
  add column if not exists default_rules_initialized_at timestamptz,
  add column if not exists auto_provisioned_at timestamptz,
  add column if not exists provisioned_source text;

alter table public.profiles
  alter column default_slippage_bps set default 2500,
  alter column max_auto_buy_sol set default 0.1,
  alter column max_auto_sell_percent set default 100,
  alter column max_auto_dev_buy_sol set default 1;

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
    max_auto_buy_sol,
    max_auto_sell_percent,
    max_auto_dev_buy_sol,
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
    100,
    1,
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
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 2500
      else public.profiles.default_slippage_bps
    end,
    max_auto_buy_sol = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 0.1
      else public.profiles.max_auto_buy_sol
    end,
    max_auto_sell_percent = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 100
      else public.profiles.max_auto_sell_percent
    end,
    max_auto_dev_buy_sol = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then 1
      else public.profiles.max_auto_dev_buy_sol
    end,
    require_confirmation_for_all_tx = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then false
      else public.profiles.require_confirmation_for_all_tx
    end,
    profile_completed = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then true
      else public.profiles.profile_completed
    end,
    default_rules_initialized_at = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then now()
      else public.profiles.default_rules_initialized_at
    end,
    provisioned_source = case
      when public.profiles.default_rules_initialized_at is null
        and public.profiles.default_slippage_bps = 0
        and public.profiles.max_auto_buy_sol = 0
        and public.profiles.max_auto_sell_percent = 0
        and public.profiles.max_auto_dev_buy_sol = 0
      then coalesce(public.profiles.provisioned_source, 'auth_signup')
      else public.profiles.provisioned_source
    end,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.lookup_linkr_auth_user_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth, public
as $$
  select id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;
$$;

revoke all on function public.lookup_linkr_auth_user_by_email(text) from public;
grant execute on function public.lookup_linkr_auth_user_by_email(text) to service_role;

create index if not exists profiles_twitter_username_idx
  on public.profiles (lower(twitter_username));

create index if not exists profiles_auto_provisioned_idx
  on public.profiles (auto_provisioned_at)
  where auto_provisioned_at is not null;

update public.profiles p
set
  default_slippage_bps = 2500,
  max_auto_buy_sol = 0.1,
  max_auto_sell_percent = 100,
  max_auto_dev_buy_sol = 1,
  require_confirmation_for_all_tx = false,
  profile_completed = true,
  default_rules_initialized_at = now(),
  provisioned_source = coalesce(p.provisioned_source, 'legacy_all_zero_backfill'),
  updated_at = now()
where p.default_rules_initialized_at is null
  and p.default_slippage_bps = 0
  and p.max_auto_buy_sol = 0
  and p.max_auto_sell_percent = 0
  and p.max_auto_dev_buy_sol = 0
  and not exists (
    select 1
    from public.transactions t
    where t.user_id = p.user_id
  )
  and not exists (
    select 1
    from public.pending_actions pa
    where pa.user_id = p.user_id
      and pa.status in ('pending', 'confirmed')
  );
