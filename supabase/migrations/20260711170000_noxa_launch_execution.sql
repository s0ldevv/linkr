-- Noxa launch execution support for X-confirmed Linkr launches.
-- This migration is additive: existing queued launch rows keep working while
-- new rows can be claimed by the launch worker and finalized on-chain.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'token-logos',
  'token-logos',
  true,
  4718592,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public can read token logos'
  ) then
    create policy "Public can read token logos"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'token-logos');
  end if;
end $$;

alter table public.coin_launches
  add column if not exists tx_hash text,
  add column if not exists explorer_url text,
  add column if not exists factory text,
  add column if not exists deployer text,
  add column if not exists launch_signer_wallet_id uuid references public.wallets(id) on delete set null,
  add column if not exists launch_signer_address text,
  add column if not exists source_tweet_id text,
  add column if not exists source_tweet_url text,
  add column if not exists original_image_url text,
  add column if not exists stable_logo_url text,
  add column if not exists token_logo_storage_path text,
  add column if not exists metadata_twitter_url text,
  add column if not exists metadata_website_url text,
  add column if not exists fee_wallet text,
  add column if not exists fee_wallet_user_id uuid references auth.users(id) on delete set null,
  add column if not exists fee_recipient_kind text,
  add column if not exists fee_recipient_twitter_username text,
  add column if not exists requested_initial_buy_wei text,
  add column if not exists effective_initial_buy_wei text,
  add column if not exists requested_initial_buy_eth numeric,
  add column if not exists effective_initial_buy_eth numeric,
  add column if not exists initial_buy_policy text,
  add column if not exists launch_fee_wei text,
  add column if not exists total_msg_value_wei text,
  add column if not exists initial_buy_amount_wei text,
  add column if not exists dex_factory text,
  add column if not exists pair_token text,
  add column if not exists paired_token text,
  add column if not exists position_manager text,
  add column if not exists pool text,
  add column if not exists position_id text,
  add column if not exists is_token0 boolean,
  add column if not exists pool_fee integer,
  add column if not exists restrictions_end_block text,
  add column if not exists noxa_verified jsonb,
  add column if not exists noxa_receipt jsonb,
  add column if not exists idempotency_key text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists first_launch_subsidy_eligible boolean not null default false,
  add column if not exists first_launch_subsidized boolean not null default false,
  add column if not exists funding_policy text,
  add column if not exists funding_status text,
  add column if not exists funding_amount_wei text,
  add column if not exists funding_tx_hash text,
  add column if not exists funding_error text;

update public.coin_launches
set
  tx_hash = coalesce(tx_hash, tx_signature),
  token_address = coalesce(token_address, mint),
  original_image_url = coalesce(original_image_url, image_url),
  stable_logo_url = coalesce(stable_logo_url, image_url),
  source_tweet_id = coalesce(source_tweet_id, tweet_id),
  requested_initial_buy_eth = coalesce(requested_initial_buy_eth, dev_buy_eth)
where tx_hash is null
   or token_address is null
   or original_image_url is null
   or stable_logo_url is null
   or source_tweet_id is null
   or requested_initial_buy_eth is null;

create unique index if not exists coin_launches_idempotency_key_uidx
  on public.coin_launches (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists coin_launches_tx_hash_uidx
  on public.coin_launches (lower(tx_hash))
  where tx_hash is not null;

create index if not exists coin_launches_processing_idx
  on public.coin_launches (status, next_attempt_at, created_at);

create index if not exists coin_launches_launch_signer_wallet_idx
  on public.coin_launches (launch_signer_wallet_id, created_at desc);

create index if not exists coin_launches_fee_wallet_idx
  on public.coin_launches (lower(fee_wallet), created_at desc)
  where fee_wallet is not null;

create table if not exists public.wallet_funding_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  coin_launch_id uuid references public.coin_launches(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  wallet_id uuid references public.wallets(id) on delete set null,
  funding_kind text not null default 'first_launch_minimum',
  source_address text,
  destination_address text not null,
  amount_wei text not null,
  tx_hash text unique,
  status text not null default 'pending',
  error text,
  raw_result jsonb not null default '{}'::jsonb
);

grant all on public.wallet_funding_events to service_role;
alter table public.wallet_funding_events enable row level security;

create index if not exists wallet_funding_events_user_created_idx
  on public.wallet_funding_events (user_id, created_at desc);

create index if not exists wallet_funding_events_launch_idx
  on public.wallet_funding_events (coin_launch_id);

create unique index if not exists wallet_funding_events_first_launch_uidx
  on public.wallet_funding_events (user_id, funding_kind)
  where funding_kind = 'first_launch_minimum'
    and status in ('pending', 'submitted', 'confirmed');

create or replace function public.claim_next_queued_coin_launch(
  p_worker_id text,
  p_stale_before timestamptz default now() - interval '15 minutes'
)
returns public.coin_launches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.coin_launches;
begin
  update public.coin_launches
  set
    status = 'processing',
    processing_started_at = now(),
    worker_id = nullif(btrim(p_worker_id), ''),
    attempt_count = coalesce(attempt_count, 0) + 1,
    last_attempt_at = now(),
    next_attempt_at = null,
    error = null
  where id = (
    select id
    from public.coin_launches
    where (
        status = 'queued'
        and coalesce(next_attempt_at, now()) <= now()
      )
      or (
        status in ('processing', 'submitted')
        and processing_started_at < p_stale_before
        and coalesce(attempt_count, 0) < coalesce(max_attempts, 3)
      )
    order by created_at asc
    for update skip locked
    limit 1
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.claim_next_queued_coin_launch(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_next_queued_coin_launch(text, timestamptz)
  to service_role;
