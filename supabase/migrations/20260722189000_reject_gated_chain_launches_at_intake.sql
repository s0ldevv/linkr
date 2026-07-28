-- Reject launches for a chain whose execution stage is gated (disabled or
-- rollout 0) at acceptance time instead of accepting a 202 that can never
-- complete. Canary users mirror linkr_chain_rollout_allowed_v1 and may still
-- pass. Body otherwise identical to 20260722176000.

create or replace function public.accept_linkr_launch_request_v1(
  p_user_id uuid,
  p_source_surface text,
  p_source_event_id text,
  p_idempotency_key text,
  p_chain text,
  p_wallet_id uuid,
  p_payload jsonb,
  p_pending_action_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_surface text;
  v_accept jsonb;
  v_work_id uuid;
  v_pending public.linkr_pending_actions%rowtype;
  v_mode text;
  v_payload_hash text;
  v_existing_hash text;
begin
  select mode into v_mode from public.linkr_platform_control
  where singleton;
  if v_mode in ('intake_paused', 'commands_paused') then
    raise exception 'platform_commands_paused';
  end if;
  if p_user_id is null then raise exception 'launch_user_required'; end if;
  v_surface := public.normalize_action_source_surface(p_source_surface, 'unknown');
  if v_surface not in ('agent_api', 'dashboard', 'terminal', 'telegram') then
    raise exception 'unsupported_launch_source';
  end if;
  p_idempotency_key := btrim(coalesce(p_idempotency_key, ''));
  if length(p_idempotency_key) not between 1 and 180 then
    raise exception 'launch_idempotency_key_invalid';
  end if;
  if p_chain not in ('solana', 'robinhood') then
    raise exception 'unsupported_launch_chain';
  end if;
  if not exists (
    select 1 from public.linkr_queue_runtime_config
    where stage = case p_chain
        when 'solana' then 'launch_solana'
        else 'launch_robinhood'
      end
      and enabled
      and (rollout_percent > 0 or p_user_id = any(canary_user_ids))
  ) then
    raise exception '%', p_chain || '_launches_temporarily_unavailable';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384 then
    raise exception 'launch_payload_invalid';
  end if;
  if length(btrim(coalesce(p_payload->>'name', ''))) not between 1 and 80
     or length(btrim(coalesce(p_payload->>'symbol', ''))) not between 1 and 20
     or length(btrim(coalesce(p_payload->>'description', ''))) not between 1 and 512
     or coalesce(p_payload->>'image_url', '') !~ '^https://' then
    raise exception 'launch_payload_fields_invalid';
  end if;
  if not exists (
    select 1 from public.wallets
    where id = p_wallet_id and user_id = p_user_id
      and (
        (p_chain = 'solana' and wallet_type = 'solana') or
        (p_chain = 'robinhood' and wallet_type = 'evm' and chain_id = 4663)
      )
  ) then raise exception 'launch_wallet_mismatch'; end if;

  v_payload_hash := encode(
    extensions.digest(convert_to(p_payload::text, 'utf8'), 'sha256'), 'hex'
  );
  v_accept := public.accept_linkr_work_item(
    p_idempotency_key => 'launch:' || v_surface || ':' || p_idempotency_key,
    p_source_surface => v_surface,
    p_source_event_id => left(coalesce(nullif(btrim(p_source_event_id), ''), p_idempotency_key), 200),
    p_user_id => p_user_id,
    p_conversation_id => null::uuid,
    p_request_type => 'launch_coin'::text,
    p_route => 'media.capture'::text,
    p_priority => 70::smallint,
    p_resource_type => 'wallet'::text,
    p_resource_key => p_chain || ':' || p_wallet_id::text,
    p_payload => jsonb_build_object('schema_version', 1, 'chain', p_chain),
    p_payload_ref => null::text,
    p_payload_hash => v_payload_hash,
    p_consumer_version => 'worker-media-capture-v1'::text,
    p_execution_generation => 1::bigint
  );
  v_work_id := (v_accept->>'work_item_id')::uuid;
  select payload_hash into v_existing_hash from public.linkr_work_items
  where id = v_work_id;
  if v_existing_hash is distinct from v_payload_hash then
    raise exception 'idempotency_payload_mismatch';
  end if;

  if p_pending_action_id is not null then
    select * into v_pending from public.linkr_pending_actions
    where id = p_pending_action_id and user_id = p_user_id for update;
    if not found then raise exception 'pending_launch_not_found'; end if;
    if v_pending.action_type <> 'launch_coin'
       or v_pending.status not in ('pending', 'confirmed', 'executing') then
      raise exception 'pending_launch_not_acceptable';
    end if;
    if public.normalize_action_source_surface(v_pending.surface, 'unknown') <> v_surface then
      raise exception 'pending_launch_surface_mismatch';
    end if;
    if v_pending.work_item_id is not null and v_pending.work_item_id <> v_work_id then
      raise exception 'pending_launch_work_item_mismatch';
    end if;
    update public.linkr_pending_actions set
      status = 'confirmed',
      action_payload = p_payload || jsonb_build_object(
        'chain', p_chain, 'wallet_id', p_wallet_id, 'source_surface', v_surface
      ),
      deterministic_validation = coalesce(deterministic_validation, '{}'::jsonb) ||
        jsonb_build_object(
          'required_fields_complete', true,
          'authenticated_source', true,
          'wallet_verified', true
        ),
      work_item_id = v_work_id,
      confirmed_at = coalesce(confirmed_at, now()),
      updated_at = now()
    where id = v_pending.id
    returning * into v_pending;
  else
  insert into public.linkr_pending_actions (
    user_id, surface, surface_conversation_id, action_type, status,
    confirmation_phrase, summary, action_payload, risk_summary,
    deterministic_validation, source_refs, idempotency_key, expires_at,
    confirmed_at, source_surface, work_item_id
  ) values (
    p_user_id, v_surface, left(coalesce(nullif(btrim(p_source_event_id), ''),
      p_idempotency_key), 200), 'launch_coin', 'confirmed',
    'authenticated launch request',
    left('Launch $' || upper(btrim(p_payload->>'symbol')) || ' on ' || p_chain, 500),
    p_payload || jsonb_build_object(
      'chain', p_chain, 'wallet_id', p_wallet_id, 'source_surface', v_surface
    ),
    jsonb_build_array('Token launches are irreversible.'),
    jsonb_build_object(
      'required_fields_complete', true,
      'authenticated_source', true,
      'wallet_verified', true
    ),
    jsonb_build_array(jsonb_build_object(
      'source_surface', v_surface, 'source_event_id', p_source_event_id
    )),
    'launch:' || v_surface || ':' || p_idempotency_key,
    now() + interval '24 hours', now(), v_surface, v_work_id
  )
  on conflict (user_id, idempotency_key) do update set updated_at = now()
  returning * into v_pending;
  end if;

  return jsonb_build_object(
    'id', v_pending.id,
    'action_id', v_pending.id,
    'work_item_id', v_work_id,
    'request_id', v_work_id,
    'status', v_accept->>'state',
    'chain', p_chain,
    'duplicate', coalesce((v_accept->>'duplicate')::boolean, false),
    'enqueued', coalesce((v_accept->>'enqueued')::boolean, false),
    'message_id', v_accept->'message_id'
  );
end;
$$;

revoke all on function public.accept_linkr_launch_request_v1(
  uuid, text, text, text, text, uuid, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.accept_linkr_launch_request_v1(
  uuid, text, text, text, text, uuid, jsonb, uuid
) to service_role;
