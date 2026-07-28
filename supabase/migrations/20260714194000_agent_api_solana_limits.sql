alter table public.agent_api_keys
  add column if not exists max_buy_sol numeric,
  add column if not exists max_transfer_sol numeric;
