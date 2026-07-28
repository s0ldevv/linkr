create unique index if not exists wallets_unique_user_evm_address
  on public.wallets (user_id, public_key)
  where wallet_type = 'evm' and chain_id = 4663;

create unique index if not exists wallets_unique_user_solana_address
  on public.wallets (user_id, public_key)
  where wallet_type = 'solana' and chain_id is null;
