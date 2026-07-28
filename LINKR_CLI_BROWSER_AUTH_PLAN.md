# Linkr CLI Browser Login Architecture Plan

Status: implementation plan, not yet built.

Goal: ship an installable npm CLI package that lets users run `linkr`, authenticate with their X account through the browser, paste a short authorization code back into the CLI, then chat with the same Linkr agent experience that powers `/app/terminal`.

This plan intentionally does not make users copy long API keys. The CLI login should feel like Vercel/Supabase style device authorization, but under the hood the backend should mint a dedicated scoped Linkr API key after the user proves ownership of their X-backed Linkr account.

## 1. Existing Linkr pieces to reuse

Use the current system instead of creating a separate CLI backend:

- Web terminal UI: `src/routes/_authenticated.app.terminal.tsx`
- Web terminal API gateway routes: `src/lib/agent-api/gateway.server.ts`
- Chat runtime endpoint: `supabase/functions/terminal-chat/index.ts`
- Conversation endpoints: `supabase/functions/terminal-conversations/index.ts`, `terminal-messages`, `terminal-action`, `terminal-upload`
- Existing X login: `supabase/functions/x-oauth/index.ts`, `src/routes/auth.tsx`, `src/routes/auth.callback.tsx`
- Existing one-time auth handoff table: `supabase/migrations/20260722032000_auth_handoff_codes.sql`
- Existing signed Agent API auth: `supabase/functions/_shared/agent_api_auth.ts`
- Existing API key creation: `supabase/functions/agent-api-keys/index.ts`, `supabase/functions/_shared/agent_onboarding.ts`
- Public docs route: `src/routes/docs.tsx`, `src/components/linkr/docs/LinkrDocsPage.tsx`

Key observation: `/app/terminal` currently authenticates with a Supabase user JWT. Existing external Agent API endpoints authenticate with scoped HMAC-signed API keys. The CLI should use the browser only to prove the user identity and then store a dedicated CLI API key locally. It should not store Supabase refresh tokens.

## 2. Recommended architecture

Build three layers:

1. `@linkr/cli`: a Node CLI with login, logout, whoami, chat, conversation history, and action confirmation.
2. CLI auth bridge: a new browser-device login flow that creates a short-lived login session, asks the user to authenticate with X in the browser, shows a one-time code, and lets the CLI redeem that code for a dedicated API key.
3. CLI chat API: new API-key-authenticated chat/conversation/action endpoints that reuse `processLinkrAgentTurn` and the existing terminal tables.

Request path:

```text
User terminal
  linkr login
    -> POST /api/cli/auth/start
    -> browser opens https://www.linkr.cash/cli/auth?request=<browser_request_code>
    -> existing X login if needed
    -> page shows only LINKR-XXXX-XXXX
    -> user pastes code into CLI
    -> POST /api/cli/auth/complete
    -> backend creates dedicated scoped CLI API key
    -> CLI stores credential locally

  linkr chat
    -> HMAC signed POST /api/cli/chat
    -> Supabase Edge Function verifies key, scopes, limits, nonce
    -> processLinkrAgentTurn(...)
    -> SSE stream back to CLI
```

## 3. Auth flow, end to end

### 3.1 Start login from CLI

Add a public, unauthenticated endpoint:

`POST /api/cli/auth/start`

Body:

```json
{
  "client_name": "Dev's PC",
  "cli_version": "0.1.0",
  "requested_scopes": [
    "profile:read",
    "actions:read",
    "coins:read",
    "coin:read",
    "chat:write"
  ],
  "requested_limits": {
    "daily_request_limit": 500
  }
}
```

Server behavior:

- Generate two independent high-entropy secrets:
  - `device_code`: 32 random bytes, returned only to the CLI and never placed in the browser URL.
  - `browser_request_code`: 32 random bytes, placed only in the browser URL.
- Store only SHA-256 hashes of both values.
- Store normalized requested scopes, requested limits, client name, CLI version, request IP hash, user-agent hash, attempt count, status, and expiry.
- Expire the login session after 10 minutes.
- Return:

```json
{
  "device_code": "<opaque high entropy secret>",
  "verification_url": "https://www.linkr.cash/cli/auth?request=<browser_request_code>",
  "expires_at": "2026-07-28T19:00:00.000Z"
}
```

CLI behavior:

- Open `verification_url` with the `open` package when possible.
- Always print the URL as fallback.
- Keep `device_code` in memory only until login finishes.
- Prompt: `Paste the Linkr authorization code:`

Do not poll unless you later add an automatic login completion mode. Manual paste is simpler and matches the requested UX.

### 3.2 Browser authorization page

Add a public route:

`src/routes/cli.auth.tsx` for `/cli/auth`

Behavior:

1. Read `request` from the URL.
2. If the user is not signed in, redirect to `/auth?returnTo=/cli/auth?request=...`.
3. The existing `/auth` flow already signs in with X, then returns to a same-origin path.
4. Once signed in, call `POST /api/cli/auth/approve` with the user's Supabase session JWT and the `browser_request_code`.
5. The approve endpoint validates the request code, validates the login session is still pending, records `approved_user_id`, generates the short display code, stores only its hash, and returns it once.
6. The page displays only the code.

The code page should contain no API key, no token, no debug details, no account metadata, and no copy of the hidden `device_code`.

Example display code format:

```text
LINKR-J7K4-Q9PV
```

Use a Crockford/base32 alphabet that avoids ambiguous characters. Use at least 50 bits of entropy for the displayed code, a 10 minute maximum lifetime, and a maximum of 5 failed redemption attempts.

### 3.3 Complete login from CLI

Add a public, unauthenticated endpoint:

`POST /api/cli/auth/complete`

Body:

```json
{
  "device_code": "<opaque high entropy secret from start>",
  "user_code": "LINKR-J7K4-Q9PV"
}
```

Server behavior:

- Hash `device_code` and normalized `user_code`.
- Atomically find and consume a row where:
  - status is `approved`
  - code hashes match
  - `approved_user_id` is set
  - `expires_at > now()`
  - `consumed_at is null`
  - failed attempts are below the limit
- On mismatch, increment attempt count by device session if the device hash exists.
- On success, create or reuse a dedicated agent profile named `Linkr CLI`.
- Mint a new API key with the approved scopes and limits.
- Mark the login session consumed.
- Return the plaintext API key once:

```json
{
  "api_key": "linkr_live_...",
  "key": {
    "id": "...",
    "prefix": "...",
    "scopes": ["profile:read", "actions:read", "coins:read", "coin:read", "chat:write"],
    "expires_at": null
  },
  "agent_profile": {
    "id": "...",
    "name": "Linkr CLI"
  }
}
```

Important: do not create the API key during the browser approval step. Create it only during successful CLI redemption so no plaintext API key ever needs to sit in the database or appear in the browser.

## 4. Database changes

Add a migration for `cli_auth_sessions`.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `device_code_hash text not null unique`
- `browser_request_hash text not null unique`
- `user_code_hash text unique`
- `approved_user_id uuid references auth.users(id) on delete cascade`
- `status text not null default 'pending'`
- `requested_scopes text[] not null default '{}'`
- `requested_limits jsonb not null default '{}'`
- `client_name text`
- `cli_version text`
- `request_ip_hash text`
- `request_user_agent_hash text`
- `approve_ip_hash text`
- `approve_user_agent_hash text`
- `failed_attempts integer not null default 0`
- `expires_at timestamptz not null`
- `approved_at timestamptz`
- `consumed_at timestamptz`
- `created_at timestamptz not null default now()`

Constraints:

- `status in ('pending','approved','consumed','expired','denied')`
- `failed_attempts between 0 and 5`

Indexes:

- pending expiry index on `(expires_at)` where `consumed_at is null`
- lookup index on `browser_request_hash`
- lookup index on `device_code_hash`
- lookup index on `user_code_hash` where `user_code_hash is not null`

Security:

- Enable RLS.
- Revoke all from `anon` and `authenticated`.
- Grant all only to `service_role`.
- Access it only through Edge Functions.

## 5. Backend endpoints to add

Add gateway route mappings in `src/lib/agent-api/gateway.server.ts`:

- `/api/cli/auth/start` -> `cli-auth-start`
- `/api/cli/auth/approve` -> `cli-auth-approve`
- `/api/cli/auth/complete` -> `cli-auth-complete`
- `/api/cli/chat` -> `cli-chat`
- `/api/cli/conversations` -> `cli-conversations`
- `/api/cli/messages` -> `cli-messages`
- `/api/cli/action` -> `cli-action`
- `/api/cli/uploads` -> `cli-upload` if image attachments are required in v1

Update CORS allowed headers to include:

- `x-linkr-canonical-path`
- `x-linkr-client-version`
- `x-linkr-install-id`

The gateway already forwards `X-Linkr-Canonical-Path`; keep using that for HMAC signatures so proxy rewrites cannot break verification.

## 6. Scopes and limits

Add a new scope in `supabase/functions/_shared/agent_api_core.ts`:

```ts
"chat:write"
```

Default CLI login scopes:

- `profile:read`
- `actions:read`
- `coins:read`
- `coin:read`
- `chat:write`

For full parity with `/app/terminal`, allow the CLI to request additional write scopes:

- `launch:write`
- `trade:buy`
- `trade:sell`
- `transfer:write`
- `schedule:read`
- `schedule:write`
- `rewards:claim`
- `liquidity:write`
- `burn:write`

Do not grant all write scopes blindly. Normalize requested scopes server-side, apply conservative defaults, and keep value movement bounded by per-key limits. The browser auth code page can still show only the code; scope selection can live in the CLI command flags and the user's dashboard settings.

Recommended commands:

```text
linkr login              # read + chat, safe default
linkr login --full       # chat plus value-moving scopes, bounded by server limits
linkr login --read-only  # no chat actions that can execute value movement
```

Server-side rules:

- `--full` may request write scopes, but every action still goes through pending-action confirmation.
- Default transfer caps should be zero unless the user explicitly enables them in dashboard settings or with a clear CLI flag.
- Revocation must be visible in `/app/api-keys` and work immediately through existing `revoke_key`.

## 7. CLI chat endpoint

Add `supabase/functions/cli-chat/index.ts`.

It should mirror `terminal-chat` with these changes:

- Authenticate with `requireAgentApiKey(req, admin, "chat:write")`.
- Use `ctx.userId` as the actor.
- Use `surface: "cli"` and `transport.kind: "cli_sse"`.
- Reuse `linkr_terminal_conversations`, `linkr_terminal_messages`, `linkr_terminal_events`, `linkr_agent_runs`, `linkr_pending_actions`, and `linkr_action_receipts`.
- Store conversation `source` as `cli`.
- Accept `conversation_id`, `client_message_id`, `message`, `attachments`, and `client_context`.
- Validate `conversation_id` belongs to `ctx.userId`.
- Keep the same SSE event vocabulary as web terminal:
  - `ack`
  - `typing`
  - `execution_status`
  - `delta`
  - `source_ref`
  - `action_required`
  - `message_update`
  - `complete`
  - `error`
- Use the same idempotency pattern as `terminal-chat`.
- Rate limit by API key and by user.

The runtime call should stay the same shape:

```ts
await processLinkrAgentTurn(
  admin,
  {
    surface: "cli",
    surface_conversation_id: conversation.id,
    source_message_id: userMessage.id,
    user_id: ctx.userId,
    text,
    actor: { kind: "authenticated_user", user_id: ctx.userId },
    transport: {
      kind: "cli_sse",
      public_output: false,
      supports_streaming: true
    },
    conversation: {
      terminal_conversation_id: conversation.id,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
      run_id: run.id
    },
    attachments,
    source_refs: [],
    client_context: body.client_context ?? {}
  },
  sink
);
```

## 8. CLI action confirmation

Add `supabase/functions/cli-action/index.ts`.

Purpose: confirm or cancel pending actions emitted by chat.

Body:

```json
{
  "pending_action_id": "...",
  "action": "confirm",
  "confirmation_phrase": "CONFIRM ..."
}
```

Rules:

- Authenticate with API key.
- Load `linkr_pending_actions` by `id` and `ctx.userId`.
- Reject expired, non-pending, already executing, or already executed actions.
- Map `pending.action_type` to required write scope.
- Require exact `confirmation_phrase` for value-moving actions.
- Require `Idempotency-Key` on confirm.
- For cancel, allow `actions:read` or `chat:write`.
- Reuse `confirmAndExecuteLinkrPendingAction` and `cancelPendingActionViaDispatch`.
- Write assistant/result messages back into the same terminal conversation so `/app/terminal` stays in sync.

CLI behavior:

- When an SSE `action_required` event arrives, render the summary and risk details.
- Prompt the user to type the exact confirmation phrase for value-moving actions.
- Send a signed `POST /api/cli/action`.
- Show the receipt or failure message.

This gives CLI parity with the terminal page without letting a chat turn silently move funds.

## 9. Conversation history endpoints

Add API-key variants of the existing terminal endpoints:

- `GET /api/cli/conversations`
- `POST /api/cli/conversations`
- `PATCH /api/cli/conversations`
- `GET /api/cli/messages?conversation_id=...`

They should reuse the existing terminal tables and logic, but authenticate with `requireAgentApiKey(req, admin, "chat:write")` or `profile:read` for read-only listing. This makes CLI conversations appear in the web terminal and lets users continue a conversation on either surface.

## 10. NPM package structure

Create a separate package, ideally in a workspace path such as `packages/linkr-cli`.

Recommended package:

```json
{
  "name": "@linkr/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "linkr": "./dist/bin/linkr.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Recommended libraries:

- `commander` for commands
- `prompts` for terminal prompts
- `open` for opening the browser
- `eventsource-parser` for SSE
- `picocolors` for readable output
- `conf` for config storage, or a small custom config helper

Avoid `@supabase/supabase-js` in the CLI. The CLI should call Linkr's public API using `fetch` and HMAC signing. It should not manage Supabase sessions.

Commands:

```text
linkr login
linkr logout
linkr whoami
linkr chat
linkr chat "show my portfolio"
linkr conversations
linkr continue <conversation_id>
linkr revoke-current
```

## 11. Local credential storage

Store only the dedicated Linkr API key and non-sensitive metadata.

Path:

```text
~/.linkr/credentials.json
```

Shape:

```json
{
  "apiKey": "linkr_live_...",
  "apiUrl": "https://www.linkr.cash",
  "keyPrefix": "...",
  "agentProfileId": "...",
  "installId": "...",
  "createdAt": "..."
}
```

Security requirements:

- Create the directory with `0700`.
- Create the file with `0600`.
- Refuse to use the credential on Unix if the file is group/world readable.
- On Windows, use the user's profile directory and do not write to project folders.
- Never log the API key.
- `linkr logout` deletes the local file.
- `linkr revoke-current` calls the backend revoke endpoint, then deletes the local file.
- Later, add OS keychain storage. Do not block v1 on it.

## 12. Request signing

For every authenticated CLI API request, reuse the existing Agent API HMAC contract.

Headers:

```text
Authorization: Bearer linkr_live_...
X-Linkr-Timestamp: <unix seconds>
X-Linkr-Nonce: <random unique nonce>
X-Linkr-Body-SHA256: <hex sha256 of exact body bytes>
X-Linkr-Signature: <hex hmac sha256>
Idempotency-Key: <required for mutations>
X-Linkr-Canonical-Path: /api/cli/chat
```

Signature payload:

```text
LINKR-HMAC-SHA256
<HTTP_METHOD>
<canonical_path_with_query>
<body_sha256_hex>
<timestamp>
<nonce>
<idempotency_key_or_empty>
```

The HMAC secret is the plaintext API key. This matches `requireAgentApiKey`.

Client requirements:

- Generate a new nonce for every request.
- Retry network failures only with the same idempotency key for the same logical action.
- Never retry a value-moving confirm with a different idempotency key unless the user explicitly starts a new action.

## 13. Security checklist

Auth bridge:

- Hash all login codes at rest.
- Keep `device_code` out of browser URLs.
- Keep `browser_request_code` unusable for CLI redemption.
- Display only the short `user_code` in the browser.
- Expire login sessions after 10 minutes.
- Limit failed completion attempts to 5.
- Rate limit auth start, approve, and complete by IP hash and session id.
- Consume the auth session atomically.
- Create the API key only after successful CLI redemption.
- Never store plaintext API keys in the auth session table.

X login:

- Reuse existing X OAuth user flow.
- Reuse `/auth?returnTo=...` instead of adding a second X OAuth implementation.
- Keep all X client secrets server-side.
- Continue using the existing one-time handoff approach so Supabase tokens are not exposed in URLs.

CLI credential:

- Store a revocable Linkr API key, not a Supabase refresh token.
- Keep keys scoped and rate-limited.
- Show CLI-created keys in `/app/api-keys`.
- Add a clear key name such as `CLI - Dev's PC - 2026-07-28`.

Chat and actions:

- Authenticate chat with `chat:write`.
- Authenticate action confirm with the specific write scope required by the pending action.
- Require exact confirmation phrases for value-moving actions.
- Keep server-side caps authoritative.
- Keep wallet private keys server-side only.
- Keep idempotency keys mandatory for confirms.
- Record all CLI requests in `agent_api_requests`.

Operational:

- Add structured audit events for auth start, approve, complete, revoke, chat, and confirm.
- Add cleanup job for expired `cli_auth_sessions`.
- Add version headers so the backend can block dangerously old CLI versions.
- Add tests for replay, expired code, wrong code, wrong device code, double redemption, revoked key, missing scope, stale timestamp, and nonce reuse.

## 14. Docs page update

Add the CLI to the existing public `/docs` route as part of the feature launch.

Files:

- `src/routes/docs.tsx`
- `src/components/linkr/docs/LinkrDocsPage.tsx`
- `src/components/linkr/docs/linkr-docs.css` only if the existing docs components need small layout support

Required docs content:

- Add a dedicated `CLI` entry to the docs navigation/table of contents near the existing `Terminal` and `Agent API` sections.
- Add a new CLI section that explains what the npm package is for, how it relates to `/app/terminal`, and that it uses the same Linkr agent runtime, wallet guardrails, conversation history, and pending-action confirmation model.
- Include install and first-run commands:

```text
npm install -g @linkr/cli
linkr login
linkr chat
```

- Explain the browser login flow exactly as implemented: `linkr login` opens a browser URL, the user authenticates with X, the page shows only a short one-time authorization code, and the CLI redeems that code for a local revocable Linkr CLI credential.
- State that the browser never shows an API key, the CLI never stores Supabase refresh tokens, and CLI-created keys can be revoked from `/app/api-keys`.
- Document common commands: `linkr login`, `linkr logout`, `linkr whoami`, `linkr chat`, `linkr conversations`, `linkr continue <conversation_id>`, and `linkr revoke-current`.
- Document action confirmation behavior: value-moving actions show a pending action, require the exact confirmation phrase, are bounded by server-side scopes/caps, and are idempotent.
- Add a short troubleshooting block for expired codes, revoked keys, missing scopes, stale clocks, and browser-open fallback.
- Update the `/docs` page metadata in `src/routes/docs.tsx` so the title/description mention CLI once the feature is public.

Docs quality requirements:

- Keep the CLI docs user-facing and concise; do not expose internal table names or secret hashing details on the public page.
- Keep implementation/security details in this plan and backend tests, not in the public docs copy.
- Cross-link to `/app/terminal` for the web chat experience and `/app/api-keys` for key revocation/monitoring.

## 15. Build order

1. Add `chat:write` to `AGENT_SCOPES`.
2. Add `cli_auth_sessions` migration.
3. Add `cli-auth-start`, `cli-auth-approve`, and `cli-auth-complete`.
4. Add `/cli/auth` route that redirects through existing X auth when needed and displays only the one-time code.
5. Add gateway route mappings and CORS header updates.
6. Add `cli-chat` by adapting `terminal-chat` to API-key auth and `surface: "cli"`.
7. Add `cli-action` by adapting terminal action confirmation to API-key auth and scope checks.
8. Add `cli-conversations` and `cli-messages` for shared history.
9. Build `@linkr/cli` with login/logout/whoami/chat/conversations.
10. Add edge tests and CLI integration tests against local Supabase functions.
11. Update `/docs` with the CLI section, navigation entry, install flow, login flow, command reference, action confirmation notes, troubleshooting, and metadata.
12. Publish a beta package to npm.
13. Document install:

```text
npm install -g @linkr/cli
linkr login
linkr chat
```

## 16. Acceptance criteria

Login:

- `linkr login` opens the browser and also prints the login URL.
- A signed-out user is taken through X login.
- A signed-in user goes directly to the CLI authorization code page.
- The code page shows only the one-time code.
- Pasting the code into the CLI returns a dedicated API key.
- The key appears in `/app/api-keys` and can be revoked.
- Expired, reused, incorrect, or brute-forced codes fail.

Chat:

- `linkr chat` streams the same event types as `/app/terminal`.
- Conversations and messages appear in `/app/terminal`.
- Existing Linkr capabilities work through `processLinkrAgentTurn`.
- The CLI can continue an existing conversation id.

Actions:

- Pending actions show a summary and confirmation phrase in the CLI.
- Confirming requires exact phrase and a signed idempotent request.
- Cancelling works.
- Duplicate confirms do not duplicate execution.
- Missing scopes or exceeded caps fail before any chain work begins.

Security:

- No Supabase refresh token is stored by the CLI.
- No API key is shown in the browser.
- No plaintext login code or API key is stored in the database.
- Every authenticated CLI request is HMAC signed.
- Every nonce is single-use.
- Revoked keys stop working immediately.

Docs:

- `/docs` has a visible CLI nav entry and section.
- The CLI docs show install, login, chat, logout, revoke, conversation, and confirmation flows.
- The docs accurately say the browser displays only the one-time code and that CLI credentials are revocable from `/app/api-keys`.
- The `/docs` metadata mentions CLI after public launch.

## 17. Notes from standards and platform docs

- The login bridge should follow the OAuth device authorization pattern: separate high-entropy device code, human-entered user code, short expiry, and rate limits. See RFC 8628.
- X user auth should continue using OAuth 2.0 Authorization Code with PKCE through the existing Linkr backend. X access tokens are short-lived unless `offline.access` is requested; the CLI should not own that refresh-token lifecycle.
- Supabase Edge Functions called by signed-in browser users can use the user's session JWT. CLI calls should instead use Linkr's own HMAC API-key layer after login.

References:

- RFC 8628 OAuth 2.0 Device Authorization Grant: https://datatracker.ietf.org/doc/html/rfc8628
- X OAuth 2.0 Authorization Code with PKCE: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- Supabase Edge Function auth: https://supabase.com/docs/guides/functions/auth
