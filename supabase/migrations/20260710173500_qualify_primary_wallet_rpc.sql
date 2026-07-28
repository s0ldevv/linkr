-- Fix live schema lint for set_my_primary_wallet by qualifying wallet columns
-- inside the PL/pgSQL function. This is behavior-preserving.

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
begin
  if not exists (
    select 1
    from public.wallets w
    where w.id = p_wallet_id
      and w.user_id = auth.uid()
      and w.wallet_type = 'evm'
      and w.chain_id = 4663
  ) then
    raise exception 'wallet_not_found';
  end if;

  update public.wallets w
  set is_primary = false
  where w.user_id = auth.uid()
    and w.wallet_type = 'evm'
    and w.chain_id = 4663
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

