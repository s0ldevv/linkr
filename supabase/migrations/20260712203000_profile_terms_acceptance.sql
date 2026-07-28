alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_accepted_version text;

create index if not exists profiles_terms_accepted_idx
  on public.profiles (terms_accepted_at)
  where terms_accepted_at is not null;
