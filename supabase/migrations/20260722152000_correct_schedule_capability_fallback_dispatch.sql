-- The X reply poster already has its own durable cron. Keep this fallback
-- database-local and remove the accidental dispatcher job: the hardened edge
-- dispatcher intentionally does not authorize the legacy X pipeline routes.

create or replace function public.deliver_pending_schedule_capability_replies(
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tweet public.tweets_inbox%rowtype;
  v_delivered integer := 0;
  v_reply_text constant text :=
    'Yes. I can schedule buys and sells by time or supported market-cap triggers on Solana and Robinhood Chain. Send the token address, amount, and timing or market cap; I will draft it and ask you to confirm before funds move.';
begin
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  for v_tweet in
    select ti.*
    from public.tweets_inbox ti
    where ti.status = 'pending'
      and (ti.next_attempt_at is null or ti.next_attempt_at <= now())
      and length(ti.text) <= 240
      and ti.text ~* '\m(can|could|do|does|able|support|supports|possible|allow|allows)\M'
      and ti.text ~* '\m(schedule|schedules|scheduled|scheduling|later|trigger|triggers|order|orders|market[[:space:]]*cap|marketcap|mcap)\M'
      and ti.text ~* '\m(buy|buys|buying|sell|sells|selling|trade|trades|trading|swap|swaps|transfer|transfers|send|sends)\M'
      and ti.text !~* '0x[0-9a-f]{20,}'
      and ti.text !~* '\m[1-9a-hj-np-zA-HJ-NP-Z]{32,44}\M'
      and ti.text !~* '\m(confirm|cancel)\M'
    order by ti.created_at
    for update skip locked
    limit p_limit
  loop
    insert into public.twitter_replies (
      tweet_id, reply_text, status, conversation_id, author_twitter_id,
      reply_kind, prompt_version, idempotency_key
    ) values (
      v_tweet.tweet_id, v_reply_text, 'pending', v_tweet.conversation_id,
      v_tweet.author_twitter_id, 'schedule_capability_fallback',
      'schedule-capability-fallback-v1',
      'schedule-capability-fallback:' || v_tweet.tweet_id
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;

    update public.tweets_inbox
    set status = 'completed', processed_at = now(), error = null
    where tweet_id = v_tweet.tweet_id and status = 'pending';

    if found then
      v_delivered := v_delivered + 1;
    end if;
  end loop;

  return jsonb_build_object('delivered', v_delivered);
end;
$$;

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'linkr-process-tweets') then
    perform cron.unschedule('linkr-process-tweets');
  end if;

  if exists (select 1 from cron.job where jobname = 'linkr-schedule-capability-fallback') then
    perform cron.unschedule('linkr-schedule-capability-fallback');
  end if;
  perform cron.schedule(
    'linkr-schedule-capability-fallback',
    '* * * * *',
    'select public.deliver_pending_schedule_capability_replies(20);'
  );
end;
$$;
