-- Rank the wallets that actually produced settled transaction volume.
-- The previous leaderboard grouped by user and then attached every user's
-- activity to their primary Robinhood wallet, which hid Solana and collapsed
-- users with multiple active wallets into a single row.

drop function if exists public.get_home_top_wallets_30d(integer);

create function public.get_home_top_wallets_30d(limit_count integer default 5)
returns table (
  rank bigint,
  wallet text,
  chain text,
  native_symbol text,
  trades bigint,
  amount_eth numeric,
  amount_sol numeric,
  volume_usd numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with attributed as (
    select
      coalesce(
        nullif(t.wallet_address, ''),
        nullif(direct_wallet.address, ''),
        nullif(direct_wallet.public_key, ''),
        nullif(fallback_wallet.address, ''),
        nullif(fallback_wallet.public_key, '')
      ) as wallet_address,
      case
        when lower(coalesce(t.chain, '')) = 'solana'
          or lower(coalesce(t.native_symbol, '')) = 'sol'
        then 'solana'
        else 'robinhood'
      end as wallet_chain,
      coalesce(t.amount_eth, 0) as amount_eth,
      coalesce(t.amount_sol, 0) as amount_sol,
      coalesce(
        t.amount_usd,
        t.amount_eth * t.eth_price_usd,
        t.amount_sol * t.sol_price_usd,
        0
      ) as volume_usd
    from public.transactions t
    left join public.wallets direct_wallet on direct_wallet.id = t.wallet_id
    left join lateral (
      select w.address, w.public_key
      from public.wallets w
      where w.user_id = t.user_id
        and (
          (
            lower(coalesce(t.chain, '')) = 'solana'
            or lower(coalesce(t.native_symbol, '')) = 'sol'
          ) = (w.wallet_type = 'solana')
        )
      order by (w.is_primary is true) desc, w.created_at asc
      limit 1
    ) fallback_wallet on t.wallet_id is null and nullif(t.wallet_address, '') is null
    where t.created_at >= now() - interval '30 days'
      and t.user_id is not null
      and (
        t.tx_hash is not null
        or t.tx_signature is not null
        or lower(coalesce(t.status, '')) in
          ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )
  ),
  per_wallet as (
    select
      wallet_address,
      wallet_chain,
      count(*)::bigint as trades,
      sum(amount_eth) as amount_eth,
      sum(amount_sol) as amount_sol,
      sum(volume_usd) as volume_usd
    from attributed
    where wallet_address is not null
    group by wallet_address, wallet_chain
  ),
  ranked as (
    select
      row_number() over (order by volume_usd desc, trades desc, wallet_address) as rank,
      left(wallet_address, 4) || '...' || right(wallet_address, 4) as wallet,
      wallet_chain as chain,
      case when wallet_chain = 'solana' then 'SOL' else 'ETH' end as native_symbol,
      trades,
      amount_eth,
      amount_sol,
      volume_usd
    from per_wallet
  )
  select r.rank, r.wallet, r.chain, r.native_symbol, r.trades,
    r.amount_eth, r.amount_sol, r.volume_usd
  from ranked r
  order by r.rank
  limit greatest(1, least(coalesce(limit_count, 5), 25));
$$;

revoke all on function public.get_home_top_wallets_30d(integer)
  from public, anon, authenticated;
grant execute on function public.get_home_top_wallets_30d(integer) to service_role;
