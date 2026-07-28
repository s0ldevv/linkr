-- Linkr conversation threading and reply observability.
-- Adds enough metadata to detect when a user replies to one of Linkr's posted
-- replies, reconstruct bounded dialogue, and trace public reply prompt/linting.

alter table public.tweets_inbox
  add column if not exists is_follow_up boolean not null default false,
  add column if not exists parent_inbox_tweet_id text,
  add column if not exists parent_reply_tweet_id text;

alter table public.twitter_replies
  add column if not exists conversation_id text,
  add column if not exists author_twitter_id text,
  add column if not exists reply_kind text,
  add column if not exists prompt_version text,
  add column if not exists lint_result jsonb;

alter table public.agent_runs
  add column if not exists reply_mode text,
  add column if not exists prompt_version text,
  add column if not exists reply_lint_result jsonb;

create index if not exists tweets_inbox_conversation_created_idx
  on public.tweets_inbox (conversation_id, created_at);

create index if not exists tweets_inbox_follow_up_idx
  on public.tweets_inbox (is_follow_up, created_at)
  where is_follow_up = true;

create index if not exists tweets_inbox_parent_reply_tweet_idx
  on public.tweets_inbox (parent_reply_tweet_id)
  where parent_reply_tweet_id is not null;

create index if not exists twitter_replies_reply_tweet_idx
  on public.twitter_replies (reply_tweet_id)
  where reply_tweet_id is not null;

create index if not exists twitter_replies_conversation_created_idx
  on public.twitter_replies (conversation_id, created_at);

update public.twitter_replies r
set
  conversation_id = coalesce(r.conversation_id, t.conversation_id),
  author_twitter_id = coalesce(r.author_twitter_id, t.author_twitter_id)
from public.tweets_inbox t
where r.tweet_id = t.tweet_id
  and (r.conversation_id is null or r.author_twitter_id is null);
