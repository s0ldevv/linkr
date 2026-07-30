-- DB-backed X OAuth tokens for the Linkr bot account.
-- Token values are encrypted by Edge Functions before being stored here.

create table if not exists public.x_bot_tokens (
  id uuid primary key default gen_random_uuid(),
  account_key text not null unique default 'linkrbot',
  bot_handle text not null default 'linkrbot',
  x_user_id text,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_auth_tag text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_auth_tag text not null,
  token_type text not null default 'bearer',
  scope text not null,
  expires_at timestamptz not null,
  is_active boolean not null default true,
  refresh_lock_owner text,
  refresh_lock_until timestamptz,
  last_refreshed_at timestamptz,
  last_refresh_attempt_at timestamptz,
  last_refresh_status text check (last_refresh_status in ('ok', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists x_bot_tokens_active_idx
  on public.x_bot_tokens (account_key, is_active, expires_at desc);

create index if not exists x_bot_tokens_refresh_lock_idx
  on public.x_bot_tokens (refresh_lock_until)
  where refresh_lock_until is not null;

grant all on public.x_bot_tokens to service_role;
alter table public.x_bot_tokens enable row level security;

drop trigger if exists x_bot_tokens_updated_at on public.x_bot_tokens;
create trigger x_bot_tokens_updated_at
  before update on public.x_bot_tokens
  for each row execute function public.set_updated_at();

create table if not exists public.x_bot_token_events (
  id bigserial primary key,
  account_key text not null default 'linkrbot',
  event_type text not null,
  status text not null,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists x_bot_token_events_created_idx
  on public.x_bot_token_events (account_key, created_at desc);

grant all on public.x_bot_token_events to service_role;
alter table public.x_bot_token_events enable row level security;

create or replace function public.claim_x_bot_token_refresh_lock(
  p_account_key text,
  p_owner text,
  p_lock_until timestamptz
)
returns public.x_bot_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.x_bot_tokens;
begin
  update public.x_bot_tokens
  set
    refresh_lock_owner = p_owner,
    refresh_lock_until = p_lock_until,
    last_refresh_attempt_at = now(),
    last_error = null
  where account_key = p_account_key
    and is_active = true
    and (
      refresh_lock_until is null
      or refresh_lock_until < now()
      or refresh_lock_owner = p_owner
    )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.claim_x_bot_token_refresh_lock(text, text, timestamptz)
  to service_role;

create or replace function public.release_x_bot_token_refresh_lock(
  p_token_id uuid,
  p_owner text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.x_bot_tokens
  set
    refresh_lock_owner = null,
    refresh_lock_until = null
  where id = p_token_id
    and refresh_lock_owner = p_owner;
end;
$$;

grant execute on function public.release_x_bot_token_refresh_lock(uuid, text)
  to service_role;
