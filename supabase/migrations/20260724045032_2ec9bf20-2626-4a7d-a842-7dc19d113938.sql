UPDATE public.linkr_dispatch_stage_state d
SET wake_generation = wake_generation + 1,
    state = 'pending',
    lease_owner = NULL,
    lease_expires_at = now() + interval '2 minutes',
    updated_at = now()
FROM public.linkr_queue_runtime_config c
WHERE d.stage = 'command_prepare'
  AND c.stage = d.stage
  AND c.enabled
  AND d.state IN ('idle', 'paused');
SELECT public.request_linkr_stage_wake('command_prepare');
SELECT public.request_linkr_stage_wake('nft_solana');