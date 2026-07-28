-- Durable, service-only outbox for irreversible token burns.
-- Signed transactions are persisted before broadcast so retries can only
-- rebroadcast the same transaction, never create a second burn.

create table if not exists public.token_burn_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  chain text not null,
  token_address text not null,
  token_account_addresses text[] not null default '{}',
  amount_raw text not null,
  amount_display text not null,
  symbol text,
  decimals smallint not null,
  source_surface text not null,
  pending_action_id uuid references public.linkr_pending_actions(id) on delete set null,
  legacy_pending_action_id uuid references public.pending_actions(id) on delete set null,
  agent_api_key_id uuid references public.agent_api_keys(id) on delete set null,
  idempotency_key text not null,
  state text not null default 'signed',
  signed_transaction text not null,
  tx_hash text not null,
  nonce numeric(78, 0),
  blockhash text,
  last_valid_block_height bigint,
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint token_burn_executions_chain_check
    check (chain in ('robinhood', 'solana')),
  constraint token_burn_executions_amount_raw_check
    check (amount_raw ~ '^[1-9][0-9]{0,77}$'),
  constraint token_burn_executions_amount_display_check
    check (amount_display ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  constraint token_burn_executions_symbol_length_check
    check (symbol is null or octet_length(symbol) between 1 and 20),
  constraint token_burn_executions_decimals_check
    check (decimals between 0 and 255),
  constraint token_burn_executions_idempotency_length_check
    check (octet_length(idempotency_key) between 1 and 256),
  constraint token_burn_executions_signed_length_check
    check (octet_length(signed_transaction) between 1 and 131072),
  constraint token_burn_executions_state_check
    check (state in ('signed', 'broadcast', 'confirmed', 'failed', 'reconciling')),
  constraint token_burn_executions_broadcast_shape_check
    check (state not in ('broadcast', 'confirmed') or broadcast_at is not null),
  constraint token_burn_executions_confirm_shape_check
    check (state <> 'confirmed' or confirmed_at is not null)
);

create unique index if not exists token_burn_executions_idempotency_uidx
  on public.token_burn_executions (idempotency_key);
create unique index if not exists token_burn_executions_linkr_pending_uidx
  on public.token_burn_executions (pending_action_id)
  where pending_action_id is not null;
create unique index if not exists token_burn_executions_legacy_pending_uidx
  on public.token_burn_executions (legacy_pending_action_id)
  where legacy_pending_action_id is not null;
create unique index if not exists token_burn_executions_chain_hash_uidx
  on public.token_burn_executions (chain, tx_hash);
create unique index if not exists token_burn_executions_evm_nonce_uidx
  on public.token_burn_executions (chain, wallet_id, nonce)
  where chain = 'robinhood' and nonce is not null;
create index if not exists token_burn_executions_reconcile_idx
  on public.token_burn_executions (chain, updated_at)
  where state in ('signed', 'broadcast', 'reconciling');
create index if not exists token_burn_executions_user_created_idx
  on public.token_burn_executions (user_id, created_at desc);

alter table public.token_burn_executions enable row level security;
revoke all on public.token_burn_executions from public, anon, authenticated;
grant all on public.token_burn_executions to service_role;

drop trigger if exists token_burn_executions_set_updated_at
  on public.token_burn_executions;
create trigger token_burn_executions_set_updated_at
  before update on public.token_burn_executions
  for each row execute function public.set_updated_at();

comment on table public.token_burn_executions is
  'Service-only signed-transaction outbox for explicit, separately confirmed, irreversible token burns.';
