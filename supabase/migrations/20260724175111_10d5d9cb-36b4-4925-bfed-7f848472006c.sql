UPDATE public.linkr_resource_heads
SET active_work_item_id = '6e86ee10-1c52-41f8-9d56-7c206bd58141',
    active_sequence = 7,
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = now()
WHERE resource_key = 'ef402c94-b8b9-49d1-bcd3-ff0a68fc7c5c'
  AND resource_type = 'wallet'
  AND active_work_item_id IS NULL;