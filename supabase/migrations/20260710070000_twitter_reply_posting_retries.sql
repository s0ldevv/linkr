-- Durable retry metadata for X reply posting.
-- Keeps prepared replies queued through transient X/API failures and makes
-- operator-required bot OAuth reauthorization visible without losing replies.

alter table public.twitter_replies
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_status_code integer,
  add column if not exists error_details jsonb not null default '{}'::jsonb;

create index if not exists twitter_replies_pending_next_attempt_idx
  on public.twitter_replies (status, next_attempt_at, created_at)
  where status in ('pending', 'posting');

create index if not exists twitter_replies_failed_retry_scan_idx
  on public.twitter_replies (status, created_at desc, attempt_count)
  where status = 'failed';
