# Linkr on Discord — Design & Architecture

**Status:** Design proposal (not yet built)
**Goal:** Bring the full Linkr agent to Discord — users **DM Linkr and chat with it in plain English**, talk to it in a server, prepare and confirm wallet actions, and gate server access behind verification — reusing the exact agent runtime, wallet security, and conversation storage that already power the Telegram bot.

> **Revision note.** This version makes **natural free-form DM chat a first-class part of the design**, not an optional add-on. It also corrects an important detail: reading DM (and @mention) message content does **not** require Discord's privileged Message Content intent (verified against Discord's docs — see §2). The result is a **dual-path** architecture: a serverless HTTP path for slash commands and buttons, plus a lightweight always-on **Gateway** worker that lets users truly DM and converse with Linkr like they do on Telegram.

---

## 1. What we're mirroring (the Telegram flow, as-built)

The Telegram integration already does everything we want, and almost none of it is Telegram-specific. Verified in code:

| Concern | Telegram implementation |
| --- | --- |
| Ingress | `telegram-webhook/index.ts` receives every update; verifies `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET` (`telegram.ts: verifyTelegramWebhookRequest`) |
| Idempotency | `telegram_updates` table + `accept_legacy_telegram_update` RPC (lease-based dedup) |
| Account linking | `/login` → `createTelegramLoginLink` writes a one-time `telegram_link_tokens` row → user opens the web app, signs in with **X (Supabase OAuth)** → `completeTelegramLinkToken` binds `telegram_accounts.user_id` |
| Private chat | `runPrivateTelegramTurn` → **`processLinkrAgentTurn`** (the shared agent runtime) with `surface: "telegram"` |
| Conversation storage | `telegram_conversations` maps (chat, user, thread) → a `linkr_terminal_conversations` row; reuses `linkr_terminal_messages` + `linkr_agent_runs` — **the same tables as the web terminal** |
| Value-moving actions | Agent prepares a `linkr_pending_actions` row; bot renders an inline **Confirm/Cancel** keyboard (`telegramPendingActionKeyboard`); button callback → `confirmAndExecuteLinkrPendingAction` / `cancelLinkrPendingAction` |
| Groups | Bot only answers when addressed (@mention/reply); refuses private/account actions in group ("DM me"); new members are **muted** and must pass a **captcha + X verification** web challenge (`telegram-verify`, `telegram_verification_challenges`) before they can speak |
| Safety | Ban check (`getActiveBanForAuthUser`), shadow queue (`acceptShadowWork`), per-surface output sink |

**Key insight:** the "brain" (`processLinkrAgentTurn`), the wallet/pending-action layer, the conversation tables, bans, and the shadow queue are all **surface-neutral**. Telegram is a ~1,600-line *adapter* around them. Discord is a second adapter around the same core. We build a new front-door, not a new backend.

---

## 2. How Discord ingress works (and what free-form DM chat actually needs)

Telegram delivers **every message** to your webhook. Discord splits ingress into two channels:

| Model | What it delivers | Transport | Serverless? |
| --- | --- | --- | --- |
| **HTTP Interactions** (Interactions Endpoint URL) | Only **interactions**: slash commands, button/menu clicks, modals | Discord `POST`s to your HTTPS URL, **Ed25519-signed** | ✅ Yes — fits Supabase Edge Functions |
| **Gateway** (WebSocket) | All events, including free-form **message text** and **DMs** (`MESSAGE_CREATE`) | A persistent WebSocket your process holds open | ❌ No — needs one always-on worker |

So "just DM the bot in plain English and it replies," exactly like Telegram, is a **Gateway** feature. The important correction: **it does not require the privileged Message Content intent.**

### The intent facts (verified against Discord docs)

Discord classifies only three intents as **privileged**: `GUILD_PRESENCES`, `GUILD_MEMBERS`, and `MESSAGE_CONTENT`. Message content is delivered **without** the `MESSAGE_CONTENT` intent in exactly these cases:

1. messages the app sends,
2. **messages in DMs with the app**,
3. **messages in which the app is mentioned**,
4. the message a message-context-menu command is used on.

`DIRECT_MESSAGES` and `GUILD_MESSAGES` are **standard, non-privileged** intents.

**Implication for us:** the two experiences users care about — **DMing Linkr** and **@mentioning Linkr in a server** — both deliver full message content with only the non-privileged `DIRECT_MESSAGES` / `GUILD_MESSAGES` intents. We only need the privileged `MESSAGE_CONTENT` intent if we wanted to read *ambient* server messages that neither mention the bot nor are DMs — which we deliberately do **not** do (that's noisy and privacy-hostile). So free-form DM chat costs us one always-on process, **not** a Discord privileged-intent review.

(Verify the exact wording against `docs.discord.com/developers/topics/gateway` at build time, since intent behavior has changed historically.)

### The resulting design: a hybrid

- **HTTP Interactions endpoint** (serverless edge function) handles **slash commands + buttons** — including the **Confirm/Cancel** buttons on value-moving actions.
- **Gateway worker** (one always-on process) handles **free-form `MESSAGE_CREATE`** — DMs and @mentions — the "truly chat with Linkr" path.

Both feed the **same** `processLinkrAgentTurn` and the same conversation/pending-action tables. (Note: if an Interactions Endpoint URL is set, interactions arrive over HTTP and *not* the Gateway; `MESSAGE_CREATE` always arrives over the Gateway. That split is exactly what we want — buttons stay serverless and robust, messages flow through the worker.)

Reference docs: Gateway (intents, lifecycle), Receiving & Responding to Interactions, Application Commands, Message Components. (`docs.discord.com/developers/topics/gateway`, `.../interactions/receiving-and-responding`, `.../interactions/application-commands`, `.../components/reference`).

---

## 3. Telegram → Discord concept map

| Telegram | Discord equivalent |
| --- | --- |
| Webhook receives all updates | **Gateway worker** (`MESSAGE_CREATE` for free-form DM/mention chat) **+ HTTP interactions endpoint** (slash + buttons) |
| Free-form DM text → agent turn | **DM message over the Gateway** → agent turn (the headline experience) |
| `X-Telegram-Bot-Api-Secret-Token` secret | Gateway: bot-token IDENTIFY. Interactions: **Ed25519 signature** verify |
| `/start`, `/login` commands | DM "help"/"connect" text **or** `/linkr connect` slash command → ephemeral X-login link |
| Inline keyboard Confirm/Cancel | **Message components** (buttons) → `MESSAGE_COMPONENT` interaction (HTTP endpoint) |
| `sendTelegramMessage` | REST `POST /channels/{id}/messages` (Gateway path) / interaction follow-up (HTTP path) |
| "typing…" chat action | `POST /channels/{id}/typing` (Gateway path) / deferred response (HTTP path) |
| "DM me for private actions" | DMs are already private; in servers use **ephemeral** responses |
| New-member mute → captcha → unmute | Unverified members lack a **Verified role**; verify → web captcha + X login → bot **assigns the role** (REST, needs Manage Roles) |
| `telegram_accounts` | `discord_accounts` |
| `telegram_chats` | `discord_guilds` (+ DM channels) |
| `telegram_conversations` | `discord_conversations` |
| `telegram_updates` (dedup) | `discord_messages` (message id) + `discord_interactions` (interaction id) |
| `telegram_link_tokens` | `discord_link_tokens` |
| `telegram_verification_challenges` | `discord_verification_challenges` (reuse the same captcha web page) |
| `surface: "telegram"` | `surface: "discord"` |
| 4096-char messages | **2000-char** messages (or embeds); need a `splitDiscordText` analog |

---

## 4. Architecture (dual-path)

```
                    ┌──────────────────────────── Discord user ────────────────────────────┐
                    │  DM: "what's my sol balance?"        Slash: /linkr wallet             │
                    │  @Linkr in a channel                 Button: Confirm / Cancel          │
                    └───────────────┬───────────────────────────────┬──────────────────────┘
        free-form messages (MESSAGE_CREATE)          slash commands + button clicks (interactions)
                    │                                               │ Ed25519-signed POST
                    ▼                                               ▼
   ┌──────────────────────────────────┐        ┌──────────────────────────────────────────┐
   │  Gateway worker  (always-on)      │        │  discord-interactions (edge function)     │
   │  • WS: IDENTIFY (DIRECT_MESSAGES, │        │  • verify Ed25519, PING→PONG              │
   │    GUILD_MESSAGES) + heartbeat    │        │  • dedup interaction id                   │
   │  • filter: DMs + @mentions only   │        │  • ACK within 3s (defer type 5/6)         │
   │  • dedup by message id            │        │  • run agent, PATCH follow-up             │
   │  • typing indicator               │        └───────────────────┬──────────────────────┘
   │  • relay → discord-gateway-turn   │                            │
   └───────────────┬───────────────────┘                           │
                   │  authenticated internal call                  │
                   ▼                                               ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │  Shared Linkr core (unchanged):                                       │
        │  processLinkrAgentTurn (surface:"discord")  ·  Discord sink           │
        │  linkr_terminal_conversations / _messages / linkr_agent_runs          │
        │  linkr_pending_actions  ·  confirm/cancel runtime  ·  bans  ·  queue  │
        └─────────────────────────────────────────────────────────────────────┘
```

Only the two adapters and the linking/verification glue are new. Everything in the shared core is reused as-is.

---

## 5. Free-form DM chat via the Gateway (the headline feature)

This is the piece that makes Discord feel like Telegram: open a DM with the Linkr bot, type naturally, get a streamed-feeling reply, and confirm value-moving actions with a button.

### 5.1 Hosting

The Gateway is a long-lived outbound WebSocket, so it **cannot** be a request-scoped edge function. Run one small always-on process:

- **Where:** a Fly.io machine, Railway/Render service, a container on Cloud Run with `min-instances=1`, or a tiny VPS. A single instance (one shard) is plenty until ~2,500 guilds; sharding is a later concern and mostly irrelevant for a DM-centric bot.
- **What it is:** a thin Deno/Node process — WebSocket client + a relay call. **No agent logic, no DB writes of its own.** All heavy lifting stays in the existing serverless codebase, so the always-on surface is minimal and safe to restart/redeploy freely.

### 5.2 Connection lifecycle (standard Discord Gateway)

1. `GET /gateway/bot` for the WSS URL and recommended shard count.
2. Connect; on `HELLO`, start heartbeating at the given interval.
3. `IDENTIFY` with the bot token and intents `DIRECT_MESSAGES | GUILD_MESSAGES` (+ `MESSAGE_CONTENT` **only** if we ever add ambient server reading — not needed here).
4. Cache `session_id` + resume URL; on disconnect, **RESUME** (replaying missed events) or re-`IDENTIFY` with exponential backoff. Respect `INVALID_SESSION` and reconnect opcodes.

### 5.3 Message handling

On `MESSAGE_CREATE`:

1. **Filter:** ignore messages authored by the bot or other bots; accept **DMs** (channel type = DM) and, in guilds, **only messages that @mention the bot** (both include content without the privileged intent). Everything else is dropped.
2. **Dedup:** `MESSAGE_CREATE` can be redelivered on RESUME. Dedup by `message.id` — mirror Telegram's idempotency: `client_message_id = "discord:{channel_id}:{message_id}"` and rely on the existing idempotent inserts in `prepareTurn` (Telegram already does exactly this with `telegram:{chat}:{thread}:{message_id}`).
3. **Resolve identity:** `getLinkedDiscordAccount(discord_user_id)`. If unlinked, reply with the ephemeral-style connect prompt (a link from `createDiscordLinkToken`) and stop — same gate as Telegram's `sendLoginPrompt`.
4. **Ban check:** `getActiveBanForAuthUser`; refuse if banned.
5. **Typing:** `POST /channels/{channel_id}/typing` (lasts ~10s; re-send if the turn runs long) — the Discord analog of `sendTelegramChatAction`.
6. **Run the turn:** relay to an internal, authenticated edge function `discord-gateway-turn` (service-role/HMAC-authed) that:
   - runs `prepareTurn` + **`processLinkrAgentTurn`** with `surface: "discord"` and the resolved `user_id`,
   - persists onto `discord_conversations` → `linkr_terminal_conversations/messages/runs` (shared history with the web terminal and other surfaces),
   - returns `{ reply_text, pending_action_id? }`.
7. **Reply:** the worker sends the reply with REST `POST /channels/{channel_id}/messages`, chunked to 2000 chars (`splitDiscordText`) or as an embed. If a `pending_action_id` came back, attach **Confirm/Cancel buttons** (`custom_id = confirm:<id>` / `cancel:<id>`).

### 5.4 Why the DM path is actually simpler than slash commands

A free-form message is **not** an interaction, so there is **no 3-second ACK, no deferral, and no 15-minute token**. The worker can take as long as the turn needs and then send a normal message. The only "cost" is the always-on process. Confirmations still flow cleanly: the buttons on that message are components, so clicking one produces an **interaction** that goes to the serverless `discord-interactions` endpoint — the persistent worker never touches execution.

### 5.5 Ordering, concurrency, images

- **Ordering per user:** the runtime already serializes a conversation via its run lock (`conversation_run_locked`); the worker surfaces "still finishing the previous turn, try again" just like Telegram.
- **Images/attachments:** DM image attachments carry a CDN URL; download and hand off exactly like `bestTelegramPhoto` / `uploadTelegramPhotoForLaunch` for image-based launches.
- **Latency vs. durability:** relaying straight to `discord-gateway-turn` is snappy; for durability under load, the worker can instead **enqueue** to the existing shadow/queue and let `worker-discord-turn` send the reply via REST. Recommend the direct relay for chat feel, with the queue as the retry/fallback path.

### 5.6 Relationship to slash commands

Slash commands (`/linkr …`) and buttons remain on the **serverless HTTP** path (§6) — they're great for servers, discoverability, and ephemeral privacy. Free-form DM chat is the Gateway path. Users get both; the two never conflict because Discord routes interactions to the HTTP endpoint and messages to the Gateway.

---

## 6. Slash command surface (serverless, complements DM chat)

| Command | Purpose | Response |
| --- | --- | --- |
| `/linkr connect` | Link the caller's X account | Ephemeral one-time login link |
| `/linkr status` | Connection + ban status | Ephemeral |
| `/linkr ask <message>` | Talk to Linkr from a server channel | Deferred → ephemeral (or public with `share:true`); value moves get buttons |
| `/linkr wallet` | Wallet addresses & balances | Deferred, ephemeral |
| `/linkr verify` | Pass server verification | Ephemeral link → assigns Verified role |
| `/linkr help` | Capability summary | Ephemeral |

The HTTP path must **defer within 3 seconds** (type 5 for commands, type 6 for button clicks) because the agent runtime is slower than 3s, then PATCH `/webhooks/{app_id}/{interaction_token}/messages/@original` with the result (interaction token valid 15 min). Run the work either via `EdgeRuntime.waitUntil` (simplest) or the existing queue worker (recommended, retry-safe). Buttons: `confirm:<pending_action_id>` / `cancel:<pending_action_id>` → `confirmAndExecuteLinkrPendingAction` / `cancelLinkrPendingAction`, gated by ban check and "only the pending action's owner can confirm." Default `/linkr ask` and `/linkr wallet` to **ephemeral** so account data never renders publicly.

---

## 7. Account linking (X → Discord)

Reuse the Telegram pattern verbatim, from either surface (a DM prompt or `/linkr connect`):

1. `createDiscordLinkToken` writes a one-time `discord_link_tokens` row (hashed token, `discord_user_id`, `guild_id`, TTL) and returns a web link, e.g. `https://linkr.cash/discord/connect?token=…`.
2. The user signs in with **X via the existing Supabase OAuth** (add a `discord_link` branch in `auth.callback.tsx`, mirroring the Telegram handoff).
3. `completeDiscordLinkToken` binds `discord_accounts.user_id = auth.uid()` (analog of `completeTelegramLinkToken`); the bot DMs a confirmation.
4. `getLinkedDiscordAccount(discord_user_id)` resolves the Linkr `user_id` on every turn.

No Discord OAuth2 is needed — we link Discord identity to the **X/Linkr** account, not to Discord's own identity.

---

## 8. Server verification (the captcha/mute analog)

Discord has native gating, so use **roles** instead of muting:

1. Gated channels are restricted to a **Verified role**; new members lack it.
2. `/linkr verify` (or a persistent Verify button in `#verify`) → creates a `discord_verification_challenges` row → ephemeral link to the **same captcha + X web page** the Telegram flow uses.
3. On success, `discord-verify` calls `PUT /guilds/{guild_id}/members/{user_id}/roles/{verified_role_id}` (bot needs **Manage Roles**, with its role above the Verified role).
4. Optionally combine with Discord Membership Screening / verification level so unverified users can't post before the role is granted.

This preserves the Telegram guarantee (no participation before captcha + X verification) using Discord-native primitives.

---

## 9. Database schema (new tables, mirroring Telegram)

No changes to the shared core tables. Add Discord analogs (RLS: users read own rows; service role full), following `20260719120000_telegram_bot_integration.sql`:

- **`discord_accounts`** — `discord_user_id` (unique), `user_id`, `username`, `global_name`, `avatar`, `linked_at`, `unlinked_at`, `metadata`.
- **`discord_guilds`** — `guild_id` (pk), `name`, `icon`, `verified_role_id`, `config` jsonb.
- **`discord_conversations`** — `discord_channel_id`, `discord_user_id`, `user_id`, `guild_id` (null for DMs), `terminal_conversation_id` → `linkr_terminal_conversations(id)`, `surface_conversation_id` (e.g. `discord:{channel_id}:{user_id}`), unique `(user_id, surface_conversation_id)`.
- **`discord_messages`** — `message_id` (pk), `channel_id`, `discord_user_id`, `status`, `payload` — Gateway idempotency/dedup.
- **`discord_interactions`** — `interaction_id` (pk), `type`, `status`, `payload`, lease columns — interactions idempotency (mirror `telegram_updates` + lease RPC).
- **`discord_link_tokens`** — `token_hash`, `discord_user_id`, `guild_id`, `status`, `user_id`, `expires_at`, `used_at`.
- **`discord_verification_challenges`** — mirror the Telegram challenge table (captcha, attempts, status, `guild_id`, `verified_role_id`). Or **generalize** the Telegram table with a `surface` column and reuse for both.

`surface` on `linkr_agent_runs` / `linkr_pending_actions` gains the value `"discord"` (free-form text; no enum migration).

---

## 10. New components

| New | Analog of | Responsibility |
| --- | --- | --- |
| **Gateway worker** (Fly/Railway/container; Deno or Node) | the always-on half of `telegram-webhook` | Hold the WS, filter DMs/@mentions, dedup by message id, typing, relay to `discord-gateway-turn`, send replies + buttons via REST |
| `supabase/functions/discord-gateway-turn/index.ts` | `runPrivateTelegramTurn` | Authenticated internal endpoint: prepare + `processLinkrAgentTurn` (surface `discord`) → `{ reply_text, pending_action_id? }` |
| `supabase/functions/discord-interactions/index.ts` | `telegram-webhook` (control half) | Ed25519 verify → PING/PONG → dedup → route slash + component interactions → defer + execute confirm/cancel |
| `supabase/functions/discord-register-commands/index.ts` | `setTelegramBotCommands` | One-time slash-command registration |
| `supabase/functions/discord-verify/index.ts` (or extend `telegram-verify`) | `telegram-verify` | Captcha check → assign Verified role via REST |
| `supabase/functions/_shared/discord.ts` | `telegram.ts` | REST + helpers: `verifyDiscordSignature`, `gatewayIdentifyPayload`, `sendChannelMessage`, `sendTyping`, `respondInteraction`, `followupInteraction`, `assignRole`, `registerCommands`, `hashDiscordToken`, `getLinkedDiscordAccount`, `createDiscordLinkToken`, `completeDiscordLinkToken`, `discordConfirmCancelComponents`, `splitDiscordText` |

Reused unchanged: `linkr_agent_runtime.ts`, `linkr_action_runtime.ts` (confirm/cancel), `x_bans.ts`, `shadow_queue.ts`, `linkr_capabilities.ts`. A new **Discord sink** (like `createTelegramSink`) writes to the shared terminal tables and captures the pending-action id for buttons. Web: add `/discord/connect` + `/discord/verify` routes (or generalize the Telegram ones) and a `discord_link` branch in `auth.callback.tsx`.

**Env/secrets:** `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY` (Ed25519), `DISCORD_BOT_TOKEN` (Gateway IDENTIFY + REST), `DISCORD_GATEWAY_RELAY_SECRET` (worker → `discord-gateway-turn` auth), and per-guild `verified_role_id` (in `discord_guilds`).

---

## 11. Discord-specific gotchas

- **DM/@mention content is free** (no privileged intent); **ambient** server reading is not — and we don't do it.
- **Gateway is always-on** — one small process; plan restarts/RESUME, backoff, and a health check.
- **HTTP path 3-second ACK** — always defer; the DM/Gateway path has no such limit (plain message send).
- **15-minute interaction token** — for confirm/execute that can exceed it, fall back to a normal channel/DM message via the bot token.
- **2000-char limit** — chunk (`splitDiscordText`) or use embeds (~4096 in a description).
- **REST rate limits** — honor per-route buckets, global limits, `Retry-After`, and back off on 429 (stricter than Telegram).
- **Signature probing** — Discord re-verifies the interactions endpoint with bad signatures expecting 401; keep verification strict.
- **Dedup everywhere** — Gateway RESUME can replay `MESSAGE_CREATE`; interactions can retry. Dedup by message id and interaction id.

---

## 12. Phased build

| Phase | Deliverable | Infra | Privileged intent |
| --- | --- | --- | --- |
| **0 — Skeleton** | App + `discord-interactions` verifies Ed25519 + answers PING; register `/linkr help`; deferred hello round-trip | Edge functions | none |
| **1 — Linking + slash core** | `/linkr connect` (X linking), `/linkr ask`, `/linkr wallet`, `/linkr status`; deferred + follow-up; Confirm/Cancel buttons → execute; ephemeral privacy; bans; shared conversation storage | Edge + existing queue | none |
| **2 — Free-form DM chat (Gateway)** | Always-on Gateway worker: DM + @mention `MESSAGE_CREATE` → `discord-gateway-turn` → agent → reply + buttons; typing; dedup; unlinked/ban gates; image attachments | + one always-on worker | **none** (`DIRECT_MESSAGES`/`GUILD_MESSAGES` only) |
| **3 — Server verification** | `/linkr verify` + captcha page + Verified-role assignment; gated-channel model | Edge functions | none |
| **4 — Polish** | Embeds/receipts, `/linkr history`, launch announcements to a channel, Linked Roles, rate-limit hardening, sharding if needed | — | none |

**Phase 2 is now core, not optional** — and, thanks to the intent facts in §2, it needs only a single always-on process with standard intents. No Discord privileged-intent review is required for DM/@mention chat.

---

## 13. Open decisions

- **Gateway hosting:** Fly.io machine vs. Railway/Render vs. Cloud Run (min-instances=1) vs. VPS. Recommend Fly.io/Railway for simplest always-on + easy redeploys.
- **Turn transport from the worker:** direct relay to `discord-gateway-turn` (snappier) vs. enqueue to the existing queue (more durable). Recommend direct relay with the queue as fallback.
- **Server free-form chat:** support @mention chat in servers from day one (same non-privileged path as DMs) or DM-only first. Recommend DM-first, @mention next.
- **Verification table:** new `discord_verification_challenges` vs. generalize the Telegram table with a `surface` column. Recommend generalizing.
- **Web pages:** reuse/generalize the Telegram connect + verify pages vs. build Discord-specific. Recommend generalizing.

---

## 14. TL;DR

Discord is a second adapter over the same Linkr core that already backs Telegram and the web terminal, built as **two paths that share one brain**:

1. **Free-form DM chat (the headline):** one small always-on **Gateway worker** listens for DM and @mention `MESSAGE_CREATE`, dedupes, shows typing, and relays to `discord-gateway-turn` → `processLinkrAgentTurn` (`surface:"discord"`), then sends a normal reply with **Confirm/Cancel buttons** for value-moving actions. Because DM and @mention content arrive **without** Discord's privileged Message Content intent, this needs only standard intents and a persistent process — no Discord review. And since a DM isn't an interaction, there's no 3-second ACK or token limit; the turn can take as long as it needs.
2. **Slash commands + buttons (serverless):** a signed `discord-interactions` edge function mirrors `telegram-webhook` for `/linkr …` commands and Confirm/Cancel clicks, using **defer-then-follow-up** and **ephemeral** replies for privacy in servers.

Link X accounts with the existing one-time-token + X-OAuth handshake, gate servers with a **Verified role** (captcha + X login) instead of muting, and reuse the agent, wallets, pending actions, bans, and conversation tables unchanged. Users truly DM Linkr and chat with it — exactly like Telegram — with confirmation-gated safety intact.
