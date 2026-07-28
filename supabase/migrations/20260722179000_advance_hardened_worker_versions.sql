-- Material worker changes get new immutable consumer versions. Stale v1
-- continuations fail closed with 409, while the dispatcher emits only v2.

update public.linkr_queue_runtime_config
set consumer_version = case stage
      when 'media_capture' then 'worker-media-capture-v2'
      when 'reply_x_high' then 'worker-reply-x-v2'
      when 'reply_x_normal' then 'worker-reply-x-v2'
      when 'reconciliation' then 'worker-reconcile-v2'
      else consumer_version
    end,
    updated_at = now()
where stage in (
  'media_capture', 'reply_x_high', 'reply_x_normal', 'reconciliation'
);

do $$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.accept_linkr_launch_request_v1(uuid,text,text,text,text,uuid,jsonb,uuid)'::regprocedure,
    'public.ensure_linkr_coin_launch_v1(uuid,uuid,text,text,text,text,text,integer,integer)'::regprocedure
  ] loop
    select pg_get_functiondef(v_signature) into strict v_definition;
    if strpos(v_definition, 'worker-media-capture-v2') > 0 then
      continue;
    end if;
    if strpos(v_definition, 'worker-media-capture-v1') = 0 then
      raise exception 'media consumer version not found in %', v_signature;
    end if;
    execute replace(
      v_definition,
      'worker-media-capture-v1',
      'worker-media-capture-v2'
    );
  end loop;
end;
$$;
