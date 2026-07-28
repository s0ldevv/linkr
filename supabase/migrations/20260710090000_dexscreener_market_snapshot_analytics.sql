-- Preserve richer Dexscreener token-pair analytics in cached market snapshots.

alter table public.market_token_snapshots
  add column if not exists pair_dex_id text,
  add column if not exists pair_created_at timestamptz,
  add column if not exists liquidity_base numeric,
  add column if not exists liquidity_quote numeric,
  add column if not exists txns_5m integer,
  add column if not exists txns_1h integer,
  add column if not exists txns_6h integer,
  add column if not exists boosts_active integer;
