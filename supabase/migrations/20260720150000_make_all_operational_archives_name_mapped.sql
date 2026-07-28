-- Complete the archive repair for every remaining positional row projection.
-- twitter_replies gained idempotency_key after its archive table was created.

alter table public.twitter_replies_archive
  add column if not exists idempotency_key text;

-- Patch each exact remaining fragment in the deployed function. The migration
-- aborts if any expected fragment is absent, preventing a partial repair.
do $migration$
declare
  v_function regprocedure :=
    'public.archive_operational_history(integer,integer,integer,integer,integer,integer,integer)'::regprocedure;
  v_definition text;
  v_old_fragments constant text[] := array[
$old_replies$
      insert into public.twitter_replies_archive
      select c.*, now() as archived_at
      from candidates c
$old_replies$,
$old_memory$
      insert into public.user_memory_index_archive
      select c.*, now() as archived_at
      from candidates c
$old_memory$,
$old_threads$
      insert into public.tweet_thread_contexts_archive
      select ttc.*, now() as archived_at
      from public.tweet_thread_contexts ttc
$old_threads$,
$old_tweets$
      insert into public.tweets_inbox_archive
      select c.*, now() as archived_at
      from tweet_candidates c
$old_tweets$
  ];
  v_new_fragments constant text[] := array[
$new_replies$
      insert into public.twitter_replies_archive
      select (
        jsonb_populate_record(
          null::public.twitter_replies_archive,
          to_jsonb(c) || jsonb_build_object('archived_at', now())
        )
      ).*
      from candidates c
$new_replies$,
$new_memory$
      insert into public.user_memory_index_archive
      select (
        jsonb_populate_record(
          null::public.user_memory_index_archive,
          to_jsonb(c) || jsonb_build_object('archived_at', now())
        )
      ).*
      from candidates c
$new_memory$,
$new_threads$
      insert into public.tweet_thread_contexts_archive
      select (
        jsonb_populate_record(
          null::public.tweet_thread_contexts_archive,
          to_jsonb(ttc) || jsonb_build_object('archived_at', now())
        )
      ).*
      from public.tweet_thread_contexts ttc
$new_threads$,
$new_tweets$
      insert into public.tweets_inbox_archive
      select (
        jsonb_populate_record(
          null::public.tweets_inbox_archive,
          to_jsonb(c) || jsonb_build_object('archived_at', now())
        )
      ).*
      from tweet_candidates c
$new_tweets$
  ];
  v_index integer;
begin
  select pg_get_functiondef(v_function)
    into strict v_definition;

  for v_index in 1..array_length(v_old_fragments, 1) loop
    if strpos(v_definition, v_old_fragments[v_index]) = 0 then
      raise exception 'archive_operational_history fragment % did not match expected version', v_index;
    end if;
    v_definition := replace(
      v_definition,
      v_old_fragments[v_index],
      v_new_fragments[v_index]
    );
  end loop;

  execute v_definition;
end;
$migration$;
