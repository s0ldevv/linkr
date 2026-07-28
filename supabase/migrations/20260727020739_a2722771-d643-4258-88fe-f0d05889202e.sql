DO $$
DECLARE
  v_jobid bigint;
  v_command text := $cmd$
select net.http_post(
  url := (select decrypted_secret || '/functions/v1/cron-fetch-mentions' from vault.decrypted_secrets where name = 'x_wallet_agent_project_url' limit 1),
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', (select decrypted_secret from vault.decrypted_secrets where name = 'x_wallet_agent_internal_cron_key' limit 1)),
  body := jsonb_build_object('scheduled_at', now()),
  timeout_milliseconds := 60000
) as request_id;
$cmd$;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'linkr-fetch-mentions'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule('linkr-fetch-mentions', '* * * * *', v_command);
  ELSE
    PERFORM cron.alter_job(v_jobid, command := v_command);
  END IF;
END $$;
