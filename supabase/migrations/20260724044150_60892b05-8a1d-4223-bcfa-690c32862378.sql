
-- Reopen the command_prepare circuit (was tripped by a WORKER_RESOURCE_LIMIT on an NFT mint)
update public.linkr_dispatch_stage_state
set state = 'idle',
    circuit_open_until = null,
    consecutive_failure_count = 0,
    last_error_code = null,
    wake_generation = wake_generation + 1,
    updated_at = now()
where stage = 'command_prepare';

-- Redrive the two NFT tweets that were stuck queued while the circuit was open
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.linkr_work_items
    where id in (
      '147ec2db-1921-4091-9b4f-ec898a20431f',
      'b61b66ba-4f40-4b52-9b12-d466aaef12b7'
    )
      and state = 'queued'
      and terminal_at is null
  loop
    perform public.linkr_enqueue_work_item(v_id, 0);
  end loop;
end $$;
