-- Default dev-buy wallet rule. max_auto_dev_buy_* remain hard ceilings; these
-- new fields are the amount applied when a launch request omits a dev buy.
-- Zero keeps today's behavior. Enrichment forces zero for the subsidized first
-- launch regardless of this rule so the SOL_FUNDING_WALLET subsidy stays valid.

alter table public.profiles
  add column if not exists default_dev_buy_sol numeric not null default 0,
  add column if not exists default_dev_buy_eth numeric not null default 0;

alter table public.profiles
  drop constraint if exists profiles_default_dev_buy_sol_check,
  add constraint profiles_default_dev_buy_sol_check
    check (default_dev_buy_sol >= 0 and default_dev_buy_sol <= 5),
  drop constraint if exists profiles_default_dev_buy_eth_check,
  add constraint profiles_default_dev_buy_eth_check
    check (default_dev_buy_eth >= 0 and default_dev_buy_eth <= 0.1);

comment on column public.profiles.default_dev_buy_sol is
  'Dev buy (SOL) applied when a launch request omits an amount. Capped by max_auto_dev_buy_sol at authorization; forced to 0 for the subsidized first launch.';
comment on column public.profiles.default_dev_buy_eth is
  'Dev buy (ETH) applied when a launch request omits an amount. Capped by max_auto_dev_buy_eth at authorization; forced to 0 for the subsidized first launch.';
