-- Scheduled and market-cap-triggered wallet actions.
-- Workers claim only due rows through indexed predicates and FOR UPDATE SKIP LOCKED.

create table if not exists public.scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'x',
  source_tweet_id text,
  source_tweet_url text,
  pending_action_id uuid references public.pending_actions(id) on delete set null,
  action_type text not null,
  trigger_type text not null,
  chain text not null,
  status text not null default 'pending',
  token_address text,
  token_symbol text,
  recipient text,
  amount_original numeric,
  amount_original_unit text,
  amount_eth numeric,
  amount_sol numeric,
  amount_usd numeric,
  amount_pct numeric,
  amount_all boolean not null default false,
  slippage_bps integer,
  scheduled_for timestamptz,
  trigger_metric text,
  trigger_direction text,
  trigger_value_usd numeric,
  last_observed_value_usd numeric,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  check_count integer not null default 0,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  processing_started_at timestamptz,
  processed_at timestamptz,
  executed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  worker_id text,
  transaction_hash text,
  transaction_signature text,
  transaction_id uuid references public.transactions(id) on delete set null,
  idempotency_key text,
  action_payload jsonb not null default '{}'::jsonb,
  trigger_payload jsonb not null default '{}'::jsonb,
  execution_result jsonb not null default '{}'::jsonb,
  error text,
  constraint scheduled_actions_action_type_check
    check (action_type in ('buy', 'sell', 'transfer')),
  constraint scheduled_actions_trigger_type_check
    check (trigger_type in ('time', 'market_cap')),
  constraint scheduled_actions_chain_check
    check (chain in ('robinhood', 'solana')),
  constraint scheduled_actions_status_check
    check (status in ('pending', 'processing', 'executed', 'failed', 'cancelled', 'expired')),
  constraint scheduled_actions_trigger_direction_check
    check (trigger_direction is null or trigger_direction in ('below', 'above')),
  constraint scheduled_actions_market_action_check
    check (trigger_type <> 'market_cap' or action_type in ('buy', 'sell')),
  constraint scheduled_actions_time_has_due_at_check
    check (trigger_type <> 'time' or scheduled_for is not null),
  constraint scheduled_actions_market_has_threshold_check
    check (
      trigger_type <> 'market_cap'
      or (
        token_address is not null
        and trigger_metric = 'market_cap_usd'
        and trigger_direction is not null
        and trigger_value_usd is not null
      )
    )
);

create unique index if not exists scheduled_actions_idempotency_uidx
  on public.scheduled_actions (idempotency_key)
  where idempotency_key is not null;

create index if not exists scheduled_actions_user_created_idx
  on public.scheduled_actions (user_id, created_at desc);

create index if not exists scheduled_actions_user_status_idx
  on public.scheduled_actions (user_id, status, created_at desc);

create index if not exists scheduled_actions_due_time_idx
  on public.scheduled_actions (scheduled_for, created_at)
  where trigger_type = 'time' and status = 'pending';

create index if not exists scheduled_actions_due_market_idx
  on public.scheduled_actions (next_check_at, created_at)
  where trigger_type = 'market_cap' and status = 'pending';

create index if not exists scheduled_actions_processing_stale_idx
  on public.scheduled_actions (processing_started_at)
  where status = 'processing';

create index if not exists scheduled_actions_token_idx
  on public.scheduled_actions (chain, token_address, status)
  where token_address is not null;

drop trigger if exists scheduled_actions_updated_at on public.scheduled_actions;
create trigger scheduled_actions_updated_at
  before update on public.scheduled_actions
  for each row execute function public.set_updated_at();

grant select on public.scheduled_actions to authenticated;
grant all on public.scheduled_actions to service_role;

alter table public.scheduled_actions enable row level security;

drop policy if exists "users read own scheduled actions" on public.scheduled_actions;
create policy "users read own scheduled actions"
  on public.scheduled_actions for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.claim_ready_scheduled_actions(
  p_worker_id text,
  p_limit integer default 10,
  p_stale_before timestamptz default now() - interval '10 minutes'
)
returns setof public.scheduled_actions
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select id
    from public.scheduled_actions
    where (
        status = 'pending'
        and trigger_type = 'time'
        and scheduled_for <= now()
      )
      or (
        status = 'pending'
        and trigger_type = 'market_cap'
        and coalesce(next_check_at, now()) <= now()
      )
      or (
        status = 'processing'
        and processing_started_at <= p_stale_before
      )
    order by
      case when status = 'processing' then 0 else 1 end,
      coalesce(scheduled_for, next_check_at, created_at),
      created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.scheduled_actions s
  set
    status = 'processing',
    processing_started_at = now(),
    worker_id = p_worker_id,
    updated_at = now()
  from picked
  where s.id = picked.id
  returning s.*;
end;
$$;

revoke all on function public.claim_ready_scheduled_actions(text, integer, timestamptz) from public;
grant execute on function public.claim_ready_scheduled_actions(text, integer, timestamptz)
  to service_role;

-- Schedule the worker every minute. Runtime auth is read from Supabase Vault.
do $$
begin
  if to_regnamespace('cron') is not null and to_regnamespace('net') is not null then
    if exists (select 1 from cron.job where jobname = 'linkr-process-scheduled-actions') then
      perform cron.unschedule('linkr-process-scheduled-actions');
    end if;

    perform cron.schedule(
      'linkr-process-scheduled-actions',
      '* * * * *',
      $cron$
        select net.http_post(
          url := (
            select rtrim(decrypted_secret, '/')
            from vault.decrypted_secrets
            where name = 'linkr_supabase_url'
            limit 1
          ) || '/functions/v1/cron-process-scheduled-actions',
          headers := jsonb_build_object(
            'Content-Type',
            'application/json',
            'Authorization',
            'Bearer ' || (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'linkr_service_role_key'
              limit 1
            )
          ),
          body := jsonb_build_object(
            'source',
            'pg_cron',
            'job',
            'linkr-process-scheduled-actions'
          )
        );
      $cron$
    );
  end if;
end;
$$;
