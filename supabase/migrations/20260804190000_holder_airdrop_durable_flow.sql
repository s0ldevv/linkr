-- Durable, confirmation-gated Solana holder airdrops. This migration installs
-- storage/routing contracts and seeds the worker stage disabled for canary
-- enablement after validation.

create table if not exists public.linkr_holder_airdrops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  launch_id uuid not null references public.coin_launches(id) on delete restrict,
  pending_action_id uuid references public.linkr_pending_actions(id) on delete set null,
  work_item_id uuid references public.linkr_work_items(id) on delete set null,
  source_work_item_id uuid not null references public.linkr_work_items(id) on delete restrict,
  source_tweet_id text not null,
  mint text not null,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  wallet_address text not null,
  source_token_account text not null,
  token_decimals integer not null check (token_decimals between 0 and 18),
  source_balance_raw numeric(78,0) not null check (source_balance_raw >= 0),
  requested_raw numeric(78,0) not null check (requested_raw > 0),
  allocated_raw numeric(78,0) not null check (allocated_raw > 0),
  dust_raw numeric(78,0) not null check (dust_raw >= 0),
  recipient_count integer not null check (recipient_count > 0),
  holder_account_count integer not null check (holder_account_count >= recipient_count),
  snapshot_slot bigint not null check (snapshot_slot > 0),
  snapshot_provider text not null,
  snapshot_fetched_at timestamptz not null,
  snapshot_checksum text,
  snapshot_provenance jsonb not null default '{}'::jsonb,
  excluded_dev_wallet text not null,
  excluded_largest_owner text not null,
  status text not null default 'prepared' check (status in (
    'prepared','confirmed','queued','validating','executing',
    'reconciling','completed','failed','cancelled','expired'
  )),
  idempotency_key text not null unique,
  confirmed_at timestamptz,
  completed_at timestamptz,
  notification_sent_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (allocated_raw + dust_raw = requested_raw)
);

create table if not exists public.linkr_holder_airdrop_recipients (
  id uuid primary key default gen_random_uuid(),
  airdrop_id uuid not null references public.linkr_holder_airdrops(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  owner_address text not null,
  holder_balance_raw numeric(78,0) not null check (holder_balance_raw > 0),
  allocation_raw numeric(78,0) not null check (allocation_raw > 0),
  status text not null default 'planned' check (status in (
    'planned','batched','signed','broadcast','confirmed','failed','reconciling'
  )),
  batch_id uuid,
  transaction_signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (airdrop_id, ordinal),
  unique (airdrop_id, owner_address)
);

create table if not exists public.linkr_holder_airdrop_batches (
  id uuid primary key default gen_random_uuid(),
  airdrop_id uuid not null references public.linkr_holder_airdrops(id) on delete cascade,
  batch_index integer not null check (batch_index >= 0),
  first_ordinal integer not null check (first_ordinal > 0),
  last_ordinal integer not null check (last_ordinal >= first_ordinal),
  recipient_count integer not null check (recipient_count between 1 and 4),
  allocated_raw numeric(78,0) not null check (allocated_raw > 0),
  status text not null default 'planned' check (status in (
    'planned','claimed','signed','simulated','broadcasting','broadcast',
    'reconciling','confirmed','failed','cancelled'
  )),
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  signed_transaction bytea,
  signed_transaction_hash text,
  signature text,
  blockhash text,
  last_valid_block_height bigint,
  simulation_result jsonb,
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  last_error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  broadcast_attempt_count integer not null default 0 check (broadcast_attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (airdrop_id, batch_index),
  check ((signed_transaction is null) = (signed_transaction_hash is null))
);

alter table public.linkr_holder_airdrops
  add column if not exists snapshot_checksum text,
  add column if not exists notification_sent_at timestamptz;
alter table public.linkr_holder_airdrop_batches
  add column if not exists broadcast_attempt_count integer not null default 0;

alter table public.linkr_holder_airdrop_recipients
  drop constraint if exists linkr_holder_airdrop_recipients_batch_fkey,
  add constraint linkr_holder_airdrop_recipients_batch_fkey
  foreign key (batch_id) references public.linkr_holder_airdrop_batches(id) on delete set null;

create index if not exists linkr_holder_airdrops_user_status_idx
  on public.linkr_holder_airdrops(user_id, status, created_at desc);
create index if not exists linkr_holder_airdrop_batches_claim_idx
  on public.linkr_holder_airdrop_batches(airdrop_id, status, batch_index);

create or replace function public.guard_linkr_holder_airdrop_snapshot_immutable_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.user_id is distinct from old.user_id
    or new.launch_id is distinct from old.launch_id
    or new.source_work_item_id is distinct from old.source_work_item_id
    or new.source_tweet_id is distinct from old.source_tweet_id
    or new.mint is distinct from old.mint
    or new.wallet_id is distinct from old.wallet_id
    or new.wallet_address is distinct from old.wallet_address
    or new.source_token_account is distinct from old.source_token_account
    or new.token_decimals is distinct from old.token_decimals
    or new.source_balance_raw is distinct from old.source_balance_raw
    or new.requested_raw is distinct from old.requested_raw
    or new.allocated_raw is distinct from old.allocated_raw
    or new.dust_raw is distinct from old.dust_raw
    or new.recipient_count is distinct from old.recipient_count
    or new.holder_account_count is distinct from old.holder_account_count
    or new.snapshot_slot is distinct from old.snapshot_slot
    or new.snapshot_provider is distinct from old.snapshot_provider
    or new.snapshot_fetched_at is distinct from old.snapshot_fetched_at
    or new.snapshot_checksum is distinct from old.snapshot_checksum
    or new.snapshot_provenance is distinct from old.snapshot_provenance
    or new.excluded_dev_wallet is distinct from old.excluded_dev_wallet
    or new.excluded_largest_owner is distinct from old.excluded_largest_owner
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'holder_airdrop_snapshot_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_linkr_holder_airdrop_snapshot_immutable on public.linkr_holder_airdrops;
create trigger guard_linkr_holder_airdrop_snapshot_immutable
before update on public.linkr_holder_airdrops for each row
execute function public.guard_linkr_holder_airdrop_snapshot_immutable_v1();

create or replace function public.guard_linkr_holder_airdrop_recipient_immutable_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.airdrop_id is distinct from old.airdrop_id
    or new.ordinal is distinct from old.ordinal
    or new.owner_address is distinct from old.owner_address
    or new.holder_balance_raw is distinct from old.holder_balance_raw
    or new.allocation_raw is distinct from old.allocation_raw then
    raise exception 'holder_airdrop_recipient_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_linkr_holder_airdrop_recipient_immutable on public.linkr_holder_airdrop_recipients;
create trigger guard_linkr_holder_airdrop_recipient_immutable
before update on public.linkr_holder_airdrop_recipients for each row
execute function public.guard_linkr_holder_airdrop_recipient_immutable_v1();

create or replace function public.guard_linkr_holder_airdrop_batch_plan_immutable_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.airdrop_id is distinct from old.airdrop_id
    or new.batch_index is distinct from old.batch_index
    or new.first_ordinal is distinct from old.first_ordinal
    or new.last_ordinal is distinct from old.last_ordinal
    or new.recipient_count is distinct from old.recipient_count
    or new.allocated_raw is distinct from old.allocated_raw then
    raise exception 'holder_airdrop_batch_plan_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_linkr_holder_airdrop_batch_plan_immutable on public.linkr_holder_airdrop_batches;
create trigger guard_linkr_holder_airdrop_batch_plan_immutable
before update on public.linkr_holder_airdrop_batches for each row
execute function public.guard_linkr_holder_airdrop_batch_plan_immutable_v1();

alter table public.linkr_holder_airdrops enable row level security;
alter table public.linkr_holder_airdrop_recipients enable row level security;
alter table public.linkr_holder_airdrop_batches enable row level security;
revoke all on public.linkr_holder_airdrops from public, anon, authenticated;
revoke all on public.linkr_holder_airdrop_recipients from public, anon, authenticated;
revoke all on public.linkr_holder_airdrop_batches from public, anon, authenticated;
grant select on public.linkr_holder_airdrops to authenticated;
grant select on public.linkr_holder_airdrop_recipients to authenticated;
grant select on public.linkr_holder_airdrop_batches to authenticated;
grant all on public.linkr_holder_airdrops to service_role;
grant all on public.linkr_holder_airdrop_recipients to service_role;
grant all on public.linkr_holder_airdrop_batches to service_role;
drop policy if exists "users read own holder airdrops" on public.linkr_holder_airdrops;
create policy "users read own holder airdrops" on public.linkr_holder_airdrops
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "users read own holder airdrop recipients" on public.linkr_holder_airdrop_recipients;
create policy "users read own holder airdrop recipients" on public.linkr_holder_airdrop_recipients
  for select to authenticated using (exists (
    select 1 from public.linkr_holder_airdrops a
    where a.id = airdrop_id and a.user_id = auth.uid()
  ));
drop policy if exists "users read own holder airdrop batches" on public.linkr_holder_airdrop_batches;
create policy "users read own holder airdrop batches" on public.linkr_holder_airdrop_batches
  for select to authenticated using (exists (
    select 1 from public.linkr_holder_airdrops a
    where a.id = airdrop_id and a.user_id = auth.uid()
  ));

drop function if exists public.prepare_linkr_holder_airdrop_v1(uuid,uuid,text,text,uuid,text,uuid,text,text,integer,numeric,numeric,numeric,numeric,integer,bigint,text,timestamptz,text,text,jsonb);
create or replace function public.prepare_linkr_holder_airdrop_v1(
  p_input_work_item_id uuid, p_user_id uuid, p_tweet_id text,
  p_surface_conversation_id text, p_launch_id uuid, p_mint text,
  p_wallet_id uuid, p_wallet_address text, p_source_token_account text,
  p_token_decimals integer, p_source_balance_raw numeric,
  p_requested_raw numeric, p_allocated_raw numeric, p_dust_raw numeric,
  p_holder_account_count integer,
  p_snapshot_slot bigint, p_snapshot_provider text,
  p_snapshot_fetched_at timestamptz, p_excluded_dev_wallet text,
  p_excluded_largest_owner text, p_snapshot_provenance jsonb, p_recipients jsonb
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  v_launch public.coin_launches%rowtype;
  v_wallet public.wallets%rowtype;
  v_airdrop public.linkr_holder_airdrops%rowtype;
  v_pending public.linkr_pending_actions%rowtype;
  v_recipient jsonb;
  v_count integer := 0;
  v_sum numeric := 0;
  v_key text;
begin
  if not exists (
    select 1 from public.linkr_work_items
    where id = p_input_work_item_id and user_id = p_user_id
  ) then raise exception 'holder_airdrop_input_work_item_mismatch'; end if;
  select * into v_launch from public.coin_launches
  where id = p_launch_id and user_id = p_user_id and chain = 'solana'
    and status = 'confirmed' and mint = p_mint
    and (token_address is null or token_address = mint);
  if not found then raise exception 'holder_airdrop_owned_completed_launch_required'; end if;
  if p_wallet_id is distinct from v_launch.solana_launch_wallet_id
    and p_wallet_id is distinct from v_launch.launch_signer_wallet_id then
    raise exception 'holder_airdrop_launch_wallet_mismatch';
  end if;
  select * into v_wallet from public.wallets
  where id = p_wallet_id and user_id = p_user_id and wallet_type = 'solana'
    and coalesce(address, public_key) = p_wallet_address;
  if not found then raise exception 'holder_airdrop_launch_wallet_mismatch'; end if;
  if p_source_balance_raw < p_requested_raw or p_requested_raw <= 0
    or p_allocated_raw <= 0 or p_allocated_raw + p_dust_raw <> p_requested_raw then
    raise exception 'holder_airdrop_totals_invalid';
  end if;
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then
    raise exception 'holder_airdrop_recipients_required';
  end if;
  for v_recipient in select value from jsonb_array_elements(p_recipients) loop
    if coalesce(v_recipient->>'owner','') = ''
      or (v_recipient->>'holder_balance_raw')::numeric <= 0
      or (v_recipient->>'allocation_raw')::numeric <= 0 then
      raise exception 'holder_airdrop_recipient_invalid';
    end if;
    v_count := v_count + 1;
    if (v_recipient->>'ordinal')::integer <> v_count then
      raise exception 'holder_airdrop_recipient_ordinal_invalid';
    end if;
    v_sum := v_sum + (v_recipient->>'allocation_raw')::numeric;
  end loop;
  if v_sum <> p_allocated_raw then raise exception 'holder_airdrop_allocation_sum_invalid'; end if;
  if p_holder_account_count < v_count then raise exception 'holder_airdrop_holder_count_invalid'; end if;

  v_key := 'x-holder-airdrop:' || p_tweet_id;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select * into v_airdrop from public.linkr_holder_airdrops where idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'airdrop_id', v_airdrop.id,
      'pending_action_id', v_airdrop.pending_action_id,
      'duplicate', true,
      'recipient_count', v_airdrop.recipient_count,
      'allocated_raw', v_airdrop.allocated_raw::text,
      'dust_raw', v_airdrop.dust_raw::text,
      'requested_raw', v_airdrop.requested_raw::text,
      'snapshot_slot', v_airdrop.snapshot_slot,
      'snapshot_provider', v_airdrop.snapshot_provider,
      'snapshot_fetched_at', v_airdrop.snapshot_fetched_at,
      'snapshot_checksum', v_airdrop.snapshot_checksum,
      'excluded_largest_owner', v_airdrop.excluded_largest_owner
    );
  end if;
  insert into public.linkr_holder_airdrops (
    user_id, launch_id, source_work_item_id, source_tweet_id, mint,
    wallet_id, wallet_address, source_token_account, token_decimals,
    source_balance_raw, requested_raw, allocated_raw, dust_raw,
    recipient_count, holder_account_count, snapshot_slot, snapshot_provider,
    snapshot_fetched_at, snapshot_checksum, snapshot_provenance, excluded_dev_wallet,
    excluded_largest_owner, idempotency_key
  ) values (
    p_user_id, p_launch_id, p_input_work_item_id, p_tweet_id, p_mint,
    p_wallet_id, p_wallet_address, p_source_token_account, p_token_decimals,
    p_source_balance_raw, p_requested_raw, p_allocated_raw, p_dust_raw,
    v_count, p_holder_account_count, p_snapshot_slot, p_snapshot_provider,
    p_snapshot_fetched_at, p_snapshot_provenance->>'checksum', coalesce(p_snapshot_provenance,'{}'::jsonb)
      || jsonb_build_object('provider',p_snapshot_provider,'slot',p_snapshot_slot),
    p_excluded_dev_wallet, p_excluded_largest_owner, v_key
  ) returning * into v_airdrop;
  insert into public.linkr_holder_airdrop_recipients (
    airdrop_id, ordinal, owner_address, holder_balance_raw, allocation_raw
  ) select v_airdrop.id, (x->>'ordinal')::integer, x->>'owner',
      (x->>'holder_balance_raw')::numeric, (x->>'allocation_raw')::numeric
    from jsonb_array_elements(p_recipients) x;
  insert into public.linkr_holder_airdrop_batches (
    airdrop_id, batch_index, first_ordinal, last_ordinal, recipient_count, allocated_raw
  ) select v_airdrop.id, ((ordinal - 1) / 4), min(ordinal), max(ordinal),
      count(*)::integer, sum(allocation_raw)
    from public.linkr_holder_airdrop_recipients where airdrop_id = v_airdrop.id
    group by ((ordinal - 1) / 4);
  update public.linkr_holder_airdrop_recipients r set batch_id = b.id, status = 'batched'
    from public.linkr_holder_airdrop_batches b
    where r.airdrop_id = v_airdrop.id and b.airdrop_id = r.airdrop_id
      and r.ordinal between b.first_ordinal and b.last_ordinal;
  insert into public.linkr_pending_actions (
    user_id, surface, surface_conversation_id, x_thread_id, action_type,
    status, confirmation_phrase, summary, action_payload, risk_summary,
    deterministic_validation, source_refs, idempotency_key, expires_at,
    source_surface, work_item_id
  ) values (
    p_user_id, 'x', p_surface_conversation_id, p_surface_conversation_id,
    'holder_airdrop', 'pending', 'confirm holder airdrop',
    format('Airdrop %s raw units of %s to %s eligible holders', p_allocated_raw, p_mint, v_count),
    jsonb_build_object('airdrop_id',v_airdrop.id,'mint',p_mint,'wallet_id',p_wallet_id,'snapshot_slot',p_snapshot_slot),
    jsonb_build_array('Moves the launched token from your launch wallet','Recipient allocations are immutable after preparation'),
    jsonb_build_object('owned_completed_solana_launch',true,'immutable_snapshot',true,'allocation_sum_raw',p_allocated_raw),
    jsonb_build_array(jsonb_build_object('tweet_id',p_tweet_id)),
    v_key, now() + interval '15 minutes', 'x', p_input_work_item_id
  ) returning * into v_pending;
  update public.linkr_holder_airdrops set pending_action_id = v_pending.id where id = v_airdrop.id;
  return jsonb_build_object(
    'airdrop_id',v_airdrop.id,'pending_action_id',v_pending.id,'duplicate',false,
    'recipient_count', v_airdrop.recipient_count,
    'allocated_raw', v_airdrop.allocated_raw::text,
    'dust_raw', v_airdrop.dust_raw::text,
    'requested_raw', v_airdrop.requested_raw::text,
    'snapshot_slot', v_airdrop.snapshot_slot,
    'snapshot_provider', v_airdrop.snapshot_provider,
    'snapshot_fetched_at', v_airdrop.snapshot_fetched_at,
    'snapshot_checksum', v_airdrop.snapshot_checksum,
    'excluded_largest_owner', v_airdrop.excluded_largest_owner
  );
end;
$$;

create or replace function public.confirm_linkr_holder_airdrop_v1(
  p_pending_action_id uuid, p_confirmation_work_item_id uuid
) returns jsonb language plpgsql security definer
set search_path = public, pgmq as $$
declare
  v_pending public.linkr_pending_actions%rowtype;
  v_airdrop public.linkr_holder_airdrops%rowtype;
  v_confirmation public.linkr_work_items%rowtype;
  v_accept jsonb;
  v_work_id uuid;
begin
  select * into v_pending from public.linkr_pending_actions
    where id = p_pending_action_id for update;
  if not found or v_pending.action_type <> 'holder_airdrop' then raise exception 'pending_holder_airdrop_not_found'; end if;
  select * into v_confirmation from public.linkr_work_items
    where id = p_confirmation_work_item_id and user_id = v_pending.user_id;
  if not found then raise exception 'holder_airdrop_confirmation_work_item_mismatch'; end if;
  select * into v_airdrop from public.linkr_holder_airdrops
    where pending_action_id = v_pending.id for update;
  if not found then raise exception 'holder_airdrop_ledger_missing'; end if;
  if v_pending.status in ('confirmed','executing','executed') then
    return jsonb_build_object('duplicate',true,'airdrop_id',v_airdrop.id,'work_item_id',v_airdrop.work_item_id);
  end if;
  if v_pending.status <> 'pending' then raise exception 'pending_holder_airdrop_not_confirmable'; end if;
  if v_pending.expires_at <= now() then
    update public.linkr_pending_actions set status='expired',updated_at=now() where id=v_pending.id;
    update public.linkr_holder_airdrops set status='expired',updated_at=now() where id=v_airdrop.id;
    return jsonb_build_object('expired',true,'airdrop_id',v_airdrop.id);
  end if;
  v_accept := public.accept_linkr_work_item(
    p_idempotency_key => 'holder-airdrop-solana:' || v_airdrop.id::text || ':v1',
    p_source_surface => 'x', p_source_event_id => v_airdrop.source_tweet_id,
    p_user_id => v_airdrop.user_id, p_conversation_id => null::uuid,
    p_request_type => 'holder_airdrop', p_route => 'holder_airdrop.solana',
    p_priority => 50::smallint, p_resource_type => 'wallet',
    p_resource_key => v_airdrop.wallet_id::text,
    p_payload => jsonb_build_object('schema_version',1,'airdrop_id',v_airdrop.id,'pending_action_id',v_pending.id),
    p_payload_hash => null, p_consumer_version => 'worker-holder-airdrop-solana-v1',
    p_execution_generation => 1
  );
  v_work_id := (v_accept->>'work_item_id')::uuid;
  update public.linkr_pending_actions set status='confirmed',confirmed_at=coalesce(confirmed_at,now()),
    work_item_id=v_work_id,updated_at=now() where id=v_pending.id;
  update public.linkr_holder_airdrops set status='queued',confirmed_at=coalesce(confirmed_at,now()),
    work_item_id=v_work_id,updated_at=now() where id=v_airdrop.id;
  return jsonb_build_object('duplicate',false,'airdrop_id',v_airdrop.id,'work_item_id',v_work_id);
end;
$$;

create or replace function public.cancel_linkr_holder_airdrop_v1(
  p_pending_action_id uuid, p_cancellation_work_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.linkr_pending_actions%rowtype;
begin
  select * into v_pending from public.linkr_pending_actions where id=p_pending_action_id for update;
  if not found or v_pending.action_type <> 'holder_airdrop' then raise exception 'pending_holder_airdrop_not_found'; end if;
  if not exists (select 1 from public.linkr_work_items where id=p_cancellation_work_item_id and user_id=v_pending.user_id) then
    raise exception 'holder_airdrop_cancellation_work_item_mismatch';
  end if;
  if v_pending.status <> 'pending' then raise exception 'pending_holder_airdrop_not_cancellable'; end if;
  update public.linkr_pending_actions set status='cancelled',cancelled_at=now(),updated_at=now() where id=v_pending.id;
  update public.linkr_holder_airdrops set status='cancelled',updated_at=now() where pending_action_id=v_pending.id;
  update public.linkr_holder_airdrop_batches set status='cancelled',updated_at=now()
    where airdrop_id=(select id from public.linkr_holder_airdrops where pending_action_id=v_pending.id);
  return jsonb_build_object('cancelled',true,'pending_action_id',v_pending.id);
end;
$$;

create or replace function public.claim_linkr_holder_airdrop_batch_v1(
  p_airdrop_id uuid, p_work_item_id uuid, p_claim_token uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_airdrop public.linkr_holder_airdrops%rowtype;
declare v_batch public.linkr_holder_airdrop_batches%rowtype;
begin
  select * into v_airdrop from public.linkr_holder_airdrops
    where id=p_airdrop_id and work_item_id=p_work_item_id
      and status in ('queued','validating','executing','reconciling') for update;
  if not found then raise exception 'holder_airdrop_not_claimable'; end if;
  select * into v_batch from public.linkr_holder_airdrop_batches
    where airdrop_id=p_airdrop_id and (
      status='planned' or (
        status='claimed' and claim_expires_at < now()
        and signed_transaction is null and signature is null
      )
    )
    order by batch_index for update skip locked limit 1;
  if not found then return jsonb_build_object('complete',true); end if;
  update public.linkr_holder_airdrop_batches set status='claimed',claim_token=p_claim_token,
    claimed_at=now(),claim_expires_at=now()+interval '10 minutes',
    attempt_count=attempt_count+1,updated_at=now() where id=v_batch.id;
  update public.linkr_holder_airdrops set status='validating',updated_at=now() where id=v_airdrop.id;
  return jsonb_build_object('complete',false,'batch_id',v_batch.id,'batch_index',v_batch.batch_index);
end;
$$;

create or replace function public.record_linkr_holder_airdrop_batch_signed_v1(
  p_batch_id uuid, p_airdrop_id uuid, p_work_item_id uuid, p_claim_token uuid,
  p_signed_transaction_base64 text, p_signed_transaction_hash text,
  p_signature text, p_blockhash text, p_last_valid_block_height bigint,
  p_simulation_result jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_airdrop public.linkr_holder_airdrops%rowtype;
declare v_batch public.linkr_holder_airdrop_batches%rowtype;
declare v_signed bytea;
begin
  select * into v_airdrop from public.linkr_holder_airdrops
    where id=p_airdrop_id and work_item_id=p_work_item_id
      and status in ('queued','validating','executing','reconciling') for update;
  if not found then raise exception 'holder_airdrop_not_signable'; end if;
  select * into v_batch from public.linkr_holder_airdrop_batches
    where id=p_batch_id and airdrop_id=p_airdrop_id for update;
  if not found then raise exception 'holder_airdrop_batch_not_found'; end if;
  if v_batch.status in ('signed','broadcasting','broadcast','reconciling','confirmed') then
    if v_batch.signature = p_signature and v_batch.signed_transaction_hash = p_signed_transaction_hash then
      return jsonb_build_object('batch_id',v_batch.id,'signature',v_batch.signature,'duplicate',true,'status',v_batch.status);
    end if;
    raise exception 'holder_airdrop_batch_signed_conflict';
  end if;
  if v_batch.status <> 'claimed' or v_batch.claim_token is distinct from p_claim_token then
    raise exception 'holder_airdrop_batch_claim_required';
  end if;
  if coalesce(p_signature,'') = '' or coalesce(p_blockhash,'') = ''
    or p_signed_transaction_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'holder_airdrop_signed_metadata_invalid';
  end if;
  v_signed := decode(p_signed_transaction_base64, 'base64');
  if length(v_signed) < 1 or length(v_signed) > 1232 then
    raise exception 'holder_airdrop_signed_transaction_size_invalid';
  end if;
  update public.linkr_holder_airdrop_batches set
    status='signed',
    signed_transaction=v_signed,
    signed_transaction_hash=p_signed_transaction_hash,
    signature=p_signature,
    blockhash=p_blockhash,
    last_valid_block_height=p_last_valid_block_height,
    simulation_result=coalesce(p_simulation_result,'{}'::jsonb),
    last_error_code=null,
    updated_at=now()
    where id=v_batch.id;
  update public.linkr_holder_airdrop_recipients set
    status='signed', transaction_signature=p_signature, updated_at=now()
    where batch_id=v_batch.id;
  update public.linkr_holder_airdrops set status='executing',updated_at=now()
    where id=v_airdrop.id;
  return jsonb_build_object('batch_id',v_batch.id,'signature',p_signature,'duplicate',false,'status','signed');
end;
$$;

create or replace function public.mark_linkr_holder_airdrop_batch_broadcasting_v1(
  p_batch_id uuid, p_airdrop_id uuid, p_work_item_id uuid, p_signature text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_batch public.linkr_holder_airdrop_batches%rowtype;
begin
  if not exists (
    select 1 from public.linkr_holder_airdrops
    where id=p_airdrop_id and work_item_id=p_work_item_id
      and status in ('queued','validating','executing','reconciling')
  ) then raise exception 'holder_airdrop_not_broadcastable'; end if;
  select * into v_batch from public.linkr_holder_airdrop_batches
    where id=p_batch_id and airdrop_id=p_airdrop_id and signature=p_signature for update;
  if not found then raise exception 'holder_airdrop_batch_not_broadcastable'; end if;
  if v_batch.status in ('broadcasting','broadcast','reconciling','confirmed') then
    return jsonb_build_object('batch_id',v_batch.id,'signature',v_batch.signature,'duplicate',true,'status',v_batch.status);
  end if;
  if v_batch.status <> 'signed' then raise exception 'holder_airdrop_batch_not_signed'; end if;
  update public.linkr_holder_airdrop_batches set status='broadcasting',updated_at=now()
    where id=v_batch.id and status='signed';
  update public.linkr_holder_airdrops set status='reconciling',updated_at=now()
    where id=p_airdrop_id;
  return jsonb_build_object('batch_id',v_batch.id,'signature',v_batch.signature,'duplicate',false,'status','broadcasting');
end;
$$;

create or replace function public.record_linkr_holder_airdrop_batch_broadcast_v1(
  p_batch_id uuid, p_airdrop_id uuid, p_work_item_id uuid, p_signature text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_batch public.linkr_holder_airdrop_batches%rowtype;
begin
  if not exists (
    select 1 from public.linkr_holder_airdrops
    where id=p_airdrop_id and work_item_id=p_work_item_id
      and status in ('executing','reconciling')
  ) then raise exception 'holder_airdrop_not_broadcastable'; end if;
  select * into v_batch from public.linkr_holder_airdrop_batches
    where id=p_batch_id and airdrop_id=p_airdrop_id and signature=p_signature for update;
  if not found then raise exception 'holder_airdrop_batch_not_found'; end if;
  if v_batch.status in ('confirmed','failed') then
    return jsonb_build_object('batch_id',v_batch.id,'signature',v_batch.signature,'duplicate',true,'status',v_batch.status);
  end if;
  if v_batch.status not in ('broadcasting','broadcast','reconciling') then
    raise exception 'holder_airdrop_batch_broadcasting_required';
  end if;
  update public.linkr_holder_airdrop_batches set
    status='broadcast',
    broadcast_at=coalesce(broadcast_at,now()),
    broadcast_attempt_count=broadcast_attempt_count + case when broadcast_at is null then 1 else 0 end,
    updated_at=now()
    where id=v_batch.id;
  update public.linkr_holder_airdrop_recipients set
    status='broadcast', transaction_signature=p_signature, updated_at=now()
    where batch_id=v_batch.id and status in ('signed','broadcast','reconciling');
  update public.linkr_holder_airdrops set status='reconciling',updated_at=now()
    where id=p_airdrop_id;
  return jsonb_build_object('batch_id',v_batch.id,'signature',v_batch.signature,'duplicate',false,'status','broadcast');
end;
$$;

create or replace function public.settle_linkr_holder_airdrop_batch_v1(
  p_batch_id uuid, p_airdrop_id uuid, p_work_item_id uuid, p_signature text,
  p_outcome text, p_error_code text, p_slot bigint, p_confirmation jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_remaining integer;
declare v_failed integer;
declare v_status text;
begin
  if p_outcome not in ('confirmed','failed','pending') then
    raise exception 'holder_airdrop_settlement_outcome_invalid';
  end if;
  if not exists (
    select 1 from public.linkr_holder_airdrops
    where id=p_airdrop_id and work_item_id=p_work_item_id
      and status in ('queued','validating','executing','reconciling','completed','failed')
  ) then raise exception 'holder_airdrop_settlement_airdrop_missing'; end if;
  if p_outcome='pending' then
    update public.linkr_holder_airdrop_batches set
      status='reconciling',
      last_error_code=coalesce(p_error_code,last_error_code),
      simulation_result=coalesce(simulation_result,'{}'::jsonb)
        || jsonb_build_object('last_confirmation',coalesce(p_confirmation,'{}'::jsonb),'last_checked_at',now()),
      updated_at=now()
      where id=p_batch_id and airdrop_id=p_airdrop_id and signature=p_signature
        and status in ('broadcasting','broadcast','reconciling');
    update public.linkr_holder_airdrops set status='reconciling',updated_at=now()
      where id=p_airdrop_id and status not in ('failed','completed');
    return jsonb_build_object('airdrop_status','reconciling','terminal',false);
  end if;
  if p_outcome='confirmed' then
    update public.linkr_holder_airdrop_batches set
      status='confirmed', confirmed_at=coalesce(confirmed_at,now()),
      last_error_code=null,
      simulation_result=coalesce(simulation_result,'{}'::jsonb)
        || jsonb_build_object('confirmation',coalesce(p_confirmation,'{}'::jsonb),'slot',p_slot),
      updated_at=now()
      where id=p_batch_id and airdrop_id=p_airdrop_id and signature=p_signature
        and status in ('broadcasting','broadcast','reconciling','confirmed');
    update public.linkr_holder_airdrop_recipients set
      status='confirmed', transaction_signature=p_signature, updated_at=now()
      where batch_id=p_batch_id;
  else
    update public.linkr_holder_airdrop_batches set
      status='failed', last_error_code=left(coalesce(p_error_code,'holder_airdrop_batch_failed'),120),
      simulation_result=coalesce(simulation_result,'{}'::jsonb)
        || jsonb_build_object('failure',coalesce(p_confirmation,'{}'::jsonb),'slot',p_slot),
      updated_at=now()
      where id=p_batch_id and airdrop_id=p_airdrop_id and signature=p_signature
        and status in ('broadcasting','broadcast','reconciling','failed');
    update public.linkr_holder_airdrop_recipients set
      status='failed', transaction_signature=p_signature, updated_at=now()
      where batch_id=p_batch_id;
  end if;
  select count(*) filter (where status in ('planned','claimed','signed','broadcasting','broadcast','reconciling')),
         count(*) filter (where status='failed')
    into v_remaining, v_failed
    from public.linkr_holder_airdrop_batches where airdrop_id=p_airdrop_id;
  if v_failed > 0 then
    update public.linkr_holder_airdrops set
      status='failed', failure_code=left(coalesce(p_error_code,'holder_airdrop_batch_failed'),120),
      completed_at=coalesce(completed_at,now()), updated_at=now()
      where id=p_airdrop_id and status <> 'completed';
    update public.linkr_pending_actions set status='failed', updated_at=now()
      where id=(select pending_action_id from public.linkr_holder_airdrops where id=p_airdrop_id)
        and status in ('pending','confirmed','executing');
    v_status := 'failed';
  elsif v_remaining = 0 then
    update public.linkr_holder_airdrops set
      status='completed', completed_at=coalesce(completed_at,now()), updated_at=now()
      where id=p_airdrop_id and status <> 'completed';
    update public.linkr_pending_actions set status='executed', updated_at=now()
      where id=(select pending_action_id from public.linkr_holder_airdrops where id=p_airdrop_id)
        and status in ('pending','confirmed','executing');
    v_status := 'completed';
  else
    update public.linkr_holder_airdrops set status='reconciling',updated_at=now()
      where id=p_airdrop_id and status not in ('failed','completed');
    v_status := 'reconciling';
  end if;
  return jsonb_build_object('airdrop_status',v_status,'terminal',v_status in ('completed','failed'));
end;
$$;

create or replace function public.notify_linkr_holder_airdrop_terminal_v1(
  p_airdrop_id uuid, p_work_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_airdrop public.linkr_holder_airdrops%rowtype;
declare v_batch_count integer;
declare v_text text;
begin
  select * into v_airdrop from public.linkr_holder_airdrops
    where id=p_airdrop_id and work_item_id=p_work_item_id for update;
  if not found then raise exception 'holder_airdrop_notification_airdrop_missing'; end if;
  if v_airdrop.status not in ('completed','failed') then
    return jsonb_build_object('notified',false,'status',v_airdrop.status);
  end if;
  if v_airdrop.notification_sent_at is not null then
    return jsonb_build_object('notified',false,'status',v_airdrop.status,'duplicate',true);
  end if;
  select count(*) into v_batch_count from public.linkr_holder_airdrop_batches where airdrop_id=v_airdrop.id;
  if v_airdrop.status='completed' then
    v_text := format('Holder airdrop completed: %s raw units of %s to %s holders across %s confirmed batch(es).',
      v_airdrop.allocated_raw::text, v_airdrop.mint, v_airdrop.recipient_count, v_batch_count);
  else
    v_text := format('Holder airdrop stopped: %s. No replacement transactions will be created.',
      coalesce(v_airdrop.failure_code,'holder_airdrop_failed'));
  end if;
  perform public.enqueue_linkr_x_reply_v1(
    p_work_item_id, left(v_text,280),
    case when v_airdrop.status='completed' then 'holder_airdrop_completed' else 'holder_airdrop_failed' end,
    1, 80::smallint
  );
  update public.linkr_holder_airdrops set notification_sent_at=now(),updated_at=now()
    where id=v_airdrop.id;
  return jsonb_build_object('notified',true,'status',v_airdrop.status);
end;
$$;

revoke all on function public.prepare_linkr_holder_airdrop_v1(uuid,uuid,text,text,uuid,text,uuid,text,text,integer,numeric,numeric,numeric,numeric,integer,bigint,text,timestamptz,text,text,jsonb,jsonb) from public;
revoke all on function public.confirm_linkr_holder_airdrop_v1(uuid,uuid) from public;
revoke all on function public.cancel_linkr_holder_airdrop_v1(uuid,uuid) from public;
revoke all on function public.claim_linkr_holder_airdrop_batch_v1(uuid,uuid,uuid) from public;
revoke all on function public.record_linkr_holder_airdrop_batch_signed_v1(uuid,uuid,uuid,uuid,text,text,text,text,bigint,jsonb) from public;
revoke all on function public.mark_linkr_holder_airdrop_batch_broadcasting_v1(uuid,uuid,uuid,text) from public;
revoke all on function public.record_linkr_holder_airdrop_batch_broadcast_v1(uuid,uuid,uuid,text) from public;
revoke all on function public.settle_linkr_holder_airdrop_batch_v1(uuid,uuid,uuid,text,text,text,bigint,jsonb) from public;
revoke all on function public.notify_linkr_holder_airdrop_terminal_v1(uuid,uuid) from public;
grant execute on function public.prepare_linkr_holder_airdrop_v1(uuid,uuid,text,text,uuid,text,uuid,text,text,integer,numeric,numeric,numeric,numeric,integer,bigint,text,timestamptz,text,text,jsonb,jsonb) to service_role;
grant execute on function public.confirm_linkr_holder_airdrop_v1(uuid,uuid) to service_role;
grant execute on function public.cancel_linkr_holder_airdrop_v1(uuid,uuid) to service_role;
grant execute on function public.claim_linkr_holder_airdrop_batch_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.record_linkr_holder_airdrop_batch_signed_v1(uuid,uuid,uuid,uuid,text,text,text,text,bigint,jsonb) to service_role;
grant execute on function public.mark_linkr_holder_airdrop_batch_broadcasting_v1(uuid,uuid,uuid,text) to service_role;
grant execute on function public.record_linkr_holder_airdrop_batch_broadcast_v1(uuid,uuid,uuid,text) to service_role;
grant execute on function public.settle_linkr_holder_airdrop_batch_v1(uuid,uuid,uuid,text,text,text,bigint,jsonb) to service_role;
grant execute on function public.notify_linkr_holder_airdrop_terminal_v1(uuid,uuid) to service_role;

do $$ begin
  if to_regclass('pgmq.q_holder_airdrop_solana') is null then perform pgmq.create('holder_airdrop_solana'); end if;
end $$;
insert into public.linkr_queue_runtime_config (
  stage,worker_function,enabled,batch_size,visibility_timeout_seconds,max_concurrency,consumer_version,rollout_percent,canary_user_ids
) values ('holder_airdrop_solana','worker-holder-airdrop-solana',false,1,600,1,'worker-holder-airdrop-solana-v1',0,'{}'::uuid[])
on conflict(stage) do update set worker_function=excluded.worker_function,enabled=false,
  batch_size=1,visibility_timeout_seconds=600,max_concurrency=1,
  consumer_version=excluded.consumer_version,rollout_percent=0,canary_user_ids='{}'::uuid[],updated_at=now();
-- Operational enable step after migration validation and canary approval:
-- update public.linkr_queue_runtime_config
-- set enabled = true, rollout_percent = <canary_or_full>, canary_user_ids = <approved_user_ids>, updated_at = now()
-- where stage='holder_airdrop_solana';
insert into public.linkr_dispatch_stage_state(stage) values('holder_airdrop_solana') on conflict do nothing;
insert into public.linkr_worker_capacity_slots(stage,slot_number) values('holder_airdrop_solana',1) on conflict do nothing;

create or replace function public.linkr_queue_for_route(p_route text,p_priority smallint default 50)
returns text language sql immutable strict set search_path=public as $$
select case
  when p_route='x.ingress' then 'x_ingress' when p_route='telegram.control' then 'telegram_control'
  when p_route='conversation.turn' and p_priority>=80 then 'conversation_turns_high'
  when p_route='conversation.turn' then 'conversation_turns_normal'
  when p_route='sms.turn' and p_priority>=80 then 'sms_turns_high' when p_route='sms.turn' then 'sms_turns_normal'
  when p_route='command.prepare' then 'command_prepare' when p_route='launch.enrich' then 'launch_enrich'
  when p_route='media.capture' then 'media_capture' when p_route='image.generate' then 'image_generate'
  when p_route='nft.solana' then 'nft_solana' when p_route='holder_airdrop.solana' then 'holder_airdrop_solana'
  when p_route='action.solana' then 'action_solana' when p_route='action.robinhood' then 'action_robinhood'
  when p_route='launch.solana' then 'launch_solana' when p_route='launch.robinhood' then 'launch_robinhood'
  when p_route='confirm.solana' then 'confirm_solana' when p_route='confirm.robinhood' then 'confirm_robinhood'
  when p_route='reply.x' and p_priority>=80 then 'reply_x_high' when p_route='reply.x' then 'reply_x_normal'
  when p_route='reply.telegram' and p_priority>=80 then 'reply_telegram_high' when p_route='reply.telegram' then 'reply_telegram_normal'
  when p_route='reply.sms' and p_priority>=80 then 'reply_sms_high' when p_route='reply.sms' then 'reply_sms_normal'
  when p_route='reconciliation' then 'reconciliation' else null end;
$$;
create or replace function public.linkr_queue_for_route(p_route text,p_priority integer)
returns text language sql immutable strict set search_path=public as $$
select case when p_priority between -32768 and 32767 then public.linkr_queue_for_route(p_route,p_priority::smallint) else null end;
$$;
