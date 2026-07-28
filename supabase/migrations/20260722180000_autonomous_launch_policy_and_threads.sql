-- Autonomous launch drafts remain durable across X replies while preserving
-- explicit user ownership of the chain decision.

alter table public.linkr_action_drafts
  add column if not exists session_generation integer not null default 1,
  add column if not exists field_provenance jsonb not null default '{}'::jsonb,
  add column if not exists generation_context jsonb not null default '{}'::jsonb,
  add column if not exists last_user_input_at timestamptz,
  add column if not exists auto_launch_authorized_at timestamptz,
  add column if not exists authorization_kind text;

alter table public.linkr_action_drafts
  drop constraint if exists linkr_action_drafts_session_generation_check,
  drop constraint if exists linkr_action_drafts_provenance_size_check,
  drop constraint if exists linkr_action_drafts_generation_context_size_check,
  drop constraint if exists linkr_action_drafts_authorization_kind_check;
alter table public.linkr_action_drafts
  add constraint linkr_action_drafts_session_generation_check
    check (session_generation > 0),
  add constraint linkr_action_drafts_provenance_size_check
    check (octet_length(field_provenance::text) <= 8192),
  add constraint linkr_action_drafts_generation_context_size_check
    check (octet_length(generation_context::text) <= 8192),
  add constraint linkr_action_drafts_authorization_kind_check
    check (authorization_kind is null or authorization_kind in (
      'explicit_launch_intent', 'manual_confirmation'
    ));

alter table public.linkr_work_items
  add column if not exists parent_work_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'linkr_work_items_parent_work_item_id_fkey'
  ) then
    alter table public.linkr_work_items
      add constraint linkr_work_items_parent_work_item_id_fkey
      foreign key (parent_work_item_id) references public.linkr_work_items(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists linkr_work_items_parent_idx
  on public.linkr_work_items (parent_work_item_id, created_at)
  where parent_work_item_id is not null;

update public.linkr_work_items
set parent_work_item_id = (payload->>'parent_work_item_id')::uuid
where parent_work_item_id is null
  and payload->>'parent_work_item_id' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

drop index if exists public.linkr_action_drafts_idempotency_key_uidx;
create unique index if not exists linkr_action_drafts_generation_uidx
  on public.linkr_action_drafts (user_id, draft_key, session_generation);

create or replace function public.resolve_linkr_launch_thread_v1(
  p_input_work_item_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.linkr_work_items%rowtype;
  v_tweet public.tweets_inbox%rowtype;
  v_parent_root uuid;
  v_draft public.linkr_action_drafts%rowtype;
begin
  if p_input_work_item_id is null or p_user_id is null then return null; end if;
  select * into v_item from public.linkr_work_items
  where id = p_input_work_item_id;
  if not found then return null; end if;
  select * into v_tweet from public.tweets_inbox
  where work_item_id = p_input_work_item_id;
  if not found then return null; end if;

  select coalesce(w.parent_work_item_id,
    case when w.payload->>'parent_work_item_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (w.payload->>'parent_work_item_id')::uuid else null end)
  into v_parent_root
  from public.twitter_replies r
  join public.linkr_work_items w on w.id = r.work_item_id
  where r.reply_tweet_id in (
    v_tweet.parent_tweet_id,
    v_tweet.referenced_tweet_id,
    v_tweet.parent_reply_tweet_id
  )
  order by r.posted_at desc nulls last, r.created_at desc
  limit 1;

  select d.* into v_draft
  from public.linkr_action_drafts d
  where d.user_id = p_user_id
    and d.action_type = 'launch_coin'
    and (
      d.surface_conversation_id = v_tweet.conversation_id
      or d.source_tweet_id in (
        v_tweet.parent_tweet_id,
        v_tweet.root_tweet_id,
        v_tweet.referenced_tweet_id,
        v_tweet.parent_inbox_tweet_id,
        v_tweet.parent_reply_tweet_id
      )
      or d.work_item_id = v_parent_root
      or d.work_item_id in (
        select ti.work_item_id from public.tweets_inbox ti
        where ti.tweet_id in (
          v_tweet.parent_tweet_id,
          v_tweet.root_tweet_id,
          v_tweet.referenced_tweet_id,
          v_tweet.parent_inbox_tweet_id
        )
      )
    )
    and (
      (d.status in ('open', 'awaiting_clarification', 'ready')
        and d.expires_at > now())
      or (
        d.updated_at >= now() - interval '7 days'
        and d.status in ('open', 'awaiting_clarification', 'ready', 'expired')
        and not exists (
          select 1 from public.linkr_pending_actions p
          where p.draft_id = d.id or p.work_item_id = d.work_item_id
        )
        and not exists (
          select 1 from public.coin_launches c
          where c.work_item_id = d.work_item_id
        )
        and not exists (
          select 1 from public.linkr_chain_transactions x
          where x.work_item_id = d.work_item_id
        )
      )
    )
  order by
    case when d.status in ('open', 'awaiting_clarification', 'ready')
      and d.expires_at > now() then 0 else 1 end,
    d.updated_at desc,
    d.id
  limit 1;
  return case when v_draft.id is null then null else to_jsonb(v_draft) end;
end;
$$;

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

  if v_draft.id is not null then
    v_root_work_item_id := v_draft.work_item_id;
    v_fields := coalesce(v_draft.filled_fields, '{}'::jsonb) || p_filled_fields;
    v_provenance := coalesce(v_draft.field_provenance, '{}'::jsonb) || p_field_provenance;
    v_context := coalesce(v_draft.generation_context, '{}'::jsonb) || p_generation_context;
    v_reopening := v_draft.status = 'expired' or v_draft.expires_at <= now();
    v_generation := v_draft.session_generation + case when v_reopening then 1 else 0 end;
    v_key := v_draft.draft_key;
  else
    v_root_work_item_id := p_input_work_item_id;
    v_fields := p_filled_fields;
    v_provenance := p_field_provenance;
    v_context := p_generation_context;
    select coalesce(max(session_generation), 0) + 1 into v_generation
    from public.linkr_action_drafts
    where user_id = p_user_id and draft_key = v_key;
  end if;

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
      case when cardinality(v_required) > 0 then 'awaiting_clarification' else 'open' end,
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
      status = case when cardinality(v_required) > 0 then 'awaiting_clarification' else 'open' end,
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

revoke all on function public.resolve_linkr_launch_thread_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_linkr_launch_thread_v1(uuid, uuid)
  to service_role;
revoke all on function public.upsert_linkr_launch_draft_v2(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_linkr_launch_draft_v2(uuid, uuid, jsonb, jsonb, jsonb)
  to service_role;
