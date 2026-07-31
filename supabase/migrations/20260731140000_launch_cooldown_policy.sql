-- Optional one-launch-per-user cooldown, disabled by default.

insert into public.linkr_admin_settings (key, value, description)
values (
  'launch_cooldown_policy',
  '{"enabled":false,"duration_minutes":60}'::jsonb,
  'Controls whether a user may launch only one coin during a configured window.'
)
on conflict (key) do nothing;

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
  v_duration_minutes integer;
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

    if v_website is not null and v_website !~* '^[a-z][a-z0-9+.-]*://' then
      v_website := 'https://' || v_website;
    end if;
    if v_twitter is not null and v_twitter !~* '^[a-z][a-z0-9+.-]*://' then
      v_twitter := 'https://' || v_twitter;
    end if;
    if v_telegram is not null and v_telegram !~* '^[a-z][a-z0-9+.-]*://' then
      v_telegram := 'https://' || v_telegram;
    end if;

    if v_telegram ~* '^https://(t\.me|telegram\.me)$' then
      v_telegram := v_telegram || '/';
    end if;

    if v_website is not null and v_website !~* '^https://[^[:space:]/?#]+[^[:space:]]*$' then
      raise exception 'invalid_metadata_test_website_url';
    end if;
    if v_twitter is not null and v_twitter !~* '^https://(x\.com|twitter\.com)(/[^[:space:]]*)?$' then
      raise exception 'invalid_metadata_test_twitter_url';
    end if;
    if v_telegram is not null and v_telegram !~* '^https://(t\.me|telegram\.me)(/[^[:space:]]*)?$' then
      raise exception 'invalid_metadata_test_telegram_url';
    end if;

    v_result := jsonb_build_object(
      'enabled', v_enabled,
      'test_website_url', v_website,
      'test_twitter_url', v_twitter,
      'test_telegram_url', v_telegram
    );
    return v_result;
  end if;

  if p_key = 'launch_cooldown_policy' then
    v_duration_minutes := greatest(
      coalesce((p_value->>'duration_minutes')::integer, 60),
      1
    );
    if v_duration_minutes > 10080 then
      raise exception 'launch_cooldown_duration_out_of_range';
    end if;
    return jsonb_build_object(
      'enabled', coalesce((p_value->>'enabled')::boolean, false),
      'duration_minutes', v_duration_minutes
    );
  end if;

  raise exception 'unknown_admin_setting:%', p_key;
end;
$$;

create table if not exists public.linkr_launch_cooldown_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_key text not null,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linkr_launch_cooldown_claims enable row level security;
revoke all on public.linkr_launch_cooldown_claims from public, anon, authenticated;
grant all on public.linkr_launch_cooldown_claims to service_role;

create index if not exists linkr_launch_cooldown_claims_claimed_idx
  on public.linkr_launch_cooldown_claims (claimed_at desc);

create or replace function public.get_linkr_launch_cooldown_v1(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy jsonb;
  v_enabled boolean;
  v_duration_minutes integer;
  v_last_launch_at timestamptz;
  v_cooldown_until timestamptz;
  v_retry_after integer;
begin
  select value into v_policy
  from public.linkr_admin_settings
  where key = 'launch_cooldown_policy';

  v_enabled := coalesce((v_policy->>'enabled')::boolean, false);
  v_duration_minutes := greatest(
    least(coalesce((v_policy->>'duration_minutes')::integer, 60), 10080),
    1
  );

  if not v_enabled or p_user_id is null then
    return jsonb_build_object(
      'enabled', false,
      'allowed', true,
      'duration_minutes', v_duration_minutes,
      'last_launch_at', null,
      'cooldown_until', null,
      'retry_after_seconds', 0
    );
  end if;

  select greatest(
    coalesce((
      select max(claimed_at)
      from public.linkr_launch_cooldown_claims
      where user_id = p_user_id
    ), '-infinity'::timestamptz),
    coalesce((
      select max(created_at)
      from public.coin_launches
      where user_id = p_user_id
        and coalesce(status, '') not in ('cancelled', 'rejected', 'failed', 'dead_letter')
    ), '-infinity'::timestamptz)
  ) into v_last_launch_at;

  if v_last_launch_at = '-infinity'::timestamptz then
    v_last_launch_at := null;
  end if;
  v_cooldown_until := v_last_launch_at + make_interval(mins => v_duration_minutes);
  v_retry_after := greatest(
    0,
    ceil(extract(epoch from (v_cooldown_until - clock_timestamp())))::integer
  );

  return jsonb_build_object(
    'enabled', true,
    'allowed', v_retry_after = 0,
    'duration_minutes', v_duration_minutes,
    'last_launch_at', v_last_launch_at,
    'cooldown_until', case when v_last_launch_at is null then null else v_cooldown_until end,
    'retry_after_seconds', case when v_last_launch_at is null then 0 else v_retry_after end
  );
end;
$$;

create or replace function public.enforce_linkr_launch_cooldown_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status jsonb;
  v_retry_after integer;
  v_request_key text;
begin
  if coalesce(new.request_type, '') <> 'launch_coin' or new.user_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('linkr-launch-cooldown:' || new.user_id::text, 0)
  );
  v_request_key := coalesce(new.idempotency_key, new.id::text);
  if exists (
    select 1
    from public.linkr_launch_cooldown_claims
    where user_id = new.user_id and request_key = v_request_key
  ) then
    return new;
  end if;
  v_status := public.get_linkr_launch_cooldown_v1(new.user_id);
  if not coalesce((v_status->>'enabled')::boolean, false) then
    return new;
  end if;
  if not coalesce((v_status->>'allowed')::boolean, true) then
    v_retry_after := greatest(1, coalesce((v_status->>'retry_after_seconds')::integer, 60));
    raise exception 'launch_cooldown_active'
      using detail = 'retry_after_seconds=' || v_retry_after::text;
  end if;

  insert into public.linkr_launch_cooldown_claims (user_id, request_key, claimed_at, updated_at)
  values (new.user_id, v_request_key, now(), now())
  on conflict (user_id) do update
    set request_key = excluded.request_key,
        claimed_at = excluded.claimed_at,
        updated_at = excluded.updated_at
    where public.linkr_launch_cooldown_claims.request_key = excluded.request_key
       or (extract(epoch from (now() - public.linkr_launch_cooldown_claims.claimed_at))
           >= ((v_status->>'duration_minutes')::integer * 60));
  if not found then
    v_retry_after := greatest(1, coalesce((v_status->>'retry_after_seconds')::integer, 60));
    raise exception 'launch_cooldown_active'
      using detail = 'retry_after_seconds=' || v_retry_after::text;
  end if;
  return new;
end;
$$;

drop trigger if exists linkr_launch_cooldown_guard on public.linkr_work_items;
create trigger linkr_launch_cooldown_guard
before insert on public.linkr_work_items
for each row execute function public.enforce_linkr_launch_cooldown_v1();

revoke all on function public.get_linkr_launch_cooldown_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_linkr_launch_cooldown_v1(uuid)
  to service_role;
revoke all on function public.enforce_linkr_launch_cooldown_v1()
  from public, anon, authenticated;
grant execute on function public.enforce_linkr_launch_cooldown_v1()
  to service_role;
