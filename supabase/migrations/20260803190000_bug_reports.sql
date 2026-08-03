-- Anonymous product feedback submitted through the public bug-report Edge
-- Function. Browser roles cannot access this table directly; the public
-- function and the admin-only secretpanel function use the service role.

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  severity text not null,
  description text not null,
  steps_to_reproduce text,
  expected_behavior text,
  page_path text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fixed_at timestamptz,
  constraint bug_reports_title_length
    check (char_length(title) between 5 and 140),
  constraint bug_reports_category_allowed
    check (category in ('functionality', 'transaction', 'wallet', 'account', 'interface', 'other')),
  constraint bug_reports_severity_allowed
    check (severity in ('low', 'medium', 'high', 'critical')),
  constraint bug_reports_description_length
    check (char_length(description) between 20 and 4000),
  constraint bug_reports_steps_length
    check (steps_to_reproduce is null or char_length(steps_to_reproduce) <= 4000),
  constraint bug_reports_expected_length
    check (expected_behavior is null or char_length(expected_behavior) <= 2000),
  constraint bug_reports_page_path_length
    check (page_path is null or char_length(page_path) <= 500),
  constraint bug_reports_status_allowed
    check (status in ('open', 'fixed')),
  constraint bug_reports_fixed_state_consistent
    check (
      (status = 'open' and fixed_at is null)
      or (status = 'fixed' and fixed_at is not null)
    )
);

create index if not exists bug_reports_status_created_at_idx
  on public.bug_reports (status, created_at desc);

create index if not exists bug_reports_created_at_idx
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

revoke all on table public.bug_reports from public, anon, authenticated;
grant all on table public.bug_reports to service_role;

comment on table public.bug_reports is
  'Anonymous Linkr bug reports. Intentionally contains no reporter identity or contact fields.';
