-- Per-API-key cap for Solana launch initial buys, mirroring the existing
-- max_launch_initial_buy_eth. Null keeps today's behavior (profile cap +
-- absolute 5 SOL ceiling apply).

alter table public.agent_api_keys
  add column if not exists max_launch_initial_buy_sol numeric;

alter table public.agent_api_keys
  drop constraint if exists agent_api_keys_max_launch_initial_buy_sol_check,
  add constraint agent_api_keys_max_launch_initial_buy_sol_check
    check (
      max_launch_initial_buy_sol is null
      or (max_launch_initial_buy_sol >= 0 and max_launch_initial_buy_sol <= 5)
    );
