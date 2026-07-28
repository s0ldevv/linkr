-- Canonical action provenance.
-- Keep a normalized, queryable source_surface on every value-moving action table.

create or replace function public.normalize_action_source_surface(
  p_source text,
  p_fallback text default 'unknown'
)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(btrim(coalesce(p_source, '')));
begin
  if v = '' then
    v := lower(btrim(coalesce(p_fallback, '')));
  end if;

  if v = '' then
    return 'unknown';
  end if;

  v := regexp_replace(v, '[^a-z0-9_]+', '_', 'g');
  v := regexp_replace(v, '^_+|_+$', '', 'g');

  if v in ('x', 'twitter', 'tweet', 'tweets', 'x_bot', 'xbot')
    or v like 'x_%'
    or v like 'tweet_%'
  then
    return 'x';
  end if;

  if v = 'telegram' or v like 'telegram_%' then
    return 'telegram';
  end if;

  if v in ('terminal', 'dashboard_terminal', 'linkr_terminal') then
    return 'terminal';
  end if;

  if v in ('dashboard', 'website', 'web', 'in_app', 'app', 'public_launch_page', 'launch_config') then
    return 'dashboard';
  end if;

  if v in ('agent_api', 'agent', 'api', 'external_api') then
    return 'agent_api';
  end if;

  if v in ('cron', 'scheduler', 'pg_cron', 'system_job') then
    return 'cron';
  end if;

  if v in ('future', 'system', 'unknown') then
    return v;
  end if;

  return coalesce(nullif(v, ''), 'unknown');
end;
$$;

create or replace function public.action_source_surface_from_row(
  p_row jsonb,
  p_fallback text default 'unknown'
)
returns text
language plpgsql
immutable
as $$
declare
  candidate text;
begin
  candidate := coalesce(
    nullif(p_row->>'source_surface', ''),
    nullif(p_row->>'surface', ''),
    nullif(p_row->>'source', ''),
    nullif(p_row->>'launch_source', ''),
    nullif(p_row->'action_payload'->>'source_surface', ''),
    nullif(p_row->'action_payload'->>'source', ''),
    nullif(p_row->'filled_fields'->>'source_surface', ''),
    nullif(p_row->'filled_fields'->>'source', ''),
    nullif(p_row->'launch_metadata'->>'source_surface', ''),
    nullif(p_row->'launch_metadata'->>'source', ''),
    nullif(p_row->'raw_request'->>'source_surface', ''),
    nullif(p_row->'raw_request'->>'source', ''),
    nullif(p_row->'raw_result'->>'source_surface', ''),
    nullif(p_row->'raw_result'->>'source', ''),
    nullif(p_row->'settings_snapshot'->>'source_surface', ''),
    nullif(p_row->'settings_snapshot'->>'source', '')
  );

  if candidate is null and nullif(p_row->>'tweet_id', '') is not null then
    candidate := 'x';
  end if;

  if candidate is null and nullif(p_row->>'source_tweet_id', '') is not null then
    candidate := 'x';
  end if;

  if candidate is null and nullif(p_row->>'terminal_conversation_id', '') is not null then
    candidate := 'terminal';
  end if;

  return public.normalize_action_source_surface(candidate, p_fallback);
end;
$$;

alter table public.agent_runs
  add column if not exists source_surface text;

alter table public.pending_actions
  add column if not exists source_surface text;

alter table public.transactions
  add column if not exists source_surface text;

alter table public.coin_launches
  add column if not exists source_surface text;

alter table public.liquidity_actions
  add column if not exists source_surface text;

alter table public.scheduled_actions
  add column if not exists source_surface text;

alter table public.linkr_action_drafts
  add column if not exists source_surface text;

alter table public.linkr_pending_actions
  add column if not exists source_surface text;

alter table public.linkr_action_jobs
  add column if not exists source_surface text;

alter table public.linkr_action_receipts
  add column if not exists source_surface text;

update public.agent_runs
set source_surface = public.action_source_surface_from_row(to_jsonb(agent_runs), 'x')
where source_surface is null or btrim(source_surface) = '';

update public.pending_actions
set source_surface = public.action_source_surface_from_row(to_jsonb(pending_actions), 'x')
where source_surface is null or btrim(source_surface) = '';

update public.transactions
set source_surface = public.action_source_surface_from_row(to_jsonb(transactions), 'unknown')
where source_surface is null or btrim(source_surface) = '';

update public.coin_launches
set source_surface = public.action_source_surface_from_row(to_jsonb(coin_launches), 'x')
where source_surface is null or btrim(source_surface) = '';

update public.liquidity_actions la
set source_surface = public.normalize_action_source_surface(pa.source_surface, 'x')
from public.pending_actions pa
where la.pending_action_id = pa.id
  and (la.source_surface is null or btrim(la.source_surface) = '');

update public.liquidity_actions
set source_surface = public.action_source_surface_from_row(to_jsonb(liquidity_actions), 'unknown')
where source_surface is null or btrim(source_surface) = '';

update public.scheduled_actions
set source_surface = public.action_source_surface_from_row(to_jsonb(scheduled_actions), source)
where source_surface is null or btrim(source_surface) = '';

update public.linkr_action_drafts
set source_surface = public.action_source_surface_from_row(to_jsonb(linkr_action_drafts), 'unknown')
where source_surface is null or btrim(source_surface) = '';

update public.linkr_pending_actions
set source_surface = public.action_source_surface_from_row(to_jsonb(linkr_pending_actions), 'unknown')
where source_surface is null or btrim(source_surface) = '';

update public.linkr_action_jobs
set source_surface = public.action_source_surface_from_row(to_jsonb(linkr_action_jobs), 'unknown')
where source_surface is null or btrim(source_surface) = '';

update public.linkr_action_receipts
set source_surface = public.action_source_surface_from_row(to_jsonb(linkr_action_receipts), 'unknown')
where source_surface is null or btrim(source_surface) = '';

alter table public.agent_runs
  alter column source_surface set default 'x',
  alter column source_surface set not null;

alter table public.pending_actions
  alter column source_surface set default 'x',
  alter column source_surface set not null;

alter table public.transactions
  alter column source_surface set default 'unknown',
  alter column source_surface set not null;

alter table public.coin_launches
  alter column source_surface set default 'x',
  alter column source_surface set not null;

alter table public.liquidity_actions
  alter column source_surface set default 'unknown',
  alter column source_surface set not null;

alter table public.scheduled_actions
  alter column source_surface set default 'x',
  alter column source_surface set not null;

alter table public.linkr_action_drafts
  alter column source_surface set default 'unknown',
  alter column source_surface set not null;

alter table public.linkr_pending_actions
  alter column source_surface set default 'unknown',
  alter column source_surface set not null;

alter table public.linkr_action_jobs
  alter column source_surface set default 'unknown',
  alter column source_surface set not null;

alter table public.linkr_action_receipts
  alter column source_surface set default 'unknown',
  alter column source_surface set not null;

alter table public.coin_launches
  drop constraint if exists coin_launches_launch_source_check,
  add constraint coin_launches_launch_source_check
    check (
      launch_source in (
        'x_bot',
        'x',
        'agent_api',
        'website',
        'dashboard',
        'terminal',
        'telegram',
        'cron',
        'unknown'
      )
    ) not valid;

create or replace function public.set_action_source_surface()
returns trigger
language plpgsql
as $$
declare
  fallback text := 'unknown';
  pending_source text;
begin
  if tg_table_name in ('agent_runs', 'pending_actions', 'coin_launches', 'scheduled_actions') then
    fallback := 'x';
  end if;

  if tg_table_name = 'scheduled_actions' then
    new.source := public.normalize_action_source_surface(new.source, fallback);
  end if;

  new.source_surface := public.action_source_surface_from_row(to_jsonb(new), fallback);

  if tg_table_name = 'liquidity_actions'
    and new.source_surface = 'unknown'
    and new.pending_action_id is not null
  then
    select pa.source_surface
      into pending_source
    from public.pending_actions pa
    where pa.id = new.pending_action_id;

    if pending_source is not null then
      new.source_surface := public.normalize_action_source_surface(pending_source, 'unknown');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists agent_runs_action_source_surface on public.agent_runs;
create trigger agent_runs_action_source_surface
  before insert or update of source_surface, tweet_id, extraction on public.agent_runs
  for each row execute function public.set_action_source_surface();

drop trigger if exists pending_actions_action_source_surface on public.pending_actions;
create trigger pending_actions_action_source_surface
  before insert or update of source_surface, tweet_id, action_payload, settings_snapshot on public.pending_actions
  for each row execute function public.set_action_source_surface();

drop trigger if exists transactions_action_source_surface on public.transactions;
create trigger transactions_action_source_surface
  before insert or update of source_surface, tweet_id, raw_request, raw_result, terminal_conversation_id on public.transactions
  for each row execute function public.set_action_source_surface();

drop trigger if exists coin_launches_action_source_surface on public.coin_launches;
create trigger coin_launches_action_source_surface
  before insert or update of source_surface, tweet_id, launch_source, launch_metadata, terminal_conversation_id on public.coin_launches
  for each row execute function public.set_action_source_surface();

drop trigger if exists liquidity_actions_action_source_surface on public.liquidity_actions;
create trigger liquidity_actions_action_source_surface
  before insert or update of source_surface, simulation, terminal_conversation_id, pending_action_id on public.liquidity_actions
  for each row execute function public.set_action_source_surface();

drop trigger if exists scheduled_actions_action_source_surface on public.scheduled_actions;
create trigger scheduled_actions_action_source_surface
  before insert or update of source_surface, source, source_tweet_id, action_payload on public.scheduled_actions
  for each row execute function public.set_action_source_surface();

drop trigger if exists linkr_action_drafts_action_source_surface on public.linkr_action_drafts;
create trigger linkr_action_drafts_action_source_surface
  before insert or update of source_surface, surface, filled_fields on public.linkr_action_drafts
  for each row execute function public.set_action_source_surface();

drop trigger if exists linkr_pending_actions_action_source_surface on public.linkr_pending_actions;
create trigger linkr_pending_actions_action_source_surface
  before insert or update of source_surface, surface, action_payload on public.linkr_pending_actions
  for each row execute function public.set_action_source_surface();

drop trigger if exists linkr_action_jobs_action_source_surface on public.linkr_action_jobs;
create trigger linkr_action_jobs_action_source_surface
  before insert or update of source_surface, surface, action_payload on public.linkr_action_jobs
  for each row execute function public.set_action_source_surface();

drop trigger if exists linkr_action_receipts_action_source_surface on public.linkr_action_receipts;
create trigger linkr_action_receipts_action_source_surface
  before insert or update of source_surface, surface, payload on public.linkr_action_receipts
  for each row execute function public.set_action_source_surface();

create index if not exists agent_runs_source_surface_created_idx
  on public.agent_runs (source_surface, created_at desc);

create index if not exists pending_actions_source_surface_created_idx
  on public.pending_actions (source_surface, created_at desc);

create index if not exists transactions_source_surface_created_idx
  on public.transactions (source_surface, created_at desc);

create index if not exists coin_launches_source_surface_created_idx
  on public.coin_launches (source_surface, created_at desc);

create index if not exists liquidity_actions_source_surface_created_idx
  on public.liquidity_actions (source_surface, created_at desc);

create index if not exists scheduled_actions_source_surface_created_idx
  on public.scheduled_actions (source_surface, created_at desc);

create index if not exists linkr_action_drafts_source_surface_updated_idx
  on public.linkr_action_drafts (source_surface, updated_at desc);

create index if not exists linkr_pending_actions_source_surface_created_idx
  on public.linkr_pending_actions (source_surface, created_at desc);

create index if not exists linkr_action_jobs_source_surface_created_idx
  on public.linkr_action_jobs (source_surface, created_at desc);

create index if not exists linkr_action_receipts_source_surface_created_idx
  on public.linkr_action_receipts (source_surface, created_at desc);

comment on column public.agent_runs.source_surface is
  'Normalized user-facing source where the action request originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.pending_actions.source_surface is
  'Normalized user-facing source where the pending action originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.transactions.source_surface is
  'Normalized user-facing source where the transaction action originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.coin_launches.source_surface is
  'Normalized user-facing source where the launch originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.liquidity_actions.source_surface is
  'Normalized user-facing source where the liquidity action originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.scheduled_actions.source_surface is
  'Normalized user-facing source where the scheduled action originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.linkr_action_drafts.source_surface is
  'Normalized user-facing source where the Linkr action draft originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.linkr_pending_actions.source_surface is
  'Normalized user-facing source where the Linkr pending action originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.linkr_action_jobs.source_surface is
  'Normalized user-facing source where the Linkr action job originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';

comment on column public.linkr_action_receipts.source_surface is
  'Normalized user-facing source where the Linkr action receipt originated: x, terminal, telegram, dashboard, agent_api, cron, or unknown.';
