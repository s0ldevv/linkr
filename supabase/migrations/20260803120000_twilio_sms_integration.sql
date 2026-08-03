-- Durable, private Twilio SMS/MMS transport for Linkr.

create table if not exists public.sms_accounts (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  phone_hash text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  linked_at timestamptz,
  unlinked_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  opted_out_at timestamptz,
  opt_in_status text not null default 'implicit_inbound',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_accounts_opt_in_status_check
    check (opt_in_status in ('implicit_inbound','linked','opted_out','blocked'))
);

create index if not exists sms_accounts_user_idx on public.sms_accounts (user_id)
  where user_id is not null;
create index if not exists sms_accounts_phone_hash_idx on public.sms_accounts (phone_hash);
create index if not exists sms_accounts_last_inbound_idx on public.sms_accounts (last_inbound_at desc);
drop trigger if exists sms_accounts_set_updated_at on public.sms_accounts;
create trigger sms_accounts_set_updated_at before update on public.sms_accounts
  for each row execute function public.set_updated_at();
grant select on public.sms_accounts to authenticated;
grant all on public.sms_accounts to service_role;
alter table public.sms_accounts enable row level security;
drop policy if exists "users read own sms account links" on public.sms_accounts;
create policy "users read own sms account links" on public.sms_accounts
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.sms_numbers (
  id uuid primary key default gen_random_uuid(),
  twilio_account_sid text not null,
  messaging_service_sid text,
  phone_e164 text,
  phone_hash text,
  label text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_numbers_destination_check
    check (messaging_service_sid is not null or phone_e164 is not null)
);
create unique index if not exists sms_numbers_service_uidx on public.sms_numbers (messaging_service_sid)
  where messaging_service_sid is not null;
create unique index if not exists sms_numbers_phone_uidx on public.sms_numbers (phone_hash)
  where phone_hash is not null;
drop trigger if exists sms_numbers_set_updated_at on public.sms_numbers;
create trigger sms_numbers_set_updated_at before update on public.sms_numbers
  for each row execute function public.set_updated_at();
grant all on public.sms_numbers to service_role;
alter table public.sms_numbers enable row level security;

create table if not exists public.sms_conversations (
  id uuid primary key default gen_random_uuid(),
  from_phone_hash text not null,
  from_phone_e164 text not null,
  to_phone_hash text,
  to_phone_e164 text,
  messaging_service_sid text,
  user_id uuid not null references auth.users(id) on delete cascade,
  terminal_conversation_id uuid not null references public.linkr_terminal_conversations(id) on delete cascade,
  surface_conversation_id text not null,
  last_inbound_message_sid text,
  last_outbound_message_sid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_conversations_destination_check
    check (messaging_service_sid is not null or to_phone_hash is not null),
  unique (user_id, surface_conversation_id)
);
create unique index if not exists sms_conversations_provider_uidx on public.sms_conversations
  (from_phone_hash, coalesce(messaging_service_sid, to_phone_hash));
create index if not exists sms_conversations_user_updated_idx on public.sms_conversations (user_id, updated_at desc);
create index if not exists sms_conversations_terminal_idx on public.sms_conversations (terminal_conversation_id);
drop trigger if exists sms_conversations_set_updated_at on public.sms_conversations;
create trigger sms_conversations_set_updated_at before update on public.sms_conversations
  for each row execute function public.set_updated_at();
grant select on public.sms_conversations to authenticated;
grant all on public.sms_conversations to service_role;
alter table public.sms_conversations enable row level security;
drop policy if exists "users read own sms conversations" on public.sms_conversations;
create policy "users read own sms conversations" on public.sms_conversations
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.sms_inbound_messages (
  message_sid text primary key,
  account_sid text not null,
  messaging_service_sid text,
  from_phone_e164 text not null,
  from_phone_hash text not null,
  to_phone_e164 text,
  to_phone_hash text,
  body text not null default '',
  num_media integer not null default 0 check (num_media >= 0 and num_media <= 20),
  media jsonb not null default '[]'::jsonb,
  status text not null default 'accepted',
  user_id uuid references auth.users(id) on delete set null,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete set null,
  agent_run_id uuid references public.linkr_agent_runs(id) on delete set null,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_inbound_status_check check
    (status in ('accepted','ignored','queued','processing','processed','failed','dead_letter'))
);
create index if not exists sms_inbound_sender_received_idx on public.sms_inbound_messages (from_phone_hash, received_at desc);
create index if not exists sms_inbound_status_received_idx on public.sms_inbound_messages (status, received_at desc);
create index if not exists sms_inbound_conversation_received_idx on public.sms_inbound_messages (terminal_conversation_id, received_at desc);
drop trigger if exists sms_inbound_messages_set_updated_at on public.sms_inbound_messages;
create trigger sms_inbound_messages_set_updated_at before update on public.sms_inbound_messages
  for each row execute function public.set_updated_at();
grant all on public.sms_inbound_messages to service_role;
alter table public.sms_inbound_messages enable row level security;

create table if not exists public.sms_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  terminal_conversation_id uuid references public.linkr_terminal_conversations(id) on delete set null,
  agent_run_id uuid references public.linkr_agent_runs(id) on delete set null,
  assistant_message_id uuid references public.linkr_terminal_messages(id) on delete set null,
  inbound_message_sid text references public.sms_inbound_messages(message_sid) on delete set null,
  to_phone_e164 text not null,
  to_phone_hash text not null,
  from_phone_e164 text,
  messaging_service_sid text,
  body text not null check (char_length(body) between 1 and 8000),
  media jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  twilio_message_sid text,
  twilio_status text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_outbound_status_check check
    (status in ('pending','sending','sent','delivered','undelivered','failed','ambiguous'))
);
create unique index if not exists sms_outbound_twilio_sid_uidx on public.sms_outbound_messages (twilio_message_sid)
  where twilio_message_sid is not null;
create index if not exists sms_outbound_pending_idx on public.sms_outbound_messages (status, next_attempt_at, created_at);
create index if not exists sms_outbound_conversation_idx on public.sms_outbound_messages (terminal_conversation_id, created_at desc);
drop trigger if exists sms_outbound_messages_set_updated_at on public.sms_outbound_messages;
create trigger sms_outbound_messages_set_updated_at before update on public.sms_outbound_messages
  for each row execute function public.set_updated_at();
grant all on public.sms_outbound_messages to service_role;
alter table public.sms_outbound_messages enable row level security;

create table if not exists public.sms_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  phone_hash text not null,
  phone_e164 text not null,
  status text not null default 'pending',
  user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_link_tokens_status_check check (status in ('pending','used','expired','cancelled'))
);
create index if not exists sms_link_tokens_phone_status_idx on public.sms_link_tokens (phone_hash, status, expires_at desc);
create index if not exists sms_link_tokens_user_idx on public.sms_link_tokens (user_id) where user_id is not null;
drop trigger if exists sms_link_tokens_set_updated_at on public.sms_link_tokens;
create trigger sms_link_tokens_set_updated_at before update on public.sms_link_tokens
  for each row execute function public.set_updated_at();
grant all on public.sms_link_tokens to service_role;
alter table public.sms_link_tokens enable row level security;

create table if not exists public.sms_opt_events (
  id uuid primary key default gen_random_uuid(),
  phone_hash text not null,
  from_phone_e164 text,
  event_type text not null check (event_type in ('stop','start','help','link_started','link_completed','unlink')),
  source_message_sid text,
  raw_body text,
  created_at timestamptz not null default now()
);
create index if not exists sms_opt_events_phone_created_idx on public.sms_opt_events (phone_hash, created_at desc);
grant all on public.sms_opt_events to service_role;
alter table public.sms_opt_events enable row level security;
