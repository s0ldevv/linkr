# Linkr CLI — Design & Architecture (API-key auth)

**Status:** Design proposal (not yet built)
**Goal:** Ship an installable npm package that authenticates with a **Linkr API key** (created on the `/app/api-keys` "Agents" page) and lets the user chat with Linkr — and run wallet actions — from their own terminal, reusing the same agent, wallet, and guardrails as the web app.

```
$ npm i -g @linkr/cli            # or: npx @linkr/cli
$ linkr login                    # paste your linkr_live_… API key (from /app/api-keys)
$ linkr                          # interactive chat REPL
> what's my SOL balance?
Linkr: Your Solana wallet holds 2.31 SOL …
```

> **Revision note.** An earlier draft of this plan used an X-OAuth browser loopback flow. Per direction, auth is now done with **API keys issued from `/app/api-keys`**. That is a much better fit for a CLI (no browser, no OAuth refresh dance, a single long-lived secret). It also surfaces one real architectural fact that shapes the whole design — see §2.

---

## 1. Where API keys come from (the `/app/api-keys` page)

The Agents / API-keys page is backed by the `agent-api-keys` edge function (auth: the user's own web session). It supports:

- `create_agent` → creates an **agent profile**, provisions/binds a **wallet**, and mints the **first API key**. Returns the plaintext key **once** as `api_key`.
- `create_key` → mints an additional key for an existing agent profile.
- `revoke_key` / `disable_profile` → revoke.

At creation the user picks **scopes** and **per-key spend limits** (`max_buy_eth`, `max_buy_sol`, `max_transfer_eth`, `max_transfer_sol`, `max_launch_initial_buy_eth`, `daily_request_limit`, …). The plaintext key looks like:

```
linkr_live_<10-hex-prefix>_<64-hex-secret>
```

The user copies it once and pastes it into the CLI. **This is the CLI's credential.**

Scopes today (`_shared/agent_api_core.ts → AGENT_SCOPES`): `profile:read`, `actions:read`, `coins:read`, `coin:read`, `launch:write`, `trade:buy`, `trade:sell`, `transfer:write`, `schedule:read`, `schedule:write`, `burn:write`, `rewards:claim`, `liquidity:write`. (We add one — `chat:write` — in §4.)

---

## 2. The one architectural fact that shapes everything

There are **two different backend surfaces**, with **two different auth models**:

| Surface | Auth | Nature | Reaches the conversational brain? |
| --- | --- | --- | --- |
| **Agent API** (`agent-trade`, `agent-transfer`, `agent-wallet`, `agent-coin-info`, `agent-portfolio`, `agent-history`, `agent-launch-token`, `agent-liquidity-*`, `agent-burn-token`, `agent-action-status`, …) | **API key + HMAC signing** (`requireAgentApiKey`) | **Structured REST tool calls** — one endpoint per capability | **No** |
| **Terminal / conversational** (`terminal-chat` SSE) | **User session JWT** (`getCallerUserId`) | **Free-form chat**, streamed, runs `processLinkrAgentTurn` | **Yes** |

Verified: `processLinkrAgentTurn` (the natural-language agent that powers the web terminal) is imported only by `terminal-chat`, `telegram-webhook`, and the queue workers — **never by any `agent-*` endpoint**. The API-key surface is a typed command API; it has no chat endpoint.

**Implication:** API-key auth gets us wallet actions and data reads immediately, but to get the *chat* experience the user asked for, the conversational runtime must be made reachable with an API key. That is a small, clean addition (§4), not a rewrite — the runtime itself is surface-neutral and already accepts a `surface` tag.

This yields two build options, both API-key-authenticated:

- **Option A — Structured CLI (zero backend change, works today):** typed commands over the existing signed `agent-*` endpoints (`linkr balance`, `linkr trade …`, `linkr coin …`). Not a chat REPL.
- **Option B — Conversational CLI (recommended; one new endpoint + one new scope):** a real chat REPL, API-key-authenticated, reusing `processLinkrAgentTurn`.

Recommendation: ship **A as the immediate MVP** and **B as the headline experience**, since B is what "chat with Linkr in the terminal" actually means.

---

## 3. Authenticating & signing requests (the real client work)

Unlike a plain bearer token, every Agent API request is **HMAC-signed** (`_shared/agent_api_auth.ts → requireAgentApiKey`). The CLI must reproduce this for every call. Headers required:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer linkr_live_<prefix>_<secret>` (the full plaintext key) |
| `X-Linkr-Timestamp` | current unix time; must be within **±5 min** of server |
| `X-Linkr-Nonce` | a fresh unique string per request (**single-use** — server stores it; reuse ⇒ `replay_detected`) |
| `X-Linkr-Body-SHA256` | lowercase hex SHA-256 of the exact request body bytes |
| `X-Linkr-Signature` | HMAC-SHA256 (see below), lowercase hex |
| `Idempotency-Key` | required for value-moving calls; recommended everywhere |
| `X-Linkr-Canonical-Path` | the canonical `pathname[?query]` used in the signature (avoids proxy path rewrites) |
| `apikey` | the Supabase publishable key (public; needed to reach the function gateway) |

**Signature string** — HMAC-SHA256 with the **plaintext API key as the secret**, over these 7 lines joined by `\n`:

```
LINKR-HMAC-SHA256
<HTTP-METHOD-UPPERCASE>
<canonical-path>
<body-sha256-hex>
<timestamp>
<nonce>
<idempotency-key-or-empty>
```

Additional server-side enforcement the CLI inherits for free: **scope check** (`requiredScope` per endpoint), **per-key spend caps**, **per-key minute + daily rate limits**, **wallet binding** (key ↔ wallet), **ban check**, and **nonce replay protection**.

**Client responsibility:** ship a small, well-tested `signRequest()` helper (body → SHA-256 → build canonical string → HMAC). This is the single piece of genuine client complexity, but it's deterministic and fully specified above. Node ≥18 gives us `crypto.subtle` and `fetch` natively — no native deps.

**Storage:** persist the key to `~/.linkr/credentials.json` at `chmod 600` (upgrade path: OS keychain via `keytar`). It is a long-lived secret — no refresh flow needed. `linkr logout` deletes it; `linkr login` writes it (from paste or `LINKR_API_KEY` env).

---

## 4. Option B — making chat reachable by API key (recommended)

Add **one scope** and **one endpoint**; reuse the existing runtime and the existing signing/auth.

1. **New scope:** add `chat:write` to `AGENT_SCOPES` (`_shared/agent_api_core.ts`). Surface it as a checkbox on `/app/api-keys` so users can mint a chat-capable key.
2. **New endpoint `agent-chat`:** mirrors `terminal-chat` but authenticates with `await requireAgentApiKey(req, admin, "chat:write")` instead of `getCallerUserId`, then calls the **same** `processLinkrAgentTurn` with `surface: "cli"` and the key's `userId`/wallet. Stream the reply as SSE (identical event vocabulary as `terminal-chat`: `ack`, `typing`/`execution_status`, `delta`, `source_ref`, `action_required`, `message_update`, `complete`, `error`).
   - Reuse the terminal conversation tables (`linkr_terminal_conversations` / `linkr_terminal_messages`) so CLI chat history is shared with the web terminal for the same account.
   - Note: SSE + HMAC compose cleanly — signing is over the **request** (body is known before send); the streamed **response** is unaffected.
3. **Confirmations:** two complementary layers.
   - **Hard ceiling (already exists):** the key's **scopes + per-key spend caps** bound what any chat turn can ever execute. A key minted without `transfer:write`, or with `max_transfer_sol = 0`, simply cannot move value — enforced server-side regardless of what the chat says.
   - **Interactive confirm (recommended for parity):** when a turn emits `action_required` with a `pending_action_id`, the CLI prints the summary and prompts `y/N`, then sends a **signed confirm** call. Simplest implementation: accept a `{ pending_action_id, action: "confirm" | "cancel" }` message on `agent-chat` (or a small `agent-action-confirm` endpoint) guarded by the relevant write scope. This preserves the web terminal's "prepare → confirm" UX.

That's the entire backend delta for the chat experience: **1 scope + 1 (or 2) small functions**, all reusing existing auth and the existing agent brain.

---

## 5. Architecture

```
┌──────────────────────────── User's machine ────────────────────────────┐
│  linkr (npm bin)                                                        │
│  ├── Commander CLI (login / chat / balance / trade / transfer / coin …) │
│  ├── Credential store   ── ~/.linkr/credentials.json (0600) or keychain │
│  ├── signRequest()      ── SHA-256 body, timestamp, nonce, HMAC sig     │
│  ├── Transport          ── fetch (+ SSE parser for chat)                │
│  └── Confirm prompt      ── y/N → signed confirm for pending actions    │
└───────────────┬─────────────────────────────────────────────────────────┘
                │  HTTPS · Authorization: Bearer linkr_live_… · X-Linkr-* signature
                ▼
┌──────────────────────────── Supabase Edge Functions ───────────────────┐
│  requireAgentApiKey (HMAC + scopes + caps + nonce + ban + rate limit)   │
│                                                                         │
│  Agent API (today):  agent-wallet  agent-portfolio  agent-coin-info     │
│                      agent-trade   agent-transfer   agent-history …     │
│  Chat (Option B):    agent-chat  ──→ processLinkrAgentTurn (SSE)        │
└───────────────┬─────────────────────────────────────────────────────────┘
                ▼
     Same runtime + queue + Postgres that power web terminal, Telegram, X
     (wallets, market data, executors, conversation state, memory)
```

The CLI is a new **surface**, not a new system. Wallets, market data, execution, memory, and (with Option B) conversation history are all reused.

---

## 6. Commands

**Option A (structured, available immediately over existing endpoints):**

- `linkr login` / `linkr logout` / `linkr whoami` (shows agent profile, scopes, bound wallet, key prefix)
- `linkr balance` → `agent-wallet`; `linkr portfolio` → `agent-portfolio`
- `linkr coin <address|mint>` → `agent-coin-info`; `linkr history` → `agent-history`
- `linkr trade buy|sell …` → `agent-trade`; `linkr transfer …` → `agent-transfer`
- `linkr launch …` → `agent-launch-token`; `linkr lp …` → `agent-liquidity-*`
- `linkr status <action_id>` → `agent-action-status`
- Global: `--json` (machine output), `--yes` (skip confirm, still bounded by caps), `--idempotency-key`

**Option B (chat REPL, after the `agent-chat` addition):**

- `linkr` / `linkr chat [message] [--continue] [--conversation <id>]` → streamed chat
- `linkr conversations` → list shared terminal conversations

---

## 7. Package & tech stack

- **Runtime:** Node ≥ 18 (native `fetch`, `crypto.subtle`, `crypto.randomUUID`, `ReadableStream`), TypeScript, ESM+CJS, `bin: linkr` (alias `lkr`). Runnable via `npx @linkr/cli`.
- **Libraries (small, boring):** `commander` (commands), `eventsource-parser` (SSE for chat), `prompts` (y/N confirm + key paste), `ora`/`nanospinner` + `picocolors` (UX), `conf` or a hand-rolled `~/.linkr` reader (storage), optional `keytar` (keychain). **No `@supabase/supabase-js` needed** — there's no OAuth/refresh; auth is a raw signed `fetch`. **No native crypto deps** — use built-in `crypto.subtle`.
- **Config:** bake in production function base URL + publishable key; override via `LINKR_API_URL` / `LINKR_API_KEY` / `LINKR_SUPABASE_KEY` for staging & CI.

---

## 8. Backend changes required

**Option A — none.** The CLI runs against the existing signed `agent-*` endpoints as-is.

**Option B (recommended) — minimal:**
1. Add `chat:write` to `AGENT_SCOPES` and expose it on the `/app/api-keys` scope picker.
2. Add `agent-chat` (SSE) — `requireAgentApiKey(req, admin, "chat:write")` → `processLinkrAgentTurn` with `surface: "cli"`; reuse terminal conversation tables.
3. Add a signed confirm path for pending actions (`action: confirm|cancel` on `agent-chat`, or a tiny `agent-action-confirm`).
4. (Nice-to-have) accept `surface: "cli"` tagging + a `linkr-cli/<version>` user-agent + a min-version gate header.

No new wallet logic, no new executors, no changes to the agent brain.

---

## 9. Security model

- **Credential = the API key.** A long-lived secret; store at `0600`/keychain. `revoke_key` on `/app/api-keys` instantly kills a lost key. Prefer per-machine keys so one revocation doesn't disrupt others.
- **Least privilege by construction.** The user mints a key with exactly the scopes + spend caps they want the CLI to have. A read-only CLI key (`profile:read`, `coins:read`, `chat:write` without write scopes) literally cannot move funds — the server rejects it.
- **Tamper/replay protection.** HMAC signature binds method + path + body + timestamp + nonce; nonces are single-use; timestamps must be fresh (±5 min). A captured request cannot be replayed or altered.
- **Server-authoritative guardrails.** Scopes, per-key caps, per-key minute/daily rate limits, wallet binding, and ban checks all live in `requireAgentApiKey` — a modified CLI cannot bypass them.
- **No private keys client-side.** Wallet keys never leave the server; the CLI can only *request* actions within the key's scopes/caps.
- **Idempotency** via `Idempotency-Key` prevents duplicate execution on retry.

---

## 10. Suggested build order

| Phase | Deliverable | Backend |
| --- | --- | --- |
| **0 — Spike** | `signRequest()` helper + `linkr balance`/`linkr coin` against `agent-wallet`/`agent-coin-info`; prove signing end-to-end. | none |
| **1 — Structured MVP (Option A)** | Key paste login + `0600` storage, `whoami`, reads (`balance`/`portfolio`/`history`/`coin`) and writes (`trade`/`transfer`/`launch`) with confirm + idempotency, `--json`. | none |
| **2 — Chat (Option B)** | `chat:write` scope + `agent-chat` SSE endpoint; interactive `linkr chat` REPL with streaming + pending-action confirm; shared conversation history. | scope + 1–2 functions |
| **3 — Polish** | `conversations`, keychain storage, min-version gate, retries/backoff, nicer TUI, CI-friendly non-interactive mode. | tagging/gate |
| **4 — Reach** | standalone binaries (`bun build --compile`/`pkg`), Homebrew, attachments via a signed upload. | optional |

---

## 11. Open decisions

- **Ship Option A first, or wait for B?** Recommend A first (immediate value, zero backend), then B for the chat headline.
- **Confirm transport for chat:** inline `action: confirm` on `agent-chat` vs. a dedicated `agent-action-confirm`. Recommend inline first for fewer moving parts.
- **One key vs. per-command scopes:** encourage a single chat-capable key with the user's chosen caps; document minting a read-only key for safe/CI usage.
- **Package name:** `@linkr/cli` vs. bare `linkr` if available.
- **Relationship to Option-A commands:** keep the structured commands even after chat lands — they're ideal for scripting/CI, where chat is not.

---

## 12. TL;DR

Build a small TypeScript npm package (`linkr` bin) whose credential is a **Linkr API key from `/app/api-keys`**. The CLI stores the key locally and **HMAC-signs every request** (timestamp + fresh nonce + body hash + signature) exactly as `requireAgentApiKey` expects, inheriting scopes, per-key spend caps, rate limits, and replay protection for free.

- **Immediately (no backend change):** a structured CLI over the existing signed `agent-*` endpoints — balances, portfolio, coin info, trades, transfers, launches.
- **For the chat experience (small backend addition):** add a `chat:write` scope and an `agent-chat` SSE endpoint that reuses `processLinkrAgentTurn`, giving a real streamed chat REPL authenticated by API key — with value-moving actions bounded by the key's scopes/caps and an interactive confirm.

The agent, wallets, and guardrails are reused as-is; the only genuinely new code is the client-side request signer and (for chat) one thin endpoint that points the existing conversational brain at API-key auth.
