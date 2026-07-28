-- Robinhood Chain EVM migration.
-- Additive by design: legacy Solana rows remain readable while new code
-- prefers EVM wallet metadata and ETH-native amount fields.

alter table public.wallets
  add column if not exists wallet_type text not null default 'evm',
  add column if not exists chain_id integer,
  add column if not exists address text,
  add column if not exists explorer_url text;

update public.wallets
set wallet_type = 'solana_legacy'
where public_key !~ '^0x[0-9a-fA-F]{40}$'
  and wallet_type = 'evm';

update public.wallets
set
  wallet_type = 'evm',
  chain_id = 4663,
  address = public_key,
  explorer_url = 'https://robinhoodchain.blockscout.com/address/' || public_key
where public_key ~ '^0x[0-9a-fA-F]{40}$';

create index if not exists wallets_user_wallet_type_primary_idx
  on public.wallets (user_id, wallet_type, is_primary desc, created_at asc);

create unique index if not exists wallets_one_primary_evm_per_user_idx
  on public.wallets (user_id)
  where is_primary and wallet_type = 'evm';

alter table public.profiles
  add column if not exists max_auto_buy_eth numeric,
  add column if not exists max_auto_transfer_eth numeric,
  add column if not exists max_auto_dev_buy_eth numeric;

update public.profiles
set
  max_auto_buy_eth = coalesce(max_auto_buy_eth, max_auto_buy_sol),
  max_auto_transfer_eth = coalesce(max_auto_transfer_eth, max_auto_transfer_sol),
  max_auto_dev_buy_eth = coalesce(max_auto_dev_buy_eth, max_auto_dev_buy_sol);

alter table public.transactions
  add column if not exists chain_id integer,
  add column if not exists tx_hash text,
  add column if not exists explorer_url text,
  add column if not exists amount_eth numeric,
  add column if not exists eth_price_usd numeric,
  add column if not exists native_symbol text;

update public.transactions
set
  amount_eth = coalesce(amount_eth, amount_sol),
  eth_price_usd = coalesce(eth_price_usd, sol_price_usd),
  native_symbol = coalesce(native_symbol, 'ETH'),
  tx_hash = coalesce(tx_hash, tx_signature)
where amount_eth is null
  and amount_sol is not null;

alter table public.coin_launches
  add column if not exists chain_id integer,
  add column if not exists token_address text,
  add column if not exists dev_buy_eth numeric,
  add column if not exists eth_price_usd numeric;

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
  l.dev_buy_usd as amount_usd,
  coalesce(l.token_address, l.mint) as reference,
  l.tx_signature as tx_hash,
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
  tx.amount_eth,
  tx.amount_usd,
  coalesce(tx.tx_hash, tx.output_mint, tx.input_mint, tx.tweet_id) as reference,
  tx.tx_hash,
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
where tx.status in ('confirmed', 'completed', 'posted', 'success', 'submitted')
  or tx.tx_hash is not null

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
  null::numeric as amount_usd,
  ar.tweet_id as reference,
  null::text as tx_hash,
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

alter table public.coin_launches
  add column if not exists chain_id integer,
  add column if not exists token_address text,
  add column if not exists dev_buy_eth numeric,
  add column if not exists eth_price_usd numeric;

update public.coin_launches
set
  dev_buy_eth = coalesce(dev_buy_eth, dev_buy_sol),
  eth_price_usd = coalesce(eth_price_usd, sol_price_usd)
where dev_buy_eth is null
  and dev_buy_sol is not null;

create table if not exists public.native_price_cache (
  chain_id integer not null,
  symbol text not null,
  price_usd numeric not null,
  source text,
  fetched_at timestamptz not null default now(),
  primary key (chain_id, symbol)
);

grant all on public.native_price_cache to service_role;
alter table public.native_price_cache enable row level security;

create or replace function public.get_my_wallet_public_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public_key
  from public.wallets
  where user_id = auth.uid()
    and wallet_type = 'evm'
    and chain_id = 4663
  order by is_primary desc, created_at asc, id asc
  limit 1;
$$;

grant execute on function public.get_my_wallet_public_key() to authenticated;

drop function if exists public.get_my_wallets();

create or replace function public.get_my_wallets()
returns table (
  id uuid,
  public_key text,
  is_primary boolean,
  created_at timestamptz,
  wallet_type text,
  chain_id integer,
  address text,
  explorer_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id,
    w.public_key,
    w.is_primary,
    w.created_at,
    w.wallet_type,
    w.chain_id,
    coalesce(w.address, w.public_key),
    w.explorer_url
  from public.wallets w
  where w.user_id = auth.uid()
    and w.wallet_type = 'evm'
    and w.chain_id = 4663
  order by w.is_primary desc, w.created_at asc, w.id asc;
$$;

grant execute on function public.get_my_wallets() to authenticated;

drop function if exists public.set_my_primary_wallet(uuid);

create or replace function public.set_my_primary_wallet(p_wallet_id uuid)
returns table (
  id uuid,
  public_key text,
  is_primary boolean,
  created_at timestamptz,
  wallet_type text,
  chain_id integer,
  address text,
  explorer_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.wallets
    where wallets.id = p_wallet_id
      and wallets.user_id = auth.uid()
      and wallets.wallet_type = 'evm'
      and wallets.chain_id = 4663
  ) then
    raise exception 'wallet_not_found';
  end if;

  update public.wallets
  set is_primary = false
  where user_id = auth.uid()
    and wallet_type = 'evm'
    and chain_id = 4663
    and is_primary = true
    and id <> p_wallet_id;

  update public.wallets
  set is_primary = true
  where user_id = auth.uid()
    and id = p_wallet_id;

  return query
    select
      w.id,
      w.public_key,
      w.is_primary,
      w.created_at,
      w.wallet_type,
      w.chain_id,
      coalesce(w.address, w.public_key),
      w.explorer_url
    from public.wallets w
    where w.id = p_wallet_id
      and w.user_id = auth.uid();
end;
$$;

grant execute on function public.set_my_primary_wallet(uuid) to authenticated;

create or replace function public.get_home_public_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with successful_tx as (
    select *
    from public.transactions
    where coalesce(status, '') in ('confirmed', 'completed', 'submitted')
  ),
  successful_tx_30d as (
    select *
    from successful_tx
    where created_at >= now() - interval '30 days'
  ),
  successful_tx_24h as (
    select *
    from successful_tx
    where created_at >= now() - interval '24 hours'
  ),
  successful_tx_prev_24h as (
    select *
    from successful_tx
    where created_at >= now() - interval '48 hours'
      and created_at < now() - interval '24 hours'
  ),
  tx_attempts_30d as (
    select *
    from public.transactions
    where created_at >= now() - interval '30 days'
  ),
  active_users_24h as (
    select count(distinct user_id) as total
    from (
      select user_id from public.agent_runs where created_at >= now() - interval '24 hours'
      union all
      select user_id from public.transactions where created_at >= now() - interval '24 hours'
    ) s
    where user_id is not null
  ),
  active_users_prev_24h as (
    select count(distinct user_id) as total
    from (
      select user_id from public.agent_runs
      where created_at >= now() - interval '48 hours'
        and created_at < now() - interval '24 hours'
      union all
      select user_id from public.transactions
      where created_at >= now() - interval '48 hours'
        and created_at < now() - interval '24 hours'
    ) s
    where user_id is not null
  ),
  volume_24h as (
    select coalesce(sum(coalesce(amount_usd, amount_eth * eth_price_usd)), 0) as usd
    from successful_tx_24h
  ),
  volume_prev_24h as (
    select coalesce(sum(coalesce(amount_usd, amount_eth * eth_price_usd)), 0) as usd
    from successful_tx_prev_24h
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'users', (select count(*) from public.profiles),
    'usersOnline', (select total from active_users_24h),
    'usersOnlineChangePct', (
      select case
        when prev.total = 0 then null
        else ((cur.total - prev.total)::numeric / prev.total) * 100
      end
      from active_users_24h cur, active_users_prev_24h prev
    ),
    'actions24h', (select count(*) from successful_tx_24h),
    'actions24hChangePct', (
      select case
        when prev.total = 0 then null
        else ((cur.total - prev.total)::numeric / prev.total) * 100
      end
      from (select count(*) as total from successful_tx_24h) cur,
           (select count(*) as total from successful_tx_prev_24h) prev
    ),
    'trades30d', (select count(*) from successful_tx_30d),
    'tradesTotal', (select count(*) from successful_tx),
    'volumeUsd24h', (select usd from volume_24h),
    'volumeUsd24hChangePct', (
      select case
        when prev.usd = 0 then null
        else ((cur.usd - prev.usd) / prev.usd) * 100
      end
      from volume_24h cur, volume_prev_24h prev
    ),
    'volumeUsd30d', (
      select coalesce(sum(coalesce(amount_usd, amount_eth * eth_price_usd)), 0)
      from successful_tx_30d
    ),
    'volumeUsdTotal', (
      select coalesce(sum(coalesce(amount_usd, amount_eth * eth_price_usd)), 0)
      from successful_tx
    ),
    'successRate30d', (
      select case
        when count(*) = 0 then null
        else (count(*) filter (where coalesce(status, '') in ('confirmed', 'completed', 'submitted'))::numeric / count(*)) * 100
      end
      from tx_attempts_30d
    ),
    'launchesTotal', (select count(*) from public.coin_launches where coalesce(status, '') <> 'failed'),
    'uptime30d', null
  );
$$;

grant execute on function public.get_home_public_metrics() to anon, authenticated;

drop function if exists public.get_home_top_traders_30d(integer);

create or replace function public.get_home_top_traders_30d(limit_count integer default 5)
returns table (
  rank bigint,
  handle text,
  trades bigint,
  amount_eth numeric,
  volume_usd numeric,
  actions bigint,
  posts bigint,
  launches bigint,
  score numeric,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  with trade_activity as (
    select
      t.user_id,
      count(*)::bigint as trades,
      coalesce(sum(t.amount_eth), 0) as amount_eth,
      coalesce(sum(coalesce(t.amount_usd, t.amount_eth * t.eth_price_usd)), 0) as volume_usd
    from public.transactions t
    where t.created_at >= now() - interval '30 days'
      and coalesce(t.status, '') in ('confirmed', 'completed', 'submitted')
      and t.user_id is not null
    group by t.user_id
  ),
  post_activity as (
    select p.user_id, count(*)::bigint as posts
    from public.tweets_inbox ti
    join public.profiles p on p.twitter_id = ti.author_twitter_id
    where ti.created_at >= now() - interval '30 days'
    group by p.user_id
  ),
  launch_activity as (
    select cl.user_id, count(*)::bigint as launches
    from public.coin_launches cl
    where cl.created_at >= now() - interval '30 days'
      and cl.user_id is not null
      and coalesce(cl.status, '') <> 'failed'
    group by cl.user_id
  ),
  combined as (
    select user_id from trade_activity
    union
    select user_id from post_activity
    union
    select user_id from launch_activity
  ),
  scored as (
    select
      c.user_id,
      coalesce(t.trades, 0) as trades,
      coalesce(t.amount_eth, 0) as amount_eth,
      coalesce(t.volume_usd, 0) as volume_usd,
      coalesce(pa.posts, 0) as posts,
      coalesce(la.launches, 0) as launches,
      coalesce(t.trades, 0) + coalesce(pa.posts, 0) + coalesce(la.launches, 0) as actions,
      coalesce(t.volume_usd, 0) + (coalesce(t.trades, 0) * 25) + (coalesce(pa.posts, 0) * 5) + (coalesce(la.launches, 0) * 50) as score
    from combined c
    left join trade_activity t on t.user_id = c.user_id
    left join post_activity pa on pa.user_id = c.user_id
    left join launch_activity la on la.user_id = c.user_id
  ),
  enriched as (
    select
      s.*,
      coalesce(nullif(p.twitter_username, ''), 'user') as handle,
      p.twitter_profile_image_url as avatar_url
    from scored s
    left join public.profiles p on p.user_id = s.user_id
  ),
  ranked as (
    select row_number() over (order by score desc, actions desc, volume_usd desc) as rank, *
    from enriched
  )
  select
    r.rank,
    r.handle,
    r.trades,
    r.amount_eth,
    r.volume_usd,
    r.actions,
    r.posts,
    r.launches,
    r.score,
    r.avatar_url
  from ranked r
  order by r.rank
  limit greatest(1, least(coalesce(limit_count, 5), 25));
$$;

grant execute on function public.get_home_top_traders_30d(integer) to anon, authenticated;

drop function if exists public.get_home_top_wallets_30d(integer);

create or replace function public.get_home_top_wallets_30d(limit_count integer default 5)
returns table (
  rank bigint,
  wallet text,
  trades bigint,
  amount_eth numeric,
  volume_usd numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with per_user as (
    select
      t.user_id,
      count(*)::bigint as trades,
      coalesce(sum(t.amount_eth), 0) as amount_eth,
      coalesce(sum(coalesce(t.amount_usd, t.amount_eth * t.eth_price_usd)), 0) as volume_usd
    from public.transactions t
    where t.created_at >= now() - interval '30 days'
      and coalesce(t.status, '') in ('confirmed', 'completed', 'submitted')
      and t.user_id is not null
    group by t.user_id
  ),
  ranked as (
    select
      row_number() over (order by p.volume_usd desc, p.trades desc) as rank,
      coalesce(w.address, w.public_key) as wallet,
      p.trades,
      p.amount_eth,
      p.volume_usd
    from per_user p
    join public.wallets w on w.user_id = p.user_id
    where w.wallet_type = 'evm'
      and w.chain_id = 4663
      and w.is_primary = true
  )
  select rank, wallet, trades, amount_eth, volume_usd
  from ranked
  limit greatest(1, least(coalesce(limit_count, 5), 25));
$$;

grant execute on function public.get_home_top_wallets_30d(integer) to anon, authenticated;

create or replace function public.get_user_profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with settled as (
    select *
    from public.transactions t
    where t.user_id = p_user_id
      and coalesce(t.status, '') in ('confirmed', 'completed', 'submitted')
  )
  select jsonb_build_object(
    'tradesTotal', (select count(*) from settled),
    'trades30d', (select count(*) from settled s where s.created_at >= now() - interval '30 days'),
    'volumeUsdTotal', (
      select coalesce(sum(coalesce(s.amount_usd, s.amount_eth * s.eth_price_usd)), 0) from settled s
    ),
    'lastTradeAt', (select max(s.created_at) from settled s),
    'launchesTotal', (
      select count(*) from public.coin_launches cl
      where cl.user_id = p_user_id
        and coalesce(cl.status, '') <> 'failed'
    ),
    'postsTotal', (
      select count(*) from public.tweets_inbox ti
      join public.profiles p on p.twitter_id = ti.author_twitter_id
      where p.user_id = p_user_id
    ),
    'agentRunsTotal', (select count(*) from public.agent_runs ar where ar.user_id = p_user_id),
    'responsesPosted', (
      select count(*)
      from public.twitter_replies tr
      join public.tweets_inbox ti on ti.tweet_id = tr.tweet_id
      join public.profiles p on p.twitter_id = ti.author_twitter_id
      where p.user_id = p_user_id
        and tr.status = 'posted'
    ),
    'pendingActions', (
      select count(*)
      from public.pending_actions pa
      where pa.user_id = p_user_id
        and pa.status = 'pending'
        and pa.expires_at > now()
    ),
    'firstSeenAt', (select p.created_at from public.profiles p where p.user_id = p_user_id),
    'lastSeenAt', greatest(
      (select max(ar.created_at) from public.agent_runs ar where ar.user_id = p_user_id),
      (select max(s.created_at) from settled s),
      (select max(cl.created_at) from public.coin_launches cl where cl.user_id = p_user_id)
    )
  );
$$;

grant execute on function public.get_user_profile_stats(uuid) to anon, authenticated;
