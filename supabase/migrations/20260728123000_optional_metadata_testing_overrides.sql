-- Treat metadata testing fields as optional overrides.
--
-- When metadata testing is enabled, non-empty admin fields override launch
-- request metadata. Empty fields intentionally fall back to the launch defaults
-- instead of old generic placeholders.

update public.linkr_admin_settings
set value = jsonb_build_object(
  'enabled', coalesce((value->>'enabled')::boolean, false),
  'test_website_url', null,
  'test_twitter_url', null,
  'test_telegram_url', null
)
where key = 'metadata_testing_policy'
  and coalesce(value->>'test_website_url', '') in ('https://google.com', 'https://google.com/')
  and coalesce(value->>'test_twitter_url', '') in ('https://x.com', 'https://x.com/')
  and coalesce(value->>'test_telegram_url', '') in ('https://t.me', 'https://t.me/');

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

    if v_website is not null and v_website !~* '^https://[^[:space:]]+$' then
      raise exception 'invalid_metadata_test_website_url';
    end if;
    if v_twitter is not null and v_twitter !~* '^https://(x\.com|twitter\.com)(/.*)?$' then
      raise exception 'invalid_metadata_test_twitter_url';
    end if;
    if v_telegram is not null and v_telegram !~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$' then
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

  raise exception 'unknown_admin_setting:%', p_key;
end;
$$;

update public.linkr_admin_settings
set description = 'Controls optional token metadata testing overrides.'
where key = 'metadata_testing_policy';
