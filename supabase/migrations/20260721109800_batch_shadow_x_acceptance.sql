-- One set-based acceptance transaction per X page. This is used in shadow
-- mode first and exercises the exact compact PGMQ contract without N+1 RPCs.

create or replace function public.accept_shadow_x_page(p_tweet_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_messages jsonb[];
  v_sent bigint;
  v_input_count integer;
begin
  if jsonb_typeof(p_tweet_ids) <> 'array' or jsonb_array_length(p_tweet_ids) > 100 then
    raise exception 'invalid_x_page';
  end if;

  with input as (
    select distinct value as tweet_id
    from jsonb_array_elements_text(p_tweet_ids)
    where value ~ '^[0-9]{1,32}$'
  ), inserted as (
    insert into public.linkr_work_items (
      idempotency_key, source_surface, source_event_id, request_type,
      route, state, priority, state_version, dispatch_generation, payload,
      consumer_version, execution_generation
    )
    select 'shadow:x:' || tweet_id, 'x', tweet_id, 'x_ingress',
      'x.ingress', 'queued', 50, 0, 1,
      jsonb_build_object('tweet_id', tweet_id), 'shadow-v1', 0
    from input
    on conflict (idempotency_key) do nothing
    returning id, state_version, route, resource_sequence, dispatch_generation
  )
  select coalesce(array_agg(jsonb_build_object(
    'schema_version', 1,
    'work_item_id', id,
    'state_version', state_version,
    'route', route,
    'resource_sequence', resource_sequence,
    'dispatch_generation', dispatch_generation,
    'enqueued_at', now()
  )), array[]::jsonb[])
  into v_messages from inserted;

  select count(*)::integer into v_input_count
  from (select distinct value from jsonb_array_elements_text(p_tweet_ids)) s;

  if cardinality(v_messages) > 0 then
    select count(*) into v_sent from pgmq.send_batch('x_ingress', v_messages, 0);
  else
    v_sent := 0;
  end if;

  return jsonb_build_object(
    'input_count', v_input_count,
    'accepted_count', cardinality(v_messages),
    'duplicate_count', v_input_count - cardinality(v_messages),
    'message_count', v_sent
  );
end;
$$;

revoke all on function public.accept_shadow_x_page(jsonb)
  from public, anon, authenticated;
grant execute on function public.accept_shadow_x_page(jsonb) to service_role;
