-- Close the canonical X request only after its confirmed on-chain result has a
-- terminal notification record. Activate the non-economic autonomous stages;
-- chain signers remain independently gated for real canary promotion.

create or replace function public.finalize_linkr_coin_launch_v2(
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
  v_result jsonb;
  v_item public.linkr_work_items%rowtype;
  v_root_id uuid;
begin
  v_result := public.finalize_linkr_coin_launch_v1(
    p_work_item_id, p_launch_id, p_transaction_id, p_chain,
    p_transaction_hash, p_token_address, p_explorer_url, p_reply_text,
    coalesce(p_details, '{}'::jsonb)
  );
  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  v_root_id := coalesce(v_item.parent_work_item_id,
    case when v_item.payload->>'parent_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_item.payload->>'parent_work_item_id')::uuid else null end,
    v_item.id);
  update public.linkr_work_items set
    state = 'notifying', state_version = state_version + 1,
    terminal_at = null, next_attempt_at = null, last_error_code = null,
    result_ref = 'coin_launch:' || p_launch_id::text,
    last_progress_at = now(), updated_at = now()
  where id = v_root_id
    and state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
  return v_result || jsonb_build_object('root_work_item_id', v_root_id);
end;
$$;

create or replace function public.sync_linkr_x_notification_delivery_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reply_work public.linkr_work_items%rowtype;
  v_root_id uuid;
  v_terminal_state text;
begin
  if new.delivery_lane <> 'queue' or new.work_item_id is null then return new; end if;
  update public.linkr_notification_deliveries set
    state = case new.status
      when 'posted' then 'sent' when 'failed' then 'failed'
      when 'ambiguous' then 'ambiguous' when 'posting' then 'sending'
      when 'pending' then case when new.next_attempt_at is null then 'queued' else 'retryable' end
      else state end,
    attempt_count = greatest(attempt_count, coalesce(new.attempt_count, 0)),
    provider_message_id = case when new.status = 'posted'
      then coalesce(new.reply_tweet_id, provider_message_id) else provider_message_id end,
    last_error_code = case when new.status = 'posted' then null
      else nullif(left(coalesce(new.error, ''), 240), '') end,
    ambiguous_at = case when new.status = 'ambiguous'
      then coalesce(ambiguous_at, now()) else ambiguous_at end,
    sent_at = case when new.status = 'posted'
      then coalesce(sent_at, new.posted_at, now()) else sent_at end,
    updated_at = now()
  where work_item_id = new.work_item_id and channel = 'x';

  if new.status not in ('posted', 'failed')
     or new.reply_kind not in ('launch_success', 'launch_failed') then
    return new;
  end if;
  select * into v_reply_work from public.linkr_work_items
  where id = new.work_item_id;
  if not found then return new; end if;
  v_root_id := coalesce(v_reply_work.parent_work_item_id,
    case when v_reply_work.payload->>'parent_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_reply_work.payload->>'parent_work_item_id')::uuid else null end);
  if v_root_id is null then return new; end if;
  v_terminal_state := case when new.reply_kind = 'launch_success'
    then 'succeeded' else 'rejected' end;
  update public.linkr_work_items set
    state = v_terminal_state, terminal_at = coalesce(terminal_at, now()),
    state_version = state_version + 1,
    last_error_code = case when new.status = 'failed'
      then 'terminal_x_notification_failed' else null end,
    result_ref = case when new.status = 'posted'
      then 'x-reply:' || new.reply_tweet_id else 'x-reply-terminal-failure:' || new.id::text end,
    last_progress_at = now(), updated_at = now()
  where id = v_root_id
    and state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
  if new.status = 'failed' then
    perform public.record_linkr_platform_incident_v1(
      'terminal-launch-notification:' || v_root_id::text,
      'warning', 'Confirmed launch notification could not be delivered',
      jsonb_build_object(
        'root_work_item_id', v_root_id, 'reply_id', new.id,
        'reply_kind', new.reply_kind,
        'error', left(coalesce(new.error, ''), 240)
      )
    );
  end if;
  return new;
end;
$$;

create or replace function public.pause_linkr_launch_for_funds_v1(
  p_work_item_id uuid,
  p_launch_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_root_id uuid;
begin
  if p_reason_code not in (
    'insufficient_solana_launch_balance', 'insufficient_launch_signer_balance'
  ) then raise exception 'launch_funding_reason_invalid'; end if;
  select * into v_item from public.linkr_work_items
  where id = p_work_item_id for update;
  if not found then raise exception 'work_item_not_found'; end if;
  if not exists (
    select 1 from public.coin_launches
    where id = p_launch_id and work_item_id = p_work_item_id
  ) then raise exception 'coin_launch_not_found'; end if;
  v_root_id := coalesce(v_item.parent_work_item_id,
    case when v_item.payload->>'parent_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_item.payload->>'parent_work_item_id')::uuid else null end,
    v_item.id);
  update public.coin_launches set status = 'pending', error = p_reason_code,
    processed_at = null where id = p_launch_id;
  update public.linkr_work_items set
    state = 'waiting_funds', state_version = state_version + 1,
    next_attempt_at = null, last_error_code = p_reason_code,
    result_ref = 'coin_launch:' || p_launch_id::text,
    last_progress_at = now(), updated_at = now()
  where id = v_root_id
    and state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter');
  return jsonb_build_object('root_work_item_id', v_root_id, 'launch_id', p_launch_id);
end;
$$;

create or replace function public.resume_linkr_launch_after_funding_v1(
  p_user_id uuid,
  p_input_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_input public.linkr_work_items%rowtype;
  v_tweet public.tweets_inbox%rowtype;
  v_pending public.linkr_pending_actions%rowtype;
  v_economic public.linkr_work_items%rowtype;
  v_root_id uuid;
  v_message_id bigint;
begin
  select * into v_input from public.linkr_work_items
  where id = p_input_work_item_id and user_id = p_user_id;
  if not found then raise exception 'retry_input_work_item_not_found'; end if;
  select * into v_tweet from public.tweets_inbox where work_item_id = v_input.id;
  if not found then raise exception 'retry_input_tweet_not_found'; end if;
  select p.* into v_pending
  from public.linkr_pending_actions p
  join public.linkr_work_items w on w.id = p.work_item_id
  where p.user_id = p_user_id and p.surface = 'x'
    and p.surface_conversation_id = v_tweet.conversation_id
    and p.status in ('confirmed', 'executing') and w.state = 'waiting_funds'
  order by p.updated_at desc limit 1 for update of p;
  if not found then raise exception 'waiting_funds_launch_not_found'; end if;
  select * into v_economic from public.linkr_work_items
  where id = v_pending.work_item_id for update;
  v_root_id := coalesce(v_economic.parent_work_item_id,
    case when v_economic.payload->>'parent_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_economic.payload->>'parent_work_item_id')::uuid else null end,
    v_economic.id);
  update public.linkr_work_items set
    state = 'queued', state_version = state_version + 1,
    active_queue_name = null, active_message_id = null,
    next_attempt_at = now(), last_error_code = null,
    last_progress_at = now(), updated_at = now()
  where id = v_economic.id returning * into v_economic;
  v_message_id := public.linkr_enqueue_work_item(v_economic.id, 0);
  update public.linkr_work_items set
    state = 'waiting_prerequisite', state_version = state_version + 1,
    last_error_code = null, last_progress_at = now(), updated_at = now()
  where id = v_root_id and state = 'waiting_funds';
  return jsonb_build_object(
    'economic_work_item_id', v_economic.id,
    'root_work_item_id', v_root_id,
    'message_id', v_message_id,
    'route', v_economic.route
  );
end;
$$;

update public.linkr_queue_runtime_config set
  worker_function = case stage
    when 'x_ingress' then 'worker-x-ingress'
    when 'command_prepare' then 'worker-command-prepare'
    when 'launch_enrich' then 'worker-launch-enrich'
    when 'media_capture' then 'worker-media-capture'
    when 'image_generate' then 'worker-image-generate'
    else worker_function end,
  consumer_version = case stage
    when 'x_ingress' then 'worker-x-ingress-v2'
    when 'command_prepare' then 'worker-command-prepare-v2'
    when 'launch_enrich' then 'worker-launch-enrich-v1'
    when 'media_capture' then 'worker-media-capture-v3'
    when 'image_generate' then 'worker-image-generate-v1'
    else consumer_version end,
  enabled = true,
  batch_size = 1,
  max_concurrency = 1,
  rollout_percent = 100,
  updated_at = now()
where stage in (
  'x_ingress', 'command_prepare', 'launch_enrich', 'media_capture', 'image_generate'
);

update public.linkr_dispatch_stage_state set
  state = 'idle', required_consumer_version = null,
  circuit_open_until = null, last_error_code = null,
  updated_at = now()
where stage in (
  'x_ingress', 'command_prepare', 'launch_enrich', 'media_capture', 'image_generate'
);

create or replace function public.get_linkr_route_readiness_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_stages jsonb;
  v_unready integer;
  v_invalid integer;
  v_backlog integer;
begin
  with required(stage) as (
    select unnest(array[
      'x_ingress', 'command_prepare', 'launch_enrich',
      'media_capture', 'image_generate',
      'launch_robinhood', 'confirm_robinhood',
      'launch_solana', 'confirm_solana',
      'reply_x_high', 'reply_x_normal', 'reconciliation'
    ]::text[])
  ), rows as (
    select r.stage, c.worker_function, c.consumer_version, c.enabled,
      d.state as dispatch_state, d.circuit_open_until,
      d.required_consumer_version, d.last_status_code, d.last_error_code,
      coalesce((m.value->>'queue_length')::bigint, 0) as queue_length,
      coalesce((m.value->>'oldest_msg_age_sec')::bigint, 0) as oldest_age_seconds,
      (
        c.enabled
        and c.consumer_version <> 'unverified'
        and not (
          d.circuit_open_until is not null and d.circuit_open_until > now()
          and (
            d.required_consumer_version is null
            or d.required_consumer_version = c.consumer_version
          )
        )
      ) as ready
    from required r
    left join public.linkr_queue_runtime_config c on c.stage = r.stage
    left join public.linkr_dispatch_stage_state d on d.stage = r.stage
    left join (
      select to_jsonb(x) as value from pgmq.metrics_all() x
    ) m on m.value->>'queue_name' = r.stage
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by stage), '[]'::jsonb),
    count(*) filter (where not coalesce(ready, false))::integer
  into v_stages, v_unready from rows;

  select count(*)::integer into v_invalid
  from public.linkr_work_items w
  where (
    w.state in ('queued', 'retryable')
    and (w.next_attempt_at is null or w.next_attempt_at <= now())
    and (w.active_queue_name is null or w.active_message_id is null)
  ) or (
    w.state in ('waiting_user_input', 'waiting_user_confirmation', 'waiting_provider')
    and w.last_progress_at is null
  ) or (
    w.state = 'leased' and w.lease_expires_at is null
  );

  select count(*)::integer into v_backlog
  from public.linkr_work_items
  where state not in ('succeeded', 'rejected', 'cancelled', 'dead_letter')
    and last_progress_at < now() - interval '5 minutes'
    and state not in (
      'waiting_user_input', 'waiting_user_confirmation',
      'waiting_funds', 'waiting_provider'
    );

  return jsonb_build_object(
    'ready', v_unready = 0 and v_invalid = 0 and v_backlog = 0,
    'required_stage_failures', v_unready,
    'invariant_violations', v_invalid,
    'overdue_work_items', v_backlog,
    'stages', v_stages,
    'sampled_at', now()
  );
end;
$$;

-- Recovery is intentionally narrow: it can only redrive an existing launch
-- whose original tweet itself contains exactly one requested chain, and only
-- when no economic record exists. This keeps production repairs on the same
-- durable path without permitting an operator to manufacture authorization.
create or replace function public.redrive_linkr_explicit_launch_v1(
  p_tweet_id text,
  p_chain text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_tweet public.tweets_inbox%rowtype;
  v_root public.linkr_work_items%rowtype;
  v_draft public.linkr_action_drafts%rowtype;
  v_updated jsonb;
  v_queued jsonb;
  v_has_solana boolean;
  v_has_robinhood boolean;
begin
  if p_chain not in ('solana', 'robinhood') then
    raise exception 'recovery_chain_invalid';
  end if;

  select * into v_tweet from public.tweets_inbox
  where tweet_id = p_tweet_id for update;
  if not found or v_tweet.work_item_id is null then
    raise exception 'recovery_tweet_not_found';
  end if;
  select * into v_root from public.linkr_work_items
  where id = v_tweet.work_item_id for update;
  if not found or v_root.user_id is null then
    raise exception 'recovery_root_not_found';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.user_id = v_root.user_id
      and p.twitter_id = v_tweet.author_twitter_id
  ) then raise exception 'recovery_verified_user_mismatch'; end if;

  v_has_solana := lower(v_tweet.text) ~
    '(^|[^a-z0-9])(solana|pump[ .]?fun)([^a-z0-9]|$)';
  v_has_robinhood := lower(v_tweet.text) ~
    '(^|[^a-z0-9])robinhood([ ]+chain)?([^a-z0-9]|$)';
  if v_has_solana = v_has_robinhood
     or (p_chain = 'solana' and not v_has_solana)
     or (p_chain = 'robinhood' and not v_has_robinhood) then
    raise exception 'recovery_chain_not_explicit_in_source';
  end if;

  select d.* into v_draft
  from public.linkr_action_drafts d
  where d.user_id = v_root.user_id
    and d.action_type = 'launch_coin'
    and (
      d.work_item_id = v_root.id
      or d.last_input_work_item_id = v_root.id
      or d.source_tweet_id = v_tweet.tweet_id
    )
  order by d.updated_at desc, d.id
  limit 1 for update;
  if not found then raise exception 'recovery_launch_draft_not_found'; end if;
  if coalesce(length(btrim(v_draft.filled_fields->>'name')), 0) = 0 then
    raise exception 'recovery_launch_name_missing';
  end if;

  if exists (
    select 1 from public.linkr_pending_actions p
    where p.draft_id = v_draft.id
  ) or exists (
    select 1 from public.coin_launches c
    join public.linkr_work_items w on w.id = c.work_item_id
    where w.id = v_root.id or w.parent_work_item_id = v_root.id
  ) then raise exception 'recovery_economic_artifact_exists'; end if;

  delete from public.linkr_idempotency_tombstones
  where work_item_id = v_root.id;
  update public.linkr_work_items set
    state = 'waiting_user_input', state_version = state_version + 1,
    terminal_at = null, next_attempt_at = null,
    active_queue_name = null, active_message_id = null,
    last_error_code = null, last_progress_at = now(), updated_at = now()
  where id = v_root.id;

  v_updated := public.upsert_linkr_launch_draft_v2(
    v_root.id,
    v_root.user_id,
    jsonb_build_object('chain', p_chain),
    jsonb_build_object('chain', 'user_text'),
    jsonb_build_object(
      'explicit_launch_intent', true,
      'recovery_source_tweet_id', v_tweet.tweet_id,
      'recovery_kind', 'verified_explicit_source'
    )
  );
  if coalesce(v_updated->>'chain', v_updated->'filled_fields'->>'chain')
     is distinct from p_chain then
    raise exception 'recovery_chain_persistence_failed';
  end if;
  v_queued := public.queue_linkr_launch_enrichment_v1(
    (v_updated->>'id')::uuid,
    v_root.id
  );
  update public.tweets_inbox set
    status = 'processing', error = null, processed_at = null
  where id = v_tweet.id;
  insert into public.linkr_request_events (
    work_item_id, event_type, state, metadata
  ) values (
    v_root.id, 'launch_recovery_redriven', 'waiting_prerequisite',
    jsonb_build_object(
      'tweet_id', v_tweet.tweet_id,
      'chain', p_chain,
      'draft_id', v_updated->>'id',
      'enrichment_work_item_id', v_queued->>'enrichment_work_item_id'
    )
  );
  return jsonb_build_object(
    'root_work_item_id', v_root.id,
    'draft_id', v_updated->>'id',
    'chain', p_chain,
    'enrichment', v_queued
  );
end;
$$;

revoke all on function public.finalize_linkr_coin_launch_v2(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_linkr_coin_launch_v2(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) to service_role;
revoke all on function public.pause_linkr_launch_for_funds_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.pause_linkr_launch_for_funds_v1(uuid, uuid, text)
  to service_role;
revoke all on function public.resume_linkr_launch_after_funding_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resume_linkr_launch_after_funding_v1(uuid, uuid)
  to service_role;
revoke all on function public.redrive_linkr_explicit_launch_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.redrive_linkr_explicit_launch_v1(text, text)
  to service_role;
revoke all on function public.get_linkr_route_readiness_v1()
  from public, anon, authenticated;
grant execute on function public.get_linkr_route_readiness_v1()
  to postgres, service_role;
revoke all on function public.sync_linkr_x_notification_delivery_v1()
  from public, anon, authenticated;
