-- Conservative archive-and-prune path for hot operational history.
-- Rows are copied to archive tables before deletion from hot tables.

create table if not exists public.agent_runs_archive
(like public.agent_runs including defaults);
alter table public.agent_runs_archive
  add column if not exists archived_at timestamptz not null default now();
create unique index if not exists agent_runs_archive_id_idx
  on public.agent_runs_archive (id);
create index if not exists agent_runs_archive_created_idx
  on public.agent_runs_archive (created_at desc);
grant all on public.agent_runs_archive to service_role;
alter table public.agent_runs_archive enable row level security;

create table if not exists public.tweet_thread_contexts_archive
(like public.tweet_thread_contexts including defaults);
alter table public.tweet_thread_contexts_archive
  add column if not exists archived_at timestamptz not null default now();
create unique index if not exists tweet_thread_contexts_archive_id_idx
  on public.tweet_thread_contexts_archive (id);
create index if not exists tweet_thread_contexts_archive_tweet_idx
  on public.tweet_thread_contexts_archive (tweet_id);
grant all on public.tweet_thread_contexts_archive to service_role;
alter table public.tweet_thread_contexts_archive enable row level security;

create table if not exists public.tweets_inbox_archive
(like public.tweets_inbox including defaults);
alter table public.tweets_inbox_archive
  add column if not exists archived_at timestamptz not null default now();
create unique index if not exists tweets_inbox_archive_tweet_id_idx
  on public.tweets_inbox_archive (tweet_id);
create index if not exists tweets_inbox_archive_created_idx
  on public.tweets_inbox_archive (created_at desc);
grant all on public.tweets_inbox_archive to service_role;
alter table public.tweets_inbox_archive enable row level security;

create table if not exists public.twitter_replies_archive
(like public.twitter_replies including defaults);
alter table public.twitter_replies_archive
  add column if not exists archived_at timestamptz not null default now();
create unique index if not exists twitter_replies_archive_id_idx
  on public.twitter_replies_archive (id);
create index if not exists twitter_replies_archive_created_idx
  on public.twitter_replies_archive (created_at desc);
grant all on public.twitter_replies_archive to service_role;
alter table public.twitter_replies_archive enable row level security;

create table if not exists public.user_memory_index_archive
(like public.user_memory_index including defaults);
alter table public.user_memory_index_archive
  add column if not exists archived_at timestamptz not null default now();
create unique index if not exists user_memory_index_archive_id_idx
  on public.user_memory_index_archive (id);
create index if not exists user_memory_index_archive_created_idx
  on public.user_memory_index_archive (created_at desc);
grant all on public.user_memory_index_archive to service_role;
alter table public.user_memory_index_archive enable row level security;

create or replace function public.archive_operational_history(
  p_agent_runs_days integer default 90,
  p_tweets_days integer default 180,
  p_replies_days integer default 180,
  p_memory_days integer default 180,
  p_batch_size integer default 100,
  p_max_rows_per_table integer default 500,
  p_archive_retention_days integer default 365
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 100), 1000));
  v_max integer := greatest(1, least(coalesce(p_max_rows_per_table, 500), 10000));
  v_limit integer;
  v_deleted integer := 0;
  v_total integer := 0;
  v_result jsonb := '{}'::jsonb;
begin
  v_total := 0;
  loop
    v_limit := least(v_batch, v_max - v_total);
    exit when v_limit <= 0;

    with candidates as (
      select ar.*
      from public.agent_runs ar
      where ar.created_at < now() - make_interval(days => greatest(1, coalesce(p_agent_runs_days, 90)))
        and coalesce(ar.status, '') in ('completed','failed','ignored','retrying')
      order by ar.created_at
      limit v_limit
    ),
    archived as (
      insert into public.agent_runs_archive
      select c.*, now() as archived_at
      from candidates c
      on conflict (id) do update set archived_at = excluded.archived_at
      returning id
    )
    delete from public.agent_runs ar
    using archived a
    where ar.id = a.id;

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted = 0 or v_total >= v_max;
  end loop;
  v_result := v_result || jsonb_build_object('agent_runs', v_total);

  v_total := 0;
  loop
    v_limit := least(v_batch, v_max - v_total);
    exit when v_limit <= 0;

    with candidates as (
      select tr.*
      from public.twitter_replies tr
      where tr.created_at < now() - make_interval(days => greatest(1, coalesce(p_replies_days, 180)))
        and coalesce(tr.status, '') in ('posted','failed')
      order by tr.created_at
      limit v_limit
    ),
    archived as (
      insert into public.twitter_replies_archive
      select c.*, now() as archived_at
      from candidates c
      on conflict (id) do update set archived_at = excluded.archived_at
      returning id
    )
    delete from public.twitter_replies tr
    using archived a
    where tr.id = a.id;

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted = 0 or v_total >= v_max;
  end loop;
  v_result := v_result || jsonb_build_object('twitter_replies', v_total);

  v_total := 0;
  loop
    v_limit := least(v_batch, v_max - v_total);
    exit when v_limit <= 0;

    with candidates as (
      select umi.*
      from public.user_memory_index umi
      where umi.created_at < now() - make_interval(days => greatest(1, coalesce(p_memory_days, 180)))
      order by umi.created_at
      limit v_limit
    ),
    archived as (
      insert into public.user_memory_index_archive
      select c.*, now() as archived_at
      from candidates c
      on conflict (id) do update set archived_at = excluded.archived_at
      returning id
    )
    delete from public.user_memory_index umi
    using archived a
    where umi.id = a.id;

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted = 0 or v_total >= v_max;
  end loop;
  v_result := v_result || jsonb_build_object('user_memory_index', v_total);

  v_total := 0;
  loop
    v_limit := least(v_batch, v_max - v_total);
    exit when v_limit <= 0;

    with tweet_candidates as (
      select ti.*
      from public.tweets_inbox ti
      where ti.created_at < now() - make_interval(days => greatest(1, coalesce(p_tweets_days, 180)))
        and coalesce(ti.status, '') in ('completed','failed','ignored')
        and not exists (
          select 1 from public.agent_runs ar where ar.tweet_id = ti.tweet_id
        )
        and not exists (
          select 1 from public.twitter_replies tr where tr.tweet_id = ti.tweet_id
        )
        and not exists (
          select 1 from public.pending_actions pa where pa.tweet_id = ti.tweet_id
        )
      order by ti.created_at
      limit v_limit
    ),
    archived_threads as (
      insert into public.tweet_thread_contexts_archive
      select ttc.*, now() as archived_at
      from public.tweet_thread_contexts ttc
      join tweet_candidates c on c.tweet_id = ttc.tweet_id
      on conflict (id) do update set archived_at = excluded.archived_at
      returning id
    ),
    archived_tweets as (
      insert into public.tweets_inbox_archive
      select c.*, now() as archived_at
      from tweet_candidates c
      on conflict (tweet_id) do update set archived_at = excluded.archived_at
      returning tweet_id
    )
    delete from public.tweets_inbox ti
    using archived_tweets a
    where ti.tweet_id = a.tweet_id;

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted = 0 or v_total >= v_max;
  end loop;
  v_result := v_result || jsonb_build_object('tweets_inbox', v_total);

  if coalesce(p_archive_retention_days, 365) > 0 then
    delete from public.agent_runs_archive
    where archived_at < now() - make_interval(days => greatest(1, p_archive_retention_days));
    get diagnostics v_deleted = row_count;
    v_result := v_result || jsonb_build_object('agent_runs_archive_pruned', v_deleted);

    delete from public.twitter_replies_archive
    where archived_at < now() - make_interval(days => greatest(1, p_archive_retention_days));
    get diagnostics v_deleted = row_count;
    v_result := v_result || jsonb_build_object('twitter_replies_archive_pruned', v_deleted);

    delete from public.user_memory_index_archive
    where archived_at < now() - make_interval(days => greatest(1, p_archive_retention_days));
    get diagnostics v_deleted = row_count;
    v_result := v_result || jsonb_build_object('user_memory_index_archive_pruned', v_deleted);

    delete from public.tweet_thread_contexts_archive
    where archived_at < now() - make_interval(days => greatest(1, p_archive_retention_days));
    get diagnostics v_deleted = row_count;
    v_result := v_result || jsonb_build_object('tweet_thread_contexts_archive_pruned', v_deleted);

    delete from public.tweets_inbox_archive
    where archived_at < now() - make_interval(days => greatest(1, p_archive_retention_days));
    get diagnostics v_deleted = row_count;
    v_result := v_result || jsonb_build_object('tweets_inbox_archive_pruned', v_deleted);
  end if;

  return v_result
    || jsonb_build_object(
      'batch_size', v_batch,
      'max_rows_per_table', v_max,
      'archive_retention_days', p_archive_retention_days,
      'archived_at', now()
    );
end;
$$;

revoke all on function public.archive_operational_history(integer, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.archive_operational_history(integer, integer, integer, integer, integer, integer, integer)
  to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'linkr-archive-operational-history') then
      perform cron.unschedule('linkr-archive-operational-history');
    end if;

    perform cron.schedule(
      'linkr-archive-operational-history',
      '23 * * * *',
      'select public.archive_operational_history();'
    );
  end if;
end;
$$;
