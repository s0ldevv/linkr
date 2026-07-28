-- Admin-managed X account bans.
-- Bans are keyed by immutable X user id because handles can change.

create table if not exists public.banned_x_users (
  id uuid primary key default gen_random_uuid(),
  x_user_id text not null,
  username_at_ban text,
  display_name_at_ban text,
  profile_image_url text,
  reason text,
  is_active boolean not null default true,
  banned_by_user_id uuid references auth.users(id) on delete set null,
  banned_at timestamptz not null default now(),
  unbanned_by_user_id uuid references auth.users(id) on delete set null,
  unbanned_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint banned_x_users_x_user_id_nonempty check (length(trim(x_user_id)) > 0)
);

create unique index if not exists banned_x_users_x_user_id_uidx
  on public.banned_x_users (x_user_id);

create index if not exists banned_x_users_active_idx
  on public.banned_x_users (is_active, banned_at desc);

create index if not exists banned_x_users_username_idx
  on public.banned_x_users (lower(username_at_ban))
  where username_at_ban is not null;

drop trigger if exists banned_x_users_updated_at on public.banned_x_users;
create trigger banned_x_users_updated_at
  before update on public.banned_x_users
  for each row execute function public.set_updated_at();

revoke all on public.banned_x_users from anon, authenticated;
grant all on public.banned_x_users to service_role;

alter table public.banned_x_users enable row level security;

create or replace function public.suppress_banned_x_user_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_twitter_id text;
begin
  v_author_twitter_id := nullif(trim(coalesce(new.author_twitter_id, '')), '');

  if v_author_twitter_id is null and new.tweet_id is not null then
    select nullif(trim(t.author_twitter_id), '')
      into v_author_twitter_id
    from public.tweets_inbox t
    where t.tweet_id = new.tweet_id
    limit 1;
  end if;

  if v_author_twitter_id is not null and exists (
    select 1
    from public.banned_x_users b
    where b.x_user_id = v_author_twitter_id
      and b.is_active = true
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists suppress_banned_x_user_reply on public.twitter_replies;
create trigger suppress_banned_x_user_reply
  before insert on public.twitter_replies
  for each row execute function public.suppress_banned_x_user_reply();
