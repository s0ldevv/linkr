-- Compact receipts prove shadow acceptance/validation without running business
-- logic. One row per canonical work item is sufficient for count reconciliation.

create table public.linkr_shadow_receipts (
  work_item_id uuid primary key references public.linkr_work_items(id) on delete cascade,
  source_surface text not null,
  source_event_id text,
  route text not null,
  payload_hash text,
  validated_at timestamptz not null default now(),
  constraint linkr_shadow_receipt_surface_length check (octet_length(source_surface) between 1 and 40),
  constraint linkr_shadow_receipt_event_length check (
    source_event_id is null or octet_length(source_event_id) between 1 and 256
  ),
  constraint linkr_shadow_receipt_route_length check (octet_length(route) between 1 and 80)
);

create index linkr_shadow_receipts_surface_time_idx
  on public.linkr_shadow_receipts (source_surface, validated_at desc);

alter table public.linkr_shadow_receipts enable row level security;
revoke all on public.linkr_shadow_receipts from public, anon, authenticated;
grant all on public.linkr_shadow_receipts to service_role;
