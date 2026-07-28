-- Telegram bot transport for Linkr private chat and X-linked wallet actions.

create table if not exists public.telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  username text,
  first_name text,
  last_name text,
  language_code text,
  is_bot boolean not null default false,
  linked_at timestamptz,
  unlinked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_accounts_user_idx
  on public.telegram_accounts (user_id)
  where user_id is not null;
create index if not exists telegram_accounts_username_idx
  on public.telegram_accounts (lower(username))
  where username is not null;

drop trigger if exists telegram_accounts_set_updated_at on public.telegram_accounts;
create trigger telegram_accounts_set_updated_at
  before update on public.telegram_accounts
  for each row execute function public.set_updated_at();

grant select on public.telegram_accounts to authenticated;
grant all on public.telegram_accounts to service_role;
alter table public.telegram_accounts enable row level security;

drop policy if exists "users read own telegram account links" on public.telegram_accounts;
create policy "users read own telegram account links"
  on public.telegram_accounts for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.telegram_chats (
  telegram_chat_id text primary key,
  type text not null,
  title text,
  username text,
  first_name text,
  last_name text,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_chats_type_check
    check (type in ('private','group','supergroup','channel','unknown'))
);

create index if not exists telegram_chats_type_updated_idx
  on public.telegram_chats (type, updated_at desc);

drop trigger if exists telegram_chats_set_updated_at on public.telegram_chats;
create trigger telegram_chats_set_updated_at
  before update on public.telegram_chats
  for each row execute function public.set_updated_at();

grant all on public.telegram_chats to service_role;
alter table public.telegram_chats enable row level security;

create table if not exists public.telegram_conversations (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null references public.telegram_chats(telegram_chat_id) on delete cascade,
  telegram_user_id text not null references public.telegram_accounts(telegram_user_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_thread_id text not null default '',
  chat_type text not null,
  terminal_conversation_id uuid not null references public.linkr_terminal_conversations(id) on delete cascade,
  surface_conversation_id text not null,
  last_telegram_message_id text,
  last_assistant_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_user_id, message_thread_id)
);

create index if not exists telegram_conversations_user_updated_idx
  on public.telegram_conversations (user_id, updated_at desc);
create index if not exists telegram_conversations_terminal_idx
  on public.telegram_conversations (terminal_conversation_id);
create unique index if not exists telegram_conversations_surface_uidx
  on public.telegram_conversations (user_id, surface_conversation_id);

drop trigger if exists telegram_conversations_set_updated_at on public.telegram_conversations;
create trigger telegram_conversations_set_updated_at
  before update on public.telegram_conversations
  for each row execute function public.set_updated_at();

grant select on public.telegram_conversations to authenticated;
grant all on public.telegram_conversations to service_role;
alter table public.telegram_conversations enable row level security;

drop policy if exists "users read own telegram conversations" on public.telegram_conversations;
create policy "users read own telegram conversations"
  on public.telegram_conversations for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.telegram_updates (
  update_id text primary key,
  telegram_user_id text,
  telegram_chat_id text,
  status text not null default 'processing',
  payload jsonb not null,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_updates_status_check
    check (status in ('processing','processed','ignored','failed'))
);

create index if not exists telegram_updates_status_created_idx
  on public.telegram_updates (status, created_at desc);
create index if not exists telegram_updates_chat_created_idx
  on public.telegram_updates (telegram_chat_id, created_at desc);

drop trigger if exists telegram_updates_set_updated_at on public.telegram_updates;
create trigger telegram_updates_set_updated_at
  before update on public.telegram_updates
  for each row execute function public.set_updated_at();

grant all on public.telegram_updates to service_role;
alter table public.telegram_updates enable row level security;

create table if not exists public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  telegram_user_id text not null references public.telegram_accounts(telegram_user_id) on delete cascade,
  telegram_chat_id text not null references public.telegram_chats(telegram_chat_id) on delete cascade,
  status text not null default 'pending',
  user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_link_tokens_status_check
    check (status in ('pending','used','expired','cancelled'))
);

create index if not exists telegram_link_tokens_user_status_idx
  on public.telegram_link_tokens (telegram_user_id, status, expires_at desc);
create index if not exists telegram_link_tokens_auth_user_idx
  on public.telegram_link_tokens (user_id)
  where user_id is not null;

drop trigger if exists telegram_link_tokens_set_updated_at on public.telegram_link_tokens;
create trigger telegram_link_tokens_set_updated_at
  before update on public.telegram_link_tokens
  for each row execute function public.set_updated_at();

grant all on public.telegram_link_tokens to service_role;
alter table public.telegram_link_tokens enable row level security;
