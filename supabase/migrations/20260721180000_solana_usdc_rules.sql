-- Per-user controls for native Solana USDC transfers and swap priority fees.
alter table public.profiles
  add column if not exists max_auto_transfer_usdc numeric not null default 0,
  add column if not exists solana_priority_fee_lamports bigint not null default 1000000;

alter table public.profiles
  drop constraint if exists profiles_max_auto_transfer_usdc_check,
  add constraint profiles_max_auto_transfer_usdc_check
    check (max_auto_transfer_usdc >= 0 and max_auto_transfer_usdc <= 1000000),
  drop constraint if exists profiles_solana_priority_fee_lamports_check,
  add constraint profiles_solana_priority_fee_lamports_check
    check (solana_priority_fee_lamports >= 0 and solana_priority_fee_lamports <= 10000000);

comment on column public.profiles.max_auto_transfer_usdc is
  'Maximum native Solana USDC amount allowed per transfer; zero disables USDC transfers.';
comment on column public.profiles.solana_priority_fee_lamports is
  'Maximum Jupiter prioritization fee for a Solana swap, in lamports.';
