-- Activity records are chain-specific only when the source data identifies one.

alter table public.agent_runs
  add column if not exists chain text;

alter table public.agent_runs
  drop constraint if exists agent_runs_chain_check;

alter table public.agent_runs
  add constraint agent_runs_chain_check
  check (chain is null or chain in ('robinhood', 'solana'));

create or replace function public.infer_agent_run_chain(
  p_chain text,
  p_extraction jsonb,
  p_thread_context jsonb,
  p_tweet_id text
)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_explicit text;
  v_text text := '';
  v_context text := '';
  v_has_solana boolean := false;
  v_has_robinhood boolean := false;
begin
  v_explicit := lower(nullif(trim(coalesce(
    p_chain,
    p_extraction->>'chain',
    p_extraction->>'token_chain',
    p_extraction->>'launch_chain',
    p_extraction#>>'{token,chain}',
    p_extraction#>>'{resolved_token,chain}'
  )), ''));

  if v_explicit in ('solana', 'sol') then
    return 'solana';
  end if;
  if v_explicit in ('robinhood', 'robinhood chain', 'evm', 'eth') then
    return 'robinhood';
  end if;

  if p_tweet_id is not null then
    select coalesce(t.text, '')
      into v_text
      from public.tweets_inbox t
     where t.tweet_id = p_tweet_id;
  end if;

  v_has_solana :=
    v_text ~* '(^|[^a-z0-9])(solana|sol|pump[.]?fun|pumpswap)([^a-z0-9]|$)'
    or v_text ~ '(^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}([^1-9A-HJ-NP-Za-km-z]|$)';
  v_has_robinhood :=
    v_text ~* '(^|[^a-z0-9])(robinhood([[:space:]]+chain)?|evm)([^a-z0-9]|$)'
    or v_text ~* '0x[0-9a-f]{40}';

  if v_has_solana <> v_has_robinhood then
    return case when v_has_solana then 'solana' else 'robinhood' end;
  end if;
  if v_has_solana and v_has_robinhood then
    return null;
  end if;

  v_context := coalesce(p_thread_context->>'flattened_context', '');
  v_has_solana :=
    v_context ~* '(^|[^a-z0-9])(solana|sol|pump[.]?fun|pumpswap)([^a-z0-9]|$)'
    or v_context ~ '(^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}([^1-9A-HJ-NP-Za-km-z]|$)';
  v_has_robinhood :=
    v_context ~* '(^|[^a-z0-9])(robinhood([[:space:]]+chain)?|evm)([^a-z0-9]|$)'
    or v_context ~* '0x[0-9a-f]{40}';

  if v_has_solana <> v_has_robinhood then
    return case when v_has_solana then 'solana' else 'robinhood' end;
  end if;
  return null;
end;
$$;

revoke all on function public.infer_agent_run_chain(text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.infer_agent_run_chain(text, jsonb, jsonb, text)
  to service_role;

create or replace function public.set_agent_run_chain()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.chain := public.infer_agent_run_chain(
    new.chain,
    new.extraction,
    new.thread_context,
    new.tweet_id
  );
  return new;
end;
$$;

revoke all on function public.set_agent_run_chain() from public, anon, authenticated;
grant execute on function public.set_agent_run_chain() to service_role;

drop trigger if exists set_agent_run_chain on public.agent_runs;
create trigger set_agent_run_chain
before insert or update of chain, extraction, thread_context, tweet_id
on public.agent_runs
for each row execute function public.set_agent_run_chain();

update public.agent_runs ar
set chain = public.infer_agent_run_chain(
  null,
  ar.extraction,
  ar.thread_context,
  ar.tweet_id
);

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
),
latest_agent_runs as (
  select *
  from (
    select
      ar.*,
      row_number() over (
        partition by coalesce(ar.tweet_id, ar.id::text)
        order by
          case when lower(coalesce(ar.intent, '')) = 'normal_classifier' then 0 else 1 end desc,
          ar.created_at desc
      ) as run_rank
    from public.agent_runs ar
    where ar.status in ('completed', 'success')
  ) ranked
  where run_rank = 1
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
  case when coalesce(l.chain, '') = 'solana' then 'SOL' else 'ETH' end::text as native_symbol,
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
    when lower(coalesce(tx.action, '')) like '%transfer%'
      or lower(coalesce(tx.action, '')) like '%send%' then 'Transfer handled'
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
    when lower(coalesce(ar.intent, '')) like '%transfer%'
      or lower(coalesce(ar.intent, '')) like '%send%' then 'transfer'
    when lower(coalesce(ar.intent, '')) like '%launch%' then 'launch'
    else 'reply'
  end as kind,
  case
    when lower(coalesce(ar.intent, '')) like '%buy%' then 'Buy request parsed'
    when lower(coalesce(ar.intent, '')) like '%sell%' then 'Sell request parsed'
    when lower(coalesce(ar.intent, '')) like '%transfer%'
      or lower(coalesce(ar.intent, '')) like '%send%' then 'Transfer request parsed'
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
  ar.chain::text as chain,
  case
    when ar.chain = 'solana' then 'SOL'
    when ar.chain = 'robinhood' then 'ETH'
    else null
  end::text as native_symbol,
  null::text as launch_platform
from latest_agent_runs ar
left join public.tweets_inbox t on t.tweet_id = ar.tweet_id
left join latest_replies lr on lr.tweet_id = ar.tweet_id;

grant select on public.public_activity_feed to anon, authenticated;
