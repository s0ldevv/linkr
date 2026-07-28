alter table public.profiles
  add column if not exists dashboard_theme text not null default 'light';

alter table public.profiles
  drop constraint if exists profiles_dashboard_theme_check;

alter table public.profiles
  add constraint profiles_dashboard_theme_check
  check (dashboard_theme in ('light', 'dark'));
