-- Keep scheduled_actions database constraints in lockstep with the API and
-- cron worker action set. Market-cap triggers remain limited to swaps because
-- non-swap actions do not have a meaningful token market-cap guard.

alter table public.scheduled_actions
  drop constraint if exists scheduled_actions_action_type_check;

alter table public.scheduled_actions
  add constraint scheduled_actions_action_type_check
  check (
    action_type in (
      'buy',
      'sell',
      'transfer',
      'launch_coin',
      'claim_creator_rewards',
      'add_liquidity',
      'remove_liquidity',
      'collect_liquidity_fees'
    )
  ) not valid;

alter table public.scheduled_actions
  validate constraint scheduled_actions_action_type_check;

alter table public.scheduled_actions
  drop constraint if exists scheduled_actions_market_action_check;

alter table public.scheduled_actions
  add constraint scheduled_actions_market_action_check
  check (trigger_type <> 'market_cap' or action_type in ('buy', 'sell'))
  not valid;

alter table public.scheduled_actions
  validate constraint scheduled_actions_market_action_check;

create index if not exists scheduled_actions_action_status_due_idx
  on public.scheduled_actions (
    action_type,
    status,
    (coalesce(scheduled_for, next_check_at)),
    created_at
  )
  where status in ('pending', 'processing');

create index if not exists scheduled_actions_pending_action_idx
  on public.scheduled_actions (pending_action_id)
  where pending_action_id is not null;

comment on constraint scheduled_actions_action_type_check
  on public.scheduled_actions is
  'Scheduler action set accepted by create-scheduled-action and cron-process-scheduled-actions.';

comment on constraint scheduled_actions_market_action_check
  on public.scheduled_actions is
  'Market-cap triggers are restricted to buy/sell swap actions.';
