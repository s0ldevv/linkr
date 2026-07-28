-- Robinhood Chain token analytics guardrails.
-- Keeps legacy rows intact while making all new token analytics state chain-safe.

alter table public.market_token_snapshots
  alter column chain set default 'robinhood';

alter table public.market_discovery_snapshots
  alter column chain set default 'robinhood';

alter table public.token_resolution_aliases
  alter column chain set default 'robinhood';

alter table public.market_token_snapshots
  add column if not exists chain_id integer not null default 4663,
  add column if not exists token_address text,
  add column if not exists explorer_url text,
  add column if not exists holders_count integer,
  add column if not exists transfers_count integer;

update public.market_token_snapshots
set
  chain_id = 4663,
  token_address = coalesce(token_address, mint),
  explorer_url = coalesce(
    explorer_url,
    case
      when coalesce(token_address, mint) ~ '^0x[0-9a-fA-F]{40}$'
        then 'https://robinhoodchain.blockscout.com/token/' || coalesce(token_address, mint)
      else null
    end
  )
where chain = 'robinhood'
  and coalesce(token_address, mint) ~ '^0x[0-9a-fA-F]{40}$';

alter table public.token_registry
  add column if not exists chain text not null default 'robinhood',
  add column if not exists chain_id integer not null default 4663,
  add column if not exists token_address text,
  add column if not exists explorer_url text;

update public.token_registry
set
  chain = 'robinhood',
  chain_id = 4663,
  token_address = coalesce(token_address, mint),
  explorer_url = coalesce(
    explorer_url,
    'https://robinhoodchain.blockscout.com/token/' || coalesce(token_address, mint)
  )
where mint ~ '^0x[0-9a-fA-F]{40}$';

update public.token_registry
set
  chain = 'legacy_unknown',
  chain_id = 0
where mint !~ '^0x[0-9a-fA-F]{40}$'
  and chain = 'robinhood';

create index if not exists token_registry_chain_symbol_idx
  on public.token_registry (chain, lower(symbol))
  where symbol is not null;

create index if not exists token_registry_chain_name_idx
  on public.token_registry (chain, lower(name))
  where name is not null;

create unique index if not exists token_registry_chain_address_unique
  on public.token_registry (chain, lower(coalesce(token_address, mint)));
