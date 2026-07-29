create table if not exists public.linkr_app_config_info (
  config_key text primary key,
  config_value text not null,
  description text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.linkr_app_config_info is
  'Small public application config values used by Linkr surfaces.';

alter table public.linkr_app_config_info enable row level security;

drop policy if exists "Public Linkr app config is readable" on public.linkr_app_config_info;

create policy "Public Linkr app config is readable"
  on public.linkr_app_config_info
  for select
  using (is_public = true);

grant select on public.linkr_app_config_info to anon, authenticated;

insert into public.linkr_app_config_info (
  config_key,
  config_value,
  description,
  is_public
) values (
  'linkr_token_ca',
  'soon',
  'Public $LINKR token contract address displayed on /links.',
  true
)
on conflict (config_key) do update
set
  config_value = excluded.config_value,
  description = excluded.description,
  is_public = excluded.is_public,
  updated_at = now();
