-- Compact economic outbox, external-delivery state, and canonical DLQ.

create table public.linkr_chain_transactions (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  chain text not null,
  wallet_id uuid,
  launch_id uuid,
  attempt_number integer not null default 1,
  transaction_hash text,
  nonce numeric(78, 0),
  signature text,
  blockhash text,
  last_valid_block_height bigint,
  predicted_address text,
  signed_transaction bytea not null,
  signed_transaction_hash text not null,
  encrypted_key_material bytea,
  payload_hash text,
  gas_policy jsonb,
  state text not null default 'signed',
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_chain_transactions_chain_check check (chain in ('solana', 'robinhood')),
  constraint linkr_chain_transactions_attempt_check check (attempt_number > 0),
  constraint linkr_chain_transactions_signed_size check (
    octet_length(signed_transaction) between 1 and 65536
  ),
  constraint linkr_chain_transactions_key_size check (
    encrypted_key_material is null or octet_length(encrypted_key_material) <= 4096
  ),
  constraint linkr_chain_transactions_state_check check (
    state in ('signed', 'broadcasting', 'broadcast', 'confirming', 'confirmed', 'failed', 'reconciling', 'replaced')
  ),
  constraint linkr_chain_transactions_broadcast_shape check (
    state not in ('broadcast', 'confirming', 'confirmed') or broadcast_at is not null
  ),
  constraint linkr_chain_transactions_confirm_shape check (
    state <> 'confirmed' or confirmed_at is not null
  )
);

create unique index linkr_chain_transactions_work_attempt_uidx
  on public.linkr_chain_transactions (work_item_id, attempt_number);
create unique index linkr_chain_transactions_hash_uidx
  on public.linkr_chain_transactions (chain, transaction_hash)
  where transaction_hash is not null;
create unique index linkr_chain_transactions_nonce_uidx
  on public.linkr_chain_transactions (chain, wallet_id, nonce)
  where wallet_id is not null and nonce is not null;
create unique index linkr_chain_transactions_launch_attempt_uidx
  on public.linkr_chain_transactions (launch_id, attempt_number)
  where launch_id is not null;
create index linkr_chain_transactions_reconcile_idx
  on public.linkr_chain_transactions (chain, updated_at)
  where state in ('broadcasting', 'broadcast', 'confirming', 'reconciling');

create table public.linkr_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null,
  channel text not null,
  idempotency_key text not null,
  destination_ref text not null,
  content_hash text not null,
  state text not null default 'queued',
  attempt_count integer not null default 0,
  provider_message_id text,
  last_error_code text,
  ambiguous_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_notification_channel_check check (channel in ('x', 'telegram')),
  constraint linkr_notification_key_length check (octet_length(idempotency_key) between 1 and 256),
  constraint linkr_notification_state_check check (
    state in ('queued', 'sending', 'sent', 'retryable', 'ambiguous', 'failed', 'cancelled')
  ),
  constraint linkr_notification_attempt_check check (attempt_count >= 0)
);

create unique index linkr_notification_deliveries_idempotency_uidx
  on public.linkr_notification_deliveries (idempotency_key);
create index linkr_notification_deliveries_pending_idx
  on public.linkr_notification_deliveries (channel, updated_at)
  where state in ('queued', 'retryable', 'ambiguous');

create table public.linkr_dead_letter_items (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null unique,
  pgmq_message_id bigint,
  route text not null,
  reason_code text not null,
  error_fingerprint text,
  redrive_state text not null default 'pending',
  redrive_count integer not null default 0,
  last_redriven_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_dead_letter_route_length check (octet_length(route) between 1 and 80),
  constraint linkr_dead_letter_reason_length check (octet_length(reason_code) between 1 and 120),
  constraint linkr_dead_letter_redrive_state_check check (
    redrive_state in ('pending', 'validated', 'redriving', 'resolved', 'cancelled')
  ),
  constraint linkr_dead_letter_redrive_count_check check (redrive_count >= 0)
);

create index linkr_dead_letter_pending_idx
  on public.linkr_dead_letter_items (created_at)
  where redrive_state in ('pending', 'validated');

alter table public.linkr_chain_transactions enable row level security;
alter table public.linkr_notification_deliveries enable row level security;
alter table public.linkr_dead_letter_items enable row level security;

revoke all on public.linkr_chain_transactions from public, anon, authenticated;
revoke all on public.linkr_notification_deliveries from public, anon, authenticated;
revoke all on public.linkr_dead_letter_items from public, anon, authenticated;
grant all on public.linkr_chain_transactions to service_role;
grant all on public.linkr_notification_deliveries to service_role;
grant all on public.linkr_dead_letter_items to service_role;
