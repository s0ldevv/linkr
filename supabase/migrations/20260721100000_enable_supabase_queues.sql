-- Supabase-only durable queue foundation.
-- Additive and inert until queue_runtime_config rows are explicitly enabled.

create extension if not exists pgmq;

do $$
declare
  v_queue text;
begin
  foreach v_queue in array array[
    'x_ingress',
    'telegram_control',
    'conversation_turns_high',
    'conversation_turns_normal',
    'command_prepare',
    'media_capture',
    'action_solana',
    'action_robinhood',
    'launch_solana',
    'launch_robinhood',
    'confirm_solana',
    'confirm_robinhood',
    'reply_x_high',
    'reply_x_normal',
    'reply_telegram_high',
    'reply_telegram_normal',
    'reconciliation'
  ]
  loop
    if to_regclass(format('pgmq.q_%s', v_queue)) is null then
      perform pgmq.create(v_queue);
    end if;
  end loop;
end;
$$;

revoke all on schema pgmq from public;
revoke all on all tables in schema pgmq from public, anon, authenticated;
revoke all on all sequences in schema pgmq from public, anon, authenticated;
revoke execute on all functions in schema pgmq from public, anon, authenticated;

grant usage on schema pgmq to postgres, service_role;

do $$
declare
  v_queue text;
begin
  foreach v_queue in array array[
    'x_ingress',
    'telegram_control',
    'conversation_turns_high',
    'conversation_turns_normal',
    'command_prepare',
    'media_capture',
    'action_solana',
    'action_robinhood',
    'launch_solana',
    'launch_robinhood',
    'confirm_solana',
    'confirm_robinhood',
    'reply_x_high',
    'reply_x_normal',
    'reply_telegram_high',
    'reply_telegram_normal',
    'reconciliation'
  ]
  loop
    if to_regclass(format('pgmq.q_%s', v_queue)) is null
       or to_regclass(format('pgmq.a_%s', v_queue)) is null then
      raise exception 'required_pgmq_queue_missing:%', v_queue;
    end if;
  end loop;
end;
$$;
