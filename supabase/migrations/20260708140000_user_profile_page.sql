-- Aggregated per-user stats for the public /u/:username profile page.
-- Called by the user-profile-data edge function with the service role.

create or replace function public.get_user_profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with settled as (
    select t.created_at, t.amount_usd, t.amount_sol, t.sol_price_usd
    from public.transactions t
    where t.user_id = p_user_id
      and coalesce(t.action, '') in ('buy', 'sell', 'transfer')
      and (
        t.tx_signature is not null
        or coalesce(t.status, '') in ('confirmed', 'completed', 'posted', 'success', 'submitted')
      )
  )
  select jsonb_build_object(
    'tradesTotal', (select count(*) from settled),
    'trades30d', (select count(*) from settled s where s.created_at >= now() - interval '30 days'),
    'volumeUsdTotal', (
      select coalesce(sum(coalesce(s.amount_usd, s.amount_sol * s.sol_price_usd)), 0) from settled s
    ),
    'volumeUsd30d', (
      select coalesce(sum(coalesce(s.amount_usd, s.amount_sol * s.sol_price_usd)), 0)
      from settled s
      where s.created_at >= now() - interval '30 days'
    ),
    'launchesTotal', (
      select count(*)
      from public.coin_launches cl
      where cl.user_id = p_user_id
        and cl.mint is not null
        and coalesce(cl.status, '') <> 'failed'
    ),
    'postsTotal', (
      select count(*)
      from public.tweets_inbox ti
      join public.profiles p on p.twitter_id = ti.author_twitter_id
      where p.user_id = p_user_id
    ),
    'agentRunsTotal', (select count(*) from public.agent_runs ar where ar.user_id = p_user_id),
    'inquiriesTotal', (
      select count(*)
      from public.agent_runs ar
      where ar.user_id = p_user_id
        and ar.intent in (
          'coin_inquiry', 'general_inquiry', 'help', 'wallet_balance', 'portfolio',
          'transaction_history', 'launch_history', 'settings_history', 'agent_history',
          'recent_activity', 'deposit_address'
        )
    ),
    'pendingActions', (
      select count(*)
      from public.pending_actions pa
      where pa.user_id = p_user_id
        and pa.status = 'pending'
        and pa.expires_at > now()
    ),
    'firstSeenAt', (select p.created_at from public.profiles p where p.user_id = p_user_id),
    'lastActivityAt', greatest(
      (select max(ar.created_at) from public.agent_runs ar where ar.user_id = p_user_id),
      (select max(s.created_at) from settled s),
      (select max(cl.created_at) from public.coin_launches cl where cl.user_id = p_user_id)
    )
  );
$$;

revoke all on function public.get_user_profile_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_user_profile_stats(uuid) to service_role;
