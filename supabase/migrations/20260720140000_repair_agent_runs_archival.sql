-- Keep the agent-runs archive compatible with columns added after the archive
-- table was created. All additions are nullable and therefore metadata-only.

alter table public.agent_runs_archive
  add column if not exists idempotency_key text,
  add column if not exists route_decision jsonb,
  add column if not exists working_frame jsonb,
  add column if not exists reply_plan jsonb,
  add column if not exists route_resources jsonb,
  add column if not exists prompt_slots jsonb,
  add column if not exists tool_results jsonb,
  add column if not exists outcome jsonb,
  add column if not exists source_surface text,
  add column if not exists terminal_conversation_id uuid,
  add column if not exists terminal_message_id uuid;

-- The original positional projection became invalid as soon as agent_runs and
-- agent_runs_archive had different column counts/order. Patch only that exact
-- fragment and fail closed if the deployed function differs from expectation.
-- jsonb_populate_record maps by column name and emits the archive row type in
-- its physical order, including archived_at, without relying on SELECT * order.
do $migration$
declare
  v_function regprocedure :=
    'public.archive_operational_history(integer,integer,integer,integer,integer,integer,integer)'::regprocedure;
  v_definition text;
  v_old_fragment constant text := $old$
      insert into public.agent_runs_archive
      select c.*, now() as archived_at
      from candidates c
$old$;
  v_new_fragment constant text := $new$
      insert into public.agent_runs_archive
      select (
        jsonb_populate_record(
          null::public.agent_runs_archive,
          to_jsonb(c) || jsonb_build_object('archived_at', now())
        )
      ).*
      from candidates c
$new$;
begin
  select pg_get_functiondef(v_function)
    into strict v_definition;

  if strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'archive_operational_history definition did not match expected version';
  end if;

  v_definition := replace(v_definition, v_old_fragment, v_new_fragment);
  execute v_definition;
end;
$migration$;
