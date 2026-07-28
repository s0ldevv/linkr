-- Contract-address X swap execution support.

alter table public.transactions
  add column if not exists wallet_id uuid references public.wallets(id) on delete set null,
  add column if not exists wallet_address text,
  add column if not exists input_amount_wei text,
  add column if not exists output_amount_wei text,
  add column if not exists quoted_output_amount_wei text,
  add column if not exists min_output_amount_wei text,
  add column if not exists input_token_decimals integer,
  add column if not exists output_token_decimals integer,
  add column if not exists input_token_symbol text,
  add column if not exists output_token_symbol text,
  add column if not exists router_address text,
  add column if not exists route_source text,
  add column if not exists quote_id text,
  add column if not exists quote_payload jsonb,
  add column if not exists execution_payload jsonb,
  add column if not exists gas_used_wei text,
  add column if not exists effective_gas_price_wei text,
  add column if not exists submitted_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists idempotency_key text;

create unique index if not exists transactions_idempotency_key_unique
  on public.transactions (idempotency_key)
  where idempotency_key is not null;

create index if not exists transactions_tx_hash_idx
  on public.transactions (tx_hash)
  where tx_hash is not null;

create index if not exists transactions_status_action_created_idx
  on public.transactions (status, action, created_at desc);
