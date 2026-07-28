WITH cfg AS (
  SELECT d.stage, d.wake_generation, c.consumer_version, c.worker_function
  FROM public.linkr_dispatch_stage_state d
  JOIN public.linkr_queue_runtime_config c ON c.stage = d.stage
  WHERE d.stage = 'nft_solana'
), secrets AS (
  SELECT
    (SELECT nullif(rtrim(decrypted_secret, '/'), '') FROM vault.decrypted_secrets WHERE name = 'x_wallet_agent_project_url' LIMIT 1) AS project_url,
    (SELECT nullif(btrim(decrypted_secret), '') FROM vault.decrypted_secrets WHERE name = 'x_wallet_agent_internal_cron_key' LIMIT 1) AS internal_key
)
SELECT net.http_post(
  url := secrets.project_url || '/functions/v1/' || cfg.worker_function,
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', secrets.internal_key),
  body := jsonb_build_object('stage', cfg.stage, 'wake_generation', cfg.wake_generation, 'consumer_version', cfg.consumer_version),
  timeout_milliseconds := 60000
) AS request_id
FROM cfg, secrets;