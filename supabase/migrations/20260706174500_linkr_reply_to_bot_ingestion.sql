-- Linkr reply-to-bot ingestion metadata.
-- Tracks whether an inbox tweet came from direct @mention search or from a
-- reply-to-Linkr search, and why non-mention replies were accepted.

alter table public.tweets_inbox
  add column if not exists ingest_source text,
  add column if not exists ingest_reason text;

create index if not exists tweets_inbox_ingest_source_created_idx
  on public.tweets_inbox (ingest_source, created_at);

create index if not exists tweets_inbox_parent_inbox_created_idx
  on public.tweets_inbox (parent_inbox_tweet_id, created_at)
  where parent_inbox_tweet_id is not null;
