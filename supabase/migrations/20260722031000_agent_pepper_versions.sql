-- Preserve exact legacy verification while allowing independently peppered
-- credentials to be issued and rotated without breaking existing clients.
alter table public.agent_api_keys
  add column if not exists pepper_version text not null default 'legacy';
alter table public.agent_api_keys
  drop constraint if exists agent_api_keys_pepper_version_check;
alter table public.agent_api_keys
  add constraint agent_api_keys_pepper_version_check
  check (pepper_version in ('legacy', 'v2'));

alter table public.agent_onboarding_tokens
  add column if not exists pepper_version text not null default 'legacy';
alter table public.agent_onboarding_tokens
  drop constraint if exists agent_onboarding_tokens_pepper_version_check;
alter table public.agent_onboarding_tokens
  add constraint agent_onboarding_tokens_pepper_version_check
  check (pepper_version in ('legacy', 'v2'));
