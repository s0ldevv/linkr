-- Allow users to keep multiple encrypted wallets while exactly one is primary.

alter table public.wallets
  add column if not exists is_primary boolean not null default false;

update public.wallets w
set is_primary = true
where w.id = (
  select w2.id
  from public.wallets w2
  where w2.user_id = w.user_id
  order by w2.created_at asc, w2.id asc
  limit 1
);

alter table public.wallets
  drop constraint if exists wallets_user_id_key;

create unique index if not exists wallets_one_primary_per_user_idx
  on public.wallets (user_id)
  where is_primary;

create index if not exists wallets_user_created_idx
  on public.wallets (user_id, created_at desc);

create or replace function public.get_my_wallet_public_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public_key
  from public.wallets
  where user_id = auth.uid()
  order by is_primary desc, created_at asc, id asc
  limit 1;
$$;

grant execute on function public.get_my_wallet_public_key() to authenticated;

create or replace function public.get_my_wallets()
returns table (
  id uuid,
  public_key text,
  is_primary boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.public_key, w.is_primary, w.created_at
  from public.wallets w
  where w.user_id = auth.uid()
  order by w.is_primary desc, w.created_at asc, w.id asc;
$$;

grant execute on function public.get_my_wallets() to authenticated;

create or replace function public.set_my_primary_wallet(p_wallet_id uuid)
returns table (
  id uuid,
  public_key text,
  is_primary boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.wallets
    where wallets.id = p_wallet_id
      and wallets.user_id = auth.uid()
  ) then
    raise exception 'wallet_not_found';
  end if;

  update public.wallets
  set is_primary = false
  where user_id = auth.uid()
    and is_primary = true
    and id <> p_wallet_id;

  update public.wallets
  set is_primary = true
  where user_id = auth.uid()
    and id = p_wallet_id;

  return query
    select w.id, w.public_key, w.is_primary, w.created_at
    from public.wallets w
    where w.id = p_wallet_id
      and w.user_id = auth.uid();
end;
$$;

grant execute on function public.set_my_primary_wallet(uuid) to authenticated;
