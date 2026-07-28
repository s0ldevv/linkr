-- Website launcher provenance for Linkr launches.
-- This is additive and keeps existing bot/API launch rows compatible with
-- current workers, public pages, and history views.

alter table public.coin_launches
  add column if not exists launch_source text not null default 'x_bot',
  add column if not exists launch_origin text;

update public.coin_launches
set launch_source = case
  when launch_metadata->>'source' = 'agent_api' then 'agent_api'
  when launch_metadata->>'source' = 'website' then 'website'
  else coalesce(nullif(launch_source, ''), 'x_bot')
end
where launch_source is null
   or launch_source = ''
   or launch_metadata->>'source' in ('agent_api', 'website');

alter table public.coin_launches
  drop constraint if exists coin_launches_launch_source_check,
  add constraint coin_launches_launch_source_check
    check (launch_source in ('x_bot', 'agent_api', 'website')) not valid;

create index if not exists coin_launches_launch_source_created_idx
  on public.coin_launches (launch_source, created_at desc);

create index if not exists coin_launches_user_launch_source_created_idx
  on public.coin_launches (user_id, launch_source, created_at desc);

comment on column public.coin_launches.launch_source is
  'Origin channel for the launch request: x_bot, agent_api, or website.';

comment on column public.coin_launches.launch_origin is
  'Optional finer-grained origin for UI/API launched coins, such as public_launch_page.';
