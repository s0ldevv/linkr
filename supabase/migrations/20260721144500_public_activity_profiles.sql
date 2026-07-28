-- Public identity fields used to make the public activity stream legible.
-- Deliberately excludes profile ids, user ids, settings, and wallet data.

create or replace view public.public_activity_profiles as
select distinct on (lower(p.twitter_username))
  lower(p.twitter_username) as handle_key,
  p.twitter_username as handle,
  p.twitter_name as display_name,
  p.twitter_profile_image_url as avatar_url
from public.profiles p
where nullif(trim(p.twitter_username), '') is not null
order by lower(p.twitter_username), p.updated_at desc;

grant select on public.public_activity_profiles to anon, authenticated;
