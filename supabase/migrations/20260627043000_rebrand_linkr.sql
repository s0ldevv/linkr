create or replace function pg_temp.linkr_rebrand_text(value text)
returns text
language sql
immutable
as $$
  select case
    when $1 is null then null
    else regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace($1, '@' || ('sol' || 'mate') || 'app', '@linkrbot', 'gi'),
          ('sol' || 'mate') || 'app',
          'linkrbot',
          'gi'
        ),
        ('sol' || 'mate') || '\.live',
        'linkr.cash',
        'gi'
      ),
      'sol' || 'mate',
      'Linkr',
      'gi'
    )
  end;
$$;

create or replace function pg_temp.linkr_rebrand_json(value jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when $1 is null then null
    else pg_temp.linkr_rebrand_text($1::text)::jsonb
  end;
$$;

update public.tweets_inbox
set
  author_username = pg_temp.linkr_rebrand_text(author_username),
  text = pg_temp.linkr_rebrand_text(text),
  tweet_url = pg_temp.linkr_rebrand_text(tweet_url),
  media_url = pg_temp.linkr_rebrand_text(media_url),
  error = pg_temp.linkr_rebrand_text(error)
where (author_username || text || coalesce(tweet_url, '') || coalesce(media_url, '') || coalesce(error, ''))
  ~* ('sol' || 'mate');

update public.tweet_thread_contexts
set
  context_json = pg_temp.linkr_rebrand_json(context_json),
  flattened_context = pg_temp.linkr_rebrand_text(flattened_context),
  detected_urls = array(select pg_temp.linkr_rebrand_text(url) from unnest(detected_urls) as url),
  detected_media_urls = array(select pg_temp.linkr_rebrand_text(url) from unnest(detected_media_urls) as url)
where (context_json::text || coalesce(flattened_context, '') || array_to_string(detected_urls, ' ') || array_to_string(detected_media_urls, ' '))
  ~* ('sol' || 'mate');

update public.agent_runs
set
  user_context = pg_temp.linkr_rebrand_json(user_context),
  thread_context = pg_temp.linkr_rebrand_json(thread_context),
  classification = pg_temp.linkr_rebrand_json(classification),
  extraction = pg_temp.linkr_rebrand_json(extraction),
  intent = pg_temp.linkr_rebrand_text(intent),
  error = pg_temp.linkr_rebrand_text(error)
where (coalesce(user_context::text, '') || coalesce(thread_context::text, '') || coalesce(classification::text, '') || coalesce(extraction::text, '') || coalesce(intent, '') || coalesce(error, ''))
  ~* ('sol' || 'mate');

update public.pending_actions
set
  intent = pg_temp.linkr_rebrand_text(intent),
  action_payload = pg_temp.linkr_rebrand_json(action_payload),
  confirmation_phrase = pg_temp.linkr_rebrand_text(confirmation_phrase)
where (intent || coalesce(action_payload::text, '') || confirmation_phrase)
  ~* ('sol' || 'mate');

update public.transactions
set
  action = pg_temp.linkr_rebrand_text(action),
  amount_original_unit = pg_temp.linkr_rebrand_text(amount_original_unit),
  error = pg_temp.linkr_rebrand_text(error)
where (coalesce(action, '') || coalesce(amount_original_unit, '') || coalesce(error, ''))
  ~* ('sol' || 'mate');

update public.coin_launches
set
  name = pg_temp.linkr_rebrand_text(name),
  description = pg_temp.linkr_rebrand_text(description),
  image_url = pg_temp.linkr_rebrand_text(image_url),
  reward_mode = pg_temp.linkr_rebrand_text(reward_mode),
  error = pg_temp.linkr_rebrand_text(error)
where (name || coalesce(description, '') || coalesce(image_url, '') || reward_mode || coalesce(error, ''))
  ~* ('sol' || 'mate');

update public.coin_settings_updates
set error = pg_temp.linkr_rebrand_text(error)
where coalesce(error, '') ~* ('sol' || 'mate');

update public.twitter_replies
set
  reply_text = pg_temp.linkr_rebrand_text(reply_text),
  error = pg_temp.linkr_rebrand_text(error)
where (reply_text || coalesce(error, '')) ~* ('sol' || 'mate');

update public.token_registry
set
  name = pg_temp.linkr_rebrand_text(name),
  logo_url = pg_temp.linkr_rebrand_text(logo_url),
  source = pg_temp.linkr_rebrand_text(source)
where (coalesce(name, '') || coalesce(logo_url, '') || coalesce(source, ''))
  ~* ('sol' || 'mate');

update public.user_memory_index
set
  title = pg_temp.linkr_rebrand_text(title),
  searchable_text = pg_temp.linkr_rebrand_text(searchable_text)
where (coalesce(title, '') || searchable_text) ~* ('sol' || 'mate');

update public.app_state
set
  key = pg_temp.linkr_rebrand_text(key),
  value = pg_temp.linkr_rebrand_json(value)
where (key || coalesce(value::text, '')) ~* ('sol' || 'mate');

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
