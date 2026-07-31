-- Do not reserve a cooldown claim while the policy is disabled.
create or replace function public.enforce_linkr_launch_cooldown_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status jsonb;
  v_retry_after integer;
  v_request_key text;
begin
  if coalesce(new.request_type, '') <> 'launch_coin' or new.user_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('linkr-launch-cooldown:' || new.user_id::text, 0)
  );
  v_request_key := coalesce(new.idempotency_key, new.id::text);
  if exists (
    select 1
    from public.linkr_launch_cooldown_claims
    where user_id = new.user_id and request_key = v_request_key
  ) then
    return new;
  end if;
  v_status := public.get_linkr_launch_cooldown_v1(new.user_id);
  if not coalesce((v_status->>'enabled')::boolean, false) then
    return new;
  end if;
  if not coalesce((v_status->>'allowed')::boolean, true) then
    v_retry_after := greatest(1, coalesce((v_status->>'retry_after_seconds')::integer, 60));
    raise exception 'launch_cooldown_active'
      using detail = 'retry_after_seconds=' || v_retry_after::text;
  end if;

  insert into public.linkr_launch_cooldown_claims (user_id, request_key, claimed_at, updated_at)
  values (new.user_id, v_request_key, now(), now())
  on conflict (user_id) do update
    set request_key = excluded.request_key,
        claimed_at = excluded.claimed_at,
        updated_at = excluded.updated_at
    where public.linkr_launch_cooldown_claims.request_key = excluded.request_key
       or (extract(epoch from (now() - public.linkr_launch_cooldown_claims.claimed_at))
           >= ((v_status->>'duration_minutes')::integer * 60));
  if not found then
    v_retry_after := greatest(1, coalesce((v_status->>'retry_after_seconds')::integer, 60));
    raise exception 'launch_cooldown_active'
      using detail = 'retry_after_seconds=' || v_retry_after::text;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_linkr_launch_cooldown_v1() from public, anon, authenticated;
grant execute on function public.enforce_linkr_launch_cooldown_v1() to service_role;
