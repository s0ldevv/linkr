-- Keep tweet processing retryable and make sure existing X auth users have profiles.

alter table public.tweets_inbox
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

create index if not exists tweets_inbox_pending_next_attempt_idx
  on public.tweets_inbox (status, next_attempt_at, created_at)
  where status = 'pending';

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
    twitter_profile_image_url
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub'),
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
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
    updated_at = now();
  return new;
end;
$$;

insert into public.profiles (
  user_id,
  twitter_id,
  twitter_username,
  twitter_name,
  twitter_profile_image_url
)
select
  u.id,
  coalesce(
    u.raw_user_meta_data ->> 'provider_id',
    i.identity_data ->> 'provider_id',
    u.raw_user_meta_data ->> 'sub',
    i.identity_data ->> 'sub',
    i.id::text
  ),
  coalesce(
    u.raw_user_meta_data ->> 'user_name',
    u.raw_user_meta_data ->> 'preferred_username',
    i.identity_data ->> 'user_name',
    i.identity_data ->> 'preferred_username'
  ),
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    i.identity_data ->> 'full_name',
    i.identity_data ->> 'name'
  ),
  coalesce(
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture',
    i.identity_data ->> 'avatar_url',
    i.identity_data ->> 'picture'
  )
from auth.users u
left join lateral (
  select id, identity_data
  from auth.identities
  where user_id = u.id
    and provider = 'twitter'
  order by created_at desc
  limit 1
) i on true
where not exists (
  select 1
  from public.profiles p
  where p.user_id = u.id
);

with twitter_auth_profiles as (
  select
    u.id as user_id,
    coalesce(
      u.raw_user_meta_data ->> 'provider_id',
      i.identity_data ->> 'provider_id',
      u.raw_user_meta_data ->> 'sub',
      i.identity_data ->> 'sub',
      i.id::text
    ) as twitter_id,
    coalesce(
      u.raw_user_meta_data ->> 'user_name',
      u.raw_user_meta_data ->> 'preferred_username',
      i.identity_data ->> 'user_name',
      i.identity_data ->> 'preferred_username'
    ) as twitter_username,
    coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      i.identity_data ->> 'full_name',
      i.identity_data ->> 'name'
    ) as twitter_name,
    coalesce(
      u.raw_user_meta_data ->> 'avatar_url',
      u.raw_user_meta_data ->> 'picture',
      i.identity_data ->> 'avatar_url',
      i.identity_data ->> 'picture'
    ) as twitter_profile_image_url
  from auth.users u
  left join lateral (
    select id, identity_data
    from auth.identities
    where user_id = u.id
      and provider = 'twitter'
    order by created_at desc
    limit 1
  ) i on true
)
update public.profiles p
set
  twitter_id = coalesce(p.twitter_id, a.twitter_id),
  twitter_username = coalesce(p.twitter_username, a.twitter_username),
  twitter_name = coalesce(p.twitter_name, a.twitter_name),
  twitter_profile_image_url = coalesce(
    p.twitter_profile_image_url,
    a.twitter_profile_image_url
  ),
  updated_at = now()
from twitter_auth_profiles a
where p.user_id = a.user_id
  and (
    p.twitter_id is null
    or p.twitter_username is null
    or p.twitter_name is null
    or p.twitter_profile_image_url is null
  );
