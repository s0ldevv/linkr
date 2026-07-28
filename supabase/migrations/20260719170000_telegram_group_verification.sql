-- Telegram group verification challenges for Linkr-gated communities.

create table if not exists public.telegram_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  telegram_user_id text not null references public.telegram_accounts(telegram_user_id) on delete cascade,
  telegram_chat_id text not null references public.telegram_chats(telegram_chat_id) on delete cascade,
  status text not null default 'pending',
  captcha_code text not null,
  slider_target integer not null,
  attempts integer not null default 0,
  source text not null default 'telegram_join',
  invite_link text,
  expires_at timestamptz not null,
  verified_at timestamptz,
  failed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_verification_challenges_status_check
    check (status in ('pending','verified','expired','failed','cancelled')),
  constraint telegram_verification_challenges_slider_target_check
    check (slider_target between 60 and 96),
  constraint telegram_verification_challenges_attempts_check
    check (attempts >= 0)
);

create index if not exists telegram_verification_challenges_user_status_idx
  on public.telegram_verification_challenges (telegram_chat_id, telegram_user_id, status, expires_at desc);

create index if not exists telegram_verification_challenges_status_expires_idx
  on public.telegram_verification_challenges (status, expires_at);

drop trigger if exists telegram_verification_challenges_set_updated_at
  on public.telegram_verification_challenges;
create trigger telegram_verification_challenges_set_updated_at
  before update on public.telegram_verification_challenges
  for each row execute function public.set_updated_at();

grant all on public.telegram_verification_challenges to service_role;
alter table public.telegram_verification_challenges enable row level security;
