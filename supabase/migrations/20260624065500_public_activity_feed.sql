create or replace view public.public_activity_feed as
select
  ('launch:' || id::text) as id,
  'launch'::text as kind,
  ('Launched $' || symbol)::text as title,
  coalesce(description, name)::text as detail,
  status::text as status,
  created_at,
  dev_buy_sol as amount_sol,
  dev_buy_usd as amount_usd,
  mint as reference,
  tx_signature
from public.coin_launches
where status <> 'failed'

union all

select
  ('transaction:' || id::text) as id,
  coalesce(action, 'transaction')::text as kind,
  case
    when lower(coalesce(action, '')) like '%buy%' then 'Buy executed'
    when lower(coalesce(action, '')) like '%sell%' then 'Sell executed'
    when lower(coalesce(action, '')) like '%transfer%' or lower(coalesce(action, '')) like '%send%' then 'Transfer handled'
    else 'Wallet action'
  end as title,
  coalesce(
    case
      when output_mint is not null then 'Output ' || left(output_mint, 6) || '...' || right(output_mint, 6)
      when input_mint is not null then 'Input ' || left(input_mint, 6) || '...' || right(input_mint, 6)
      else null
    end,
    'Linkr transaction'
  )::text as detail,
  coalesce(status, 'unknown')::text as status,
  created_at,
  amount_sol,
  amount_usd,
  coalesce(tx_signature, output_mint, input_mint, tweet_id) as reference,
  tx_signature
from public.transactions
where status in ('confirmed', 'completed', 'posted', 'success')
  or tx_signature is not null

union all

select
  ('agent:' || id::text) as id,
  case
    when lower(coalesce(intent, '')) like '%buy%' then 'buy'
    when lower(coalesce(intent, '')) like '%sell%' then 'sell'
    when lower(coalesce(intent, '')) like '%transfer%' or lower(coalesce(intent, '')) like '%send%' then 'transfer'
    when lower(coalesce(intent, '')) like '%launch%' then 'launch'
    else 'inquiry'
  end as kind,
  case
    when lower(coalesce(intent, '')) like '%buy%' then 'Buy request parsed'
    when lower(coalesce(intent, '')) like '%sell%' then 'Sell request parsed'
    when lower(coalesce(intent, '')) like '%transfer%' or lower(coalesce(intent, '')) like '%send%' then 'Transfer request parsed'
    when lower(coalesce(intent, '')) like '%launch%' then 'Launch request parsed'
    else 'Inquiry answered'
  end as title,
  coalesce(intent, 'agent run')::text as detail,
  status::text as status,
  created_at,
  null::numeric as amount_sol,
  null::numeric as amount_usd,
  tweet_id as reference,
  null::text as tx_signature
from public.agent_runs
where status in ('completed', 'success');

grant select on public.public_activity_feed to anon, authenticated;
