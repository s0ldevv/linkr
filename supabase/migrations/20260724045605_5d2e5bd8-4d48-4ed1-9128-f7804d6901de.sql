CREATE OR REPLACE FUNCTION public.enqueue_linkr_nft_solana_v1(
  p_parent_work_item_id uuid,
  p_payload jsonb,
  p_priority smallint DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  v_parent public.linkr_work_items%ROWTYPE;
  v_root public.linkr_work_items%ROWTYPE;
  v_work public.linkr_work_items%ROWTYPE;
  v_kind text;
  v_tweet_id text;
  v_idempotency_key text;
  v_message_id bigint;
  v_inserted boolean := false;
  v_resource_key text;
  v_resource_sequence bigint;
  v_active_work_item_id uuid;
  v_state text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_nft_payload';
  END IF;
  v_kind := p_payload->>'kind';
  IF v_kind NOT IN ('create_collection', 'mint_nft') THEN
    RAISE EXCEPTION 'invalid_nft_kind';
  END IF;
  v_tweet_id := NULLIF(p_payload->>'tweet_id', '');
  IF v_tweet_id IS NULL OR length(v_tweet_id) > 64 THEN
    RAISE EXCEPTION 'invalid_nft_tweet_id';
  END IF;
  IF p_priority NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'invalid_nft_priority';
  END IF;

  SELECT * INTO v_parent
  FROM public.linkr_work_items
  WHERE id = p_parent_work_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent_work_item_not_found';
  END IF;

  SELECT * INTO v_root
  FROM public.linkr_work_items
  WHERE id = COALESCE(v_parent.parent_work_item_id, v_parent.id)
  FOR UPDATE;
  IF NOT FOUND THEN
    v_root := v_parent;
  END IF;

  v_resource_key := COALESCE(v_parent.user_id::text, v_root.user_id::text);
  IF v_resource_key IS NULL OR v_resource_key = '' THEN
    RAISE EXCEPTION 'nft_user_required';
  END IF;

  INSERT INTO public.linkr_resource_heads (
    resource_type,
    resource_key,
    active_work_item_id,
    active_sequence,
    next_sequence,
    updated_at
  ) VALUES (
    'wallet',
    v_resource_key,
    NULL,
    NULL,
    2,
    now()
  )
  ON CONFLICT (resource_type, resource_key) DO UPDATE SET
    next_sequence = public.linkr_resource_heads.next_sequence + 1,
    updated_at = now()
  RETURNING next_sequence - 1, active_work_item_id
  INTO v_resource_sequence, v_active_work_item_id;

  v_state := CASE WHEN v_active_work_item_id IS NULL THEN 'queued' ELSE 'waiting_resource' END;
  v_idempotency_key := 'nft-solana:' || v_root.id::text || ':' || v_kind || ':v2';

  INSERT INTO public.linkr_work_items (
    idempotency_key,
    source_surface,
    source_event_id,
    user_id,
    surface_conversation_id,
    request_type,
    route,
    state,
    priority,
    resource_type,
    resource_key,
    resource_sequence,
    payload,
    consumer_version,
    execution_generation,
    last_progress_at,
    parent_work_item_id
  ) VALUES (
    v_idempotency_key,
    v_parent.source_surface,
    COALESCE(v_parent.source_event_id, v_tweet_id),
    COALESCE(v_parent.user_id, v_root.user_id),
    v_parent.surface_conversation_id,
    CASE WHEN v_kind = 'create_collection' THEN 'nft_collection_mint' ELSE 'nft_mint' END,
    'nft.solana',
    v_state,
    p_priority,
    'wallet',
    v_resource_key,
    v_resource_sequence,
    p_payload || jsonb_build_object(
      'parent_work_item_id', v_root.id,
      'input_work_item_id', v_parent.id
    ),
    'worker-nft-solana-v1',
    v_root.execution_generation,
    now(),
    v_root.id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_work;

  IF FOUND THEN
    v_inserted := true;
  ELSE
    SELECT * INTO v_work
    FROM public.linkr_work_items
    WHERE idempotency_key = v_idempotency_key;
  END IF;

  IF v_inserted AND v_state = 'queued' THEN
    UPDATE public.linkr_resource_heads
    SET active_work_item_id = v_work.id,
        active_sequence = v_resource_sequence,
        updated_at = now()
    WHERE resource_type = 'wallet'
      AND resource_key = v_resource_key;
    v_message_id := public.linkr_enqueue_work_item(v_work.id, 0);
  END IF;

  RETURN jsonb_build_object(
    'work_item_id', v_work.id,
    'message_id', COALESCE(v_message_id, v_work.active_message_id),
    'parent_work_item_id', v_root.id,
    'duplicate', NOT v_inserted,
    'state', v_work.state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_linkr_nft_solana_v1(uuid, jsonb, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_linkr_nft_solana_v1(uuid, jsonb, smallint) TO service_role;

UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_request_id = NULL,
    consecutive_failure_count = 0,
    circuit_open_until = NULL,
    required_consumer_version = NULL,
    last_status_code = NULL,
    last_error_code = NULL,
    updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');

UPDATE public.linkr_work_items
SET state = 'retryable',
    active_queue_name = NULL,
    active_message_id = NULL,
    lease_expires_at = NULL,
    next_attempt_at = now(),
    last_error_code = 'nft_queue_shape_fixed',
    last_progress_at = now(),
    updated_at = now()
WHERE id IN ('147ec2db-1921-4091-9b4f-ec898a20431f'::uuid, 'b61b66ba-4f40-4b52-9b12-d466aaef12b7'::uuid)
  AND route = 'command.prepare'
  AND state IN ('queued', 'retryable', 'leased');

SELECT public.linkr_enqueue_work_item(id, 0)
FROM public.linkr_work_items
WHERE id IN ('147ec2db-1921-4091-9b4f-ec898a20431f'::uuid, 'b61b66ba-4f40-4b52-9b12-d466aaef12b7'::uuid)
  AND route = 'command.prepare'
  AND state IN ('queued', 'retryable');

SELECT public.request_linkr_stage_wake('command_prepare');
SELECT public.request_linkr_stage_wake('nft_solana');