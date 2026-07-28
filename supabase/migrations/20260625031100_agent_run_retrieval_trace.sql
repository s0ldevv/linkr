alter table public.agent_runs
  add column if not exists retrieval_request jsonb,
  add column if not exists retrieved_history jsonb,
  add column if not exists retrieval_summary text;
