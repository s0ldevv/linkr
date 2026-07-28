-- Filebase-backed IPFS launch metadata support.
-- Additive only: existing Supabase-backed launches keep working.

alter table public.coin_launches
  add column if not exists ipfs_image_uri text,
  add column if not exists ipfs_image_cid text,
  add column if not exists ipfs_image_gateway_url text,
  add column if not exists ipfs_metadata_uri text,
  add column if not exists ipfs_metadata_cid text,
  add column if not exists ipfs_metadata_gateway_url text,
  add column if not exists metadata_storage_provider text,
  add column if not exists metadata_storage_error text,
  add column if not exists filebase_image_object_key text,
  add column if not exists filebase_metadata_object_key text;

create index if not exists coin_launches_ipfs_metadata_cid_idx
  on public.coin_launches (ipfs_metadata_cid)
  where ipfs_metadata_cid is not null;

create index if not exists coin_launches_metadata_storage_provider_idx
  on public.coin_launches (metadata_storage_provider, created_at desc)
  where metadata_storage_provider is not null;

create index if not exists coin_launches_filebase_metadata_object_key_idx
  on public.coin_launches (filebase_metadata_object_key)
  where filebase_metadata_object_key is not null;

update public.coin_launches
set metadata_storage_provider = coalesce(metadata_storage_provider, 'supabase')
where metadata_uri is not null
  and metadata_storage_provider is null;
