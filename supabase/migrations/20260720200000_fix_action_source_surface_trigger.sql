-- Keep the shared provenance trigger schema-safe across every attached table.
--
-- The original implementation referenced NEW.pending_action_id inside a
-- compound boolean expression. PostgreSQL resolves that record field even for
-- tables other than liquidity_actions, so inserts into agent_runs and
-- linkr_agent_runs failed with SQLSTATE 42703. Read table-specific fields from
-- a JSON representation of NEW instead.

create or replace function public.set_action_source_surface()
returns trigger
language plpgsql
as $$
declare
  fallback text := 'unknown';
  pending_source text;
  row_json jsonb;
  pending_action_id_value uuid;
begin
  row_json := to_jsonb(new);

  if tg_table_name in ('agent_runs', 'pending_actions', 'coin_launches', 'scheduled_actions') then
    fallback := 'x';
  end if;

  if tg_table_name = 'scheduled_actions' then
    new.source := public.normalize_action_source_surface(new.source, fallback);
    row_json := to_jsonb(new);
  end if;

  new.source_surface := public.action_source_surface_from_row(row_json, fallback);

  if tg_table_name = 'liquidity_actions' and new.source_surface = 'unknown' then
    pending_action_id_value := nullif(row_json->>'pending_action_id', '')::uuid;

    if pending_action_id_value is not null then
      select pa.source_surface
        into pending_source
      from public.pending_actions pa
      where pa.id = pending_action_id_value;

      if pending_source is not null then
        new.source_surface := public.normalize_action_source_surface(pending_source, 'unknown');
      end if;
    end if;
  end if;

  return new;
end;
$$;
