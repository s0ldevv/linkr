-- Keep the durable notification ledger synchronized regardless of which
-- authorized poster updates twitter_replies. This closes the last possible
-- claim-race gap and backfills rows written before the trigger existed.

create or replace function public.sync_linkr_x_notification_delivery_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.delivery_lane <> 'queue' or new.work_item_id is null then
    return new;
  end if;

  update public.linkr_notification_deliveries
  set state = case new.status
        when 'posted' then 'sent'
        when 'failed' then 'failed'
        when 'ambiguous' then 'ambiguous'
        when 'posting' then 'sending'
        when 'pending' then case
          when new.next_attempt_at is null then 'queued'
          else 'retryable'
        end
        else state
      end,
      attempt_count = greatest(attempt_count, coalesce(new.attempt_count, 0)),
      provider_message_id = case when new.status = 'posted'
        then coalesce(new.reply_tweet_id, provider_message_id)
        else provider_message_id end,
      last_error_code = case when new.status = 'posted' then null
        else nullif(left(coalesce(new.error, ''), 240), '') end,
      ambiguous_at = case when new.status = 'ambiguous'
        then coalesce(ambiguous_at, now()) else ambiguous_at end,
      sent_at = case when new.status = 'posted'
        then coalesce(sent_at, new.posted_at, now()) else sent_at end,
      updated_at = now()
  where work_item_id = new.work_item_id and channel = 'x';
  return new;
end;
$$;

drop trigger if exists sync_linkr_x_notification_delivery
  on public.twitter_replies;
create trigger sync_linkr_x_notification_delivery
after insert or update of status, attempt_count, reply_tweet_id, error,
  next_attempt_at, posted_at
on public.twitter_replies
for each row execute function public.sync_linkr_x_notification_delivery_v1();

update public.linkr_notification_deliveries d
set state = case r.status
      when 'posted' then 'sent'
      when 'failed' then 'failed'
      when 'ambiguous' then 'ambiguous'
      when 'posting' then 'sending'
      when 'pending' then case
        when r.next_attempt_at is null then 'queued'
        else 'retryable'
      end
      else d.state
    end,
    attempt_count = greatest(d.attempt_count, coalesce(r.attempt_count, 0)),
    provider_message_id = case when r.status = 'posted'
      then coalesce(r.reply_tweet_id, d.provider_message_id)
      else d.provider_message_id end,
    last_error_code = case when r.status = 'posted' then null
      else nullif(left(coalesce(r.error, ''), 240), '') end,
    ambiguous_at = case when r.status = 'ambiguous'
      then coalesce(d.ambiguous_at, now()) else d.ambiguous_at end,
    sent_at = case when r.status = 'posted'
      then coalesce(d.sent_at, r.posted_at, now()) else d.sent_at end,
    updated_at = now()
from public.twitter_replies r
where r.work_item_id = d.work_item_id
  and r.delivery_lane = 'queue'
  and d.channel = 'x';

revoke all on function public.sync_linkr_x_notification_delivery_v1()
  from public, anon, authenticated;
