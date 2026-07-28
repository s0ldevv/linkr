-- One canonical mutable row for every asynchronous command/turn.

create table public.linkr_work_items (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  source_surface text not null,
  source_event_id text,
  user_id uuid,
  conversation_id uuid,
  request_type text not null,
  route text not null,
  state text not null default 'queued',
  priority smallint not null default 50,
  resource_type text,
  resource_key text,
  resource_sequence bigint,
  state_version bigint not null default 0,
  dispatch_generation bigint not null default 0,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  payload jsonb,
  payload_ref text,
  payload_hash text,
  accepted_at timestamptz not null default now(),
  started_at timestamptz,
  terminal_at timestamptz,
  last_error_code text,
  result_ref text,
  trace_id uuid not null default gen_random_uuid(),
  consumer_version text not null default 'legacy',
  execution_generation bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_work_items_idempotency_length
    check (octet_length(idempotency_key) between 1 and 256),
  constraint linkr_work_items_source_length
    check (octet_length(source_surface) between 1 and 40),
  constraint linkr_work_items_source_event_length
    check (source_event_id is null or octet_length(source_event_id) between 1 and 256),
  constraint linkr_work_items_request_type_length
    check (octet_length(request_type) between 1 and 80),
  constraint linkr_work_items_route_length
    check (octet_length(route) between 1 and 80),
  constraint linkr_work_items_state_check
    check (state in (
      'queued', 'leased', 'waiting_resource', 'waiting_prerequisite',
      'waiting_user_confirmation', 'waiting_funds', 'waiting_provider',
      'retryable', 'preparing', 'ready', 'signing', 'signed',
      'broadcasting', 'broadcast', 'confirming', 'confirmed', 'notifying',
      'succeeded', 'rejected', 'cancelled', 'reconciling', 'dead_letter'
    )),
  constraint linkr_work_items_priority_check check (priority between 0 and 100),
  constraint linkr_work_items_resource_type_length
    check (resource_type is null or octet_length(resource_type) between 1 and 40),
  constraint linkr_work_items_resource_key_length
    check (resource_key is null or octet_length(resource_key) between 1 and 512),
  constraint linkr_work_items_resource_shape check (
    (resource_type is null and resource_key is null and resource_sequence is null)
    or
    (resource_type is not null and resource_key is not null and resource_sequence is not null and resource_sequence > 0)
  ),
  constraint linkr_work_items_versions_check
    check (state_version >= 0 and dispatch_generation >= 0 and execution_generation >= 0),
  constraint linkr_work_items_attempt_count_check check (attempt_count >= 0),
  constraint linkr_work_items_payload_location_check
    check (not (payload is not null and payload_ref is not null)),
  constraint linkr_work_items_payload_size_check
    check (payload is null or octet_length(payload::text) <= 16384),
  constraint linkr_work_items_payload_ref_length
    check (payload_ref is null or octet_length(payload_ref) between 1 and 1024),
  constraint linkr_work_items_payload_hash_length
    check (payload_hash is null or octet_length(payload_hash) <= 128),
  constraint linkr_work_items_terminal_shape check (
    (state in ('succeeded', 'rejected', 'cancelled', 'dead_letter') and terminal_at is not null)
    or
    (state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter') and terminal_at is null)
  )
);

create unique index linkr_work_items_idempotency_uidx
  on public.linkr_work_items (idempotency_key);

create index linkr_work_items_waiting_resource_idx
  on public.linkr_work_items (resource_type, resource_key, resource_sequence)
  where state = 'waiting_resource';

create index linkr_work_items_user_outstanding_idx
  on public.linkr_work_items (user_id, accepted_at)
  where state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');

create table public.linkr_idempotency_tombstones (
  idempotency_key text primary key,
  work_item_id uuid not null,
  terminal_state text not null,
  result_ref text,
  terminal_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint linkr_idempotency_tombstones_key_length
    check (octet_length(idempotency_key) between 1 and 256),
  constraint linkr_idempotency_tombstones_state_check
    check (terminal_state in ('succeeded', 'rejected', 'cancelled', 'dead_letter')),
  constraint linkr_idempotency_tombstones_expiry_check check (expires_at > terminal_at)
);

create index linkr_idempotency_tombstones_expiry_idx
  on public.linkr_idempotency_tombstones (expires_at);

create table public.linkr_request_events (
  id bigint generated always as identity,
  work_item_id uuid not null,
  event_type text not null,
  state text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint linkr_request_events_type_length check (octet_length(event_type) between 1 and 80),
  constraint linkr_request_events_metadata_size check (octet_length(metadata::text) <= 8192)
) partition by range (created_at);

create table public.linkr_request_events_202607
  partition of public.linkr_request_events
  for values from ('2026-07-01') to ('2026-08-01');
create table public.linkr_request_events_202608
  partition of public.linkr_request_events
  for values from ('2026-08-01') to ('2026-09-01');
create table public.linkr_request_events_202609
  partition of public.linkr_request_events
  for values from ('2026-09-01') to ('2026-10-01');
create table public.linkr_request_events_default
  partition of public.linkr_request_events default;

create index linkr_request_events_work_time_idx
  on public.linkr_request_events (work_item_id, created_at desc);
create index linkr_request_events_error_time_idx
  on public.linkr_request_events (error_code, created_at desc)
  where error_code is not null;

alter table public.linkr_work_items enable row level security;
alter table public.linkr_idempotency_tombstones enable row level security;
alter table public.linkr_request_events enable row level security;

revoke all on public.linkr_work_items from public, anon, authenticated;
revoke all on public.linkr_idempotency_tombstones from public, anon, authenticated;
revoke all on public.linkr_request_events from public, anon, authenticated;
grant all on public.linkr_work_items to service_role;
grant all on public.linkr_idempotency_tombstones to service_role;
grant all on public.linkr_request_events to service_role;
grant usage, select on sequence public.linkr_request_events_id_seq to service_role;
