-- User-owned PumpSwap liquidity positions for graduated Pump.fun tokens.
-- Reuses the existing liquidity ledgers with explicit chain/platform metadata.

alter table public.liquidity_positions
  add column if not exists chain text not null default 'robinhood',
  add column if not exists platform text,
  add column if not exists wallet_id uuid references public.wallets(id) on delete set null,
  add column if not exists native_symbol text not null default 'ETH',
  add column if not exists lp_mint text,
  add column if not exists token_decimals integer,
  add column if not exists native_decimals integer,
  add column if not exists amount_token_raw text,
  add column if not exists amount_native_raw text;

update public.liquidity_positions
set
  chain = coalesce(chain, 'robinhood'),
  platform = coalesce(platform, 'robinhood_uniswap_v3'),
  native_symbol = coalesce(native_symbol, 'ETH')
where chain is null
  or platform is null
  or native_symbol is null;

alter table public.liquidity_positions
  drop constraint if exists liquidity_positions_chain_check,
  add constraint liquidity_positions_chain_check
    check (chain in ('robinhood', 'solana')) not valid,
  drop constraint if exists liquidity_positions_platform_check,
  add constraint liquidity_positions_platform_check
    check (platform is null or platform in ('robinhood_uniswap_v3', 'pump_swap')) not valid;

alter table public.liquidity_actions
  add column if not exists chain text not null default 'robinhood',
  add column if not exists platform text,
  add column if not exists wallet_id uuid references public.wallets(id) on delete set null,
  add column if not exists native_symbol text not null default 'ETH',
  add column if not exists requested_native_raw text,
  add column if not exists amount_native_raw text;

update public.liquidity_actions
set
  chain = coalesce(chain, 'robinhood'),
  platform = coalesce(platform, 'robinhood_uniswap_v3'),
  native_symbol = coalesce(native_symbol, 'ETH')
where chain is null
  or platform is null
  or native_symbol is null;

alter table public.liquidity_actions
  drop constraint if exists liquidity_actions_chain_check,
  add constraint liquidity_actions_chain_check
    check (chain in ('robinhood', 'solana')) not valid,
  drop constraint if exists liquidity_actions_platform_check,
  add constraint liquidity_actions_platform_check
    check (platform is null or platform in ('robinhood_uniswap_v3', 'pump_swap')) not valid;

create index if not exists liquidity_positions_user_chain_created_idx
  on public.liquidity_positions (user_id, chain, created_at desc);

create index if not exists liquidity_positions_lp_mint_idx
  on public.liquidity_positions (lp_mint)
  where lp_mint is not null;

create index if not exists liquidity_actions_user_chain_created_idx
  on public.liquidity_actions (user_id, chain, created_at desc);
