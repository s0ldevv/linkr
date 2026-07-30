# Launch Autofill and Conversation Context Fix Plan

**Date:** 2026-07-30
**Scope:** Token launch intake across X (`@linkrbot`)
**Status:** Implemented and verified on 2026-07-30. See "Execution record" at the end.

---

## 1. Executive summary

Two reported problems:

1. **The agent asks for things it should decide itself.** A user should only have
   to supply a **token name** and a **chain**. Ticker, description, image, dev buy,
   and mayhem mode should all be filled by the agent.
2. **The agent is not contextually aware.** A launch request with an attached image
   turned into a loop of the bot re-asking for information already given, and
   eventually asking for the *token name* it had been holding the whole time.

Both are real, both are reproducible, and I found the exact production transcript
of problem 2 in the database (Section 3).

The important finding is that **Linkr already has every capability the user is
asking for.** `enrichLaunchFields()` generates ticker, description, and an image
prompt from a name alone. `generateLaunchImage()` generates the image. The
enrichment worker already routes to image generation whenever `image_url` is
empty. The launch draft DB layer already treats **only `name` and `chain`** as
required.

The bugs are entirely in the **gate in front of that machinery**:

- On **X**, the AI slot reconciler is allowed to demand clarification for
  *optional, auto-filled* slots, and when it does, a fallback line asks the user
  for the token name even though nothing is missing. That is the loop.
- On **terminal / CLI / Telegram**, the shared conversational runtime has a
  completely separate, regex-only launch path that hard-requires
  `name, symbol, description, image_url`, never re-reads its own saved draft, and
  never calls enrichment or image generation at all.

Neither surface is short a feature. Both are gated by policy code that contradicts
the intended product contract.

---

## 2. The intended contract (what we are fixing toward)

| Slot | Source | Required from user? |
|---|---|---|
| `name` | user text | **Yes** |
| `chain` | user text only — never inferred | **Yes** |
| `symbol` | AI (`enrichLaunchFields`) → deterministic fallback | No |
| `description` | AI → deterministic fallback | No |
| `image_prompt` | user's described image, else AI | No |
| `image_url` | user media if attached, else `generateLaunchImage()` → deterministic PNG | No |
| `dev_buy_amount` | user text, else profile default, else `0` | No |
| `mayhem_mode` | user text, else `false` | No |
| `website / twitter / telegram` | `launch_metadata.ts` defaults | No |

`chain` is the one slot that must never be guessed. That rule is already enforced
at the database boundary (`explicit_launch_chain_provenance_required` in
`20260722181000_autonomous_launch_acceptance.sql`) and must stay.

Everything else: **the agent decides, then shows the user what it decided on the
confirmation card.** Confirmation is where the user corrects it — not a
pre-launch interrogation.

---

## 3. Production evidence

Queried live via PostgREST with the service role key (read-only).

### 3.1 The loop, verbatim

`tweets_inbox` joined against `twitter_replies`, user `ac09c9a3…`, 2026-07-30:

| Time (UTC) | User | Bot |
|---|---|---|
| 19:50 | "Are you able to launch coins?" | "Yes — I can prepare coin launches on Robinhood Chain or Solana/Pump.fun. Which chain should I use?" |
| 19:55 | "Launch a coin with the name: test / ticker: test / Image should be a test tube" | "Thanks — you want to launch token 'test' (ticker TEST) with an image of a test tube. Which blockchain should this launch use, and do you want to provide a description, developer buy amount, or enable mayhem mode?" |
| 19:59 | "Launch it on Solana. You add whatever description that you like and no mayhem mode, and dev buy is 0." | **"Your launch is saved. What should the token be called?"** |
| 20:01 | "Name: test and ticker: test" | "Do you want to add an image URL for the token? If so, please provide it now." |
| 20:03 | "No you go ahead and generate an image of a test tube to go with it" | **"Your launch is saved. What should the token be called?"** |
| 20:05 | "launch a coin called test on Solana. Ticker is test." **+ attached image** | "Please provide a short description, dev buy amount (if any), and whether to enable mayhem mode (yes/no)…" |
| 20:08 | "0 dev buy, no description, no mayhem mode." | **"Your launch is saved. What should the token be called?"** |

Seven turns, a name, a ticker, a chain and a real uploaded image — and zero
launches. The bot asked for the token name three times while holding
`name: "test"` in the draft the entire time.

### 3.2 The draft that proves it

`linkr_action_drafts` row `5b028575-9478-434a-9041-4d9e1878a35f` (final state of the
20:08 turn):

```json
"filled_fields": {
  "name": "test", "chain": "solana", "symbol": "TEST",
  "image_url": "https://pbs.twimg.com/media/HOgFCsgXsAAlyle.jpg",
  "description": null
},
"required_fields": [],
"status": "awaiting_clarification",
"generation_context": {
  "pause_reason": "launch_slot_clarification_required",
  "launch_slot_reconciler": {
    "intent": "continue_launch",
    "applied_slots": ["description"],
    "blocked_slots": ["dev_buy_amount", "mayhem_mode"],
    "needs_clarification": true,
    "clarification_question": null,
    "slot_updates": {
      "name":        { "action": "keep", "value": "test",    "confidence": 0.95 },
      "chain":       { "action": "keep", "value": "solana",  "confidence": 0.95 },
      "symbol":      { "action": "keep", "value": "TEST",    "confidence": 0.95 },
      "image_url":   { "action": "keep", "value": "https://pbs.twimg.com/…", "confidence": 0.9 },
      "dev_buy_amount": { "action": "set", "value": null, "evidence": "latest_user_tweet: '0 dev buy",     "confidence": 0.9, "edit_intent": true },
      "mayhem_mode":    { "action": "set", "value": null, "evidence": "latest_user_tweet: 'no mayhem mode", "confidence": 0.9, "edit_intent": true }
    }
  }
}
```

`required_fields` is **empty**. The model got the turn completely right — intent
`continue_launch`, every required slot correct and high confidence. The pipeline
still paused the launch and told the user to name their token.

### 3.3 Terminal / CLI / Telegram have never produced a launch at all

```
linkr_action_drafts   where surface <> 'x'   →  0 rows
linkr_pending_actions where surface <> 'x'   →  0 rows
```

Every draft and every pending action in the database came from X. Terminal, CLI,
and Telegram sessions in `linkr_agent_runs` only ever resolved to
`capabilities`, `small_talk`, `x_search`, `identity`, `history`. The
conversational launch path on those surfaces has never once reached a
confirmation card — consistent with Section 5's finding that it requires four
fields it has almost no way to obtain.

---

## 4. Root cause — X path (`@linkrbot`)

Flow: `worker-command-prepare` → `launch_slot_reconciler` → `upsert_linkr_launch_draft_v2`
→ `queue_linkr_launch_enrichment_v1` → `worker-launch-enrich` → `worker-image-generate`
→ `authorize_linkr_launch_v2`.

### X-1. Any blocked slot forces clarification, including optional ones

`_shared/launch_slot_reconciler.ts:247-248`

```ts
const needsClarification = reconciliation.needs_clarification ||
  blockedSlots.length > 0;
```

`blockedSlots` includes `dev_buy_amount` and `mayhem_mode` — slots that are not
required and that the pipeline auto-fills. A failure to parse an *optional*
answer halts a launch that had everything it needed.

### X-2. `normalizeSlotValue` cannot express "none" / "zero"

`_shared/launch_slot_reconciler.ts:442-472`

- `dev_buy_amount` accepts only `^\d+(\.\d{1,18})?\s+(SOL|ETH)$`. The model
  answered `"0 dev buy"` as `{action:"set", value:null}` → `cleanText(null)` → `""`
  → `undefined` → **blocked**.
- `mayhem_mode` accepts only literal `true`/`false`. `"no mayhem mode"` came back
  as `value:null` → `undefined` → **blocked**.

There is no vocabulary for "the user explicitly said none". A correct user answer
is indistinguishable from a parse failure.

### X-3. The clarification fallback asks for a field that is not missing

`supabase/functions/worker-command-prepare/index.ts:472-473`

```ts
slotPatch.clarificationQuestion ??
  clarificationReply(missing.length > 0 ? missing : ["name"]),
```

When `needsClarification` is true, `clarificationQuestion` is `null`, and nothing
is actually missing, this hardcodes `["name"]` and emits
**"Your launch is saved. What should the token be called?"** — `clarificationReply()`
in `_shared/x_launch_command.ts:198-208`.

This single line produced three of the seven replies in Section 3.1. It is the
literal source of "it took me on a loop of giving info and resetting."

### X-4. Nothing tells the reconciler which slots are optional

`buildLaunchSlotReconcilerPrompt` (`launch_slot_reconciler.ts:387-425`) never
states that only `name` and `chain` are required, or that symbol / description /
image / dev buy are auto-filled. So the model reasonably volunteers
`needs_clarification: true` and asks for description, dev buy, and mayhem mode
(19:55 and 20:05 replies). The system prompt and the product contract disagree.

### X-5. A described image is treated as a missing image URL

`LaunchSlotName` (`launch_slot_reconciler.ts:11-18`) has `image_url` but **no
`image_prompt`**, and `extractLaunchFields` (`x_launch_command.ts:76-128`) does not
parse one either. So "Image should be a test tube" is dropped, and the model asks
the user to supply a URL (20:01 reply) — for an image the platform is fully
capable of generating.

The capability is right there: `worker-launch-enrich/index.ts:69-76` routes to
`image.generate` whenever `image_url` is empty, and
`_shared/launch_image_generation.ts:18-46` generates it with a deterministic PNG
fallback. The user's creative brief just never reaches it, and the launch never
gets that far.

### X-6. No stall breaker

Nothing counts clarification rounds. A draft can bounce between
`awaiting_clarification` and paused indefinitely with no escalation, no
state echo, and no "here is what I have, confirm or correct" exit.

---

## 5. Root cause — terminal / CLI / Telegram (`linkr_agent_runtime.ts`)

All three surfaces call `processLinkrAgentTurn` (`terminal-chat/index.ts:166`,
`cli-chat/index.ts:151`, `telegram-webhook/index.ts:768`). This runtime has its
**own** launch path that shares nothing with the X pipeline above.

### T-1. Four hard-required fields, none of them auto-filled

`_shared/linkr_agent_runtime.ts:2136-2140`

```ts
if (actionType === "launch_coin") {
  for (const key of ["name", "symbol", "description", "image_url"]) {
    if (!payload[key]) missing.push(key);
  }
}
```

and the user-facing text, `:2179-2181`:

```ts
return `I can draft the launch, but I still need: ${missing.join(", ")}.`;
```

`enrichLaunchFields` and `generateLaunchImage` are never called on these surfaces.
There are two further gates behind this one:

- `_shared/linkr_tool_registry.ts:144-153` — `action.prepare_launch` requires
  `chain, name, symbol, description, image_url`.
- `_shared/linkr_action_runtime.ts:1378-1392` — `queueLaunch()` calls
  `required(...)` on `name`, `symbol`, `description`, `image_url` at execution time.

### T-2. Extraction never reads the draft it just wrote

`extractActionPayload` (`:1724-1817`) is a pure function of the **current turn's
text and attachments**. `loadRuntimeState` does fetch `state.drafts`
(`:406-412`) and `prepareAction` does persist `filled_fields` via `createDraft`
(`:2222-2275`) — but `extractActionPayload` never consults either.

Consequence, exactly as reported: attach an image on turn 1, answer a question on
turn 2, and `payload.image_url = attachedImage ?? firstUrl(text)` (`:1790`)
evaluates to `null`, because the frontend clears attachments after send
(`src/routes/_authenticated.app.terminal.tsx:386`). The image is gone. Every
answered field is re-asked on the next turn. This is the terminal equivalent of
the X loop, and it is structural rather than a model failure.

### T-3. Routing has no idea a launch is in progress

`decideRoute` (`:525-742`) never looks at `state.drafts`. A follow-up like
"Name: test and ticker: test" contains no action keyword, so it falls past the
`prepare_action` branch (`:622-635`) and lands on `conversation` or `general`. The
draft is never advanced; the user's answer is treated as chit-chat. Saying
"launch" again re-enters `prepareAction`, which re-extracts from that message
alone — and resets.

### T-4. The launch chain is silently defaulted to Robinhood

`extractActionPayload:1738` calls `inferChain`, and `inferChain:2823` ends with:

```ts
return "robinhood";
```

`missingFields` does not list `chain` for `launch_coin`, so a terminal user who
never names a chain gets a **Robinhood launch prepared without being asked**.
This contradicts the hard rule enforced everywhere else in the system
(`explicit_launch_chain_provenance_required`, and the orphaned but correct policy
text in `_shared/prompts.ts:210`). It is the one place where the agent
*over*-decides, and it is the one slot where it must not.

### T-5. Regex slot parsing that cannot survive natural phrasing

`:1786-1789`

```ts
payload.name = quoted(text, "name") ?? fieldAfter(text, /\bname(?:d)?\s+/i);
payload.symbol = quoted(text, "symbol") ?? cashtag(text)?.replace(/^\$/, "");
payload.description = quoted(text, "description") ?? null;
```

- "launch a coin **called** test" → `name = null` ("called" is not matched).
- "launch a coin named test on Solana" → `fieldAfter` splits on `[,.]` only, so
  `name = "test on Solana"`.
- `description` requires the literal form `description: "…"`.

Meanwhile the X path has `extractLaunchFieldsWithAi` (`x_launch_command.ts:130-175`)
and the full AI reconciler. The two surfaces are years apart in capability.

### T-6. Drafts are loaded user-wide, not conversation-scoped

`loadRuntimeState:406-412` selects open drafts by `user_id` only, `limit 10`.
Once T-2 is fixed and drafts are actually read, a draft from a *different*
conversation could bleed into the current one. Fix this in the same change.

### T-7. A bare image is assumed to be a launch

`decideRoute:533-541` — an attachment with empty text routes to
`prepare_action / launch_coin` at 0.79 confidence with no draft in play. Dropping
an image into the terminal for any other reason starts a launch interrogation.

---

## 6. Fix plan

Ordered so that each phase is independently shippable and independently
verifiable. Phase 1 alone stops the reported loop on X.

### Phase 0 — Single source of truth for the launch contract

New `supabase/functions/_shared/launch_contract.ts`:

```ts
export const LAUNCH_REQUIRED_SLOTS = ["name", "chain"] as const;
export const LAUNCH_AUTOFILL_SLOTS = [
  "symbol", "description", "image_prompt", "image_url",
  "dev_buy_amount", "mayhem_mode",
] as const;

export function missingLaunchSlots(
  fields: LaunchFields,
  provenance: Record<string, unknown>,
): string[];

// "Saved: name test · ticker TEST · Solana · your image"
export function launchStateSummary(fields: LaunchFields): string;
```

The contract is currently defined in four places that can drift:
`x_launch_command.ts:23-26`, `linkr_agent_runtime.ts:2136-2140`,
`linkr_tool_registry.ts:144-153`, and `v_required` in
`20260728150000_launch_slot_reconciler_guardrails.sql`. Point the first three at
this module. Leave the DB as the independent backstop.

`launchStateSummary` is what makes clarifications stop *feeling* like a reset:
every clarification reply leads with what is already saved.

---

### Phase 1 — Stop the X loop (highest value, smallest diff)

**1a. `_shared/launch_slot_reconciler.ts:247-248` — only required slots gate the launch.**

```ts
const blockingSlots = blockedSlots.filter((slot) =>
  LAUNCH_REQUIRED_SLOTS.includes(slot as never)
);
const requiredStillMissing = missingLaunchSlots(mergedFields, mergedProvenance);
const needsClarification =
  blockingSlots.length > 0 ||
  protectedOverwriteAttempts.length > 0 ||
  (reconciliation.needs_clarification && requiredStillMissing.length > 0);
```

A blocked optional slot is recorded in `generation_context` as advisory and the
launch proceeds. The model's `needs_clarification` becomes advisory too unless a
required slot is genuinely missing or a protected user slot is in conflict.

**1b. `_shared/launch_slot_reconciler.ts:442-472` — teach `normalizeSlotValue` "none".**

- Accept an explicit-none vocabulary: `null`, `""`, `"none"`, `"no"`, `"nope"`,
  `"skip"`, `"0"`, `0`, `false` when `action === "set"` **and** evidence is present.
- `dev_buy_amount`: none → `"0 SOL"` / `"0 ETH"` selected from the draft's chain
  (pass `chain` into `buildLaunchDraftSlotPatch`'s normalizer, or normalize in a
  post-pass where chain is known). Also accept a bare number and append the unit.
- `mayhem_mode`: none → `false`.
- `description` / `image_url` / `image_prompt`: none → treat as `action: "clear"`.

**1c. `worker-command-prepare/index.ts:459-481` — never invent a missing field.**

Delete the `: ["name"]` fallback. Replace with:

```ts
if (slotPatch.needsClarification) {
  const question = slotPatch.clarificationQuestion ??
    (missing.length > 0 ? clarificationReply(missing) : null);
  if (question) {
    await pauseIfComplete(...);
    await queueReply(admin, claim.work_item.id, "launch_clarification",
      Number(draft.version), `${launchStateSummary(draft.filled_fields)} ${question}`);
    await markTweetCompleted(admin, tweetId);
    return { kind: "complete", state: "waiting_user_input", resultRef: `draft:${draft.id}` };
  }
  // Nothing required is missing and we cannot phrase a question:
  // never stall — fall through to enrichment.
}
```

**Invariant to enforce in code review: a launch may only be paused for
clarification when `missingLaunchSlots()` is non-empty or a protected user slot is
in conflict. There is no other legitimate reason to stop.**

**1d. `_shared/launch_slot_reconciler.ts:387-425` — tell the model the contract.**

Add to the prompt:

- "Only `name` and `chain` must come from the user. Linkr automatically generates
  symbol, description, image, dev buy, and mayhem mode when the user does not
  specify them."
- "Never ask the user for a symbol, description, image, image URL, dev buy amount,
  or mayhem mode."
- "Set `needs_clarification` only when `name` or `chain` is missing or ambiguous,
  or when the latest message conflicts with an existing user-owned name, symbol,
  chain, or dev buy."
- "If the user describes what the image should look like, set `image_prompt`.
  Never set or request `image_url` from a description."
- "For 'no X' or 'zero X' answers, use `clear` for description/image, and `set`
  with an explicit value for `dev_buy_amount` (`\"0 SOL\"` / `\"0 ETH\"`) and
  `mayhem_mode` (`false`)."

**1e. Add `image_prompt` as a first-class slot.**

`LaunchSlotName` and `SLOT_NAMES` (`launch_slot_reconciler.ts:11-18`, `:90-98`);
normalize as 1000-char clean text; provenance `user_text`. No DB change needed —
`enrichLaunchFields` already prefers a user-supplied `image_prompt`
(`launch_enrichment.ts:39, 88`), `worker-launch-enrich` preserves it through
`pick()`, and `update_linkr_launch_enrichment_v1` only rejects `chain`.

This turns "the image should be a test tube on a purple background" into an
actual generated logo instead of a request for a URL.

**1f. Stall breaker.** Track `generation_context.clarification_rounds`. On round
≥ 2 with no new required slot filled: if a required slot is still missing, ask for
**only that slot** with `launchStateSummary()` prepended; otherwise force-proceed
to enrichment and let the confirmation card carry the correction.

---

### Phase 2 — Terminal / CLI / Telegram: carry context across turns

**2a. Conversation-scope the draft query.** `linkr_agent_runtime.ts:406-412`: add
`.eq("surface_conversation_id", input.surface_conversation_id)` (fixes T-6 before
drafts start being trusted).

**2b. Merge the open draft into extraction.** In `prepareAction` (`:1476-1494`),
before extraction:

```ts
const openDraft = state.drafts.find((d) =>
  d.action_type === payloadActionType &&
  d.surface_conversation_id === input.surface_conversation_id &&
  ["open", "awaiting_clarification", "ready"].includes(d.status) &&
  Date.now() - Date.parse(d.updated_at) < 30 * 60_000
);
extracted = mergeLaunchFields(
  (openDraft?.filled_fields ?? {}) as LaunchFields,
  extractActionPayload(input.text, payloadActionType, refs, state, input.attachments),
);
```

`mergeLaunchFields` (`x_launch_command.ts:177-189`) already has the right
semantics: non-empty incoming values win, everything else persists. This single
change is what stops the terminal from forgetting an attached image.

**2c. Route follow-ups back into the open draft.** In `decideRoute`, immediately
after the confirm/cancel branches (`:565`):

```ts
const openDraft = openDraftForConversation(state, input);
if (openDraft && !isOtherExplicitIntent(normalized)) {
  return {
    route: "prepare_action",
    intent: "prepare_action",
    action_type: openDraft.action_type,
    confidence: 0.9,
    reason: "continuing open action draft",
  };
}
```

`isOtherExplicitIntent` must still let wallet/portfolio/history/X-search questions
through so a user can ask something mid-launch without hijacking the draft.

**2d. Fix T-7.** Restrict `decideRoute:533-541` (bare image ⇒ launch) to the case
where an open launch draft exists. Otherwise ask what the image is for.

---

### Phase 3 — Terminal / CLI / Telegram: require only name + chain, then autofill

**3a. `missingFields` (`:2136-2140`)** →

```ts
if (actionType === "launch_coin") {
  if (!payload.name) missing.push("name");
  if (payload.chain_explicit !== true) missing.push("chain");
}
```

**3b. Stop defaulting the launch chain.** In `extractActionPayload:1784-1801`,
for `launch_coin` set `chain` from `launchRequestSignals({text}).explicitChain`
(already computed at `:1794-1795`) rather than `inferChain`, and set
`payload.chain_explicit`. Carry `chain_explicit` in the draft so a chain named on
turn 1 survives to turn 3. `inferChain`'s Robinhood default stays for buy/sell/
transfer, where a resolved token address disambiguates it.

**3c. Replace regex launch extraction with the AI reconciler.** Generalize
`LaunchSlotReconcilerInput` to be surface-neutral — rename `latestTweetId` /
`originalTweetId` to `latestMessageId` / `originalMessageId` (keep the tweet-named
fields as deprecated aliases so `worker-command-prepare` is untouched) — and call
it from `prepareAction` for `launch_coin` behind `await import()`:

```ts
const { reconcileLaunchDraftWithAi, buildLaunchDraftSlotPatch } =
  await import("./launch_slot_reconciler.ts");
```

Inputs available on these surfaces: draft `filled_fields` / `field_provenance`,
the original launch message and the previous assistant reply from
`state.recent_messages`, `input.text`, and `terminalImageAttachments(input.attachments)[0]`
as `latestMediaUrl`. Same guardrails, same protected slots, same provenance — one
launch brain across all four surfaces.

**3d. Enrich and generate before the confirmation card.** In `prepareAction`, for
`launch_coin`, once `missingLaunchSlots()` is empty and before
`createPendingAction` (`:1639`):

```ts
const { enrichLaunchFields } = await import("./launch_enrichment.ts");
const enriched = await enrichLaunchFields(extracted as LaunchFields, {
  devBuySol: state.profile?.default_dev_buy_sol,
  devBuyEth: state.profile?.default_dev_buy_eth,
  firstLaunchSubsidyEligible: eligibility,
});
extracted = { ...extracted, ...enriched.fields };

if (!extracted.image_url) {
  await sink.setStatus("typing", { label: "Designing your token image" });
  const { generateLaunchImage } = await import("./launch_image_generation.ts");
  const { storeCapturedImage } = await import("./bounded_media.ts");
  const generated = await generateLaunchImage({
    prompt: String(extracted.image_prompt ?? ""),
    negativePrompt: extracted.image_negative_prompt,
    seed: `${input.surface_conversation_id}:${extracted.name}`,
    allowFallback: true,
  });
  extracted.image_url = (await storeCapturedImage(admin, generated.image)).publicUrl;
}
```

Dynamic imports are mandatory here — `linkr_agent_runtime.ts:1646-1651` records
that bundling execution code into this runtime's boot graph previously produced
HTTP 546. This matches the existing lazy-import pattern at `:1495`, `:1595`, `:1619`.

The pending action is then created from the **final** values, so the confirmation
card shows the real ticker, description, and image. That is the correction
surface — not a questionnaire.

Latency note: image generation has a 45 s provider timeout
(`launch_image_generation.ts:66`). The SSE stream heartbeats every 15 s
(`terminal-chat/index.ts:151`), so the connection holds, but emit
`execution_status` updates so the UI is honest about the wait. **If measured p95
proves too slow, fall back to Option B:** enqueue `launch_enrich` and
`image.generate` work items exactly as X does, reply "building your token now",
and deliver the confirmation card asynchronously. Decide from the numbers, not up
front.

**3e. Relax the downstream gates.** `linkr_tool_registry.ts:144-153` →
required `["chain", "name"]`. Validation now runs after 3d, so symbol /
description / image_url are present as **post-enrichment assertions** rather than
pre-clarification gates. `queueLaunch`'s `required()` calls
(`linkr_action_runtime.ts:1378-1392`) stay exactly as they are — they are the
correct last line of defence.

**3f. Clarification copy (`:2179-2181`).** Lead with `launchStateSummary()` and
ask only for what is genuinely required:

> "Saved: name **test** · ticker **TEST** · your image. Which chain — Solana or
> Robinhood?"

---

### Phase 4 — Observability and drift prevention

- Structured log `launch_clarification_emitted { surface, draft_id, round,
  missing, blocked_slots, question_source }` at every clarification site.
- Structured log `launch_autofill_applied { surface, slots, provenance }` after
  enrichment.
- A funnel query over `linkr_action_drafts` — drafts created vs. drafts reaching
  `converted_to_pending`, and the distribution of `clarification_rounds`.
  **Target: p50 = 0, p95 ≤ 1.**
- Delete or wire in `_shared/prompts.ts`. It has no importers anywhere in the
  repo, yet it holds the correctly-worded chain policy at `:210` that
  `inferChain` violates. Dead code that contradicts live code is how T-4 survived.
- `cli-chat` has **no entry** in `supabase/functions/edge-budgets.json` while
  `terminal-chat` and `telegram-webhook` do. Add it before Phase 3 lands.

---

## 7. Tests

Deno tests live beside their modules and run via `npm run test:edge`.

**`launch_slot_reconciler_test.ts`** — stub `modelCall`, no network:

1. **The production regression.** Feed the exact reconciler JSON from Section 3.2
   with `existingFields = {name:"test", chain:"solana", symbol:"TEST", image_url:"…"}`.
   Assert `needsClarification === false`, `dev_buy_amount === "0 SOL"`,
   `mayhem_mode === false`.
2. Blocked optional slot alone ⇒ no clarification.
3. Blocked `chain` ⇒ clarification.
4. Protected-slot overwrite without `edit_intent` ⇒ clarification (existing
   behaviour must not regress).
5. `image_prompt` set from a described image; `image_url` untouched.

**`worker-command-prepare` clarification-copy test** — `needsClarification` with
`missing === []` must never emit `clarificationReply(["name"])`. Assert the
string "What should the token be called?" is unreachable when `name` is set.

**`linkr_agent_runtime` launch tests** (new `linkr_launch_intake_test.ts`):

6. Turn 1 `"launch a coin called test on solana"` + image attachment; turn 2
   `"ticker TEST"` with no attachment ⇒ merged payload still carries `image_url`.
7. Turn 2 `"Name: test and ticker: test"` with an open draft ⇒ routes to
   `prepare_action`, not `general`.
8. `"launch a coin called test"` with no chain ⇒ `missing` contains `chain`, and
   the payload is **not** silently `robinhood`.
9. Name + chain only ⇒ enrichment fills symbol/description/image_prompt, image
   generation fills `image_url`, and a pending action is created.

**`launch_enrichment_test.ts`** — extend the existing file: name + chain only
produces every downstream field with correct provenance.

**End-to-end replay** — script the seven turns of Section 3.1 against a staging
`@linkrbot`. Acceptance: a confirmation card by turn 2 at the latest.

---

## 8. Acceptance criteria

1. `@linkrbot launch a coin called test on Solana` **+ image** ⇒ confirmation
   card on the **first** reply. No clarification.
2. `launch a coin called test` ⇒ exactly one question, about the chain, with
   saved state echoed. The next message naming a chain ⇒ confirmation card.
3. The bot never asks for a ticker, description, image, image URL, dev buy, or
   mayhem mode on any surface.
4. "0 dev buy, no description, no mayhem mode" advances the launch. It never
   blocks it.
5. `"the image should be a test tube on a purple background"` produces a
   generated image matching that brief — never a request for a URL.
6. The bot never asks for a field already present in `filled_fields`. The string
   "What should the token be called?" cannot be emitted when `name` is set.
7. Terminal / CLI / Telegram reach a launch confirmation card — something that
   has **never** happened in production (Section 3.3).
8. No launch is ever prepared on a chain the user did not explicitly name, on any
   surface.
9. `verify:edge-release` passes: `audit:architecture`, `check:edge-budget`,
   `test:edge`.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Autofill launches something the user did not intend | Confirmation card still required, now showing final ticker/description/image. `launch_semantic_verifier.ts` still runs before `authorize_linkr_launch_v2`. |
| Relaxing clarification weakens the anti-overwrite guarantees from `LAUNCH_AI_SLOT_INTELLIGENCE_PLAN.md` §8 | Only **blocked optional slots** stop gating. Protected-slot conflicts (`name`, `symbol`, `chain`, `dev_buy_amount` with `user_text` provenance) still force clarification in both code and the DB guard. |
| Phase 3d inflates the terminal runtime boot graph → HTTP 546 | Dynamic `await import()` only; re-baseline `edge-budgets.json` for `terminal-chat` / `telegram-webhook` and add the missing `cli-chat` entry. |
| Inline image generation makes terminal turns feel slow | Stream `execution_status`; measure p95; Option B (async enqueue, mirroring X) is pre-designed in 3d. |
| The reconciler mis-parses on a surface it was not designed for | Ship Phase 2 (context carry) before Phase 3c (reconciler swap). Phase 2 alone fixes the reset; Phase 3c is an upgrade on top of a working base. |

**Explicit non-goals:** no change to chain-selection policy (still user-explicit
only), no change to confirmation/authorization, no change to
`normalizedInitialBuy` caps (`launch_configuration.ts:53`), no change to wallet or
signing paths, no change to cache headers or deploy process (`CLAUDE.md`).

---

## 10. Relationship to `LAUNCH_AI_SLOT_INTELLIGENCE_PLAN.md`

That plan produced the reconciler and was right about the architecture. Its §8,
*"Prefer Clarification Over Silent Correction"*, is the design decision that
over-fired: implemented as *any* uncertainty about *any* slot halts the launch.

This plan amends §8 to:

> Prefer clarification over silent correction **for user-owned required slots and
> for conflicting edits to slots the user already set.** For optional,
> auto-filled slots, prefer **autofill plus a visible confirmation card** over a
> question. The confirmation card is the correction surface.

Its own worked example is the proof — §8 states that after "Use Solana" the
system should launch `name=test, symbol=TEST, chain=solana`. In production it
asked for the name instead, three times.

---

## Appendix A — Files to change

| File | Change | Phase |
|---|---|---|
| `_shared/launch_contract.ts` | **New.** Required/autofill slot policy, `missingLaunchSlots`, `launchStateSummary` | 0 |
| `_shared/launch_slot_reconciler.ts` | Optional slots stop gating (`:247`); none/zero vocabulary (`:442-472`); `image_prompt` slot (`:11-18`, `:90-98`); contract in prompt (`:387-425`); surface-neutral input types | 1, 3 |
| `worker-command-prepare/index.ts` | Remove `["name"]` fallback (`:472-473`); state echo; stall breaker; round counter | 1 |
| `_shared/x_launch_command.ts` | `REQUIRED_FIELDS` → `launch_contract.ts`; state-echoing `clarificationReply` | 0, 1 |
| `_shared/linkr_agent_runtime.ts` | Conversation-scoped drafts (`:406`); draft merge (`:1488`); draft-aware routing (`:525`); `missingFields` (`:2136`); no chain default (`:1738`, `:1784`); enrich + generate before pending (`:1639`); clarification copy (`:2179`); bare-image guard (`:533`) | 2, 3 |
| `_shared/linkr_tool_registry.ts` | `action.prepare_launch` required → `["chain","name"]` (`:144-153`) | 3 |
| `_shared/prompts.ts` | Delete (orphaned) or wire in its chain policy | 4 |
| `supabase/functions/edge-budgets.json` | Add `cli-chat`; re-baseline `terminal-chat`, `telegram-webhook` | 3 |
| `_shared/launch_slot_reconciler_test.ts` | **New.** Cases 1-5 | 1 |
| `_shared/linkr_launch_intake_test.ts` | **New.** Cases 6-9 | 2, 3 |
| `_shared/launch_enrichment_test.ts` | Extend: name + chain only | 3 |

No migration is required. `v_required` in
`20260728150000_launch_slot_reconciler_guardrails.sql` already tracks only
`name` and `chain`, and `authorize_linkr_launch_v2` already validates the final
payload. **The database has been right the whole time — the application layer is
what asks for too much.**

## Appendix B — Reproduction queries

```bash
# Drafts by surface — expect x-only before Phase 3
GET /rest/v1/linkr_action_drafts?select=id,surface,action_type,status,required_fields,filled_fields&order=updated_at.desc

# The looping draft and its reconciler trace
GET /rest/v1/linkr_action_drafts?id=eq.5b028575-9478-434a-9041-4d9e1878a35f&select=filled_fields,field_provenance,generation_context

# The transcript
GET /rest/v1/tweets_inbox?select=tweet_id,text,media_url,created_at&order=created_at.desc&limit=12
GET /rest/v1/twitter_replies?select=tweet_id,reply_kind,reply_text,created_at&order=created_at.desc&limit=12

# Regression watch: this must return zero rows after Phase 1
GET /rest/v1/twitter_replies?reply_text=ilike.*What%20should%20the%20token%20be%20called*
```

---

## Execution record — 2026-07-30

All phases implemented. Every gate below was run to completion.

### Deviations from the plan, and why

Four places where the plan was wrong or incomplete, corrected during execution:

1. **Protected-slot conflicts do not all deserve a question.** Phase 1a as
   written made *any* blocked protected overwrite force clarification. That
   broke the original incident regression: when the model reads the assistant's
   own `@linkrbot` handle as a token name, the guard drops it and the launch
   must continue. Asking "did you mean to rename your token to linkrbot?" would
   be a new loop. Only `protected_user_slot_requires_edit_intent` — a genuine
   disagreement with something the user set — now clarifies.

2. **The two overwrite guards were in the wrong order.** A bot-handle artifact
   was caught by the edit-intent guard first and labelled
   `protected_user_slot_requires_edit_intent`, i.e. mislabelled as a user
   conflict. The handle check now runs first so `blocked_reason` describes the
   real cause. This is what makes (1) work.

3. **`chain_explicit` had the very bug this change exists to remove.** Writing
   `chain_explicit: false` on every turn meant message three erased the chain
   chosen in message one. The chain flags are now only emitted when the message
   actually talks about a chain. Caught by a test, not by review.

4. **The resolved dev buy was computed and then dropped.** `queueLaunch` reads
   `initial_buy_sol` / `initial_buy_eth`, not `dev_buy_amount`, so a user's
   configured wallet default would have been resolved and silently ignored at
   launch time. `applyResolvedDevBuy` projects it across, refusing to relabel a
   SOL amount as ETH or to exceed the per-chain cap.

Two improvements on the plan:

- **Tool-registry required fields kept, not relaxed** (plan 3e). Because
  validation now runs *after* autofill, keeping `symbol`/`description`/
  `image_url` turns that list into a post-enrichment assertion that the
  pipeline produced a complete payload — strictly stronger than relaxing it.
- **Carry-forward scoped to launches only.** Trades, transfers and burns are
  single-shot; reviving a stale amount or recipient from an abandoned draft
  would be worse than asking again. Money-moving paths are behaviourally
  unchanged.

### Verification

| Gate | Result |
|---|---|
| `npm run test:edge` | **334 passed, 0 failed** (baseline 298; 36 added) |
| `npm run check:edge-budget` | pass (335 files, 2.38 MiB) |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `deno check` — all 76 `_shared` modules | pass |
| `deno check` — all 8 affected functions | pass |
| `npm run lint` | 5 errors, all pre-existing prettier issues in untouched `src/` files (`git diff -- src` is empty) |
| `npm run audit:architecture` | same 6 pre-existing failures as baseline (local `.env` files, gitignored); list did not grow |

### The incident transcript, replayed

`launch_transcript_regression_test.ts` replays the real 2026-07-30 session
through the actual reconciler and a faithful model of
`upsert_linkr_launch_draft_v2` + the worker's clarification branch, using the
model outputs the model actually returned:

- **Turn 1** (name + ticker + image brief, no chain) → one question, asking
  only for the chain, echoing `Saved so far: name test · ticker TEST`. It
  cannot mention description, dev buy, mayhem, or an image URL.
- **Turn 2** ("Launch it on Solana… no mayhem mode, and dev buy is 0") →
  **launches.** `dev_buy_amount: "0 SOL"`, `mayhem_mode: false`,
  `image_prompt: "a test tube"`.

Seven turns and no launch became two turns and one clarification. The second
session (everything at once + attached image) now launches on the **first**
reply with zero clarifications.

A source-level guard asserts `clarificationReply` can never again be handed a
synthetic missing-field list, so the "What should the token be called?" reply
is unreachable while a name is present.

### Affected functions (the deploy set)

`terminal-chat`, `cli-chat`, `telegram-webhook`, `worker-command-prepare`,
`worker-launch-enrich`, `worker-image-generate`, `worker-media-capture`,
`worker-x-ingress` — 8 of 87, computed by walking static and dynamic imports.

No migration required. The database already required only `name` and `chain`;
it was the application layer asking for too much.

### Known pre-existing issues, deliberately not touched

- `update-user-settings/index.ts` has a typecheck error (`TS2322`, unrelated to
  this work). Not in the deploy set.
- `mayhem_mode` and `cashback_mode` are captured on the draft but the X
  `coin_launches` insert (`create_linkr_coin_launch_v1`) never writes
  `mayhem_mode_requested`, so an explicit mayhem request does not yet reach the
  chain on that path. Defaults are unaffected — both modes are off unless asked
  for, which is the required behaviour. Fixing the plumbing means replacing a
  live launch-execution DB function and was judged too risky to bundle with
  this change.
