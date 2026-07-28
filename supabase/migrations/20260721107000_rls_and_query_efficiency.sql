-- Preserve every policy's command/roles/semantics while forcing auth helpers
-- into one-time initplans instead of evaluating them once per scanned row.

do $$
declare
  v_policy record;
  v_sql text;
  v_qual text;
  v_check text;
begin
  for v_policy in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ~ 'auth\.(uid|jwt|role)\(\)'
        or coalesce(with_check, '') ~ 'auth\.(uid|jwt|role)\(\)'
      )
  loop
    v_qual := v_policy.qual;
    v_check := v_policy.with_check;
    foreach v_sql in array array['uid', 'jwt', 'role']
    loop
      if v_qual is not null then
        v_qual := replace(v_qual, format('auth.%s()', v_sql), format('(select auth.%s())', v_sql));
      end if;
      if v_check is not null then
        v_check := replace(v_check, format('auth.%s()', v_sql), format('(select auth.%s())', v_sql));
      end if;
    end loop;

    v_sql := format('alter policy %I on %I.%I',
      v_policy.policyname, v_policy.schemaname, v_policy.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;
end;
$$;

-- Existing scheduled_actions_due_time_idx and scheduled_actions_due_market_idx
-- already cover the two bounded due predicates. Do not add a redundant generic
-- schedule index.

-- Queue pointer joins use the work-item primary key; no general mutable-state
-- index is intentionally added.
