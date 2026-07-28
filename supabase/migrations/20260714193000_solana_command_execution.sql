-- First-class chain labels for command execution history.
-- Robinhood Chain keeps chain_id=4663; Solana keeps chain_id null and chain='solana'.

alter table public.transactions
  add column if not exists chain text;

update public.transactions
set chain = case
  when chain_id = 4663 then 'robinhood'
  when lower(coalesce(native_symbol, '')) = 'sol'
    or input_mint = 'So11111111111111111111111111111111111111112'
    or output_mint = 'So11111111111111111111111111111111111111112'
  then 'solana'
  else chain
end
where chain is null;

create index if not exists transactions_user_chain_created_idx
  on public.transactions (user_id, chain, created_at desc);

create index if not exists transactions_chain_action_status_idx
  on public.transactions (chain, action, status, created_at desc);
