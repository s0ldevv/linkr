create index if not exists transactions_user_action_created_idx
  on public.transactions (user_id, action, created_at desc);

create index if not exists transactions_user_input_mint_created_idx
  on public.transactions (user_id, input_mint, created_at desc);

create index if not exists transactions_user_output_mint_created_idx
  on public.transactions (user_id, output_mint, created_at desc);

create index if not exists transactions_user_amount_sol_idx
  on public.transactions (user_id, amount_sol desc nulls last);

create index if not exists transactions_user_amount_usd_idx
  on public.transactions (user_id, amount_usd desc nulls last);

create index if not exists coin_launches_user_symbol_created_idx
  on public.coin_launches (user_id, lower(symbol), created_at desc);

create index if not exists coin_launches_user_mint_idx
  on public.coin_launches (user_id, mint);

create index if not exists coin_settings_updates_user_created_idx
  on public.coin_settings_updates (user_id, created_at desc);

create index if not exists agent_runs_user_intent_created_idx
  on public.agent_runs (user_id, intent, created_at desc);

create index if not exists twitter_replies_status_created_idx
  on public.twitter_replies (status, created_at desc);
