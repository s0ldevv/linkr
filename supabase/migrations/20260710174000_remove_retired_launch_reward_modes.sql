-- Remove retired launch reward-mode schema from active Robinhood Chain launches.
-- Historical values are archived before the active columns are dropped.

create table if not exists public.coin_launch_retired_reward_archive (
  coin_launch_id uuid primary key references public.coin_launches(id) on delete cascade,
  retired_config jsonb not null default '{}'::jsonb,
  archived_at timestamptz not null default now()
);

insert into public.coin_launch_retired_reward_archive (
  coin_launch_id,
  retired_config
)
select
  id,
  jsonb_build_object(
    'mode',
    reward_mode,
    'percent',
    agent_percentage
  )
from public.coin_launches
where (
    reward_mode is not null
    and reward_mode <> 'none'
  )
  or coalesce(agent_percentage, 0) <> 0
on conflict (coin_launch_id) do update
set
  retired_config = excluded.retired_config,
  archived_at = now();

update public.coin_settings_updates
set new_config = new_config - 'reward_mode' - 'agent_percentage'
where new_config ?| array['reward_mode', 'agent_percentage'];

alter table public.coin_launches
  drop constraint if exists coin_launches_reward_mode_check,
  drop constraint if exists coin_launches_agent_pct_check;

alter table public.coin_launches
  drop column if exists reward_mode,
  drop column if exists agent_percentage;

grant select on public.coin_launch_retired_reward_archive to service_role;
grant all on public.coin_launch_retired_reward_archive to service_role;
