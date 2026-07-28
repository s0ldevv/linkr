-- Bounded recovery for tweets claimed by cron-process-tweets and left in
-- processing after a function timeout or crash.

create index if not exists tweets_inbox_processing_last_attempt_idx
  on public.tweets_inbox (status, last_attempt_at, created_at)
  where status = 'processing';

create or replace function public.recover_stale_processing_tweets(
  p_cutoff timestamptz,
  p_limit integer default 25,
  p_max_attempts integer default 5
)
returns table(tweet_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with stale as (
    select ti.tweet_id
    from public.tweets_inbox ti
    where ti.status = 'processing'
      and coalesce(ti.last_attempt_at, ti.created_at) < p_cutoff
      and coalesce(ti.attempt_count, 0) < greatest(1, coalesce(p_max_attempts, 5))
    order by coalesce(ti.last_attempt_at, ti.created_at), ti.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 250))
  )
  update public.tweets_inbox ti
  set
    status = 'pending',
    error = 'Recovered stale processing claim',
    next_attempt_at = now()
  from stale
  where ti.tweet_id = stale.tweet_id
  returning ti.tweet_id;
end;
$$;

revoke all on function public.recover_stale_processing_tweets(timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.recover_stale_processing_tweets(timestamptz, integer, integer)
  to service_role;

create or replace function public.fail_stale_processing_tweets(
  p_cutoff timestamptz,
  p_limit integer default 25,
  p_max_attempts integer default 5
)
returns table(tweet_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with stale as (
    select ti.tweet_id
    from public.tweets_inbox ti
    where ti.status = 'processing'
      and coalesce(ti.last_attempt_at, ti.created_at) < p_cutoff
      and coalesce(ti.attempt_count, 0) >= greatest(1, coalesce(p_max_attempts, 5))
    order by coalesce(ti.last_attempt_at, ti.created_at), ti.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 250))
  )
  update public.tweets_inbox ti
  set
    status = 'failed',
    error = 'Failed stale processing claim after max attempts',
    next_attempt_at = null,
    processed_at = now()
  from stale
  where ti.tweet_id = stale.tweet_id
  returning ti.tweet_id;
end;
$$;

revoke all on function public.fail_stale_processing_tweets(timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.fail_stale_processing_tweets(timestamptz, integer, integer)
  to service_role;

