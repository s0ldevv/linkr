-- Bind every private-key export challenge to the freshly authenticated
-- Supabase session that created it. Additive and ignored by older code.
alter table public.wallet_export_challenges
  add column if not exists session_hash text;

create index if not exists wallet_export_challenges_session_pending_idx
  on public.wallet_export_challenges (user_id, wallet_id, session_hash, expires_at)
  where status = 'pending';

comment on column public.wallet_export_challenges.session_hash is
  'SHA-256 of the Supabase JWT session_id; never stores the session identifier itself.';
