-- Normalize Pump creator-fee recipients so a recipient can discover and claim
-- shared earnings without being the launch owner. The launch JSON remains the
-- immutable request snapshot; this table is the relationship/read model.

create table if not exists public.coin_launch_reward_recipients (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.coin_launches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  wallet_address text not null,
  role text not null default 'shared_creator_rewards',
  share_bps integer not null,
  source text not null,
  twitter_username text,
  twitter_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coin_launch_reward_recipients_role_check
    check (role = 'shared_creator_rewards'),
  constraint coin_launch_reward_recipients_share_check
    check (share_bps between 1 and 10000),
  constraint coin_launch_reward_recipients_wallet_check
    check (length(btrim(wallet_address)) between 32 and 64),
  unique (launch_id, user_id, wallet_address)
);

create index if not exists coin_launch_reward_recipients_user_created_idx
  on public.coin_launch_reward_recipients (user_id, created_at desc);
create index if not exists coin_launch_reward_recipients_launch_idx
  on public.coin_launch_reward_recipients (launch_id);

grant select on public.coin_launch_reward_recipients to authenticated;
grant all on public.coin_launch_reward_recipients to service_role;
alter table public.coin_launch_reward_recipients enable row level security;

drop policy if exists "users read own launch reward shares"
  on public.coin_launch_reward_recipients;
create policy "users read own launch reward shares"
  on public.coin_launch_reward_recipients
  for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.refresh_coin_launch_reward_recipients(p_launch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_launch public.coin_launches%rowtype;
  v_recipient jsonb;
  v_address text;
  v_user_id uuid;
  v_wallet_id uuid;
  v_config_user text;
  v_config_wallet text;
  v_share_bps integer;
begin
  select * into v_launch from public.coin_launches where id = p_launch_id;
  delete from public.coin_launch_reward_recipients where launch_id = p_launch_id;

  if not found
     or coalesce(v_launch.chain, '') <> 'solana'
     or jsonb_typeof(v_launch.creator_rewards_config -> 'recipients') <> 'array' then
    return 0;
  end if;

  for v_recipient in
    select value from jsonb_array_elements(v_launch.creator_rewards_config -> 'recipients')
  loop
    if coalesce(v_recipient ->> 'role', '') <> 'shared_creator_rewards' then
      continue;
    end if;

    v_address := nullif(btrim(v_recipient ->> 'address'), '');
    v_share_bps := coalesce(
      nullif(v_recipient ->> 'shareBps', '')::integer,
      nullif(v_recipient ->> 'share_bps', '')::integer
    );
    if v_address is null or v_share_bps is null or v_share_bps not between 1 and 10000 then
      continue;
    end if;

    v_user_id := null;
    v_wallet_id := null;
    v_config_user := coalesce(
      nullif(v_recipient ->> 'userId', ''),
      nullif(v_recipient ->> 'user_id', '')
    );
    v_config_wallet := coalesce(
      nullif(v_recipient ->> 'walletId', ''),
      nullif(v_recipient ->> 'wallet_id', '')
    );

    if v_config_user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select id into v_user_id from auth.users where id = v_config_user::uuid;
    end if;
    if v_config_wallet ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select w.id, coalesce(v_user_id, w.user_id)
      into v_wallet_id, v_user_id
      from public.wallets w
      where w.id = v_config_wallet::uuid
        and w.public_key = v_address
      limit 1;
    end if;
    if v_user_id is null then
      select w.id, w.user_id
      into v_wallet_id, v_user_id
      from public.wallets w
      where w.public_key = v_address
      order by w.created_at
      limit 1;
    end if;

    -- A raw external wallet has no Linkr identity to attach yet. Its immutable
    -- address remains in creator_rewards_config and can be reconciled later.
    if v_user_id is null then
      continue;
    end if;

    insert into public.coin_launch_reward_recipients (
      launch_id, user_id, wallet_id, wallet_address, role, share_bps,
      source, twitter_username, twitter_id, updated_at
    ) values (
      v_launch.id,
      v_user_id,
      v_wallet_id,
      v_address,
      'shared_creator_rewards',
      v_share_bps,
      coalesce(nullif(v_recipient ->> 'source', ''), 'creator_rewards_config'),
      nullif(v_recipient ->> 'twitterUsername', ''),
      nullif(v_recipient ->> 'twitterId', ''),
      now()
    )
    on conflict (launch_id, user_id, wallet_address) do update
      set wallet_id = excluded.wallet_id,
          share_bps = excluded.share_bps,
          source = excluded.source,
          twitter_username = excluded.twitter_username,
          twitter_id = excluded.twitter_id,
          updated_at = now();
  end loop;

  return (
    select count(*)::integer
    from public.coin_launch_reward_recipients
    where launch_id = p_launch_id
  );
end;
$$;

revoke all on function public.refresh_coin_launch_reward_recipients(uuid) from public;
grant execute on function public.refresh_coin_launch_reward_recipients(uuid) to service_role;

create or replace function public.sync_coin_launch_reward_recipients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_coin_launch_reward_recipients(new.id);
  return new;
end;
$$;

drop trigger if exists sync_coin_launch_reward_recipients_trigger
  on public.coin_launches;
create trigger sync_coin_launch_reward_recipients_trigger
after insert or update of creator_rewards_config, chain
on public.coin_launches
for each row execute function public.sync_coin_launch_reward_recipients();

-- Safe idempotent backfill for previously stored fee-share configs.
do $$
declare
  v_launch_id uuid;
begin
  for v_launch_id in
    select id from public.coin_launches
    where chain = 'solana'
      and jsonb_typeof(creator_rewards_config -> 'recipients') = 'array'
  loop
    perform public.refresh_coin_launch_reward_recipients(v_launch_id);
  end loop;
end;
$$;
