-- Rank homepage "Top Users (30d)" by combined activity instead of
-- settled trades alone. Users with X posts, agent runs, or launches
-- now qualify even when they have not completed a trade yet.

create or replace function public.get_home_top_traders_30d(limit_count integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with trade_activity as (
    select
      'user:' || t.user_id::text as actor_key,
      t.user_id,
      null::text as twitter_id,
      null::text as handle,
      count(t.id)::int as trades,
      0::int as posts,
      0::int as launches,
      0::int as agent_runs,
      coalesce(sum(coalesce(t.amount_usd, t.amount_sol * t.sol_price_usd)), 0) as volume_usd,
      coalesce(sum(t.amount_sol), 0) as amount_sol,
      max(t.created_at) as last_activity_at
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
  post_activity as (
    select
      coalesce(
        'user:' || p.user_id::text,
        'x:' || nullif(ti.author_twitter_id, ''),
        'handle:' || lower(nullif(ti.author_username, '')),
        'tweet:' || min(ti.id::text)
      ) as actor_key,
      p.user_id,
      nullif(ti.author_twitter_id, '') as twitter_id,
      nullif(ti.author_username, '') as handle,
      0::int as trades,
      count(ti.id)::int as posts,
      0::int as launches,
      0::int as agent_runs,
      0::numeric as volume_usd,
      0::numeric as amount_sol,
      max(ti.created_at) as last_activity_at
    from public.tweets_inbox ti
    left join public.profiles p
      on p.twitter_id = ti.author_twitter_id
      or lower(p.twitter_username) = lower(ti.author_username)
    where ti.created_at >= now() - interval '30 days'
      and coalesce(ti.status, '') not in ('failed', 'ignored', 'error')
      and nullif(ti.author_username, '') is not null
    group by p.user_id, ti.author_twitter_id, ti.author_username
  ),
  launch_activity as (
    select
      'user:' || cl.user_id::text as actor_key,
      cl.user_id,
      null::text as twitter_id,
      null::text as handle,
      0::int as trades,
      0::int as posts,
      count(cl.id)::int as launches,
      0::int as agent_runs,
      0::numeric as volume_usd,
      0::numeric as amount_sol,
      max(cl.created_at) as last_activity_at
    from public.coin_launches cl
    where cl.user_id is not null
      and cl.created_at >= now() - interval '30 days'
      and cl.mint is not null
      and coalesce(cl.status, '') <> 'failed'
    group by cl.user_id
  ),
  agent_activity as (
    select
      'user:' || ar.user_id::text as actor_key,
      ar.user_id,
      null::text as twitter_id,
      null::text as handle,
      0::int as trades,
      0::int as posts,
      0::int as launches,
      count(ar.id)::int as agent_runs,
      0::numeric as volume_usd,
      0::numeric as amount_sol,
      max(ar.created_at) as last_activity_at
    from public.agent_runs ar
    where ar.user_id is not null
      and ar.created_at >= now() - interval '30 days'
      and coalesce(ar.status, '') not in ('failed', 'cancelled', 'expired', 'error')
    group by ar.user_id
  ),
  combined as (
    select * from trade_activity
    union all
    select * from post_activity
    union all
    select * from launch_activity
    union all
    select * from agent_activity
  ),
  per_actor as (
    select
      actor_key,
      min(user_id::text)::uuid as user_id,
      max(twitter_id) as twitter_id,
      max(handle) as handle,
      sum(trades)::int as trades,
      sum(posts)::int as posts,
      sum(launches)::int as launches,
      sum(agent_runs)::int as agent_runs,
      coalesce(sum(volume_usd), 0) as volume_usd,
      coalesce(sum(amount_sol), 0) as amount_sol,
      max(last_activity_at) as last_activity_at
    from combined
    group by actor_key
  ),
  enriched as (
    select
      a.*,
      coalesce(nullif(p.twitter_username, ''), a.handle, 'user_' || left(md5(a.actor_key), 6)) as resolved_handle,
      p.twitter_profile_image_url as avatar_url,
      (a.trades + a.posts + a.launches + a.agent_runs) as activity_score
    from per_actor a
    left join lateral (
      select p.*
      from public.profiles p
      where (a.user_id is not null and p.user_id = a.user_id)
        or (
          a.user_id is null
          and a.twitter_id is not null
          and p.twitter_id = a.twitter_id
        )
        or (
          a.user_id is null
          and a.handle is not null
          and lower(p.twitter_username) = lower(a.handle)
        )
      order by (p.user_id = a.user_id) desc, p.updated_at desc
      limit 1
    ) p on true
  ),
  ranked as (
    select
      row_number() over (
        order by
          activity_score desc,
          trades desc,
          volume_usd desc,
          last_activity_at desc
      ) as rank,
      resolved_handle as handle,
      avatar_url,
      trades,
      posts,
      launches,
      activity_score as score,
      activity_score as actions,
      volume_usd,
      amount_sol
    from enriched
    where activity_score > 0
  )
  select coalesce(jsonb_agg(to_jsonb(ranked) order by rank), '[]'::jsonb)
  from ranked
  where rank <= greatest(1, least(coalesce(limit_count, 5), 20));
$$;

revoke all on function public.get_home_top_traders_30d(integer) from public, anon, authenticated;
grant execute on function public.get_home_top_traders_30d(integer) to service_role;
