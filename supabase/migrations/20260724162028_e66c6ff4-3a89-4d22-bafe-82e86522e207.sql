
UPDATE public.linkr_resource_heads h
SET active_work_item_id = w.id,
    active_sequence = w.resource_sequence,
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = now()
FROM (
  SELECT id, resource_type, resource_key, resource_sequence
  FROM public.linkr_work_items
  WHERE route = 'nft.solana' AND state = 'queued'
  ORDER BY resource_sequence ASC
  LIMIT 1
) w
WHERE h.resource_type = w.resource_type AND h.resource_key = w.resource_key;

INSERT INTO public.linkr_resource_heads (resource_type, resource_key, active_work_item_id, active_sequence, updated_at)
SELECT w.resource_type, w.resource_key, w.id, w.resource_sequence, now()
FROM public.linkr_work_items w
WHERE w.route = 'nft.solana' AND w.state = 'queued'
  AND NOT EXISTS (
    SELECT 1 FROM public.linkr_resource_heads h
    WHERE h.resource_type = w.resource_type AND h.resource_key = w.resource_key
  )
ORDER BY w.resource_sequence ASC
LIMIT 1
ON CONFLICT DO NOTHING;
