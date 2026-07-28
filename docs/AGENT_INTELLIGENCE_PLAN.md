# Making @linkrcash Actually Intelligent — Conversation, Wit & Context Plan

**Status:** Proposed (revised)
**Scope:** The public X (`@linkrcash`) agent — routing, persona/system prompt, thread context, and non-determinism. Terminal/Telegram runtimes are referenced only where they already solve a problem the X path has not.

> **Revision note.** This version corrects a costly misframing in the first draft. Most of the "intelligence layer" the X agent needs — thread transcript (including the bot's own replies), entity carry-forward, pronoun resolution, and conversation-state persistence — **already exists in the tree as small, pure, unit-tested helpers.** The live X worker is a *broken reimplementation* that ignores them. So the fix is overwhelmingly **delete-and-reuse**, not build-new. Every phase below is scoped to remove code, not add a parallel system.

---

## 1. The three incidents (one disease)

**A — No wit; commands-only.**
> `@linkrcash can you give me 1 sol please?` → *"I couldn't match that to an active launch. Start with \"launch a coin called ...\"…"*

Misrouted into the launch/command lane, failed every parser, hit a hardcoded string (`worker-command-prepare/index.ts:296`). Never reached a model.

**B — No thread memory.**
> `…what do you think of this coin 0x020bfC…18b4…?` → good answer (address was in the message).
> reply: `Should I buy it?` → *"Market read is too thin… provide clearer contract details… DYOR."*

The follow-up re-extracted the token **only from the current tweet text**, found nothing, and asked for a contract. It could not see its own prior reply or carry the subject forward.

**C — Wrong identity (hallucinated).**
> `Who built you?` → *"I was built by the Linkr team — engineers, designers and crypto developers…"* — should be **built by @S0Ldev.**

This is a *model hallucination*, not a canned string: the live X reply prompt (`x_ai_intake.ts:132-154`) contains **no identity facts at all**, so the model invents plausible ones.

All three share one root: **the public X agent reaches the model with no self-concept and no thread context, and treats "not a parseable command" as a hard error.**

---

## 2. Architecture as-built (verified)

### 2.1 The live pipeline

```
X mention / reply-to-bot ─► tweets_inbox
         │
         ▼
 worker-x-ingress            classify → lane
   ├─ deterministic launch/trade/active-thread → legacy
   └─ else classifyXTurnWithAi(text)           → reply | legacy
         │
   reply │                          legacy │
         ▼                                 ▼
 worker-conversation-turn          worker-command-prepare
   composeXAiReply()                 launch/trade/nft parse
   (thin, no memory)                 └─ no match → CANNED REJECTION
```

### 2.2 The helpers the live path *should* be using but doesn't (all tested)

| Helper | What it already does | File |
| --- | --- | --- |
| `loadConversationThread(admin, convId, limit)` | Merges **`tweets_inbox` (user) + `twitter_replies` (bot)** into one role-tagged, chronological, **bounded** transcript. | `conversation.ts:182-237` |
| `buildConversationTranscript(thread)` | Formats it for a prompt — bot turns as `Linkr: …`, user turns as `@handle: …`. | `conversation.ts:239-` |
| `resolveEntitiesFromText(...)` | Extracts tokens/mints/tickers/handles as entity refs with confidence. | `linkr_entities.ts:8-73` |
| `resolvePronounReference(text, candidates)` | Resolves "it/this/that" → the single token in scope (returns null if 0 or ≥2 — safe). | `linkr_entities.ts:75-85` |
| `buildLinkrWorkingFrame(world)` | Unions entities from current tweet **+ thread + prior turns**, resolves the pronoun. | `linkr_working_frame.ts:7-51` |
| `loadLinkrWorldState(...)` | Loads the thread **and** `linkr_conversation_state` for the participant. | `world_state.ts:4-47` |
| `linkr_conversation_state` table | `active_topic, active_entities, last_route, anti_repetition` per `(conversation_id, participant_twitter_id)`. | migration `20260717…natural_conversation_state.sql` |

**Verification:** `grep processLinkrTurn` → only `turn_coordinator.ts` and its test. The coordinator that *uses* these helpers is orphaned; the live worker that *doesn't* is what runs. The DB schema for all of it is already provisioned. **No new tables, no migrations.**

### 2.3 Why the live worker fails B (exact lines)

`worker-conversation-turn/index.ts`:
- `:49` `marketTarget = extractMarketAddresses(text)[0]` — token comes from **current tweet only**.
- `:60-63` context query hits **`tweets_inbox` only** — the bot's own replies (`twitter_replies`) are never loaded.

It is a strictly-worse hand-rolled version of `loadConversationThread` + entity resolution that already exist a few files over.

---

## 3. Root causes → fixes (mapped to System / Model / Prompt)

| # | Root cause | Axis | Fix (all delete-and-reuse) |
| --- | --- | --- | --- |
| R1 | Command lane dead-ends into a canned string. | System | On no-match with no saved draft, **re-enqueue the tweet to `conversation.turn`** (once). Delete the hardcoded rejection. |
| R2 | Classifier over-routes non-executable asks to `legacy`. | System | Teach `buildRoutePrompt`: rhetorical/playful/impossible asks are `reply`, not `legacy`. Keep "uncertain **execution** → legacy." |
| R3 | Reply worker ignores bot replies + carries no entity. | System | Replace the bespoke query with `loadConversationThread` + `linkr_conversation_state` read/write + `resolvePronounReference`. |
| R4 | Canned persona picked by input hash (fully deterministic). | Model | Route conversation through the model with temperature; demote canned arrays to failure-only fallback. |
| R5 | Reply prompt has **no identity, no voice, no wit**, and forces robotic "market read too thin" phrasing. | Prompt | One authored persona core (identity incl. **@S0Ldev**, voice, latitude, rails) injected into every conversational reply. |

The "Market read is too thin" line is *instructed* by the prompt (`x_ai_intake.ts:149`) — the instruction is fine; the missing **input** (carried entity) is the bug. Fixing R3 makes that branch rarely fire; fixing R5 makes it human when it does.

---

## 4. Target architecture (one path, not three)

After this work there is exactly **one** conversational brain, made of shared helpers, called by the live worker:

```
worker-conversation-turn
  1. thread   = loadConversationThread(convId)          ← user + bot turns, bounded
  2. state    = read linkr_conversation_state(conv, author)
  3. entity   = resolvePronoun(currentText, thread+state entities)   ← "it" → the coin
  4. facts    = if entity: fetch FRESH market data (never cached prices)
  5. reply    = composeXAiReply({ persona, transcript, entity, facts })  ← model, temp>0
  6. write    linkr_conversation_state(active_entities = entities)  ← for next turn
```

- `worker-command-prepare`'s conversational escape hatch = **re-enqueue to step 1** (no second brain, no second classifier).
- The orphaned deterministic reply path in `turn_coordinator.ts` (`buildDeterministicReplyPlan`, `:229-335`) is **deleted or reduced to the shared helpers above** — we do not keep a third partial system. Its genuinely useful pieces (working-frame build, state upsert, `agent_runs` tracing) move behind the worker if we want one orchestrator later; they are not required for the fix.

**Net line count should go down, not up.**

---

## 5. The plan

Four independently-shippable, independently-reversible phases (each behind a flag). Phases 1–2 fix A and B; Phase 3 fixes C and the voice; Phase 4 makes it non-deterministic and observable.

### Phase 1 — No dead-ends (fixes A)

1. **Delete the hardcoded rejections** at `worker-command-prepare/index.ts:296` and `:355`. Replace with: if a **real saved launch draft** exists → keep the specific field clarification (`savedLaunchClarification`, legitimately helpful); otherwise **re-enqueue the tweet to `conversation.turn`** and complete this work item.
2. **Loop guard (hardening):** a tweet may cross `command → conversation` **at most once**. Track it (reuse `tweets_inbox.ai_processing_lane` / add a small `reroute_count`), and if already re-routed, fall back to a single in-persona deflection rather than re-enqueue. No ping-pong.
3. **Classifier bias (R2):** in `buildRoutePrompt`, add that a request for the bot to *give/send the user* money, or any rhetorical/impossible/social ask, is `reply` (banter), not a transfer *command*. Add the exact failing example ("can you give me 1 sol please") as a few-shot.
4. **No new enum.** Deflection is handled inside the existing `conversation` reply kind via the persona prompt (Phase 3), not a new `reply_kind`. Fewer moving parts, no schema/validation churn.

**Acceptance:** "give me 1 sol", "marry me", "are you real?" → witty in-persona replies. Real commands still route `legacy` and execute unchanged.

### Phase 2 — Full thread context + entity memory (fixes B) — *mostly deletion*

1. **Replace** the `tweets_inbox`-only context block (`worker-conversation-turn/index.ts:60-68`) with `loadConversationThread(admin, tweet.conversation_id, N)` + `buildConversationTranscript`. This alone restores the bot's own prior replies to context. (Bound already enforced by the helper — no unbounded prompts.)
2. **Carry the entity, re-fetch the facts (hardening).** Read `linkr_conversation_state.active_entities`; resolve the current pronoun against `thread entities ∪ state entities` via `resolvePronounReference`. Carry only the **token identity** (address + chain + symbol) — **never** cached prices/liquidity. Market facts (step 4) are always fetched fresh, so a follow-up next day can't quote stale numbers.
3. **Resolve `marketTarget` from: current text → resolved pronoun entity → parent-chain address.** Only when all three are empty do we ask — and in-persona, not with the canned line.
4. **Ambiguity is a conversation, not a dead-end (hardening).** `resolvePronounReference` returns null when ≥2 tokens are in scope; in that case the bot asks *which one* ("the Cash Cat one or the other?"), it does not fall back to "give me a contract."
5. **Write state back.** After replying, upsert `linkr_conversation_state` with the turn's entities (mirror `turn_coordinator.upsertState`, `:574`) so the *next* turn resolves "it".
6. **Privacy boundary (hardening).** State is keyed per `(conversation_id, participant_twitter_id)`. Conversation-scoped **public** entities (a token, a cashtag) are safe to reuse across participants in a public thread; **private** account state stays user-scoped and is never surfaced from another participant's row.

**Acceptance:** replaying B, the follow-up "Should I buy it?" resolves Cash Cat and returns a fresh, grounded risk read with DYOR.

### Phase 3 — Identity + voice (fixes C and the "robot" problem)

1. **One persona core** — `_shared/linkr_persona_core.ts` (or extend `linkr_persona.ts`), a single authored system-prompt block shared by X/terminal/Telegram, stating:
   - **Identity (authoritative facts):** `@linkrcash`, an autonomous wallet/markets agent on Robinhood Chain + Solana, **built by @S0Ldev**; what it can actually do; **and that it is a conversational agent, not only a command parser.**
   - **Voice:** dry, quick, X-native; can joke and return a snarky remark warmly; concise (fits a tweet).
   - **Latitude:** explicit permission to answer ambiguous/off-topic messages conversationally, to decline impossible asks with humor, and to *not* recite a feature list unless asked.
   - **Rails (unchanged):** no keys/PII/cross-user data, no financial guarantees, no "it executed" without a receipt, value-moving stays confirmation-gated.
2. **Surface adapter, not a second persona.** The core is shared; each surface adds only its constraints (X: ≤250 chars, no links; terminal: longer form). One identity, thin wrappers — no divergence to maintain.
3. **Rewrite `buildReplyPrompt`** (`x_ai_intake.ts:132-154`) on top of the core: lead with identity+voice, keep anti-leak rules, drop the forced "market read is too thin / ask for a contract" wording, add the humor-decline behavior.
4. **Identity needs no special route.** Because the facts live in the system prompt, *any* model reply (incl. "who built you", "what are you") is grounded — no deterministic identity branch to build or drift from. (Optional light guard: lint may flag a reply that names a builder other than @S0Ldev; keep it minimal.)
5. **Demote canned arrays to fallback-only.** `SMALL_TALK_REPLIES`/`WELLNESS_REPLIES`/… and the hash `pick()` (`linkr_persona.ts:40-116`) stay **only** as the last resort if the model call fails — so we degrade gracefully, never below today.

### Phase 4 — Non-determinism, model tier, observability

1. **Controlled randomness.** Set temperature per lane: conversation/small-talk **0.7–0.9** (varied, personable), `coin_inquiry`/`trade_advice` **~0.4** (factually stable), command/confirmation **deterministic**. Use the existing `anti_repetition` column to nudge the model off its own last opening in a thread (the terminal already does a repetition reroll — `linkr_agent_runtime.ts:1278`).
2. **Right-size the model (config-only).** The public reply path defaults to `gpt-5-mini` at `effort: none/low` (`x_ai_intake.ts:20`), while the terminal uses stronger tiers. Promote the **conversation** lane via `COMET_REPLY_MODELS` and raise its `effort` to `low`/`medium`. **Keep the classifier fast/cheap** to protect the sub-60s reply SLO. The only added latency is one reply-composition call at a higher tier plus a couple of **indexed** reads — measure before/after.
3. **Lint: harden, don't just loosen (hardening).** `reply_lint.ts` matches forbidden words by **substring** (`"tool"` flags `"toolkit"`), which muzzles natural replies. Switch to **word-boundary** matching, keep every genuine leak/PII phrase, and relax `TOKEN_MISSING_PATTERNS` now that "no token" is rare (Phase 2) and should read human when it happens. Net: fewer false positives, same security floor.
4. **Observability (near-free).** Populate the already-existing `agent_runs.working_frame / route_decision / outcome` columns from the live worker so we can replay A/B/C-class failures and track a **canned-fallback rate** that should trend to ~0.

---

## 6. File-by-file change map

| File | Change | Δ complexity | Phase |
| --- | --- | --- | --- |
| `worker-command-prepare/index.ts` | Delete rejections `:296`/`:355`; re-enqueue to `conversation.turn` (guarded, once). | **−** | 1 |
| `worker-x-ingress/index.ts` | Route playful/impossible asks to `conversation.turn`; add reroute guard. | ~ | 1 |
| `_shared/x_ai_intake.ts` | `buildRoutePrompt`: playful ≠ legacy + few-shot. `buildReplyPrompt`: persona-first, humor-decline, drop canned line. Config: model/effort/temperature. | ~ | 1,3,4 |
| `worker-conversation-turn/index.ts` | Replace bespoke context query with `loadConversationThread`; read/resolve/write `linkr_conversation_state`; resolve target from thread. | **−** (net) | 2 |
| `_shared/linkr_persona.ts` (+ `linkr_persona_core.ts`) | Author persona core w/ @S0Ldev identity + voice + latitude; demote canned arrays to fallback. | ~ | 3 |
| `_shared/reply_lint.ts` | Substring → word-boundary matching; relax token-missing patterns; keep security phrases. | ~ | 3,4 |
| `_shared/turn_coordinator.ts` | Delete/retire the deterministic `buildDeterministicReplyPlan` path (dead code); keep only helpers reused above. | **−−** | 2 |
| Config env | `COMET_REPLY_MODELS`, per-lane effort/temperature. | ~ | 4 |

No migrations. No new tables. No new reply-kind enum. The largest single change is **removing** a broken reimplementation.

---

## 7. Guardrails that must NOT change

- Value-moving actions (launch/trade/transfer/liquidity/confirm/cancel) stay deterministic and confirmation-gated. Wit lives only in conversational lanes.
- No keys, seed phrases, cross-user private data, or internal-implementation language in public replies.
- No claim a transaction executed without a real executor receipt.
- Classifier keeps "uncertain about an **execution** request → legacy." We only reclassify clearly **non-executable** asks.
- Carry **entity identity**, not market numbers — always re-fetch facts.

---

## 8. Testing & rollout

**Golden transcripts (add to `_shared/*_test.ts`):**
- A: "can you give me 1 sol please?" → `reply` lane, in-persona humorous decline, **no launch string**, offers real capability.
- B: two-turn thread → follow-up "Should I buy it?" resolves the prior token and returns a fresh grounded read.
- C: "Who built you?" → names **@S0Ldev**; "what are you?" → correct capability summary.
- Regression: real launch/trade commands route `legacy` and execute; confirmations still gated; no PII/leak passes lint; reroute guard prevents command↔conversation loops.

**Non-determinism is tested by construction, not by flaky assertions:** assert that temperature is configured per lane and that command/confirmation paths are byte-stable — do **not** assert "two replies differ" (flaky).

**Rollout:** ship Phase 1+2 behind existing `LINKR_FAST_HANDOFF`-style flags; shadow-log new routing vs old before enabling replies; watch canned-fallback rate + reply latency; enable Phase 3 persona once shadow looks right; tune Phase 4 temperature/tier against the SLO. Every phase is independently revertible.

---

## 9. Why this is simpler *and* more robust

- **Simpler:** the hardest capability (thread memory, entity carry-forward, pronoun resolution, bounded transcript, state persistence) is **already written and tested** — we delete a broken copy and call the good one. No new tables, no new enums, no second brain, net-negative line count.
- **More robust:** one conversational path instead of three partial ones; explicit loop, ambiguity, staleness, and privacy guards; word-boundary lint that stops muzzling voice without lowering the security floor; identity grounded in the prompt so it can't hallucinate a builder.
- **Truly intelligent, non-deterministic:** every non-command message reaches a model that knows who it is, sees the whole thread, remembers the subject, and is free to be funny — with temperature so it never repeats itself — while money still moves only through deterministic, confirmation-gated paths.

## 10. Expected outcome

- **A** → a funny, human decline that keeps the user engaged.
- **B** → the bot remembers the coin under discussion and answers the real question.
- **C** → "built by @S0Ldev," every time.
- **Broadly** → `@linkrcash` handles *any* message — command, question, joke, or ambiguous aside — through one grounded, thread-aware, non-deterministic brain, safe and deterministic exactly where value moves.
