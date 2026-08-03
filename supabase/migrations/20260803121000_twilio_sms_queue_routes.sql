-- Dedicated private SMS turn and provider-reply lanes. Disabled until staging smoke tests pass.
do $$
declare v_queue text;
begin
  foreach v_queue in array array[
    'sms_turns_high', 'sms_turns_normal', 'reply_sms_high', 'reply_sms_normal'
  ] loop
    if to_regclass('pgmq.q_' || v_queue) is null then
      perform pgmq.create(v_queue);
    end if;
  end loop;
end;
$$;
insert into public.linkr_queue_runtime_config (
  stage, worker_function, enabled, batch_size,
  visibility_timeout_seconds, max_concurrency, consumer_version,
  rollout_percent, canary_user_ids
) values
  ('sms_turns_high', 'worker-sms-turn', false, 5, 180, 5, 'worker-sms-turn-v1', 100, '{}'::uuid[]),
  ('sms_turns_normal', 'worker-sms-turn', false, 5, 180, 5, 'worker-sms-turn-v1', 100, '{}'::uuid[]),
  ('reply_sms_high', 'worker-reply-sms', false, 5, 120, 5, 'worker-reply-sms-v1', 100, '{}'::uuid[]),
  ('reply_sms_normal', 'worker-reply-sms', false, 5, 120, 5, 'worker-reply-sms-v1', 100, '{}'::uuid[])
on conflict (stage) do update set
  worker_function = excluded.worker_function,
  enabled = false,
  batch_size = excluded.batch_size,
  visibility_timeout_seconds = excluded.visibility_timeout_seconds,
  max_concurrency = excluded.max_concurrency,
  consumer_version = excluded.consumer_version,
  updated_at = now();

insert into public.linkr_dispatch_stage_state (stage) values
  ('sms_turns_high'), ('sms_turns_normal'), ('reply_sms_high'), ('reply_sms_normal')
on conflict do nothing;

insert into public.linkr_worker_capacity_slots (stage, slot_number)
select stage, slot_number
from unnest(array['sms_turns_high','sms_turns_normal','reply_sms_high','reply_sms_normal']) stage
cross join generate_series(1, 5) slot_number
on conflict do nothing;

create or replace function public.linkr_queue_for_route(
  p_route text,
  p_priority smallint default 50
)
returns text language sql immutable strict set search_path = public as $$
  select case
    when p_route = 'x.ingress' then 'x_ingress'
    when p_route = 'telegram.control' then 'telegram_control'
    when p_route = 'conversation.turn' and p_priority >= 80 then 'conversation_turns_high'
    when p_route = 'conversation.turn' then 'conversation_turns_normal'
    when p_route = 'sms.turn' and p_priority >= 80 then 'sms_turns_high'
    when p_route = 'sms.turn' then 'sms_turns_normal'
    when p_route = 'command.prepare' then 'command_prepare'
    when p_route = 'launch.enrich' then 'launch_enrich'
    when p_route = 'media.capture' then 'media_capture'
    when p_route = 'image.generate' then 'image_generate'
    when p_route = 'action.solana' then 'action_solana'
    when p_route = 'action.robinhood' then 'action_robinhood'
    when p_route = 'launch.solana' then 'launch_solana'
    when p_route = 'launch.robinhood' then 'launch_robinhood'
    when p_route = 'confirm.solana' then 'confirm_solana'
    when p_route = 'confirm.robinhood' then 'confirm_robinhood'
    when p_route = 'reply.x' and p_priority >= 80 then 'reply_x_high'
    when p_route = 'reply.x' then 'reply_x_normal'
    when p_route = 'reply.telegram' and p_priority >= 80 then 'reply_telegram_high'
    when p_route = 'reply.telegram' then 'reply_telegram_normal'
    when p_route = 'reply.sms' and p_priority >= 80 then 'reply_sms_high'
    when p_route = 'reply.sms' then 'reply_sms_normal'
    when p_route = 'reconciliation' then 'reconciliation'
    else null
  end;
$$;

create or replace function public.linkr_queue_for_route(p_route text, p_priority integer)
returns text language sql immutable strict set search_path = public as $$
  select case when p_priority between -32768 and 32767
    then public.linkr_queue_for_route(p_route, p_priority::smallint)
    else null end;
$$;
