-- Schedule the Robinhood Chain launch executor.
-- Auth material is read from Supabase Vault at runtime; do not hardcode secrets here.

do $$
begin
  if to_regnamespace('cron') is not null and to_regnamespace('net') is not null then
    if exists (select 1 from cron.job where jobname = 'linkr-process-launches') then
      perform cron.unschedule('linkr-process-launches');
    end if;

    perform cron.schedule(
      'linkr-process-launches',
      '* * * * *',
      $cron$
        select net.http_post(
          url := (
            select rtrim(decrypted_secret, '/')
            from vault.decrypted_secrets
            where name = 'linkr_supabase_url'
            limit 1
          ) || '/functions/v1/cron-process-launches',
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
            'linkr-process-launches'
          )
        );
      $cron$
    );
  end if;
end;
$$;
