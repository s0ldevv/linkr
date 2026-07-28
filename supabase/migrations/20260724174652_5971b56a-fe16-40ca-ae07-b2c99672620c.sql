-- Repair the stuck NFT mint work item and re-queue the source tweet so the
-- fixed parser can re-classify it end-to-end.
UPDATE public.linkr_work_items
SET payload = jsonb_set(payload, '{command,collectionQuery}', '"TestingCollection"'::jsonb),
    state = 'queued',
    next_attempt_at = now(),
    lease_expires_at = NULL
WHERE id = '6e86ee10-1c52-41f8-9d56-7c206bd58141';

-- Clear any stale resource-head lease so the dispatcher can pick it up.
UPDATE public.linkr_resource_heads
SET lease_owner = NULL, lease_expires_at = NULL
WHERE active_work_item_id = '6e86ee10-1c52-41f8-9d56-7c206bd58141';