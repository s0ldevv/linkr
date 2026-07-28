-- The token refresh RPCs are SECURITY DEFINER functions. PostgreSQL grants
-- EXECUTE to PUBLIC on new functions unless it is explicitly revoked, so a
-- service_role grant alone does not make these functions service-only.
--
-- Keep this migration metadata-only: no rows are read or rewritten and the
-- function signatures/bodies remain unchanged for active Edge Functions.

revoke all on function public.claim_x_bot_token_refresh_lock(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_x_bot_token_refresh_lock(text, text, timestamptz)
  to service_role;

revoke all on function public.release_x_bot_token_refresh_lock(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_x_bot_token_refresh_lock(uuid, text)
  to service_role;

-- These tables are already protected by RLS with no client policies. Make the
-- intended service-only boundary explicit as defense in depth against future
-- policy or default-privilege changes.
revoke all on table public.x_bot_tokens
  from public, anon, authenticated;
grant all on table public.x_bot_tokens
  to service_role;

revoke all on table public.x_bot_token_events
  from public, anon, authenticated;
grant all on table public.x_bot_token_events
  to service_role;

revoke all on sequence public.x_bot_token_events_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.x_bot_token_events_id_seq
  to service_role;
