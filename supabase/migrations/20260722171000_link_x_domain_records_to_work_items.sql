-- Link the existing X/domain records to the canonical work ledger and record
-- queue delivery ownership explicitly. All additions are nullable/additive so
-- existing producers remain valid during the staged cutover.

alter table public.tweets_inbox
  add column if not exists work_item_id uuid;

alter table public.linkr_action_drafts
  add column if not exists work_item_id uuid,
  add column if not exists last_input_work_item_id uuid,
  add column if not exists version bigint not null default 1;

alter table public.linkr_pending_actions
  add column if not exists work_item_id uuid,
  add column if not exists draft_version bigint;

alter table public.linkr_action_jobs
  add column if not exists work_item_id uuid;

alter table public.linkr_action_receipts
  add column if not exists work_item_id uuid;

alter table public.coin_launches
  add column if not exists work_item_id uuid,
  add column if not exists action_ordinal smallint not null default 0;

alter table public.twitter_replies
  add column if not exists work_item_id uuid;

alter table public.linkr_work_items
  add column if not exists surface_conversation_id text,
  add column if not exists active_queue_name text,
  add column if not exists active_message_id bigint,
  add column if not exists last_enqueued_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists recovery_count integer not null default 0,
  add column if not exists last_progress_at timestamptz;

update public.linkr_work_items
set last_progress_at = coalesce(updated_at, created_at, now())
where last_progress_at is null;

alter table public.linkr_work_items
  alter column last_progress_at set default now(),
  alter column last_progress_at set not null;

alter table public.linkr_work_items
  drop constraint if exists linkr_work_items_state_check;
alter table public.linkr_work_items
  add constraint linkr_work_items_state_check
  check (state in (
    'queued', 'leased', 'waiting_resource', 'waiting_prerequisite',
    'waiting_user_input', 'waiting_user_confirmation', 'waiting_funds',
    'waiting_provider', 'retryable', 'preparing', 'ready', 'signing',
    'signed', 'broadcasting', 'broadcast', 'confirming', 'confirmed',
    'notifying', 'succeeded', 'rejected', 'cancelled', 'reconciling',
    'dead_letter'
  ));

alter table public.linkr_work_items
  drop constraint if exists linkr_work_items_active_delivery_shape;
alter table public.linkr_work_items
  add constraint linkr_work_items_active_delivery_shape check (
    (active_queue_name is null and active_message_id is null)
    or
    (active_queue_name is not null and active_message_id is not null
      and last_enqueued_at is not null)
  );

alter table public.linkr_work_items
  drop constraint if exists linkr_work_items_recovery_count_check;
alter table public.linkr_work_items
  add constraint linkr_work_items_recovery_count_check
  check (recovery_count >= 0);

alter table public.linkr_work_items
  drop constraint if exists linkr_work_items_surface_conversation_length;
alter table public.linkr_work_items
  add constraint linkr_work_items_surface_conversation_length
  check (
    surface_conversation_id is null
    or octet_length(surface_conversation_id) between 1 and 256
  );

alter table public.linkr_action_drafts
  drop constraint if exists linkr_action_drafts_version_check;
alter table public.linkr_action_drafts
  add constraint linkr_action_drafts_version_check check (version > 0);

alter table public.linkr_pending_actions
  drop constraint if exists linkr_pending_actions_draft_version_check;
alter table public.linkr_pending_actions
  add constraint linkr_pending_actions_draft_version_check
  check (draft_version is null or draft_version > 0);

alter table public.coin_launches
  drop constraint if exists coin_launches_action_ordinal_check;
alter table public.coin_launches
  add constraint coin_launches_action_ordinal_check
  check (action_ordinal between 0 and 100);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tweets_inbox_work_item_id_fkey') then
    alter table public.tweets_inbox add constraint tweets_inbox_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'linkr_action_drafts_work_item_id_fkey') then
    alter table public.linkr_action_drafts add constraint linkr_action_drafts_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'linkr_action_drafts_last_input_work_item_id_fkey') then
    alter table public.linkr_action_drafts add constraint linkr_action_drafts_last_input_work_item_id_fkey
      foreign key (last_input_work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'linkr_pending_actions_work_item_id_fkey') then
    alter table public.linkr_pending_actions add constraint linkr_pending_actions_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'linkr_action_jobs_work_item_id_fkey') then
    alter table public.linkr_action_jobs add constraint linkr_action_jobs_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'linkr_action_receipts_work_item_id_fkey') then
    alter table public.linkr_action_receipts add constraint linkr_action_receipts_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coin_launches_work_item_id_fkey') then
    alter table public.coin_launches add constraint coin_launches_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'twitter_replies_work_item_id_fkey') then
    alter table public.twitter_replies add constraint twitter_replies_work_item_id_fkey
      foreign key (work_item_id) references public.linkr_work_items(id)
      on delete set null not valid;
  end if;
end;
$$;

alter table public.tweets_inbox validate constraint tweets_inbox_work_item_id_fkey;
alter table public.linkr_action_drafts validate constraint linkr_action_drafts_work_item_id_fkey;
alter table public.linkr_action_drafts validate constraint linkr_action_drafts_last_input_work_item_id_fkey;
alter table public.linkr_pending_actions validate constraint linkr_pending_actions_work_item_id_fkey;
alter table public.linkr_action_jobs validate constraint linkr_action_jobs_work_item_id_fkey;
alter table public.linkr_action_receipts validate constraint linkr_action_receipts_work_item_id_fkey;
alter table public.coin_launches validate constraint coin_launches_work_item_id_fkey;
alter table public.twitter_replies validate constraint twitter_replies_work_item_id_fkey;

create unique index if not exists tweets_inbox_work_item_id_uidx
  on public.tweets_inbox (work_item_id) where work_item_id is not null;
create index if not exists linkr_action_drafts_work_item_idx
  on public.linkr_action_drafts (work_item_id) where work_item_id is not null;
create index if not exists linkr_action_drafts_last_input_work_item_idx
  on public.linkr_action_drafts (last_input_work_item_id)
  where last_input_work_item_id is not null;
create unique index if not exists linkr_pending_actions_work_item_uidx
  on public.linkr_pending_actions (work_item_id) where work_item_id is not null;
create index if not exists linkr_action_jobs_work_item_idx
  on public.linkr_action_jobs (work_item_id) where work_item_id is not null;
create index if not exists linkr_action_receipts_work_item_idx
  on public.linkr_action_receipts (work_item_id) where work_item_id is not null;
create unique index if not exists coin_launches_work_item_ordinal_uidx
  on public.coin_launches (work_item_id, action_ordinal)
  where work_item_id is not null;
create index if not exists twitter_replies_work_item_idx
  on public.twitter_replies (work_item_id) where work_item_id is not null;
create index if not exists linkr_work_items_active_delivery_idx
  on public.linkr_work_items (active_queue_name, active_message_id)
  where active_message_id is not null;
create index if not exists linkr_work_items_repair_ready_idx
  on public.linkr_work_items (state, last_progress_at)
  where state in ('queued', 'retryable', 'leased', 'broadcast', 'reconciling');

comment on column public.linkr_work_items.surface_conversation_id is
  'External conversation/thread identity; unlike conversation_id this is not constrained to UUID.';
comment on column public.linkr_work_items.active_message_id is
  'The sole current PGMQ pointer. Older pointers are stale and may be deleted safely.';
