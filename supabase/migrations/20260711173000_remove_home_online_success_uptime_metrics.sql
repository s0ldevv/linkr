-- Remove public homepage metrics that are no longer displayed or requested:
-- live user counts, completion percentage, and uptime percentage.
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
    'launchesTotal', (select count(*) from public.coin_launches where coalesce(status, '') <> 'failed')
  );
$$;

grant execute on function public.get_home_public_metrics() to anon, authenticated;
