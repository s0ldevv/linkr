-- Track Telegram group announcements for confirmed launches.

alter table public.coin_launches
  add column if not exists telegram_group_announcement_status text,
  add column if not exists telegram_group_announcement_chat_id text,
  add column if not exists telegram_group_announcement_message_id text,
  add column if not exists telegram_group_announcement_attempted_at timestamptz,
  add column if not exists telegram_group_announced_at timestamptz,
  add column if not exists telegram_group_announcement_error text;

update public.coin_launches
set telegram_group_announcement_status = 'pending'
where telegram_group_announcement_status is null;

-- Do not backfill old confirmed launches into the group.
update public.coin_launches
set
  telegram_group_announcement_status = 'skipped',
  telegram_group_announcement_error = coalesce(
    telegram_group_announcement_error,
    'historical_launch_before_group_announcements'
  )
where status = 'confirmed'
  and telegram_group_announcement_status = 'pending'
  and telegram_group_announced_at is null
  and coalesce(telegram_group_announcement_message_id, '') = '';

alter table public.coin_launches
  alter column telegram_group_announcement_status set default 'pending',
  alter column telegram_group_announcement_status set not null;

alter table public.coin_launches
  drop constraint if exists coin_launches_telegram_group_announcement_status_check,
  add constraint coin_launches_telegram_group_announcement_status_check
    check (telegram_group_announcement_status in ('pending', 'sent', 'failed', 'skipped')) not valid;

create index if not exists coin_launches_telegram_group_announcement_idx
  on public.coin_launches (telegram_group_announcement_status, processed_at desc)
  where status = 'confirmed';

comment on column public.coin_launches.telegram_group_announcement_status is
  'Telegram group announcement state for launch broadcasts: pending, sent, failed, or skipped.';

comment on column public.coin_launches.telegram_group_announcement_chat_id is
  'Telegram chat id or @username where the launch announcement was sent or attempted.';

comment on column public.coin_launches.telegram_group_announcement_message_id is
  'Telegram message id returned for the group launch announcement.';

comment on column public.coin_launches.telegram_group_announced_at is
  'Timestamp when the launch announcement was successfully sent to the Telegram group.';
