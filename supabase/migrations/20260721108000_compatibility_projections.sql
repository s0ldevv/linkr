-- Safe user-visible async status projection. Existing tables and endpoint
-- response shapes remain authoritative until each gated consumer cutover.

create or replace function public.get_linkr_work_item_status(p_work_item_id uuid)
returns table (
  request_id uuid,
  request_type text,
  state text,
  accepted_at timestamptz,
  started_at timestamptz,
  terminal_at timestamptz,
  result_ref text,
  last_error_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.request_type, w.state, w.accepted_at, w.started_at,
    w.terminal_at, w.result_ref, w.last_error_code
  from public.linkr_work_items w
  where w.id = p_work_item_id
    and (
      w.user_id = (select auth.uid())
      or (select auth.role()) = 'service_role'
    )
  union all
  select t.work_item_id, 'compacted', t.terminal_state, t.created_at, null,
    t.terminal_at, t.result_ref, null
  from public.linkr_idempotency_tombstones t
  where t.work_item_id = p_work_item_id
    and (select auth.role()) = 'service_role'
    and not exists (select 1 from public.linkr_work_items w where w.id = p_work_item_id)
  limit 1;
$$;

revoke all on function public.get_linkr_work_item_status(uuid) from public, anon;
grant execute on function public.get_linkr_work_item_status(uuid) to authenticated, service_role;
