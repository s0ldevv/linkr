-- World-class policy controls and scheduler lifecycle hardening.
--
-- Additive and deployment-safe: no production data is dropped. Existing
-- scheduled rows remain valid one-time schedules, and existing admin ban
-- behavior remains unchanged.

create table if not exists public.linkr_admin_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  value_type text not null default 'json',
  description text not null default '',
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  constraint linkr_admin_settings_key_check
    check (key ~ '^[a-z][a-z0-9_]{2,96}$'),
  constraint linkr_admin_settings_value_type_check
    check (value_type in ('json', 'boolean', 'integer', 'decimal', 'text'))
);

create table if not exists public.linkr_admin_setting_audit (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null,
  old_value jsonb,
  new_value jsonb not null,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text,
  request_id text
);

create index if not exists linkr_admin_setting_audit_key_changed_idx
  on public.linkr_admin_setting_audit (setting_key, changed_at desc);

alter table public.linkr_admin_settings enable row level security;
alter table public.linkr_admin_setting_audit enable row level security;
revoke all on public.linkr_admin_settings from public, anon, authenticated;
revoke all on public.linkr_admin_setting_audit from public, anon, authenticated;
grant all on public.linkr_admin_settings to service_role;
grant all on public.linkr_admin_setting_audit to service_role;

insert into public.linkr_admin_settings (key, value, description)
values
  (
    'launch_funding_policy',
    '{"mode":"first_eligible_launch"}'::jsonb,
    'Controls whether Linkr funds no launches, only the first eligible launch, or every eligible launch request.'
  ),
  (
    'x_user_gating_policy',
    '{"min_followers_enabled":false,"min_followers":0,"min_following_enabled":false,"min_following":0,"min_posts_enabled":false,"min_posts":0}'::jsonb,
    'Controls X account follower/following/post-count eligibility thresholds.'
  ),
  (
    'metadata_testing_policy',
    '{"enabled":false,"test_website_url":"https://google.com","test_twitter_url":"https://x.com","test_telegram_url":"https://t.me/"}'::jsonb,
    'Controls explicit token metadata testing overrides. Disabled by default for production metadata.'
  )
on conflict (key) do nothing;

drop trigger if exists linkr_admin_settings_updated_at on public.linkr_admin_settings;
create trigger linkr_admin_settings_updated_at
  before update on public.linkr_admin_settings
  for each row execute function public.set_updated_at();

create or replace function public.linkr_validate_admin_setting(
  p_key text,
  p_value jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_mode text;
  v_result jsonb;
  v_enabled boolean;
  v_min_followers integer;
  v_min_following integer;
  v_min_posts integer;
  v_website text;
  v_twitter text;
  v_telegram text;
begin
  if p_key = 'launch_funding_policy' then
    v_mode := coalesce(nullif(p_value->>'mode', ''), 'first_eligible_launch');
    if v_mode not in ('funding_disabled', 'first_eligible_launch', 'fund_every_eligible_launch') then
      raise exception 'invalid_launch_funding_mode';
    end if;
    return jsonb_build_object('mode', v_mode);
  end if;

  if p_key = 'x_user_gating_policy' then
    v_min_followers := greatest(coalesce((p_value->>'min_followers')::integer, 0), 0);
    v_min_following := greatest(coalesce((p_value->>'min_following')::integer, 0), 0);
    v_min_posts := greatest(coalesce((p_value->>'min_posts')::integer, 0), 0);
    if v_min_followers > 1000000000
      or v_min_following > 1000000000
      or v_min_posts > 1000000000 then
      raise exception 'x_gating_threshold_out_of_range';
    end if;
    return jsonb_build_object(
      'min_followers_enabled', coalesce((p_value->>'min_followers_enabled')::boolean, false),
      'min_followers', v_min_followers,
      'min_following_enabled', coalesce((p_value->>'min_following_enabled')::boolean, false),
      'min_following', v_min_following,
      'min_posts_enabled', coalesce((p_value->>'min_posts_enabled')::boolean, false),
      'min_posts', v_min_posts
    );
  end if;

  if p_key = 'metadata_testing_policy' then
    v_enabled := coalesce((p_value->>'enabled')::boolean, false);
    v_website := nullif(btrim(coalesce(p_value->>'test_website_url', '')), '');
    v_twitter := nullif(btrim(coalesce(p_value->>'test_twitter_url', '')), '');
    v_telegram := nullif(btrim(coalesce(p_value->>'test_telegram_url', '')), '');
    if v_enabled then
      if v_website is null or v_website !~* '^https://[^[:space:]]+$' then
        raise exception 'invalid_metadata_test_website_url';
      end if;
      if v_twitter is not null and v_twitter !~* '^https://(x\.com|twitter\.com)(/.*)?$' then
        raise exception 'invalid_metadata_test_twitter_url';
      end if;
      if v_telegram is not null and v_telegram !~* '^https://(t\.me|telegram\.me)(/.*)?$' then
        raise exception 'invalid_metadata_test_telegram_url';
      end if;
    end if;
    v_result := jsonb_build_object(
      'enabled', v_enabled,
      'test_website_url', coalesce(v_website, 'https://google.com'),
      'test_twitter_url', coalesce(v_twitter, 'https://x.com'),
      'test_telegram_url', coalesce(v_telegram, 'https://t.me/')
    );
    return v_result;
  end if;

  raise exception 'unknown_admin_setting:%', p_key;
end;
$$;

create or replace function public.get_linkr_admin_settings_v1()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value order by key), '{}'::jsonb)
  from public.linkr_admin_settings;
$$;

create or replace function public.get_linkr_admin_setting_v1(p_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select value
  from public.linkr_admin_settings
  where key = p_key;
$$;

create or replace function public.set_linkr_admin_setting_v1(
  p_key text,
  p_value jsonb,
  p_admin_user_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  v_new := public.linkr_validate_admin_setting(p_key, coalesce(p_value, '{}'::jsonb));
  select value into v_old
  from public.linkr_admin_settings
  where key = p_key
  for update;

  insert into public.linkr_admin_settings (
    key, value, description, updated_by_user_id
  ) values (
    p_key,
    v_new,
    case p_key
      when 'launch_funding_policy' then 'Controls launch funding mode.'
      when 'x_user_gating_policy' then 'Controls X account eligibility thresholds.'
      when 'metadata_testing_policy' then 'Controls explicit testing metadata overrides.'
      else 'Administrative setting.'
    end,
    p_admin_user_id
  )
  on conflict (key) do update
    set value = excluded.value,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now();

  if v_old is distinct from v_new then
    insert into public.linkr_admin_setting_audit (
      setting_key,
      old_value,
      new_value,
      changed_by_user_id,
      reason,
      request_id
    ) values (
      p_key,
      v_old,
      v_new,
      p_admin_user_id,
      nullif(left(coalesce(p_reason, ''), 500), ''),
      nullif(left(coalesce(p_request_id, ''), 200), '')
    );
  end if;

  return v_new;
end;
$$;

revoke all on function public.linkr_validate_admin_setting(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_linkr_admin_settings_v1()
  from public, anon, authenticated;
revoke all on function public.get_linkr_admin_setting_v1(text)
  from public, anon, authenticated;
revoke all on function public.set_linkr_admin_setting_v1(text, jsonb, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.linkr_validate_admin_setting(text, jsonb)
  to service_role, postgres;
grant execute on function public.get_linkr_admin_settings_v1()
  to service_role, postgres;
grant execute on function public.get_linkr_admin_setting_v1(text)
  to service_role, postgres;
grant execute on function public.set_linkr_admin_setting_v1(text, jsonb, uuid, text, text)
  to service_role, postgres;

create table if not exists public.linkr_x_eligibility_snapshots (
  x_user_id text primary key,
  username text,
  public_metrics jsonb not null default '{}'::jsonb,
  policy_snapshot jsonb not null default '{}'::jsonb,
  eligible boolean not null,
  reason text,
  source text not null default 'x_ingress',
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);

create index if not exists linkr_x_eligibility_expires_idx
  on public.linkr_x_eligibility_snapshots (expires_at);

alter table public.linkr_x_eligibility_snapshots enable row level security;
revoke all on public.linkr_x_eligibility_snapshots from public, anon, authenticated;
grant all on public.linkr_x_eligibility_snapshots to service_role;

create or replace function public.evaluate_linkr_x_user_gating_v1(
  p_x_user_id text,
  p_username text,
  p_public_metrics jsonb default '{}'::jsonb,
  p_source text default 'x_ingress'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy jsonb;
  v_followers integer;
  v_following integer;
  v_posts integer;
  v_reason text := null;
  v_eligible boolean := true;
  v_snapshot jsonb;
begin
  if nullif(btrim(coalesce(p_x_user_id, '')), '') is null then
    raise exception 'x_user_id_required';
  end if;

  select value into v_policy
  from public.linkr_admin_settings
  where key = 'x_user_gating_policy';
  v_policy := coalesce(
    v_policy,
    '{"min_followers_enabled":false,"min_followers":0,"min_following_enabled":false,"min_following":0,"min_posts_enabled":false,"min_posts":0}'::jsonb
  );

  v_followers := greatest(coalesce((p_public_metrics->>'followers_count')::integer, 0), 0);
  v_following := greatest(coalesce((p_public_metrics->>'following_count')::integer, 0), 0);
  v_posts := greatest(coalesce((p_public_metrics->>'tweet_count')::integer, 0), 0);

  if coalesce((v_policy->>'min_followers_enabled')::boolean, false)
    and v_followers < greatest(coalesce((v_policy->>'min_followers')::integer, 0), 0) then
    v_eligible := false;
    v_reason := 'below_min_followers';
  elsif coalesce((v_policy->>'min_following_enabled')::boolean, false)
    and v_following < greatest(coalesce((v_policy->>'min_following')::integer, 0), 0) then
    v_eligible := false;
    v_reason := 'below_min_following';
  elsif coalesce((v_policy->>'min_posts_enabled')::boolean, false)
    and v_posts < greatest(coalesce((v_policy->>'min_posts')::integer, 0), 0) then
    v_eligible := false;
    v_reason := 'below_min_posts';
  end if;

  v_snapshot := jsonb_build_object(
    'eligible', v_eligible,
    'reason', v_reason,
    'x_user_id', p_x_user_id,
    'username', nullif(btrim(coalesce(p_username, '')), ''),
    'public_metrics', coalesce(p_public_metrics, '{}'::jsonb),
    'policy', v_policy,
    'checked_at', now()
  );

  insert into public.linkr_x_eligibility_snapshots (
    x_user_id,
    username,
    public_metrics,
    policy_snapshot,
    eligible,
    reason,
    source,
    checked_at,
    expires_at
  ) values (
    p_x_user_id,
    nullif(btrim(coalesce(p_username, '')), ''),
    coalesce(p_public_metrics, '{}'::jsonb),
    v_policy,
    v_eligible,
    v_reason,
    left(coalesce(p_source, 'x_ingress'), 80),
    now(),
    now() + interval '30 minutes'
  )
  on conflict (x_user_id) do update
    set username = excluded.username,
        public_metrics = excluded.public_metrics,
        policy_snapshot = excluded.policy_snapshot,
        eligible = excluded.eligible,
        reason = excluded.reason,
        source = excluded.source,
        checked_at = excluded.checked_at,
        expires_at = excluded.expires_at;

  return v_snapshot;
end;
$$;

revoke all on function public.evaluate_linkr_x_user_gating_v1(text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.evaluate_linkr_x_user_gating_v1(text, text, jsonb, text)
  to service_role, postgres;

alter table public.scheduled_actions
  add column if not exists schedule_kind text not null default 'one_time',
  add column if not exists priority integer not null default 50,
  add column if not exists interval_seconds integer,
  add column if not exists recurrence_timezone text not null default 'UTC',
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists max_occurrences integer,
  add column if not exists occurrence_count integer not null default 0,
  add column if not exists successful_occurrence_count integer not null default 0,
  add column if not exists failed_occurrence_count integer not null default 0,
  add column if not exists last_execution_at timestamptz,
  add column if not exists active_occurrence_id uuid,
  add column if not exists active_occurrence_key text,
  add column if not exists paused_at timestamptz,
  add column if not exists resumed_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists last_due_at timestamptz,
  add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null;

update public.scheduled_actions
set schedule_kind = 'one_time'
where schedule_kind is null;

alter table public.scheduled_actions
  drop constraint if exists scheduled_actions_status_check;
alter table public.scheduled_actions
  add constraint scheduled_actions_status_check
    check (status in ('pending', 'processing', 'paused', 'executed', 'failed', 'cancelled', 'expired')) not valid;
alter table public.scheduled_actions validate constraint scheduled_actions_status_check;

alter table public.scheduled_actions
  drop constraint if exists scheduled_actions_schedule_kind_check;
alter table public.scheduled_actions
  add constraint scheduled_actions_schedule_kind_check
    check (schedule_kind in ('one_time', 'interval', 'daily', 'weekly', 'condition')) not valid;
alter table public.scheduled_actions validate constraint scheduled_actions_schedule_kind_check;

alter table public.scheduled_actions
  drop constraint if exists scheduled_actions_interval_bounds_check;
alter table public.scheduled_actions
  add constraint scheduled_actions_interval_bounds_check
    check (
      interval_seconds is null
      or (interval_seconds between 60 and 31536000)
    ) not valid;
alter table public.scheduled_actions validate constraint scheduled_actions_interval_bounds_check;

create index if not exists scheduled_actions_user_active_idx
  on public.scheduled_actions (user_id, status, scheduled_for, next_check_at)
  where status in ('pending', 'processing', 'paused');

create index if not exists scheduled_actions_recurring_due_idx
  on public.scheduled_actions (scheduled_for, next_check_at, priority)
  where status = 'pending' and schedule_kind <> 'one_time';

create index if not exists scheduled_actions_due_priority_idx
  on public.scheduled_actions (status, priority desc, (coalesce(scheduled_for, next_check_at)), created_at)
  where status in ('pending', 'processing');

create table if not exists public.linkr_schedule_occurrences (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.scheduled_actions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_key text not null,
  due_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'running',
  attempt_count integer not null default 0,
  worker_id text,
  transaction_id uuid references public.transactions(id) on delete set null,
  transaction_hash text,
  transaction_signature text,
  reply_status text,
  reply_id uuid,
  observed_value_usd numeric,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_schedule_occurrences_status_check
    check (status in ('running', 'retrying', 'succeeded', 'failed', 'cancelled', 'skipped'))
);

create unique index if not exists linkr_schedule_occurrences_schedule_key_uidx
  on public.linkr_schedule_occurrences (schedule_id, occurrence_key);

create index if not exists linkr_schedule_occurrences_user_created_idx
  on public.linkr_schedule_occurrences (user_id, created_at desc);

create index if not exists linkr_schedule_occurrences_schedule_created_idx
  on public.linkr_schedule_occurrences (schedule_id, created_at desc);

create index if not exists linkr_schedule_occurrences_status_due_idx
  on public.linkr_schedule_occurrences (status, due_at);

drop trigger if exists linkr_schedule_occurrences_updated_at on public.linkr_schedule_occurrences;
create trigger linkr_schedule_occurrences_updated_at
  before update on public.linkr_schedule_occurrences
  for each row execute function public.set_updated_at();

grant select on public.linkr_schedule_occurrences to authenticated;
grant all on public.linkr_schedule_occurrences to service_role;
alter table public.linkr_schedule_occurrences enable row level security;

drop policy if exists "users read own schedule occurrences" on public.linkr_schedule_occurrences;
create policy "users read own schedule occurrences"
  on public.linkr_schedule_occurrences for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.begin_linkr_schedule_occurrence_v1(
  p_schedule_id uuid,
  p_occurrence_key text,
  p_due_at timestamptz,
  p_worker_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.scheduled_actions%rowtype;
  v_occ public.linkr_schedule_occurrences%rowtype;
begin
  if nullif(btrim(coalesce(p_occurrence_key, '')), '') is null then
    raise exception 'occurrence_key_required';
  end if;

  select *
  into v_schedule
  from public.scheduled_actions
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'schedule_not_found';
  end if;

  if v_schedule.status in ('cancelled', 'paused', 'expired') then
    return jsonb_build_object(
      'started', false,
      'status', v_schedule.status,
      'schedule_id', p_schedule_id
    );
  end if;

  insert into public.linkr_schedule_occurrences (
    schedule_id,
    user_id,
    occurrence_key,
    due_at,
    started_at,
    status,
    attempt_count,
    worker_id
  ) values (
    p_schedule_id,
    v_schedule.user_id,
    left(p_occurrence_key, 200),
    coalesce(p_due_at, now()),
    now(),
    'running',
    1,
    nullif(left(coalesce(p_worker_id, ''), 120), '')
  )
  on conflict (schedule_id, occurrence_key) do update
    set status = case
          when public.linkr_schedule_occurrences.status in ('succeeded', 'cancelled', 'skipped')
            then public.linkr_schedule_occurrences.status
          else 'running'
        end,
        started_at = case
          when public.linkr_schedule_occurrences.status in ('succeeded', 'cancelled', 'skipped')
            then public.linkr_schedule_occurrences.started_at
          else now()
        end,
        attempt_count = case
          when public.linkr_schedule_occurrences.status in ('succeeded', 'cancelled', 'skipped')
            then public.linkr_schedule_occurrences.attempt_count
          else public.linkr_schedule_occurrences.attempt_count + 1
        end,
        worker_id = coalesce(nullif(left(coalesce(p_worker_id, ''), 120), ''), public.linkr_schedule_occurrences.worker_id),
        updated_at = now()
  returning * into v_occ;

  if v_occ.status in ('succeeded', 'cancelled', 'skipped') then
    return jsonb_build_object(
      'started', false,
      'status', v_occ.status,
      'occurrence', to_jsonb(v_occ)
    );
  end if;

  update public.scheduled_actions
  set active_occurrence_id = v_occ.id,
      active_occurrence_key = v_occ.occurrence_key,
      last_due_at = coalesce(p_due_at, now()),
      updated_at = now()
  where id = p_schedule_id;

  return jsonb_build_object(
    'started', true,
    'status', v_occ.status,
    'occurrence', to_jsonb(v_occ)
  );
end;
$$;

create or replace function public.complete_linkr_schedule_occurrence_v1(
  p_schedule_id uuid,
  p_occurrence_id uuid,
  p_status text,
  p_transaction_id uuid default null,
  p_transaction_hash text default null,
  p_transaction_signature text default null,
  p_observed_value_usd numeric default null,
  p_result jsonb default '{}'::jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_occ public.linkr_schedule_occurrences%rowtype;
  v_previous_status text;
begin
  v_status := lower(coalesce(p_status, ''));
  if v_status not in ('retrying', 'succeeded', 'failed', 'cancelled', 'skipped') then
    raise exception 'invalid_occurrence_status';
  end if;

  select *
  into v_occ
  from public.linkr_schedule_occurrences
  where id = p_occurrence_id
    and schedule_id = p_schedule_id
  for update;

  if not found then
    raise exception 'schedule_occurrence_not_found';
  end if;

  if v_occ.status in ('succeeded', 'failed', 'cancelled', 'skipped') then
    return to_jsonb(v_occ);
  end if;

  v_previous_status := v_occ.status;

  update public.linkr_schedule_occurrences
  set status = v_status,
      completed_at = case when v_status = 'retrying' then null else now() end,
      transaction_id = p_transaction_id,
      transaction_hash = nullif(p_transaction_hash, ''),
      transaction_signature = nullif(p_transaction_signature, ''),
      observed_value_usd = p_observed_value_usd,
      result = coalesce(p_result, '{}'::jsonb),
      error = nullif(left(coalesce(p_error, ''), 500), ''),
      updated_at = now()
  where id = p_occurrence_id
    and schedule_id = p_schedule_id
  returning * into v_occ;

  update public.scheduled_actions
  set active_occurrence_id = case when v_status = 'retrying' then active_occurrence_id else null end,
      active_occurrence_key = case when v_status = 'retrying' then active_occurrence_key else null end,
      occurrence_count = occurrence_count + case when v_previous_status not in ('succeeded', 'failed', 'cancelled', 'skipped') and v_status in ('succeeded', 'failed', 'cancelled', 'skipped') then 1 else 0 end,
      successful_occurrence_count = successful_occurrence_count + case when v_previous_status not in ('succeeded', 'failed', 'cancelled', 'skipped') and v_status = 'succeeded' then 1 else 0 end,
      failed_occurrence_count = failed_occurrence_count + case when v_previous_status not in ('succeeded', 'failed', 'cancelled', 'skipped') and v_status = 'failed' then 1 else 0 end,
      last_execution_at = case when v_status = 'succeeded' then now() else last_execution_at end,
      updated_at = now()
  where id = p_schedule_id;

  return to_jsonb(v_occ);
end;
$$;

create or replace function public.mutate_linkr_schedule_v1(
  p_user_id uuid,
  p_schedule_id uuid,
  p_action text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.scheduled_actions%rowtype;
  v_action text := lower(coalesce(p_action, ''));
  v_interval integer;
  v_scheduled_for timestamptz;
  v_next_check_at timestamptz;
begin
  select *
  into v_schedule
  from public.scheduled_actions
  where id = p_schedule_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'schedule_not_found';
  end if;

  v_schedule := null;

  if v_action = 'pause' then
    update public.scheduled_actions
    set status = 'paused',
        paused_at = now(),
        processing_started_at = null,
        worker_id = null,
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status in ('pending', 'processing')
    returning * into v_schedule;
  elsif v_action = 'resume' then
    update public.scheduled_actions
    set status = 'pending',
        resumed_at = now(),
        paused_at = null,
        processing_started_at = null,
        worker_id = null,
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status = 'paused'
    returning * into v_schedule;
  elsif v_action = 'cancel' then
    update public.scheduled_actions
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = nullif(left(coalesce(p_patch->>'reason', 'user_cancelled'), 240), ''),
        processing_started_at = null,
        worker_id = null,
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status in ('pending', 'processing', 'paused')
    returning * into v_schedule;

    update public.linkr_schedule_occurrences
    set status = 'cancelled',
        completed_at = now(),
        error = coalesce(error, 'schedule_cancelled'),
        updated_at = now()
    where schedule_id = p_schedule_id
      and status in ('running', 'retrying');
  elsif v_action = 'update' then
    v_interval := nullif(p_patch->>'interval_seconds', '')::integer;
    if v_interval is not null and (v_interval < 60 or v_interval > 31536000) then
      raise exception 'invalid_interval_seconds';
    end if;
    v_scheduled_for := nullif(p_patch->>'scheduled_for', '')::timestamptz;
    v_next_check_at := nullif(p_patch->>'next_check_at', '')::timestamptz;
    update public.scheduled_actions
    set interval_seconds = coalesce(v_interval, interval_seconds),
        scheduled_for = coalesce(v_scheduled_for, scheduled_for),
        next_check_at = coalesce(v_next_check_at, next_check_at),
        ends_at = coalesce(nullif(p_patch->>'ends_at', '')::timestamptz, ends_at),
        max_occurrences = coalesce(nullif(p_patch->>'max_occurrences', '')::integer, max_occurrences),
        updated_by_user_id = p_user_id,
        updated_at = now()
    where id = p_schedule_id
      and status in ('pending', 'paused')
    returning * into v_schedule;
  else
    raise exception 'invalid_schedule_mutation';
  end if;

  if v_schedule.id is null then
    raise exception 'schedule_not_mutable';
  end if;

  return to_jsonb(v_schedule);
end;
$$;

revoke all on function public.begin_linkr_schedule_occurrence_v1(uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.complete_linkr_schedule_occurrence_v1(uuid, uuid, text, uuid, text, text, numeric, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.mutate_linkr_schedule_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.begin_linkr_schedule_occurrence_v1(uuid, text, timestamptz, text)
  to service_role, postgres;
grant execute on function public.complete_linkr_schedule_occurrence_v1(uuid, uuid, text, uuid, text, text, numeric, jsonb, text)
  to service_role, postgres;
grant execute on function public.mutate_linkr_schedule_v1(uuid, uuid, text, jsonb)
  to service_role, postgres;

create or replace function public.claim_ready_scheduled_actions(
  p_worker_id text,
  p_limit integer default 10,
  p_stale_before timestamptz default now() - interval '10 minutes'
)
returns setof public.scheduled_actions
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('statement_timeout', '5000', true);
  perform set_config('lock_timeout', '500', true);

  return query
  with picked as (
    select id
    from public.scheduled_actions
    where (
        status = 'pending'
        and trigger_type = 'time'
        and scheduled_for <= now()
      )
      or (
        status = 'pending'
        and trigger_type = 'market_cap'
        and coalesce(next_check_at, now()) <= now()
      )
      or (
        status = 'processing'
        and processing_started_at <= p_stale_before
      )
    order by
      case when status = 'processing' then 0 else 1 end,
      priority desc,
      coalesce(scheduled_for, next_check_at, created_at),
      created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.scheduled_actions s
  set
    status = 'processing',
    processing_started_at = now(),
    worker_id = p_worker_id,
    updated_at = now()
  from picked
  where s.id = picked.id
  returning s.*;
end;
$$;

revoke all on function public.claim_ready_scheduled_actions(text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_ready_scheduled_actions(text, integer, timestamptz)
  to service_role;
