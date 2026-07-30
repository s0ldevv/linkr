-- Rebrand the X bot handle from @linkrcash to @linkrbot.
--
-- Scope notes:
--   * Matches the handle EXACTLY. A separate X account "linkrcashtest" also
--     exists in this database (58 rows in tweets_inbox); a LIKE '%linkrcash%'
--     match would corrupt it, so every predicate below uses equality.
--   * The existing x_bot_tokens row is deliberately LEFT ALONE. @linkrbot is a
--     new X account, so those OAuth tokens belong to the old @linkrcash user
--     (x_user_id 2070400325207334912). Re-keying them to 'linkrbot' would make
--     the bot authenticate as the wrong account. x-oauth upserts on account_key,
--     so re-authorizing inserts a correct 'linkrbot' row on its own.
--   * x_bot_token_events rows for 'linkrcash' are an audit log of the old
--     account and are left intact as history.
--   * Telegram handles (@LinkrCashBot) are out of scope and untouched.

-- 1. Column defaults, so newly inserted rows key off the new handle.
alter table public.x_bot_tokens
  alter column account_key set default 'linkrbot';

alter table public.x_bot_tokens
  alter column bot_handle set default 'linkrbot';

alter table public.x_bot_token_events
  alter column account_key set default 'linkrbot';

-- 2. The bot's own profile / activity rows, which mirror the live X username.
update public.profiles
   set twitter_username = 'linkrbot'
 where twitter_username = 'linkrcash';

-- public_activity_profiles needs no update: it is a view derived from
-- profiles.twitter_username, so the update above propagates to it.

update public.linkr_x_eligibility_snapshots
   set username = 'linkrbot'
 where username = 'linkrcash';
