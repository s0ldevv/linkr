# Linkr

Linkr is a multi-surface agent platform with an authenticated dashboard terminal, X automation, Telegram workflows, Solana and Robinhood-chain wallet actions, token launches, NFT launches/collections, scheduled actions, liquidity tools, and an HMAC-authenticated agent API.

## Runtime layout

- `src/` — TanStack Start dashboard and server-side API gateway.
- `supabase/functions/` — Supabase Edge Functions and the shared agent/runtime modules.
- `supabase/migrations/` — database schema, queueing, idempotency, reconciliation, RLS, and maintenance jobs.
- `contracts/` — Robinhood-chain launch contracts, tests, and deployment records.
- `scripts/` — release architecture and Edge Function source-budget gates.

## Agent action execution

Terminal, X, Telegram, and dashboard confirmations converge on the same pending-action model. Confirmation is compare-and-set/idempotent, and the terminal invokes the authenticated `terminal-action` executor internally. Chain-specific SDKs are lazy-loaded only for the confirmed action branch.

## Local setup

Requirements: Node.js 22+, npm, Deno, Supabase CLI, and the toolchain required by `contracts/` when contracts are being changed.

```bash
cp .env.example .env
cp .env.local.example .env.local
cp supabase/.env.example supabase/.env.local
npm ci
npm run audit:architecture
npm run check
npm run dev
```

Populate local secrets from your secret manager. Never commit `.env`, `.env.local`, `supabase/.env.local`, temporary internal keys, wallet secrets, or provider access tokens.

## Release gates

```bash
npm run audit:architecture
npm run check:edge-budget
npm run test:edge
npm run check
```

The architecture audit enforces function/config coverage, bounded request parsing, secret-file hygiene, shared queue-worker use, and application-level auth gates for functions where Supabase JWT verification is intentionally disabled.

## World-class hardening revision

This checkout includes the `WORLD_CLASS_HARDENING.md` implementation pass:

- DB-backed admin policies for first-launch funding, X user gating, and metadata testing.
- Early X/Telegram/terminal/Agent API ban and gating enforcement before work is queued.
- Recurring, pausable, resumable, cancellable scheduled wallet actions, launches, rewards claims, and liquidity actions.
- Agent API schedule read/write endpoints with HMAC auth, scopes, idempotency, absolute start times, relative delays, and interval-first-run creation.
- Production metadata defaults that point to Linkr coin pages and source X URLs; Google URLs are only present in explicit metadata testing policy values.
- GPT-5 Mini enforcement for AI extraction/enrichment paths, with GPT-5 Nano models denied in the shared Comet helper.

The database migrations for this revision are present but intentionally not applied in this workspace. Apply them only when the deployment owner approves database rollout.

Read `WORLD_CLASS_HARDENING.md` and `DEPLOYMENT_CHECKLIST.md` before deploying this revision.
