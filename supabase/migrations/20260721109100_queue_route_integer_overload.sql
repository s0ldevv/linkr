-- PL/pgSQL integer literals resolve as integer, while work-item priority is
-- stored as smallint. Keep one canonical mapping and provide a checked adapter.

create or replace function public.linkr_queue_for_route(
  p_route text,
  p_priority integer
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case
    when p_priority between -32768 and 32767
      then public.linkr_queue_for_route(p_route, p_priority::smallint)
    else null
  end;
$$;

revoke all on function public.linkr_queue_for_route(text, integer)
  from public, anon, authenticated;
