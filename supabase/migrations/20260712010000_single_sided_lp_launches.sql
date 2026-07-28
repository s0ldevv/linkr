-- Single-sided Uniswap V3 LP launch support.
-- New launches use the app-owned LaunchFactory/LaunchLocker contracts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'token-metadata',
  'token-metadata',
  true,
  262144,
  array['application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public can read token metadata'
  ) then
    create policy "Public can read token metadata"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'token-metadata');
  end if;
end $$;

alter table public.coin_launches
  add column if not exists launch_method text,
  add column if not exists metadata_uri text,
  add column if not exists token_metadata_storage_path text,
  add column if not exists token_metadata_hash text,
  add column if not exists initial_buy_tokens_out_wei text,
  add column if not exists lp_tick_lower text,
  add column if not exists lp_tick_upper text,
  add column if not exists lp_sqrt_price_x96 text,
  add column if not exists lp_liquidity text,
  add column if not exists lp_used_launch_wei text,
  add column if not exists lp_dust_wei text,
  add column if not exists graduation_weth_wei text,
  add column if not exists single_sided_launch_record jsonb,
  add column if not exists single_sided_launch_receipt jsonb;

update public.coin_launches
set launch_method = coalesce(launch_method, 'legacy_external')
where launch_method is null;

create index if not exists coin_launches_launch_method_created_idx
  on public.coin_launches (launch_method, created_at desc);

create index if not exists coin_launches_metadata_uri_idx
  on public.coin_launches (metadata_uri)
  where metadata_uri is not null;
