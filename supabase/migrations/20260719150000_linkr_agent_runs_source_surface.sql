-- Keep chat/agent run provenance aligned with action provenance.

alter table public.linkr_agent_runs
  add column if not exists source_surface text;

update public.linkr_agent_runs
set source_surface = public.action_source_surface_from_row(to_jsonb(linkr_agent_runs), 'unknown')
where source_surface is null or btrim(source_surface) = '';

alter table public.linkr_agent_runs
  alter column source_surface set default 'unknown',
  alter column source_surface set not null;

drop trigger if exists linkr_agent_runs_action_source_surface on public.linkr_agent_runs;
create trigger linkr_agent_runs_action_source_surface
  before insert or update of source_surface, surface, x_thread_id, cron_job_id on public.linkr_agent_runs
  for each row execute function public.set_action_source_surface();

create index if not exists linkr_agent_runs_source_surface_created_idx
  on public.linkr_agent_runs (source_surface, created_at desc);

comment on column public.linkr_agent_runs.source_surface is
  'Canonical surface that originated this chat/agent run, e.g. x, terminal, telegram, dashboard, agent_api, cron, or unknown.';
