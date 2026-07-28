-- Store optional Telegram metadata for EVM and Pump.fun launches.

alter table public.coin_launches
  add column if not exists metadata_telegram_url text;

comment on column public.coin_launches.metadata_telegram_url is
  'Optional launch metadata Telegram URL normalized by Linkr.';
