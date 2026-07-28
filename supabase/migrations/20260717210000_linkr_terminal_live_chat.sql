-- Linkr terminal live chat, channel-neutral runtime state, and terminal projections.

create table if not exists public.linkr_terminal_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  status text not null default 'active',
  source text not null default 'terminal',
  summary text,
  active_topic jsonb,
  active_entities jsonb not null default '[]'::jsonb,
  pinned_context jsonb not null default '{}'::jsonb,
  last_message_preview text,
  last_message_role text,
  last_message_at timestamptz,
  pending_action_count integer not null default 0,
  message_count integer not null default 0,
  total_prompt_tokens integer not null default 0,
  total_completion_tokens integer not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_terminal_conversations_status_check
    check (status in ('active','archived','deleted'))
);

create index if not exists linkr_terminal_conversations_user_updated_idx
  on public.linkr_terminal_conversations (user_id, updated_at desc);
create index if not exists linkr_terminal_conversations_user_status_idx
  on public.linkr_terminal_conversations (user_id, status, updated_at desc);

drop trigger if exists linkr_terminal_conversations_set_updated_at on public.linkr_terminal_conversations;
create trigger linkr_terminal_conversations_set_updated_at
  before update on public.linkr_terminal_conversations
  for each row execute function public.set_updated_at();

grant select on public.linkr_terminal_conversations to authenticated;
grant all on public.linkr_terminal_conversations to service_role;
alter table public.linkr_terminal_conversations enable row level security;

drop policy if exists "users read own terminal conversations" on public.linkr_terminal_conversations;
create policy "users read own terminal conversations"
  on public.linkr_terminal_conversations for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_terminal_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.linkr_terminal_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null default '',
  parts jsonb not null default '[]'::jsonb,
  status text not null default 'completed',
  client_message_id text,
  source_refs jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_terminal_messages_role_check
    check (role in ('user','assistant','system','tool')),
  constraint linkr_terminal_messages_status_check
    check (status in ('sending','typing','completed','failed','cancelled'))
);

create index if not exists linkr_terminal_messages_conversation_created_idx
  on public.linkr_terminal_messages (conversation_id, created_at asc);
create index if not exists linkr_terminal_messages_user_created_idx
  on public.linkr_terminal_messages (user_id, created_at desc);
create unique index if not exists linkr_terminal_messages_client_message_uidx
  on public.linkr_terminal_messages (user_id, client_message_id)
  where client_message_id is not null;
create unique index if not exists linkr_terminal_messages_idempotency_uidx
  on public.linkr_terminal_messages (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists linkr_terminal_messages_parts_gin_idx
  on public.linkr_terminal_messages using gin (parts);

drop trigger if exists linkr_terminal_messages_set_updated_at on public.linkr_terminal_messages;
create trigger linkr_terminal_messages_set_updated_at
  before update on public.linkr_terminal_messages
  for each row execute function public.set_updated_at();

grant select on public.linkr_terminal_messages to authenticated;
grant all on public.linkr_terminal_messages to service_role;
alter table public.linkr_terminal_messages enable row level security;

drop policy if exists "users read own terminal messages" on public.linkr_terminal_messages;
create policy "users read own terminal messages"
  on public.linkr_terminal_messages for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  surface text not null,
  surface_conversation_id text,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete cascade,
  x_thread_id text,
  cron_job_id uuid,
  user_message_id uuid references public.linkr_terminal_messages(id) on delete set null,
  assistant_message_id uuid references public.linkr_terminal_messages(id) on delete set null,
  status text not null default 'queued',
  route_decision jsonb,
  classification jsonb,
  extraction jsonb,
  working_frame jsonb,
  retrieval_request jsonb,
  retrieved_history jsonb,
  tool_results jsonb not null default '[]'::jsonb,
  reply_plan jsonb,
  outcome jsonb,
  error text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  idempotency_key text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_agent_runs_status_check
    check (status in ('queued','running','awaiting_confirmation','completed','failed','cancelled','ignored','delegated'))
);

create index if not exists linkr_agent_runs_user_surface_created_idx
  on public.linkr_agent_runs (user_id, surface, created_at desc);
create index if not exists linkr_agent_runs_terminal_conversation_created_idx
  on public.linkr_agent_runs (terminal_conversation_id, created_at desc);
create unique index if not exists linkr_agent_runs_idempotency_uidx
  on public.linkr_agent_runs (user_id, idempotency_key)
  where idempotency_key is not null;

drop trigger if exists linkr_agent_runs_set_updated_at on public.linkr_agent_runs;
create trigger linkr_agent_runs_set_updated_at
  before update on public.linkr_agent_runs
  for each row execute function public.set_updated_at();

grant select on public.linkr_agent_runs to authenticated;
grant all on public.linkr_agent_runs to service_role;
alter table public.linkr_agent_runs enable row level security;

drop policy if exists "users read own linkr agent runs" on public.linkr_agent_runs;
create policy "users read own linkr agent runs"
  on public.linkr_agent_runs for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_terminal_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.linkr_agent_runs(id) on delete cascade,
  conversation_id uuid not null references public.linkr_terminal_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists linkr_terminal_events_run_created_idx
  on public.linkr_terminal_events (run_id, created_at asc);
create index if not exists linkr_terminal_events_conversation_created_idx
  on public.linkr_terminal_events (conversation_id, created_at desc);

grant select on public.linkr_terminal_events to authenticated;
grant all on public.linkr_terminal_events to service_role;
alter table public.linkr_terminal_events enable row level security;

drop policy if exists "users read own terminal events" on public.linkr_terminal_events;
create policy "users read own terminal events"
  on public.linkr_terminal_events for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_source_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  surface_conversation_id text,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete cascade,
  x_thread_id text,
  cron_job_id uuid,
  message_id uuid references public.linkr_terminal_messages(id) on delete set null,
  run_id uuid references public.linkr_agent_runs(id) on delete set null,
  ref_type text not null,
  ref_key text not null,
  label text,
  url text,
  privacy_label text not null default 'user_private',
  source_payload jsonb not null default '{}'::jsonb,
  resolved_payload jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0.7,
  freshness text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists linkr_source_refs_user_type_created_idx
  on public.linkr_source_refs (user_id, ref_type, created_at desc);
create index if not exists linkr_source_refs_terminal_conversation_created_idx
  on public.linkr_source_refs (terminal_conversation_id, created_at desc);
create unique index if not exists linkr_source_refs_surface_ref_uidx
  on public.linkr_source_refs (user_id, surface, surface_conversation_id, ref_type, ref_key);
create index if not exists linkr_source_refs_resolved_payload_gin_idx
  on public.linkr_source_refs using gin (resolved_payload);

drop trigger if exists linkr_source_refs_set_updated_at on public.linkr_source_refs;
create trigger linkr_source_refs_set_updated_at
  before update on public.linkr_source_refs
  for each row execute function public.set_updated_at();

grant select on public.linkr_source_refs to authenticated;
grant all on public.linkr_source_refs to service_role;
alter table public.linkr_source_refs enable row level security;

drop policy if exists "users read own linkr source refs" on public.linkr_source_refs;
create policy "users read own linkr source refs"
  on public.linkr_source_refs for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_memory_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  surface_conversation_id text,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete set null,
  x_thread_id text,
  cron_job_id uuid,
  message_id uuid references public.linkr_terminal_messages(id) on delete set null,
  run_id uuid references public.linkr_agent_runs(id) on delete set null,
  event_type text not null,
  memory_source_type text,
  memory_source_id text,
  title text,
  summary text not null,
  privacy_label text not null default 'user_private',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint linkr_memory_events_type_check
    check (event_type in ('indexed','updated','skipped','redacted','forgotten'))
);

create index if not exists linkr_memory_events_user_created_idx
  on public.linkr_memory_events (user_id, created_at desc);
create index if not exists linkr_memory_events_terminal_conversation_created_idx
  on public.linkr_memory_events (terminal_conversation_id, created_at desc);

grant select on public.linkr_memory_events to authenticated;
grant all on public.linkr_memory_events to service_role;
alter table public.linkr_memory_events enable row level security;

drop policy if exists "users read own linkr memory events" on public.linkr_memory_events;
create policy "users read own linkr memory events"
  on public.linkr_memory_events for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_agent_locks (
  lock_key text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  surface text not null,
  scope_type text not null,
  scope_id text not null,
  run_id uuid references public.linkr_agent_runs(id) on delete set null,
  owner_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists linkr_agent_locks_user_scope_idx
  on public.linkr_agent_locks (user_id, surface, scope_type, scope_id);
create index if not exists linkr_agent_locks_expires_idx
  on public.linkr_agent_locks (expires_at);

drop trigger if exists linkr_agent_locks_set_updated_at on public.linkr_agent_locks;
create trigger linkr_agent_locks_set_updated_at
  before update on public.linkr_agent_locks
  for each row execute function public.set_updated_at();

grant select on public.linkr_agent_locks to authenticated;
grant all on public.linkr_agent_locks to service_role;
alter table public.linkr_agent_locks enable row level security;

drop policy if exists "users read own linkr locks" on public.linkr_agent_locks;
create policy "users read own linkr locks"
  on public.linkr_agent_locks for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_external_data_cache (
  cache_key text primary key,
  source_type text not null,
  source_ref_key text not null,
  privacy_label text not null default 'external_untrusted',
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  etag text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists linkr_external_data_cache_source_idx
  on public.linkr_external_data_cache (source_type, source_ref_key);
create index if not exists linkr_external_data_cache_expires_idx
  on public.linkr_external_data_cache (expires_at);
create index if not exists linkr_external_data_cache_privacy_idx
  on public.linkr_external_data_cache (privacy_label);

grant select on public.linkr_external_data_cache to authenticated;
grant all on public.linkr_external_data_cache to service_role;
alter table public.linkr_external_data_cache enable row level security;

drop policy if exists "authenticated read safe external cache" on public.linkr_external_data_cache;
create policy "authenticated read safe external cache"
  on public.linkr_external_data_cache for select to authenticated
  using (privacy_label in ('public','external_untrusted','recipient_public'));

alter table public.linkr_action_drafts
  add column if not exists surface text,
  add column if not exists surface_conversation_id text,
  add column if not exists terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete cascade,
  add column if not exists x_thread_id text,
  add column if not exists cron_job_id uuid,
  add column if not exists source_refs jsonb not null default '[]'::jsonb,
  add column if not exists last_message_id uuid references public.linkr_terminal_messages(id) on delete set null;

update public.linkr_action_drafts
  set surface = coalesce(surface, 'x')
  where surface is null;

alter table public.linkr_action_drafts
  alter column surface set default 'x',
  alter column surface set not null;

alter table public.linkr_action_drafts
  drop constraint if exists linkr_action_drafts_status_check;
alter table public.linkr_action_drafts
  add constraint linkr_action_drafts_status_check
  check (status in ('open','awaiting_clarification','ready','converted_to_pending','completed','cancelled','expired','failed'));

create index if not exists linkr_action_drafts_user_surface_updated_idx
  on public.linkr_action_drafts (user_id, surface, updated_at desc);
create index if not exists linkr_action_drafts_terminal_conversation_updated_idx
  on public.linkr_action_drafts (terminal_conversation_id, updated_at desc);

create table if not exists public.linkr_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  surface_conversation_id text,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete cascade,
  x_thread_id text,
  cron_job_id uuid,
  user_message_id uuid references public.linkr_terminal_messages(id) on delete set null,
  assistant_message_id uuid references public.linkr_terminal_messages(id) on delete set null,
  draft_id uuid references public.linkr_action_drafts(id) on delete set null,
  action_type text not null,
  status text not null default 'pending',
  confirmation_phrase text not null,
  summary text not null,
  action_payload jsonb not null,
  risk_summary jsonb not null default '[]'::jsonb,
  deterministic_validation jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  idempotency_key text not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_pending_actions_status_check
    check (status in ('pending','confirmed','cancelled','expired','executing','executed','failed'))
);

create index if not exists linkr_pending_actions_user_status_idx
  on public.linkr_pending_actions (user_id, status, expires_at);
create index if not exists linkr_pending_actions_user_surface_created_idx
  on public.linkr_pending_actions (user_id, surface, created_at desc);
create index if not exists linkr_pending_actions_terminal_conversation_created_idx
  on public.linkr_pending_actions (terminal_conversation_id, created_at desc);
create unique index if not exists linkr_pending_actions_idempotency_uidx
  on public.linkr_pending_actions (user_id, idempotency_key);

drop trigger if exists linkr_pending_actions_set_updated_at on public.linkr_pending_actions;
create trigger linkr_pending_actions_set_updated_at
  before update on public.linkr_pending_actions
  for each row execute function public.set_updated_at();

grant select on public.linkr_pending_actions to authenticated;
grant all on public.linkr_pending_actions to service_role;
alter table public.linkr_pending_actions enable row level security;

drop policy if exists "users read own linkr pending actions" on public.linkr_pending_actions;
create policy "users read own linkr pending actions"
  on public.linkr_pending_actions for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_action_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  surface_conversation_id text,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete cascade,
  x_thread_id text,
  cron_job_id uuid,
  pending_action_id uuid references public.linkr_pending_actions(id) on delete set null,
  run_id uuid references public.linkr_agent_runs(id) on delete set null,
  action_type text not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  action_payload jsonb not null,
  result jsonb,
  error_code text,
  error_message text,
  idempotency_key text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_action_jobs_status_check
    check (status in ('queued','running','awaiting_receipt','completed','failed','cancelled'))
);

create index if not exists linkr_action_jobs_user_status_created_idx
  on public.linkr_action_jobs (user_id, status, created_at desc);
create index if not exists linkr_action_jobs_terminal_conversation_created_idx
  on public.linkr_action_jobs (terminal_conversation_id, created_at desc);
create unique index if not exists linkr_action_jobs_idempotency_uidx
  on public.linkr_action_jobs (user_id, idempotency_key);

drop trigger if exists linkr_action_jobs_set_updated_at on public.linkr_action_jobs;
create trigger linkr_action_jobs_set_updated_at
  before update on public.linkr_action_jobs
  for each row execute function public.set_updated_at();

grant select on public.linkr_action_jobs to authenticated;
grant all on public.linkr_action_jobs to service_role;
alter table public.linkr_action_jobs enable row level security;

drop policy if exists "users read own linkr action jobs" on public.linkr_action_jobs;
create policy "users read own linkr action jobs"
  on public.linkr_action_jobs for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_action_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  surface_conversation_id text,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete cascade,
  x_thread_id text,
  cron_job_id uuid,
  job_id uuid references public.linkr_action_jobs(id) on delete set null,
  pending_action_id uuid references public.linkr_pending_actions(id) on delete set null,
  receipt_type text not null,
  status text not null,
  summary text not null,
  chain text,
  tx_hash text,
  explorer_url text,
  canonical_record_type text,
  canonical_record_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists linkr_action_receipts_user_created_idx
  on public.linkr_action_receipts (user_id, created_at desc);
create index if not exists linkr_action_receipts_terminal_conversation_created_idx
  on public.linkr_action_receipts (terminal_conversation_id, created_at desc);

grant select on public.linkr_action_receipts to authenticated;
grant all on public.linkr_action_receipts to service_role;
alter table public.linkr_action_receipts enable row level security;

drop policy if exists "users read own linkr action receipts" on public.linkr_action_receipts;
create policy "users read own linkr action receipts"
  on public.linkr_action_receipts for select to authenticated
  using (auth.uid() = user_id);

alter table public.agent_runs
  add column if not exists source_surface text,
  add column if not exists terminal_conversation_id uuid,
  add column if not exists terminal_message_id uuid;

alter table public.transactions
  add column if not exists source_surface text,
  add column if not exists terminal_conversation_id uuid,
  add column if not exists terminal_message_id uuid;

alter table public.coin_launches
  add column if not exists source_surface text,
  add column if not exists terminal_conversation_id uuid,
  add column if not exists terminal_message_id uuid;

alter table public.liquidity_actions
  add column if not exists source_surface text,
  add column if not exists terminal_conversation_id uuid,
  add column if not exists terminal_message_id uuid;

do $$
declare
  table_name text;
  tables text[] := array[
    'linkr_terminal_conversations',
    'linkr_terminal_messages',
    'linkr_agent_runs',
    'linkr_terminal_events',
    'linkr_source_refs',
    'linkr_memory_events',
    'linkr_action_drafts',
    'linkr_pending_actions',
    'linkr_action_jobs',
    'linkr_action_receipts'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array tables loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;
