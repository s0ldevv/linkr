-- Show the public source post and Linkr reply in the activity feed.

create or replace view public.public_activity_feed as
with latest_replies as (
  select *
  from (
    select
      r.tweet_id,
      r.reply_text,
      r.reply_tweet_id,
      r.status,
      r.created_at,
      r.posted_at,
      row_number() over (
        partition by r.tweet_id
        order by
          case
            when lower(coalesce(r.status, '')) in ('posted', 'completed', 'success') then 4
            when lower(coalesce(r.status, '')) = 'pending' then 3
            when lower(coalesce(r.status, '')) = 'failed' then 1
            else 2
          end desc,
          coalesce(r.posted_at, r.created_at) desc,
          r.created_at desc
      ) as reply_rank
    from public.twitter_replies r
    where r.tweet_id is not null
  ) ranked
  where reply_rank = 1
)
select
  ('launch:' || l.id::text) as id,
  'launch'::text as kind,
  ('Launched $' || l.symbol)::text as title,
  coalesce(t.text, l.description, l.name)::text as detail,
  l.status::text as status,
  l.created_at,
  l.dev_buy_sol as amount_sol,
  l.dev_buy_usd as amount_usd,
  l.mint as reference,
  l.tx_signature,
  l.tweet_id,
  t.text as user_post_text,
  t.tweet_url as user_post_url,
  t.author_username as user_post_author,
  lr.reply_text as linkr_response_text,
  lr.reply_tweet_id as linkr_response_tweet_id,
  lr.status::text as linkr_response_status
from public.coin_launches l
left join public.tweets_inbox t on t.tweet_id = l.tweet_id
left join latest_replies lr on lr.tweet_id = l.tweet_id
where l.status <> 'failed'

union all

select
  ('transaction:' || tx.id::text) as id,
  coalesce(tx.action, 'transaction')::text as kind,
  case
    when lower(coalesce(tx.action, '')) like '%buy%' then 'Buy executed'
    when lower(coalesce(tx.action, '')) like '%sell%' then 'Sell executed'
    when lower(coalesce(tx.action, '')) like '%transfer%' or lower(coalesce(tx.action, '')) like '%send%' then 'Transfer handled'
    else 'Wallet action'
  end as title,
  coalesce(
    t.text,
    case
      when tx.output_mint is not null then 'Output ' || left(tx.output_mint, 6) || '...' || right(tx.output_mint, 6)
      when tx.input_mint is not null then 'Input ' || left(tx.input_mint, 6) || '...' || right(tx.input_mint, 6)
      else null
    end,
    'Linkr transaction'
  )::text as detail,
  coalesce(tx.status, 'unknown')::text as status,
  tx.created_at,
  tx.amount_sol,
  tx.amount_usd,
  coalesce(tx.tx_signature, tx.output_mint, tx.input_mint, tx.tweet_id) as reference,
  tx.tx_signature,
  tx.tweet_id,
  t.text as user_post_text,
  t.tweet_url as user_post_url,
  t.author_username as user_post_author,
  lr.reply_text as linkr_response_text,
  lr.reply_tweet_id as linkr_response_tweet_id,
  lr.status::text as linkr_response_status
from public.transactions tx
left join public.tweets_inbox t on t.tweet_id = tx.tweet_id
left join latest_replies lr on lr.tweet_id = tx.tweet_id
where tx.status in ('confirmed', 'completed', 'posted', 'success')
  or tx.tx_signature is not null

union all

select
  ('agent:' || ar.id::text) as id,
  case
    when lower(coalesce(ar.intent, '')) like '%buy%' then 'buy'
    when lower(coalesce(ar.intent, '')) like '%sell%' then 'sell'
    when lower(coalesce(ar.intent, '')) like '%transfer%' or lower(coalesce(ar.intent, '')) like '%send%' then 'transfer'
    when lower(coalesce(ar.intent, '')) like '%launch%' then 'launch'
    else 'reply'
  end as kind,
  case
    when lower(coalesce(ar.intent, '')) like '%buy%' then 'Buy request parsed'
    when lower(coalesce(ar.intent, '')) like '%sell%' then 'Sell request parsed'
    when lower(coalesce(ar.intent, '')) like '%transfer%' or lower(coalesce(ar.intent, '')) like '%send%' then 'Transfer request parsed'
    when lower(coalesce(ar.intent, '')) like '%launch%' then 'Launch request parsed'
    else 'Linkr answered'
  end as title,
  coalesce(t.text, ar.intent, 'agent run')::text as detail,
  ar.status::text as status,
  ar.created_at,
  null::numeric as amount_sol,
  null::numeric as amount_usd,
  ar.tweet_id as reference,
  null::text as tx_signature,
  ar.tweet_id,
  t.text as user_post_text,
  t.tweet_url as user_post_url,
  t.author_username as user_post_author,
  lr.reply_text as linkr_response_text,
  lr.reply_tweet_id as linkr_response_tweet_id,
  lr.status::text as linkr_response_status
from public.agent_runs ar
left join public.tweets_inbox t on t.tweet_id = ar.tweet_id
left join latest_replies lr on lr.tweet_id = ar.tweet_id
where ar.status in ('completed', 'success');

grant select on public.public_activity_feed to anon, authenticated;
