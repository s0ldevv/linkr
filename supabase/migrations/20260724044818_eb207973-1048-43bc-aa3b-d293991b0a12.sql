-- Move Solana NFT minting out of command_prepare into a dedicated stage.
-- This prevents heavy on-chain NFT work from pausing the shared command intake stage.

DO $$
BEGIN
  IF to_regclass('pgmq.q_nft_solana') IS NULL THEN
    PERFORM pgmq.create('nft_solana');
  END IF;
END;
$$;

INSERT INTO public.linkr_queue_runtime_config (
  stage,
  worker_function,
  enabled,
  batch_size,
  visibility_timeout_seconds,
  max_concurrency,
  consumer_version,
  rollout_percent,
  canary_user_ids
) VALUES (
  'nft_solana',
  'worker-nft-solana',
  true,
  1,
  600,
  1,
  'worker-nft-solana-v1',
  100,
  '{}'::uuid[]
)
ON CONFLICT (stage) DO UPDATE SET
  worker_function = EXCLUDED.worker_function,
  enabled = true,
  batch_size = 1,
  visibility_timeout_seconds = 600,
  max_concurrency = 1,
  consumer_version = EXCLUDED.consumer_version,
  rollout_percent = 100,
  canary_user_ids = '{}'::uuid[],
  pause_reason = NULL,
  updated_at = now();

INSERT INTO public.linkr_dispatch_stage_state (stage)
VALUES ('nft_solana')
ON CONFLICT (stage) DO NOTHING;

INSERT INTO public.linkr_worker_capacity_slots (stage, slot_number)
VALUES ('nft_solana', 1)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.linkr_queue_for_route(
  p_route text,
  p_priority smallint DEFAULT 50
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_route = 'x.ingress' THEN 'x_ingress'
    WHEN p_route = 'telegram.control' THEN 'telegram_control'
    WHEN p_route = 'conversation.turn' AND p_priority >= 80 THEN 'conversation_turns_high'
    WHEN p_route = 'conversation.turn' THEN 'conversation_turns_normal'
    WHEN p_route = 'command.prepare' THEN 'command_prepare'
    WHEN p_route = 'launch.enrich' THEN 'launch_enrich'
    WHEN p_route = 'media.capture' THEN 'media_capture'
    WHEN p_route = 'image.generate' THEN 'image_generate'
    WHEN p_route = 'action.solana' THEN 'action_solana'
    WHEN p_route = 'action.robinhood' THEN 'action_robinhood'
    WHEN p_route = 'nft.solana' THEN 'nft_solana'
    WHEN p_route = 'launch.solana' THEN 'launch_solana'
    WHEN p_route = 'launch.robinhood' THEN 'launch_robinhood'
    WHEN p_route = 'confirm.solana' THEN 'confirm_solana'
    WHEN p_route = 'confirm.robinhood' THEN 'confirm_robinhood'
    WHEN p_route = 'reply.x' AND p_priority >= 80 THEN 'reply_x_high'
    WHEN p_route = 'reply.x' THEN 'reply_x_normal'
    WHEN p_route = 'reply.telegram' AND p_priority >= 80 THEN 'reply_telegram_high'
    WHEN p_route = 'reply.telegram' THEN 'reply_telegram_normal'
    WHEN p_route = 'reconciliation' THEN 'reconciliation'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.linkr_queue_for_route(
  p_route text,
  p_priority integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT CASE WHEN p_priority BETWEEN -32768 AND 32767
    THEN public.linkr_queue_for_route(p_route, p_priority::smallint)
    ELSE NULL END;
$$;

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

  v_idempotency_key := 'nft-solana:' || v_root.id::text || ':' || v_kind || ':v1';

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
    payload,
    consumer_version,
    execution_generation,
    last_progress_at,
    parent_work_item_id
  ) VALUES (
    v_idempotency_key,
    v_parent.source_surface,
    COALESCE(v_parent.source_event_id, v_tweet_id),
    v_parent.user_id,
    v_parent.surface_conversation_id,
    CASE WHEN v_kind = 'create_collection' THEN 'nft_collection_mint' ELSE 'nft_mint' END,
    'nft.solana',
    'queued',
    p_priority,
    'wallet',
    COALESCE(v_parent.user_id::text, v_root.user_id::text, 'unknown'),
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

  IF v_inserted THEN
    v_message_id := public.linkr_enqueue_work_item(v_work.id, 0);
  END IF;

  RETURN jsonb_build_object(
    'work_item_id', v_work.id,
    'message_id', COALESCE(v_message_id, v_work.active_message_id),
    'parent_work_item_id', v_root.id,
    'duplicate', NOT v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_linkr_nft_solana_v1(uuid, jsonb, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_linkr_nft_solana_v1(uuid, jsonb, smallint) TO service_role;

-- Reopen command intake after the previous NFT mint resource-limit crash.
UPDATE public.linkr_dispatch_stage_state
SET state = 'idle',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_request_id = NULL,
    consecutive_failure_count = 0,
    circuit_open_until = NULL,
    last_status_code = NULL,
    last_error_code = NULL,
    updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');

UPDATE public.linkr_queue_runtime_config
SET enabled = true,
    worker_function = CASE
      WHEN stage = 'command_prepare' THEN 'worker-command-prepare'
      WHEN stage = 'nft_solana' THEN 'worker-nft-solana'
      ELSE worker_function
    END,
    consumer_version = CASE
      WHEN stage = 'command_prepare' THEN 'worker-command-prepare-v2'
      WHEN stage = 'nft_solana' THEN 'worker-nft-solana-v1'
      ELSE consumer_version
    END,
    pause_reason = NULL,
    updated_at = now()
WHERE stage IN ('command_prepare', 'nft_solana');

-- Prevent infrastructure circuit-delay notices from producing confusing user replies
-- for command parsing and NFT minting. Product workers still send explicit errors.
CREATE OR REPLACE FUNCTION public.queue_linkr_stage_delay_notices_v1(
  p_stage text,
  p_error_code text,
  p_consumer_version text,
  p_limit integer DEFAULT 25
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_item record;
  v_reply text := 'Your request is safely queued, but this processing stage is temporarily paused. Linkr will resume it automatically; please do not submit it again.';
BEGIN
  IF p_stage IS NULL OR p_stage = '' OR p_limit < 1 THEN
    RETURN 0;
  END IF;

  IF p_stage IN ('command_prepare', 'nft_solana') THEN
    RETURN 0;
  END IF;

  FOR v_item IN
    SELECT w.id, w.last_progress_at
    FROM public.linkr_work_items w
    WHERE w.source_surface = 'x'
      AND w.state IN ('queued', 'retryable', 'leased')
      AND public.linkr_queue_for_route(w.route, w.priority) = p_stage
      AND NOT EXISTS (
        SELECT 1
        FROM public.twitter_replies tr
        WHERE tr.idempotency_key = 'reply:' || coalesce(w.parent_work_item_id, w.id)::text || ':stage_delay_notice:1'
      )
    ORDER BY w.last_progress_at ASC NULLS FIRST
    LIMIT p_limit
  LOOP
    PERFORM public.enqueue_linkr_x_reply_v1(
      v_item.id,
      v_reply,
      'stage_delay_notice',
      1,
      50::smallint
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_linkr_stage_delay_notices_v1(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_linkr_stage_delay_notices_v1(text, text, text, integer) TO service_role;

-- Requeue any X NFT work items still stranded in command_prepare from the resource-limit window.
WITH candidates AS (
  SELECT w.id
  FROM public.linkr_work_items w
  JOIN public.tweets_inbox t ON t.work_item_id = COALESCE(w.parent_work_item_id, w.id)
  WHERE w.route = 'command.prepare'
    AND w.source_surface = 'x'
    AND w.state IN ('queued', 'retryable', 'leased')
    AND t.text ~* '\m(nft|collection)\M'
  LIMIT 25
), reset_items AS (
  UPDATE public.linkr_work_items w
  SET state = 'retryable',
      active_queue_name = NULL,
      active_message_id = NULL,
      lease_expires_at = NULL,
      next_attempt_at = now(),
      last_error_code = 'nft_pipeline_moved_to_dedicated_worker',
      last_progress_at = now(),
      updated_at = now()
  FROM candidates c
  WHERE w.id = c.id
  RETURNING w.id
)
SELECT public.linkr_enqueue_work_item(id, 0)
FROM reset_items;