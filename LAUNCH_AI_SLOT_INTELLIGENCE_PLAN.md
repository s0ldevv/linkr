# Launch AI Slot Intelligence Plan

## Incident

User request on X:

```text
@linkrcash launch a coin called test with ticker test
```

Bot reply:

```text
Your launch is saved. Which chain should I use: Solana or Robinhood?
```

User follow-up:

```text
@linkrcash Use Solana
```

Resulting Solana launch:

- Mint: `6ZEYrijLeK1FMkU3XFqjCCJVAGMd6KA1dGLuyDdkyhhN`
- Actual token name: `linkrcash`
- Actual token symbol: `TEST`
- Expected token name: `test`
- Expected token symbol: `TEST`

Live DB evidence from `coin_launches`:

- `name = linkrcash`
- `symbol = TEST`
- `chain = solana`
- `tweet_id/source_tweet_id = 2081982677964427495`
- `status = confirmed`

Live DB evidence from `linkr_action_drafts`:

- `filled_fields.name = linkrcash`
- `filled_fields.symbol = TEST`
- `filled_fields.chain = solana`
- `field_provenance.name = user_text`
- `field_provenance.symbol = user_text`
- `field_provenance.chain = user_text`
- `generation_context.last_input_tweet_id = 2081983131007984078`
- `generation_context.extraction_version = launch-command-v2`

The bad state is especially dangerous because provenance says the bad name came from `user_text`, even though the user text supplied `test`.

## Root Cause

This is not a final launch-worker bug. The final launch worker launched the draft it was given.

The failure is in command preparation and draft merging:

1. `worker-command-prepare` resolves the existing launch draft when the user replies `Use Solana`.
2. It calls `extractLaunchFieldsWithAi(tweet.text, tweet.media_url)` on the follow-up tweet text.
3. The AI extractor receives the raw tweet text, including `@linkrcash`.
4. If the model returns `name = linkrcash`, `mergeLaunchFields(existingFields, incoming)` overwrites the existing user-provided `name = test`.
5. The code marks any incoming `name` as `user_text`, even when the incoming value is a bot handle misread from the follow-up.
6. The DB upsert function then merges JSON as `old || new`, so the overwritten name becomes persisted.

Relevant code paths:

- `supabase/functions/_shared/x_launch_command.ts`
  - `extractLaunchFieldsWithAi`
  - `mergeLaunchFields`
- `supabase/functions/worker-command-prepare/index.ts`
  - existing draft resolution
  - incoming extraction
  - field provenance assignment
  - `upsert_linkr_launch_draft_v2`
- `supabase/migrations/20260722180000_autonomous_launch_policy_and_threads.sql`
  - `upsert_linkr_launch_draft_v2`
  - `filled_fields = existing || incoming`

The current architecture treats AI extraction as a patch over deterministic extraction, then merges patches mechanically. That is not intelligent enough for multi-turn launch requests.

## Product Requirement

This system must not become a deterministic parser with more regex cases.

The fix should make the AI better at understanding user intent across the conversation. Deterministic code may still be used for hard safety boundaries, schema validation, transaction limits, idempotency, and chain/wallet execution constraints, but semantic understanding must come from an AI-driven state update, not from regex-first extraction.

## Target Architecture

Move from:

```text
regex extraction -> AI patch -> mechanical merge -> enrichment -> launch
```

to:

```text
conversation state + existing draft + latest user message
  -> AI slot reconciler
  -> guarded slot update
  -> AI semantic verifier
  -> enrichment of only missing creative fields
  -> launch
```

## Core Design

### 1. Use an AI Slot Reconciler, Not Field Extraction

Create a new shared module, for example:

```text
supabase/functions/_shared/launch_slot_reconciler.ts
```

The reconciler should receive:

- Existing draft fields
- Existing field provenance
- Original launch tweet text
- Latest user tweet text
- Previous assistant reply text, when available
- Source refs/tweet ids
- Current missing fields

It should return a structured JSON patch:

```json
{
  "intent": "continue_launch|edit_launch|cancel_launch|unrelated|unclear",
  "slot_updates": {
    "name": {
      "action": "keep|set|clear|ask",
      "value": "test",
      "evidence": "coin called test",
      "confidence": 0.98,
      "reason": "The initial request explicitly named the coin test."
    },
    "symbol": {
      "action": "keep|set|clear|ask",
      "value": "TEST",
      "evidence": "ticker test",
      "confidence": 0.98,
      "reason": "The initial request explicitly supplied ticker test."
    },
    "chain": {
      "action": "set",
      "value": "solana",
      "evidence": "Use Solana",
      "confidence": 0.99,
      "reason": "The latest reply answers the chain clarification."
    }
  },
  "needs_clarification": false,
  "clarification_question": null
}
```

The AI should reason over the whole launch thread, not just the latest tweet. A follow-up like `Use Solana` should be understood as answering only the missing chain slot.

### 2. Make User-Owned Slots Sticky

Once a slot has high-confidence user provenance, later messages should not overwrite it unless the user explicitly edits that slot.

Examples:

- Existing `name = test` from `coin called test`
- Latest message `Use Solana`
- Allowed update: `chain = solana`
- Forbidden update: `name = linkrcash`

This should be implemented as an AI-informed slot policy:

- `keep` means no DB update for that slot.
- `set` requires direct evidence from the conversation.
- `set` over an existing `user_text` slot requires explicit edit intent, such as `change the name to X`.
- If the reconciler sees a conflict, ask a clarification instead of overwriting.

This keeps the system intelligent while preventing one bad model extraction from corrupting an existing user intent.

### 3. Stop Sending Raw Bot Mentions as Candidate Token Fields

The AI should still see the full tweet for context, but candidate extraction should separate:

- `raw_text`
- `clean_user_text`
- `mentioned_bot_handle`
- `mentioned_user_handles`
- `urls`
- `media`

Prompt instruction should be explicit:

```text
@linkrcash is the assistant/bot handle. It is never a token name, ticker, project name, creator name, or launch metadata unless the user explicitly says to name the token linkrcash.
```

This is not a deterministic fix; it is context hygiene for the AI. The model can still understand arbitrary wording, but it is no longer invited to mistake the routing handle for a token field.

### 4. Add an AI Semantic Verifier Before Launch Authorization

Before a draft becomes a launch, call a second lightweight AI verifier:

Input:

- Original user request
- Follow-up messages
- Final launch payload

Output:

```json
{
  "matches_user_intent": true,
  "blocking_mismatches": [],
  "confidence": 0.97,
  "user_visible_summary": "Launch TEST named test on Solana"
}
```

If the verifier finds a mismatch, pause and ask the user:

```text
I have name "linkrcash" and ticker TEST, but your first request said name "test". Should I launch name "test" with ticker TEST on Solana?
```

This is the cleanest safety net because it checks the final payload semantically, not by adding a brittle name-specific rule.

### 5. Keep Enrichment Creative, But Never Authoritative Over User Slots

`worker-launch-enrich` should continue using AI to generate creative metadata:

- description
- image prompt
- image negative prompt
- missing symbol only when the user did not provide one

But enrichment must not be allowed to modify:

- user-provided name
- user-provided symbol
- user-provided chain
- user-provided dev buy

The DB function `update_linkr_launch_enrichment_v1` already only fills empty fields for symbol/description/image/dev buy and cannot set `name`. Keep that rule and add tests around it.

### 6. Store Better Provenance

Current provenance is too coarse:

```json
{
  "name": "user_text"
}
```

Replace or augment it with evidence:

```json
{
  "name": {
    "source": "user_text",
    "tweet_id": "2081982677964427495",
    "evidence": "coin called test",
    "confidence": 0.98,
    "set_at": "2026-07-28T05:59:10Z",
    "model": "gpt-5-mini",
    "prompt_version": "launch-slot-reconciler-v1"
  }
}
```

This makes future debugging much easier and lets the merge policy know whether a slot is protected.

### 7. Change DB Merging From Object Append to Slot-Aware Patch

The SQL `existing || incoming` merge is too blunt.

Add a new RPC or revise the existing one so command preparation passes a slot patch, not a full object. The DB function should:

- Apply `keep` by leaving the existing field unchanged.
- Apply `set` only when the patch includes evidence and allowed provenance.
- Reject overwriting protected user slots unless `edit_intent = true`.
- Store before/after changes in `generation_context` or a dedicated audit table.

This provides a last line of defense if a worker accidentally sends an unsafe patch.

### 8. Prefer Clarification Over Silent Correction

When confidence is low or fields conflict, the bot should ask instead of guessing.

Examples:

- User: `launch a coin called test with ticker test`
- Bot: asks chain
- User: `Use Solana`
- Action: launch `name=test`, `symbol=TEST`, `chain=solana`

But:

- User: `actually call it linkrcash`
- Action: update name only if the reconciler marks this as explicit edit intent

And:

- User: `Use Solana linkrcash`
- Action: ask whether `linkrcash` is a name edit or stray handle-like text

## Implementation Plan

### Phase 1: Immediate Safe Fix

Goal: prevent this exact class of overwrite without making the system deterministic.

1. Build `launch_slot_reconciler.ts`.
2. Replace `extractLaunchFieldsWithAi + mergeLaunchFields` in `worker-command-prepare` with the AI slot reconciler for launch drafts.
3. Include existing draft fields and the latest user message in the reconciler prompt.
4. Strip or annotate `@linkrcash` as the assistant handle in model context.
5. Enforce sticky user-owned slots in code before calling the DB upsert.
6. Add a regression test for:

```text
Initial: @linkrcash launch a coin called test with ticker test
Assistant: Which chain should I use?
Follow-up: @linkrcash Use Solana
Expected final fields: name=test, symbol=TEST, chain=solana
```

### Phase 2: DB Guardrail

Goal: stop unsafe overwrites even if worker code regresses.

1. Add a migration for slot-aware draft patching.
2. Prevent `name`, `symbol`, `chain`, and `dev_buy_amount` user slots from being overwritten unless explicit edit intent is present.
3. Store slot evidence and model confidence.
4. Add migration tests or SQL smoke checks for protected slot behavior.

### Phase 3: AI Semantic Verification

Goal: ensure the final launch payload matches the user request before irreversible launch execution.

1. Add `verifyLaunchPayloadAgainstThread`.
2. Run it after enrichment and before media capture/image generation authorizes the launch.
3. If it fails, pause the draft and ask a clarification.
4. Store verifier output in `generation_context`.
5. Include verifier result in health/debug logs without leaking secrets.

### Phase 4: Launch Understanding Evals

Goal: improve the AI over time instead of patching one failure at a time.

Create an eval file such as:

```text
supabase/functions/_shared/launch_slot_reconciler_eval_test.ts
```

Include multi-turn examples:

- Missing chain follow-up: `Use Solana`
- Name edit: `change the name to Foo`
- Symbol edit: `ticker should be BAR`
- Ambiguous edit: `make it linkr`
- Bot handle noise: `@linkrcash Use Solana`
- URLs/media present in the initial tweet
- Both chains mentioned
- User includes `ticker also test`
- User asks a question instead of continuing launch

Do not use deterministic expected regex matches as the product behavior. The tests should verify the slot reconciler contract and the protected merge behavior.

### Phase 5: Observability

Goal: make future launch mistakes diagnosable in one query.

Add structured fields/logs:

- original user request
- latest follow-up
- reconciler decision
- per-slot evidence
- per-slot confidence
- protected-slot overwrite attempts
- semantic verifier result
- final launch payload summary

Add an admin/debug view in `/secretpanel` later for recent launch draft decisions.

## Acceptance Criteria

1. The reported flow launches `name=test`, `symbol=TEST`, `chain=solana`.
2. A follow-up that only answers the chain cannot overwrite name or symbol.
3. A user can still intentionally edit name/symbol in a later reply.
4. The AI can handle messy natural language without a deterministic regex expansion.
5. If AI confidence is low, the bot asks for clarification instead of launching.
6. Final irreversible launch authorization includes a semantic match check.
7. Provenance records show the evidence text that set each user-owned slot.

## Recommended First Code Change

Implement the AI slot reconciler and protected merge first. That is the highest-leverage fix because it addresses the exact failure mode and improves every future multi-turn launch.

The smallest useful change is:

1. Add `reconcileLaunchDraftWithAi(existingDraft, latestTweet, threadContext)`.
2. Have it return slot actions with evidence.
3. Replace `mergeLaunchFields(existingFields, incoming)` in `worker-command-prepare`.
4. Add protected-slot checks before upsert.
5. Add the reported incident as a regression test.

Do not solve this by adding a special-case rule like "ignore linkrcash as a name." That is a useful prompt/context hygiene instruction, but the real fix is AI-driven slot reconciliation with protected user intent.
