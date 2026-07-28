-- Chain worker cutover contract: explicit rollout, idempotent launch creation,
-- and atomic domain finalization around the existing fenced transaction outbox.

alter table public.linkr_queue_runtime_config
  add column if not exists rollout_percent smallint not null default 100,
  add column if not exists canary_user_ids uuid[] not null default '{}'::uuid[],
  add column if not exists observation_started_at timestamptz,
  add column if not exists routed_count bigint not null default 0;

alter table public.linkr_queue_runtime_config
  drop constraint if exists linkr_queue_runtime_rollout_percent_check;
alter table public.linkr_queue_runtime_config
  add constraint linkr_queue_runtime_rollout_percent_check
  check (rollout_percent between 0 and 100);

update public.linkr_queue_runtime_config
set rollout_percent = 0, canary_user_ids = '{}'::uuid[],
    observation_started_at = null, routed_count = 0, updated_at = now()
where stage in ('launch_robinhood', 'launch_solana');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'linkr_chain_transactions_work_item_id_fkey'
  ) then
    alter table public.linkr_chain_transactions
      add constraint linkr_chain_transactions_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'linkr_chain_transactions_wallet_id_fkey'
  ) then
    alter table public.linkr_chain_transactions
      add constraint linkr_chain_transactions_wallet_id_fkey
      foreign key (wallet_id) references public.wallets(id)
      on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'linkr_chain_transactions_launch_id_fkey'
  ) then
    alter table public.linkr_chain_transactions
      add constraint linkr_chain_transactions_launch_id_fkey
      foreign key (launch_id) references public.coin_launches(id)
      on delete restrict not valid;
  end if;
end;
$$;

alter table public.linkr_chain_transactions
  validate constraint linkr_chain_transactions_work_item_id_fkey;
alter table public.linkr_chain_transactions
  validate constraint linkr_chain_transactions_launch_id_fkey;

-- One pre-existing fenced-outbox failure-injection fixture intentionally uses
-- a synthetic wallet UUID. Keep this FK NOT VALID so all new writes are still
-- enforced without rewriting historical test evidence.

create or replace function public.linkr_chain_rollout_allowed_v1(
  p_work_item_id uuid,
  p_stage text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_config public.linkr_queue_runtime_config%rowtype;
  v_bucket integer;
begin
  if p_stage not in ('launch_robinhood', 'launch_solana') then
    raise exception 'unsupported_chain_rollout_stage';
  end if;
  select * into v_item from public.linkr_work_items where id = p_work_item_id;
  if not found then raise exception 'work_item_not_found'; end if;
  select * into v_config from public.linkr_queue_runtime_config where stage = p_stage;
  if not found or not v_config.enabled then return false; end if;
  if v_item.user_id = any(v_config.canary_user_ids) then return true; end if;
  if v_config.rollout_percent <= 0 then return false; end if;
  if v_config.rollout_percent >= 100 then return true; end if;
  v_bucket := mod(
    hashtextextended(v_item.idempotency_key, v_item.execution_generation)
      & 9223372036854775807,
    100
  )::integer;
  return v_bucket < v_config.rollout_percent;
end;
$$;

create or replace function public.ensure_linkr_coin_launch_v1(
  p_work_item_id uuid,
  p_pending_action_id uuid,
  p_image_url text,
  p_original_image_url text,
  p_storage_path text,
  p_image_sha256 text,
  p_image_content_type text,
  p_image_width integer,
  p_image_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_pending public.linkr_pending_actions%rowtype;
  v_launch public.coin_launches%rowtype;
  v_payload jsonb;
  v_chain text;
  v_wallet_id uuid;
begin
  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  select * into v_pending from public.linkr_pending_actions
  where id = p_pending_action_id and work_item_id = p_work_item_id for update;
  if not found then raise exception 'pending_launch_not_found'; end if;
  if v_pending.status not in ('confirmed', 'executing', 'executed') then
    raise exception 'pending_launch_not_confirmed';
  end if;
  if v_pending.user_id is distinct from v_item.user_id then
    raise exception 'launch_user_mismatch';
  end if;
  v_payload := coalesce(v_pending.action_payload, '{}'::jsonb);
  v_chain := v_payload->>'chain';
  if v_chain not in ('solana', 'robinhood') then
    raise exception 'launch_chain_missing';
  end if;
  begin
    v_wallet_id := nullif(v_payload->>'wallet_id', '')::uuid;
  exception when others then
    raise exception 'launch_wallet_invalid';
  end;
  if v_wallet_id is null or not exists (
    select 1 from public.wallets
    where id = v_wallet_id and user_id = v_pending.user_id
      and ((v_chain = 'solana' and wallet_type = 'solana')
        or (v_chain = 'robinhood' and wallet_type = 'evm' and chain_id = 4663))
  ) then raise exception 'launch_wallet_mismatch'; end if;
  if coalesce(length(btrim(p_image_url)), 0) = 0
     or coalesce(length(btrim(p_original_image_url)), 0) = 0 then
    raise exception 'launch_image_missing';
  end if;

  insert into public.coin_launches (
    user_id, tweet_id, source_tweet_id, name, symbol, description,
    image_url, original_image_url, stable_logo_url, token_logo_storage_path,
    chain, launch_platform, launch_signer_wallet_id, solana_launch_wallet_id,
    status, work_item_id, action_ordinal, launch_metadata
  ) values (
    v_pending.user_id, v_item.source_event_id, v_item.source_event_id,
    btrim(v_payload->>'name'), upper(btrim(v_payload->>'symbol')),
    btrim(v_payload->>'description'), p_image_url, p_original_image_url,
    p_image_url, p_storage_path, v_chain,
    case when v_chain = 'solana' then 'pump_fun'
      else 'robinhood_single_sided_lp' end,
    v_wallet_id, case when v_chain = 'solana' then v_wallet_id else null end,
    'pending', v_item.id, 0,
    jsonb_build_object(
      'queue_version', 'worker-media-capture-v1',
      'pending_action_id', v_pending.id,
      'image_sha256', p_image_sha256,
      'image_content_type', p_image_content_type,
      'image_width', p_image_width,
      'image_height', p_image_height
    )
  )
  on conflict (work_item_id, action_ordinal) where work_item_id is not null
  do update set
    image_url = excluded.image_url,
    original_image_url = excluded.original_image_url,
    stable_logo_url = excluded.stable_logo_url,
    token_logo_storage_path = excluded.token_logo_storage_path,
    launch_metadata = public.coin_launches.launch_metadata || excluded.launch_metadata
  returning * into v_launch;

  update public.linkr_pending_actions
  set status = case when status = 'confirmed' then 'executing' else status end,
      action_payload = v_payload || jsonb_build_object(
        'image_url', p_image_url,
        'original_image_url', p_original_image_url,
        'stable_logo_url', p_image_url,
        'token_logo_storage_path', p_storage_path,
        'image_sha256', p_image_sha256,
        'image_content_type', p_image_content_type,
        'image_width', p_image_width,
        'image_height', p_image_height,
        'coin_launch_id', v_launch.id
      ),
      updated_at = now()
  where id = v_pending.id;

  return jsonb_build_object(
    'launch_id', v_launch.id, 'chain', v_chain,
    'wallet_id', v_wallet_id, 'existing', v_launch.created_at < now() - interval '1 second'
  );
end;
$$;

create or replace function public.finalize_linkr_coin_launch_v1(
  p_work_item_id uuid,
  p_launch_id uuid,
  p_transaction_id uuid,
  p_chain text,
  p_transaction_hash text,
  p_token_address text,
  p_explorer_url text,
  p_reply_text text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_launch public.coin_launches%rowtype;
  v_tx public.linkr_chain_transactions%rowtype;
  v_reply jsonb;
begin
  if p_chain not in ('solana', 'robinhood') then raise exception 'unsupported_chain'; end if;
  if octet_length(coalesce(p_details, '{}'::jsonb)::text) > 16384 then
    raise exception 'launch_details_too_large';
  end if;
  if coalesce(length(btrim(p_reply_text)), 0) not between 1 and 280 then
    raise exception 'launch_reply_length_invalid';
  end if;
  select * into v_launch from public.coin_launches
  where id = p_launch_id and work_item_id = p_work_item_id for update;
  if not found then raise exception 'coin_launch_not_found'; end if;
  select * into v_tx from public.linkr_chain_transactions
  where id = p_transaction_id and work_item_id = p_work_item_id
    and launch_id = p_launch_id and chain = p_chain for update;
  if not found then raise exception 'chain_transaction_not_found'; end if;
  if v_tx.state <> 'confirmed' then raise exception 'chain_transaction_not_confirmed'; end if;
  if v_tx.transaction_hash is distinct from p_transaction_hash then
    raise exception 'chain_transaction_hash_mismatch';
  end if;

  update public.coin_launches set
    status = 'confirmed', mint = p_token_address,
    token_address = p_token_address, tx_hash = p_transaction_hash,
    tx_signature = p_transaction_hash, explorer_url = p_explorer_url,
    processed_at = coalesce(processed_at, now()), error = null,
    pump_metadata_uri = case when p_chain = 'solana'
      then coalesce(p_details->>'metadata_uri', pump_metadata_uri) else pump_metadata_uri end,
    pump_url = case when p_chain = 'solana'
      then coalesce(p_details->>'pump_url', pump_url) else pump_url end,
    solscan_url = case when p_chain = 'solana'
      then coalesce(p_details->>'solscan_url', solscan_url) else solscan_url end,
    pump_receipt = case when p_chain = 'solana'
      then coalesce(pump_receipt, '{}'::jsonb) || p_details else pump_receipt end,
    factory = case when p_chain = 'robinhood'
      then coalesce(p_details->>'factory', factory) else factory end,
    deployer = case when p_chain = 'robinhood'
      then coalesce(p_details->>'creator', deployer) else deployer end,
    pool = case when p_chain = 'robinhood'
      then coalesce(p_details->>'pool', pool) else pool end,
    launch_metadata = coalesce(launch_metadata, '{}'::jsonb) ||
      jsonb_build_object('queue_finalized', true, 'transaction_id', p_transaction_id) || p_details
  where id = p_launch_id;

  update public.linkr_pending_actions
  set status = 'executed', updated_at = now()
  where work_item_id = p_work_item_id and status in ('confirmed', 'executing');

  select public.enqueue_linkr_x_reply_v1(
    p_work_item_id, p_reply_text, 'launch_success', 1, 80
  ) into v_reply;
  return jsonb_build_object(
    'launch_id', p_launch_id, 'transaction_id', p_transaction_id,
    'reply_work_item_id', v_reply->>'reply_work_item_id'
  );
end;
$$;

create or replace function public.record_linkr_platform_incident_v1(
  p_fingerprint text,
  p_severity text,
  p_title text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(length(btrim(p_fingerprint)), 0) not between 1 and 240 then
    raise exception 'incident_fingerprint_invalid';
  end if;
  if p_severity not in ('warning', 'critical') then
    raise exception 'incident_severity_invalid';
  end if;
  if coalesce(length(btrim(p_title)), 0) not between 1 and 240 then
    raise exception 'incident_title_invalid';
  end if;
  if octet_length(coalesce(p_details, '{}'::jsonb)::text) > 16384 then
    raise exception 'incident_details_too_large';
  end if;
  insert into public.linkr_platform_incidents (
    fingerprint, severity, title, details
  ) values (p_fingerprint, p_severity, p_title, coalesce(p_details, '{}'::jsonb))
  on conflict (fingerprint) where state = 'open' do update set
    severity = excluded.severity,
    title = excluded.title,
    details = excluded.details,
    occurrence_count = public.linkr_platform_incidents.occurrence_count + 1,
    last_seen_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.linkr_chain_rollout_allowed_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.linkr_chain_rollout_allowed_v1(uuid, text)
  to service_role, postgres;
revoke all on function public.ensure_linkr_coin_launch_v1(
  uuid, uuid, text, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.ensure_linkr_coin_launch_v1(
  uuid, uuid, text, text, text, text, text, integer, integer
) to service_role;
revoke all on function public.finalize_linkr_coin_launch_v1(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_linkr_coin_launch_v1(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) to service_role;
revoke all on function public.record_linkr_platform_incident_v1(
  text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_linkr_platform_incident_v1(
  text, text, text, jsonb
) to service_role, postgres;
