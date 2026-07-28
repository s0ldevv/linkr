-- Absolute ceilings for user wallet-rule caps, enforced in SQL so no edge
-- function bug can bypass them. Ceilings match the hard limits the execution
-- paths already apply (transfers 100 native, dev buy 5 SOL / 0.1 ETH), so
-- clamping existing rows changes stored numbers but never effective behavior.

update public.profiles set
  max_auto_dev_buy_sol = least(max_auto_dev_buy_sol, 5),
  max_auto_dev_buy_eth = least(coalesce(max_auto_dev_buy_eth, 0), 0.1),
  max_auto_transfer_sol = least(max_auto_transfer_sol, 100),
  max_auto_transfer_eth = least(coalesce(max_auto_transfer_eth, 0), 100),
  max_auto_transfer_usdc = least(coalesce(max_auto_transfer_usdc, 0), 10000),
  max_auto_buy_sol = least(max_auto_buy_sol, 100),
  max_auto_buy_eth = least(coalesce(max_auto_buy_eth, 0), 100)
where max_auto_dev_buy_sol > 5
   or coalesce(max_auto_dev_buy_eth, 0) > 0.1
   or max_auto_transfer_sol > 100
   or coalesce(max_auto_transfer_eth, 0) > 100
   or coalesce(max_auto_transfer_usdc, 0) > 10000
   or max_auto_buy_sol > 100
   or coalesce(max_auto_buy_eth, 0) > 100;

alter table public.profiles
  drop constraint if exists profiles_max_auto_dev_buy_sol_ceiling,
  add constraint profiles_max_auto_dev_buy_sol_ceiling
    check (max_auto_dev_buy_sol between 0 and 5),
  drop constraint if exists profiles_max_auto_dev_buy_eth_ceiling,
  add constraint profiles_max_auto_dev_buy_eth_ceiling
    check (max_auto_dev_buy_eth is null or max_auto_dev_buy_eth between 0 and 0.1),
  drop constraint if exists profiles_max_auto_transfer_sol_ceiling,
  add constraint profiles_max_auto_transfer_sol_ceiling
    check (max_auto_transfer_sol between 0 and 100),
  drop constraint if exists profiles_max_auto_transfer_eth_ceiling,
  add constraint profiles_max_auto_transfer_eth_ceiling
    check (max_auto_transfer_eth is null or max_auto_transfer_eth between 0 and 100),
  drop constraint if exists profiles_max_auto_transfer_usdc_ceiling,
  add constraint profiles_max_auto_transfer_usdc_ceiling
    check (max_auto_transfer_usdc is null or max_auto_transfer_usdc between 0 and 10000),
  drop constraint if exists profiles_max_auto_buy_sol_ceiling,
  add constraint profiles_max_auto_buy_sol_ceiling
    check (max_auto_buy_sol between 0 and 100),
  drop constraint if exists profiles_max_auto_buy_eth_ceiling,
  add constraint profiles_max_auto_buy_eth_ceiling
    check (max_auto_buy_eth is null or max_auto_buy_eth between 0 and 100);
