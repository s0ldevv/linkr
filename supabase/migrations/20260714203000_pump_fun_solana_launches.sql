-- First-class Solana / Pump.fun launch support.
-- Keep coin_launches as the canonical launch ledger while making chain and
-- platform explicit for bot routing, workers, public activity, and UI labels.

alter table public.coin_launches
  add column if not exists chain text,
  add column if not exists launch_platform text,
  add column if not exists solana_launch_wallet_id uuid references public.wallets(id) on delete set null,
  add column if not exists solana_launch_wallet_address text,
  add column if not exists requested_initial_buy_lamports text,
  add column if not exists effective_initial_buy_lamports text,
  add column if not exists pump_metadata_uri text,
  add column if not exists pump_url text,
  add column if not exists solscan_url text,
  add column if not exists pump_receipt jsonb;

update public.coin_launches
set chain = case
  when chain is not null then chain
  when chain_id = 4663 then 'robinhood'
  when coalesce(token_address, mint) ~ '^0x[0-9a-fA-F]{40}$' then 'robinhood'
  else 'robinhood'
end
where chain is null;

update public.coin_launches
set launch_platform = case
  when launch_platform is not null then launch_platform
  when chain = 'solana' then 'pump_fun'
  when coalesce(launch_method, '') = 'single_sided_uniswap_v3_lp' then 'robinhood_single_sided_lp'
  else 'robinhood_single_sided_lp'
end
where launch_platform is null;

alter table public.coin_launches
  drop constraint if exists coin_launches_chain_value_check,
  add constraint coin_launches_chain_value_check
    check (chain in ('robinhood', 'solana')) not valid,
  drop constraint if exists coin_launches_launch_platform_value_check,
  add constraint coin_launches_launch_platform_value_check
    check (launch_platform in ('robinhood_single_sided_lp', 'pump_fun')) not valid;

create index if not exists coin_launches_user_chain_created_idx
  on public.coin_launches (user_id, chain, created_at desc);

create index if not exists coin_launches_chain_status_created_idx
  on public.coin_launches (chain, status, created_at desc);

create index if not exists coin_launches_launch_platform_created_idx
  on public.coin_launches (launch_platform, created_at desc);

create index if not exists coin_launches_solana_wallet_created_idx
  on public.coin_launches (solana_launch_wallet_id, created_at desc)
  where solana_launch_wallet_id is not null;

drop view if exists public.public_activity_feed;

create view public.public_activity_feed as
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
  l.dev_buy_eth as amount_eth,
  l.dev_buy_sol as amount_sol,
  l.dev_buy_usd as amount_usd,
  coalesce(l.token_address, l.mint) as reference,
  coalesce(l.tx_hash, l.tx_signature) as tx_hash,
  l.tweet_id,
  t.text as user_post_text,
  t.tweet_url as user_post_url,
  t.author_username as user_post_author,
  lr.reply_text as linkr_response_text,
  lr.reply_tweet_id as linkr_response_tweet_id,
  lr.status::text as linkr_response_status,
  coalesce(l.chain, case when l.chain_id = 4663 then 'robinhood' else 'solana' end)::text as chain,
  case
    when coalesce(l.chain, '') = 'solana' then 'SOL'
    else 'ETH'
  end::text as native_symbol,
  l.launch_platform::text as launch_platform
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
  tx.amount_eth,
  tx.amount_sol,
  tx.amount_usd,
  coalesce(tx.tx_hash, tx.tx_signature, tx.output_mint, tx.input_mint, tx.tweet_id) as reference,
  coalesce(tx.tx_hash, tx.tx_signature) as tx_hash,
  tx.tweet_id,
  t.text as user_post_text,
  t.tweet_url as user_post_url,
  t.author_username as user_post_author,
  lr.reply_text as linkr_response_text,
  lr.reply_tweet_id as linkr_response_tweet_id,
  lr.status::text as linkr_response_status,
  coalesce(
    tx.chain,
    case
      when tx.chain_id = 4663 then 'robinhood'
      when lower(coalesce(tx.native_symbol, '')) = 'sol' then 'solana'
      else 'robinhood'
    end
  )::text as chain,
  coalesce(tx.native_symbol, case when tx.chain = 'solana' then 'SOL' else 'ETH' end)::text as native_symbol,
  null::text as launch_platform
from public.transactions tx
left join public.tweets_inbox t on t.tweet_id = tx.tweet_id
left join latest_replies lr on lr.tweet_id = tx.tweet_id
where tx.status in ('confirmed', 'completed', 'posted', 'success', 'submitted')
  or tx.tx_hash is not null
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
  null::numeric as amount_eth,
  null::numeric as amount_sol,
  null::numeric as amount_usd,
  ar.tweet_id as reference,
  null::text as tx_hash,
  ar.tweet_id,
  t.text as user_post_text,
  t.tweet_url as user_post_url,
  t.author_username as user_post_author,
  lr.reply_text as linkr_response_text,
  lr.reply_tweet_id as linkr_response_tweet_id,
  lr.status::text as linkr_response_status,
  case
    when ar.extraction->>'chain' = 'solana' or ar.extraction->>'launch_chain' = 'solana' then 'solana'
    else 'robinhood'
  end::text as chain,
  case
    when ar.extraction->>'chain' = 'solana' or ar.extraction->>'launch_chain' = 'solana' then 'SOL'
    else 'ETH'
  end::text as native_symbol,
  null::text as launch_platform
from public.agent_runs ar
left join public.tweets_inbox t on t.tweet_id = ar.tweet_id
left join latest_replies lr on lr.tweet_id = ar.tweet_id
where ar.status in ('completed', 'success');

grant select on public.public_activity_feed to anon, authenticated;
