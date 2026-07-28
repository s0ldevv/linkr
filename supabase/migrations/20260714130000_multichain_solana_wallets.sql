-- Multi-chain app wallets.
-- Keep Robinhood Chain EVM wallets as the default trading wallet while adding
-- first-class Solana wallets with their own primary selection.

drop index if exists public.wallets_one_primary_per_user_idx;
drop index if exists public.wallets_one_primary_evm_per_user_idx;

create unique index wallets_one_primary_evm_per_user_idx
  on public.wallets (user_id)
  where is_primary and wallet_type = 'evm' and chain_id = 4663;

create unique index if not exists wallets_one_primary_solana_per_user_idx
  on public.wallets (user_id)
  where is_primary and wallet_type = 'solana';

create index if not exists wallets_user_wallet_type_chain_primary_idx
  on public.wallets (user_id, wallet_type, chain_id, is_primary desc, created_at asc);

drop function if exists public.get_my_wallets();

create or replace function public.get_my_wallets()
returns table (
  id uuid,
  public_key text,
  is_primary boolean,
  created_at timestamptz,
  wallet_type text,
  chain_id integer,
  address text,
  explorer_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id,
    w.public_key,
    w.is_primary,
    w.created_at,
    w.wallet_type,
    w.chain_id,
    coalesce(w.address, w.public_key),
    w.explorer_url
  from public.wallets w
  where w.user_id = auth.uid()
    and (
      (w.wallet_type = 'evm' and w.chain_id = 4663)
      or w.wallet_type = 'solana'
    )
  order by
    case w.wallet_type when 'evm' then 0 when 'solana' then 1 else 2 end,
    w.is_primary desc,
    w.created_at asc,
    w.id asc;
$$;

grant execute on function public.get_my_wallets() to authenticated;

drop function if exists public.set_my_primary_wallet(uuid);

create or replace function public.set_my_primary_wallet(p_wallet_id uuid)
returns table (
  id uuid,
  public_key text,
  is_primary boolean,
  created_at timestamptz,
  wallet_type text,
  chain_id integer,
  address text,
  explorer_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_wallet public.wallets%rowtype;
begin
  select *
  into target_wallet
  from public.wallets w
  where w.id = p_wallet_id
    and w.user_id = auth.uid()
    and (
      (w.wallet_type = 'evm' and w.chain_id = 4663)
      or w.wallet_type = 'solana'
    )
  limit 1;

  if target_wallet.id is null then
    raise exception 'wallet_not_found';
  end if;

  update public.wallets w
  set is_primary = false
  where w.user_id = auth.uid()
    and w.wallet_type = target_wallet.wallet_type
    and (
      (target_wallet.chain_id is null and w.chain_id is null)
      or w.chain_id = target_wallet.chain_id
    )
    and w.is_primary = true
    and w.id <> p_wallet_id;

  update public.wallets w
  set is_primary = true
  where w.user_id = auth.uid()
    and w.id = p_wallet_id;

  return query
    select
      w.id,
      w.public_key,
      w.is_primary,
      w.created_at,
      w.wallet_type,
      w.chain_id,
      coalesce(w.address, w.public_key),
      w.explorer_url
    from public.wallets w
    where w.id = p_wallet_id
      and w.user_id = auth.uid();
end;
$$;

grant execute on function public.set_my_primary_wallet(uuid) to authenticated;
