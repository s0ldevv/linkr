-- =============================================================
-- Terminal homepage: richer public metrics, top wallets,
-- per-service system status, avatars on top traders.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Public metrics: add 24h action counts, users online,
--    success rate, and 24h deltas. Keeps all existing keys.
-- -------------------------------------------------------------
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
    where coalesce(action, '') in ('buy', 'sell', 'transfer')
      and (
        tx_signature is not null
        or coalesce(status, '') in ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )
  ),
  successful_tx_30d as (
    select * from successful_tx
    where created_at >= now() - interval '30 days'
  ),
  actions_24h as (
    select count(*)::int as total
    from public.agent_runs
    where created_at >= now() - interval '24 hours'
  ),
  actions_prev_24h as (
    select count(*)::int as total
    from public.agent_runs
    where created_at >= now() - interval '48 hours'
      and created_at < now() - interval '24 hours'
  ),
  volume_24h as (
    select nullif(sum(coalesce(amount_usd, amount_sol * sol_price_usd)), 0) as usd
    from successful_tx
    where created_at >= now() - interval '24 hours'
  ),
  volume_prev_24h as (
    select nullif(sum(coalesce(amount_usd, amount_sol * sol_price_usd)), 0) as usd
    from successful_tx
    where created_at >= now() - interval '48 hours'
      and created_at < now() - interval '24 hours'
  ),
  active_users_24h as (
    select count(distinct user_id)::int as total
    from (
      select user_id from public.agent_runs
      where user_id is not null and created_at >= now() - interval '24 hours'
      union all
      select user_id from public.transactions
      where user_id is not null and created_at >= now() - interval '24 hours'
    ) activity
  ),
  active_users_prev_24h as (
    select count(distinct user_id)::int as total
    from (
      select user_id from public.agent_runs
      where user_id is not null
        and created_at >= now() - interval '48 hours'
        and created_at < now() - interval '24 hours'
      union all
      select user_id from public.transactions
      where user_id is not null
        and created_at >= now() - interval '48 hours'
        and created_at < now() - interval '24 hours'
    ) activity
  ),
  tx_attempts_30d as (
    select
      count(*)::int as total,
      count(*) filter (
        where tx_signature is not null
          or coalesce(status, '') in ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )::int as ok
    from public.transactions
    where created_at >= now() - interval '30 days'
      and coalesce(action, '') in ('buy', 'sell', 'transfer')
  ),
  health_30d as (
    select status
    from public.system_health_events
    where checked_at >= now() - interval '30 days'
  ),
  health_summary as (
    select
      count(*)::int as total,
      count(*) filter (where status = 'ok')::int as ok
    from health_30d
  )
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'usersOnline', (select total from active_users_24h),
    'usersOnlineChangePct', (
      select case
        when prev.total > 0
          then round(((cur.total - prev.total)::numeric / prev.total) * 100, 1)
        else null
      end
      from active_users_24h cur, active_users_prev_24h prev
    ),
    'actions24h', (select total from actions_24h),
    'actions24hChangePct', (
      select case
        when prev.total > 0
          then round(((cur.total - prev.total)::numeric / prev.total) * 100, 1)
        else null
      end
      from actions_24h cur, actions_prev_24h prev
    ),
    'trades30d', (select count(*) from successful_tx_30d),
    'tradesTotal', (select count(*) from successful_tx),
    'volumeUsd24h', (select usd from volume_24h),
    'volumeUsd24hChangePct', (
      select case
        when prev.usd is not null and prev.usd > 0 and cur.usd is not null
          then round(((cur.usd - prev.usd) / prev.usd) * 100, 1)
        else null
      end
      from volume_24h cur, volume_prev_24h prev
    ),
    'volumeUsd30d', (
      select nullif(sum(coalesce(amount_usd, amount_sol * sol_price_usd)), 0)
      from successful_tx_30d
    ),
    'volumeUsdTotal', (
      select nullif(sum(coalesce(amount_usd, amount_sol * sol_price_usd)), 0)
      from successful_tx
    ),
    'successRate30d', (
      select case
        when total > 0 then round((ok::numeric / total) * 100, 2)
        else null
      end
      from tx_attempts_30d
    ),
    'launchesTotal', (
      select count(*)
      from public.coin_launches
      where coalesce(status, '') <> 'failed'
    ),
    'uptime30d', (
      select case
        when total >= 24 then round((ok::numeric / nullif(total, 0)) * 100, 2)
        else null
      end
      from health_summary
    ),
    'generatedAt', now()
  );
$$;

revoke all on function public.get_home_public_metrics() from public, anon, authenticated;
grant execute on function public.get_home_public_metrics() to service_role;

-- -------------------------------------------------------------
-- 2) Top traders: include avatar + total actions (agent runs).
--    Same signature as before.
-- -------------------------------------------------------------
create or replace function public.get_home_top_traders_30d(limit_count integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      row_number() over (
        order by
          count(t.id) desc,
          coalesce(sum(coalesce(t.amount_usd, t.amount_sol * t.sol_price_usd)), 0) desc
      ) as rank,
      coalesce(p.twitter_username, 'user_' || left(md5(t.user_id::text), 6)) as handle,
      p.twitter_profile_image_url as avatar_url,
      count(t.id)::int as trades,
      coalesce(
        (
          select count(*)::int
          from public.agent_runs ar
          where ar.user_id = t.user_id
            and ar.created_at >= now() - interval '30 days'
        ),
        0
      ) as actions,
      coalesce(sum(coalesce(t.amount_usd, t.amount_sol * t.sol_price_usd)), 0) as volume_usd,
      coalesce(sum(t.amount_sol), 0) as amount_sol
    from public.transactions t
    left join public.profiles p on p.user_id = t.user_id
    where t.user_id is not null
      and t.created_at >= now() - interval '30 days'
      and coalesce(t.action, '') in ('buy', 'sell', 'transfer')
      and (
        t.tx_signature is not null
        or coalesce(t.status, '') in ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )
    group by t.user_id, p.twitter_username, p.twitter_profile_image_url
  )
  select coalesce(jsonb_agg(to_jsonb(ranked) order by rank), '[]'::jsonb)
  from ranked
  where rank <= greatest(1, least(coalesce(limit_count, 5), 20));
$$;

revoke all on function public.get_home_top_traders_30d(integer) from public, anon, authenticated;
grant execute on function public.get_home_top_traders_30d(integer) to service_role;

-- -------------------------------------------------------------
-- 3) Top wallets by settled volume (30d), masked public keys.
-- -------------------------------------------------------------
create or replace function public.get_home_top_wallets_30d(limit_count integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with per_user as (
    select
      t.user_id,
      count(t.id)::int as trades,
      coalesce(sum(coalesce(t.amount_usd, t.amount_sol * t.sol_price_usd)), 0) as volume_usd,
      coalesce(sum(t.amount_sol), 0) as amount_sol
    from public.transactions t
    where t.user_id is not null
      and t.created_at >= now() - interval '30 days'
      and coalesce(t.action, '') in ('buy', 'sell', 'transfer')
      and (
        t.tx_signature is not null
        or coalesce(t.status, '') in ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )
    group by t.user_id
  ),
  primary_wallet as (
    select distinct on (w.user_id)
      w.user_id,
      w.public_key
    from public.wallets w
    order by w.user_id, (w.is_primary is true) desc, w.created_at asc
  ),
  ranked as (
    select
      row_number() over (order by pu.volume_usd desc, pu.trades desc) as rank,
      left(pw.public_key, 4) || '...' || right(pw.public_key, 4) as wallet,
      pu.trades,
      pu.volume_usd,
      pu.amount_sol
    from per_user pu
    join primary_wallet pw on pw.user_id = pu.user_id
  )
  select coalesce(jsonb_agg(to_jsonb(ranked) order by rank), '[]'::jsonb)
  from ranked
  where rank <= greatest(1, least(coalesce(limit_count, 5), 20));
$$;

revoke all on function public.get_home_top_wallets_30d(integer) from public, anon, authenticated;
grant execute on function public.get_home_top_wallets_30d(integer) to service_role;

-- -------------------------------------------------------------
-- 4) Latest health status per monitored source.
-- -------------------------------------------------------------
create or replace function public.get_home_system_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (source)
      source,
      status,
      latency_ms,
      checked_at
    from public.system_health_events
    order by source, checked_at desc
  )
  select coalesce(
    jsonb_agg(to_jsonb(latest) order by source),
    '[]'::jsonb
  )
  from latest;
$$;

revoke all on function public.get_home_system_status() from public, anon, authenticated;
grant execute on function public.get_home_system_status() to service_role;
