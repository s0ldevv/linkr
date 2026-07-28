-- Linkr natural conversation agent state, idempotency, and public caches.

alter table public.twitter_replies
  add column if not exists idempotency_key text;

alter table public.pending_actions
  add column if not exists idempotency_key text;

alter table public.agent_runs
  add column if not exists idempotency_key text,
  add column if not exists route_decision jsonb,
  add column if not exists working_frame jsonb,
  add column if not exists reply_plan jsonb,
  add column if not exists route_resources jsonb,
  add column if not exists prompt_slots jsonb,
  add column if not exists tool_results jsonb,
  add column if not exists outcome jsonb;

create unique index if not exists twitter_replies_idempotency_key_uidx
  on public.twitter_replies (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists pending_actions_idempotency_key_uidx
  on public.pending_actions (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists agent_runs_idempotency_key_uidx
  on public.agent_runs (idempotency_key)
  where idempotency_key is not null;

create table if not exists public.linkr_conversation_state (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  participant_twitter_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  active_topic jsonb,
  active_entities jsonb not null default '[]'::jsonb,
  last_route text,
  last_reply_tweet_id text,
  anti_repetition jsonb not null default '{}'::jsonb,
  privacy_label text not null default 'user_private',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, participant_twitter_id)
);

create index if not exists linkr_conversation_state_user_updated_idx
  on public.linkr_conversation_state (user_id, updated_at desc);

grant select on public.linkr_conversation_state to authenticated;
grant all on public.linkr_conversation_state to service_role;

alter table public.linkr_conversation_state enable row level security;

drop policy if exists "users read own linkr conversation state" on public.linkr_conversation_state;
create policy "users read own linkr conversation state"
  on public.linkr_conversation_state for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_action_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text,
  source_tweet_id text,
  draft_key text not null,
  action_type text not null,
  status text not null default 'open',
  required_fields text[] not null default '{}',
  filled_fields jsonb not null default '{}'::jsonb,
  entity_refs jsonb not null default '[]'::jsonb,
  privacy_label text not null default 'user_private',
  idempotency_key text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint linkr_action_drafts_status_check check (
    status in ('open','awaiting_clarification','completed','cancelled','expired','failed')
  )
);

create unique index if not exists linkr_action_drafts_idempotency_key_uidx
  on public.linkr_action_drafts (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists linkr_action_drafts_open_key_uidx
  on public.linkr_action_drafts (user_id, draft_key)
  where status in ('open','awaiting_clarification');

create index if not exists linkr_action_drafts_user_status_idx
  on public.linkr_action_drafts (user_id, status, expires_at);

grant select on public.linkr_action_drafts to authenticated;
grant all on public.linkr_action_drafts to service_role;

alter table public.linkr_action_drafts enable row level security;

drop policy if exists "users read own linkr action drafts" on public.linkr_action_drafts;
create policy "users read own linkr action drafts"
  on public.linkr_action_drafts for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.linkr_post_intelligence (
  id uuid primary key default gen_random_uuid(),
  tweet_id text not null,
  source_hash text not null,
  summary text not null,
  entities jsonb not null default '[]'::jsonb,
  facts jsonb not null default '[]'::jsonb,
  media_summaries jsonb not null default '[]'::jsonb,
  prompt_version text,
  privacy_label text not null default 'public',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  unique (tweet_id, source_hash)
);

create index if not exists linkr_post_intelligence_tweet_idx
  on public.linkr_post_intelligence (tweet_id, created_at desc);

grant select on public.linkr_post_intelligence to authenticated;
grant all on public.linkr_post_intelligence to service_role;

alter table public.linkr_post_intelligence enable row level security;

drop policy if exists "authenticated read public linkr post intelligence" on public.linkr_post_intelligence;
create policy "authenticated read public linkr post intelligence"
  on public.linkr_post_intelligence for select to authenticated
  using (privacy_label = 'public');

create table if not exists public.linkr_tool_result_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  tool text not null,
  input_hash text not null,
  result jsonb not null,
  privacy_label text not null default 'public',
  freshness text not null default 'cached',
  confidence numeric not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists linkr_tool_result_cache_tool_expires_idx
  on public.linkr_tool_result_cache (tool, expires_at);

grant select on public.linkr_tool_result_cache to authenticated;
grant all on public.linkr_tool_result_cache to service_role;

alter table public.linkr_tool_result_cache enable row level security;

drop policy if exists "authenticated read public linkr tool cache" on public.linkr_tool_result_cache;
create policy "authenticated read public linkr tool cache"
  on public.linkr_tool_result_cache for select to authenticated
  using (privacy_label in ('public','external_untrusted','recipient_public'));
