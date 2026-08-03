# Twilio SMS operations runbook

## Architecture

`sms-webhook` verifies and durably accepts form-encoded Twilio requests, handles compliance/account commands synchronously, and queues `sms.turn`. `worker-sms-turn` runs the private Linkr runtime and queues `reply.sms`. `worker-reply-sms` sends through Twilio. `sms-status-callback` records delivery outcomes.

The SMS queues ship disabled. Do not enable them until migrations and all four functions are deployed and command-only webhook smoke tests pass.

## Required Edge secrets

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN` (the primary Auth Token used by webhook signing)
- exactly one normal sender configuration: `TWILIO_MESSAGING_SERVICE_SID` (preferred) or `TWILIO_FROM_NUMBER`
- `TWILIO_WEBHOOK_PUBLIC_URL=https://xnxdbcfcxaqukmsajjfm.supabase.co/functions/v1/sms-webhook`
- `TWILIO_STATUS_CALLBACK_PUBLIC_URL=https://xnxdbcfcxaqukmsajjfm.supabase.co/functions/v1/sms-status-callback`
- `LINKR_PHONE_HASH_PEPPER` (new random value, at least 32 bytes; never rotate without a phone-hash migration)

Optional bounded controls: `LINKR_SMS_REQUESTS_PER_MINUTE=10`, `LINKR_SMS_LOGIN_TOKEN_TTL_SECONDS=600`, and `LINKR_SMS_MAX_REPLY_CHARS=1500`.

## Twilio Console

1. Select the SMS-capable number or Messaging Service.
2. Configure incoming messages as HTTP `POST` to the exact `sms-webhook` URL above.
3. Use the Messaging Service SID for production routing when available.
4. Complete toll-free verification or A2P 10DLC registration before applicable US production traffic.
5. Keep Twilio Advanced Opt-Out consistent with Linkr's STOP/START/HELP language.

The status callback URL is sent on every Linkr outbound REST request; it does not need to be separately configured on the phone number.

## Release sequence

1. Apply `20260803120000_twilio_sms_integration.sql` and `20260803121000_twilio_sms_queue_routes.sql`.
2. Deploy `x-oauth`, `sms-webhook`, `sms-status-callback`, `worker-sms-turn`, and `worker-reply-sms`.
3. Confirm all four SMS queue stages remain disabled.
4. Add Edge secrets and configure the Twilio staging webhook.
5. Test `HELP`, an unlinked free-form message, `LOGIN`, `STATUS`, `LOGOUT`, `STOP`, and `START`.
6. Enable reply lanes first, then turn lanes:

```sql
update public.linkr_queue_runtime_config
set enabled = true, pause_reason = null, updated_at = now()
where stage in ('reply_sms_high','reply_sms_normal');

update public.linkr_queue_runtime_config
set enabled = true, pause_reason = null, updated_at = now()
where stage in ('sms_turns_high','sms_turns_normal');
```

7. Test a linked research turn, pending value-moving action, exact confirmation, cancellation, duplicate webhook, STOP suppression, START recovery, and a delivery callback.

## Health queries

```sql
select status, count(*) from public.sms_inbound_messages group by status order by status;
select status, count(*) from public.sms_outbound_messages group by status order by status;
select * from public.sms_outbound_messages where status in ('pending','sending') and created_at < now() - interval '5 minutes';
select twilio_status, error_code, count(*) from public.sms_outbound_messages group by twilio_status, error_code order by count(*) desc;
select status, count(*) from public.linkr_agent_runs where surface = 'sms' group by status;
```

Never put raw phone numbers in operational logs or tickets. Use `phone_hash` and, only when necessary, the last four digits.

## Failure handling

- `401` webhook/callback: the explicit public URL or primary Auth Token does not match what Twilio signed.
- Twilio `429`: the reply worker respects `Retry-After` or exponential backoff.
- Twilio `400/401/403`: configuration failure; the row becomes `failed` and is not retried.
- Network error after send: the row becomes `ambiguous` and is dead-lettered to avoid a blind duplicate. Reconcile in Twilio Console before any manual resend.
- `undelivered`/`failed`: inspect `error_code`, registration, destination reachability, geo permissions, and sender capability.

## Rollback

Disable `reply_sms_*` first to stop outbound messages, then `sms_turns_*`. Remove or replace the incoming Twilio webhook if acceptance itself is unsafe. Keep all ledgers in place for reconciliation; do not drop SMS tables during an incident.
