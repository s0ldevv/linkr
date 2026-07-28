-- Apply launch draft updates as guarded slot patches. The RPC signature stays
-- stable for deployed workers, but protected user-owned slots are no longer
-- overwritten by a later patch unless the reconciler marked an explicit edit.

create or replace function public.upsert_linkr_launch_draft_v2(
  p_input_work_item_id uuid,
  p_user_id uuid,
  p_filled_fields jsonb,
  p_field_provenance jsonb,
  p_generation_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_tweet public.tweets_inbox%rowtype;
  v_resolved jsonb;
  v_draft public.linkr_action_drafts%rowtype;
  v_key text;
  v_generation integer;
  v_fields jsonb;
  v_provenance jsonb;
  v_context jsonb;
  v_required text[];
  v_root_work_item_id uuid;
  v_reopening boolean := false;
  v_safe_fields jsonb;
  v_safe_provenance jsonb;
  v_slot text;
  v_existing_value text;
  v_incoming_value text;
  v_existing_source text;
  v_edit_intent boolean;
  v_guard_attempts jsonb := '[]'::jsonb;
  v_force_clarification boolean := false;
begin
  if p_user_id is null then raise exception 'draft_user_required'; end if;
  if p_filled_fields is null or jsonb_typeof(p_filled_fields) <> 'object'
     or octet_length(p_filled_fields::text) > 8192 then
    raise exception 'draft_fields_invalid';
  end if;
  if p_field_provenance is null or jsonb_typeof(p_field_provenance) <> 'object'
     or octet_length(p_field_provenance::text) > 8192 then
    raise exception 'draft_provenance_invalid';
  end if;
  if p_generation_context is null or jsonb_typeof(p_generation_context) <> 'object'
     or octet_length(p_generation_context::text) > 8192 then
    raise exception 'draft_generation_context_invalid';
  end if;
  if p_filled_fields ? 'chain' and (
    coalesce(p_filled_fields->>'chain', '') not in ('solana', 'robinhood')
    or coalesce(p_field_provenance->>'chain', '') not in ('user_text', 'thread_context')
  ) then raise exception 'explicit_launch_chain_provenance_required'; end if;

  select * into v_item from public.linkr_work_items
  where id = p_input_work_item_id and user_id = p_user_id;
  if not found then raise exception 'draft_input_work_item_not_found'; end if;
  select * into v_tweet from public.tweets_inbox
  where work_item_id = p_input_work_item_id;
  if not found then raise exception 'draft_input_tweet_not_found'; end if;

  v_key := 'launch_coin:' || coalesce(
    nullif(v_tweet.conversation_id, ''), nullif(v_tweet.root_tweet_id, ''),
    nullif(v_tweet.tweet_id, ''), p_user_id::text
  );
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_key, 0));

  v_resolved := public.resolve_linkr_launch_thread_v1(
    p_input_work_item_id, p_user_id
  );
  if v_resolved is not null then
    select * into v_draft from public.linkr_action_drafts
    where id = (v_resolved->>'id')::uuid for update;
  end if;

  v_safe_fields := p_filled_fields;
  v_safe_provenance := p_field_provenance;
  if v_draft.id is not null then
    foreach v_slot in array array['name', 'symbol', 'chain', 'dev_buy_amount'] loop
      if v_safe_fields ? v_slot
         and coalesce(length(btrim(v_draft.filled_fields->>v_slot)), 0) > 0 then
        v_existing_value := btrim(v_draft.filled_fields->>v_slot);
        v_incoming_value := btrim(coalesce(v_safe_fields->>v_slot, ''));
        if v_incoming_value is distinct from v_existing_value then
          v_existing_source := coalesce(
            v_draft.field_provenance->>v_slot,
            v_draft.generation_context #>> array['launch_slot_provenance', v_slot, 'source']
          );
          v_edit_intent := coalesce(
            p_generation_context #>> array[
              'launch_slot_reconciler', 'slot_updates', v_slot, 'edit_intent'
            ] = 'true',
            false
          );
          if v_existing_source = 'user_text' and not v_edit_intent then
            v_guard_attempts := v_guard_attempts || jsonb_build_array(
              jsonb_build_object(
                'slot', v_slot,
                'existing_value', v_existing_value,
                'attempted_value', v_incoming_value,
                'blocked_reason', 'protected_user_slot_requires_edit_intent',
                'checked_at', now()
              )
            );
            v_safe_fields := v_safe_fields - v_slot;
            v_safe_provenance := v_safe_provenance - v_slot;
          end if;
        end if;
      end if;
    end loop;
  end if;

  if v_draft.id is not null then
    v_root_work_item_id := v_draft.work_item_id;
    v_fields := coalesce(v_draft.filled_fields, '{}'::jsonb) || v_safe_fields;
    v_provenance := coalesce(v_draft.field_provenance, '{}'::jsonb) || v_safe_provenance;
    v_context := coalesce(v_draft.generation_context, '{}'::jsonb) || p_generation_context;
    v_reopening := v_draft.status = 'expired' or v_draft.expires_at <= now();
    v_generation := v_draft.session_generation + case when v_reopening then 1 else 0 end;
    v_key := v_draft.draft_key;
  else
    v_root_work_item_id := p_input_work_item_id;
    v_fields := v_safe_fields;
    v_provenance := v_safe_provenance;
    v_context := p_generation_context;
    select coalesce(max(session_generation), 0) + 1 into v_generation
    from public.linkr_action_drafts
    where user_id = p_user_id and draft_key = v_key;
  end if;

  if jsonb_array_length(v_guard_attempts) > 0 then
    v_context := v_context || jsonb_build_object(
      'launch_slot_db_guard',
      jsonb_build_object(
        'protected_overwrite_attempts', v_guard_attempts,
        'checked_at', now()
      )
    );
  end if;
  v_force_clarification := coalesce(
    v_context #>> array['launch_slot_reconciler', 'needs_clarification'] = 'true',
    false
  );

  if v_fields->>'chain' is not null and (
    coalesce(v_fields->>'chain', '') not in ('solana', 'robinhood')
    or coalesce(v_provenance->>'chain', '') not in ('user_text', 'thread_context')
  ) then raise exception 'explicit_launch_chain_provenance_required'; end if;

  v_required := array[]::text[];
  if coalesce(length(btrim(v_fields->>'name')), 0) = 0 then
    v_required := array_append(v_required, 'name');
  end if;
  if coalesce(v_fields->>'chain', '') not in ('solana', 'robinhood')
     or coalesce(v_provenance->>'chain', '') not in ('user_text', 'thread_context') then
    v_required := array_append(v_required, 'chain');
  end if;

  if v_draft.id is null then
    insert into public.linkr_action_drafts (
      user_id, conversation_id, source_tweet_id, draft_key, action_type,
      status, required_fields, filled_fields, entity_refs, privacy_label,
      idempotency_key, expires_at, surface, surface_conversation_id,
      x_thread_id, source_refs, source_surface, work_item_id,
      last_input_work_item_id, version, session_generation,
      field_provenance, generation_context, last_user_input_at, updated_at
    ) values (
      p_user_id, v_tweet.conversation_id, v_tweet.tweet_id, v_key, 'launch_coin',
      case when v_force_clarification or cardinality(v_required) > 0
        then 'awaiting_clarification' else 'open' end,
      v_required, v_fields, '[]'::jsonb, 'user_private',
      'draft:' || md5(p_user_id::text || ':' || v_key) || ':g' || v_generation,
      now() + interval '24 hours', 'x', v_tweet.conversation_id,
      v_tweet.conversation_id,
      jsonb_build_array(jsonb_build_object('tweet_id', v_tweet.tweet_id)),
      'x', v_root_work_item_id, p_input_work_item_id, 1, v_generation,
      v_provenance, v_context, now(), now()
    ) returning * into v_draft;
  else
    update public.linkr_action_drafts set
      source_tweet_id = v_tweet.tweet_id,
      status = case when v_force_clarification or cardinality(v_required) > 0
        then 'awaiting_clarification' else 'open' end,
      required_fields = v_required,
      filled_fields = v_fields,
      field_provenance = v_provenance,
      generation_context = v_context,
      session_generation = v_generation,
      idempotency_key = 'draft:' || md5(p_user_id::text || ':' || v_key) || ':g' || v_generation,
      surface_conversation_id = coalesce(surface_conversation_id, v_tweet.conversation_id),
      x_thread_id = coalesce(x_thread_id, v_tweet.conversation_id),
      source_refs = coalesce(source_refs, '[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('tweet_id', v_tweet.tweet_id)),
      last_input_work_item_id = p_input_work_item_id,
      version = version + 1,
      expires_at = now() + interval '24 hours',
      closed_at = null,
      last_user_input_at = now(),
      updated_at = now()
    where id = v_draft.id
    returning * into v_draft;
  end if;

  update public.linkr_work_items set
    user_id = coalesce(user_id, p_user_id),
    surface_conversation_id = coalesce(surface_conversation_id, v_tweet.conversation_id),
    result_ref = 'draft:' || v_draft.id::text,
    last_progress_at = now(), updated_at = now()
  where id in (p_input_work_item_id, v_root_work_item_id);

  return to_jsonb(v_draft) || jsonb_build_object('reopened', v_reopening);
end;
$$;

revoke all on function public.upsert_linkr_launch_draft_v2(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_linkr_launch_draft_v2(uuid, uuid, jsonb, jsonb, jsonb)
  to service_role;
