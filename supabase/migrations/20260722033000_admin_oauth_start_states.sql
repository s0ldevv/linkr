-- One-time opaque authorization for the admin X OAuth start URL.
create table if not exists public.admin_oauth_start_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_oauth_start_states_expiry_idx
  on public.admin_oauth_start_states (expires_at) where used_at is null;

alter table public.admin_oauth_start_states enable row level security;
revoke all on public.admin_oauth_start_states from public, anon, authenticated;
grant all on public.admin_oauth_start_states to service_role;
