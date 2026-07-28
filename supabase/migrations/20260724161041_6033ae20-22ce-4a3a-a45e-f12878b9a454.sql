
UPDATE public.linkr_queue_runtime_config
SET consumer_version = 'worker-nft-solana-v3',
    enabled = true,
    pause_reason = NULL,
    updated_at = now()
WHERE stage = 'nft_solana';

UPDATE public.linkr_work_items
SET consumer_version = 'worker-nft-solana-v3', updated_at = now()
WHERE route = 'nft.solana'
  AND state IN ('queued','retryable','in_progress');

SELECT public.request_linkr_stage_wake('nft_solana');
