-- One-time encrypted handoff replaces Supabase access/refresh tokens in URL fragments.
create table if not exists public.auth_handoff_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_to text not null,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_handoff_codes_expiry_idx
  on public.auth_handoff_codes (expires_at) where used_at is null;

alter table public.auth_handoff_codes enable row level security;
revoke all on public.auth_handoff_codes from public, anon, authenticated;
grant all on public.auth_handoff_codes to service_role;
