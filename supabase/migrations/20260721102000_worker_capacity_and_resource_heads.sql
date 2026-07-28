-- Bounded worker concurrency and ordered-resource fencing.

create table public.linkr_worker_capacity_slots (
  stage text not null,
  slot_number smallint not null,
  enabled boolean not null default true,
  lease_owner text,
  lease_expires_at timestamptz,
  work_item_id uuid,
  fencing_token bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (stage, slot_number),
  constraint linkr_worker_capacity_stage_length check (octet_length(stage) between 1 and 80),
  constraint linkr_worker_capacity_slot_check check (slot_number between 1 and 256),
  constraint linkr_worker_capacity_lease_shape check (
    (lease_owner is null and lease_expires_at is null and work_item_id is null)
    or
    (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint linkr_worker_capacity_fencing_check check (fencing_token >= 0)
);

create index linkr_worker_capacity_available_idx
  on public.linkr_worker_capacity_slots (stage, slot_number)
  where enabled;

create table public.linkr_resource_heads (
  resource_type text not null,
  resource_key text not null,
  active_work_item_id uuid,
  active_sequence bigint,
  next_sequence bigint not null default 1,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (resource_type, resource_key),
  constraint linkr_resource_heads_type_length check (octet_length(resource_type) between 1 and 40),
  constraint linkr_resource_heads_key_length check (octet_length(resource_key) between 1 and 512),
  constraint linkr_resource_heads_sequence_check check (
    next_sequence > 0
    and (active_sequence is null or active_sequence > 0)
    and (active_sequence is null or next_sequence > active_sequence)
  ),
  constraint linkr_resource_heads_active_shape check (
    (active_work_item_id is null and active_sequence is null)
    or
    (active_work_item_id is not null and active_sequence is not null)
  ),
  constraint linkr_resource_heads_lease_shape check (
    (lease_owner is null and lease_expires_at is null)
    or
    (lease_owner is not null and lease_expires_at is not null and active_work_item_id is not null)
  ),
  constraint linkr_resource_heads_fencing_check check (fencing_token >= 0)
);

create table public.linkr_worker_attempt_details (
  id bigint generated always as identity,
  work_item_id uuid not null,
  stage text not null,
  attempt_number integer not null,
  worker_id text not null,
  outcome text,
  error_code text,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint linkr_worker_attempt_stage_length check (octet_length(stage) between 1 and 80),
  constraint linkr_worker_attempt_number_check check (attempt_number > 0),
  constraint linkr_worker_attempt_duration_check check (duration_ms is null or duration_ms >= 0),
  constraint linkr_worker_attempt_metadata_size check (octet_length(metadata::text) <= 8192)
) partition by range (started_at);

create table public.linkr_worker_attempt_details_202607
  partition of public.linkr_worker_attempt_details
  for values from ('2026-07-01') to ('2026-08-01');
create table public.linkr_worker_attempt_details_202608
  partition of public.linkr_worker_attempt_details
  for values from ('2026-08-01') to ('2026-09-01');
create table public.linkr_worker_attempt_details_202609
  partition of public.linkr_worker_attempt_details
  for values from ('2026-09-01') to ('2026-10-01');
create table public.linkr_worker_attempt_details_default
  partition of public.linkr_worker_attempt_details default;

create index linkr_worker_attempt_work_time_idx
  on public.linkr_worker_attempt_details (work_item_id, started_at desc);
create index linkr_worker_attempt_error_time_idx
  on public.linkr_worker_attempt_details (error_code, started_at desc)
  where error_code is not null;

create table public.linkr_capacity_change_events (
  id bigint generated always as identity primary key,
  stage text not null,
  old_enabled_slots integer,
  new_enabled_slots integer not null,
  reason text not null,
  actor text not null,
  created_at timestamptz not null default now(),
  constraint linkr_capacity_change_slot_check check (
    new_enabled_slots between 0 and 256
    and (old_enabled_slots is null or old_enabled_slots between 0 and 256)
  )
);

alter table public.linkr_worker_capacity_slots enable row level security;
alter table public.linkr_resource_heads enable row level security;
alter table public.linkr_worker_attempt_details enable row level security;
alter table public.linkr_capacity_change_events enable row level security;

revoke all on public.linkr_worker_capacity_slots from public, anon, authenticated;
revoke all on public.linkr_resource_heads from public, anon, authenticated;
revoke all on public.linkr_worker_attempt_details from public, anon, authenticated;
revoke all on public.linkr_capacity_change_events from public, anon, authenticated;
grant all on public.linkr_worker_capacity_slots to service_role;
grant all on public.linkr_resource_heads to service_role;
grant all on public.linkr_worker_attempt_details to service_role;
grant all on public.linkr_capacity_change_events to service_role;
grant usage, select on sequence public.linkr_worker_attempt_details_id_seq to service_role;
grant usage, select on sequence public.linkr_capacity_change_events_id_seq to service_role;

insert into public.linkr_worker_capacity_slots (stage, slot_number)
select stage, 1
from unnest(array[
  'x_ingress', 'telegram_control', 'conversation_turns_high',
  'conversation_turns_normal', 'command_prepare', 'media_capture',
  'action_solana', 'action_robinhood', 'launch_solana', 'launch_robinhood',
  'confirm_solana', 'confirm_robinhood', 'reply_x_high', 'reply_x_normal',
  'reply_telegram_high', 'reply_telegram_normal', 'reconciliation'
]) as stage
on conflict do nothing;
