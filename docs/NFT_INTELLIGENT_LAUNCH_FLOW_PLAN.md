# Intelligent NFT Launch Flow Plan

## Purpose

Add an intelligent NFT guidance and launch flow for the bot without turning the
bot into a brittle keyword responder, without executing NFT mints before user
confirmation, and without adding avoidable CPU or Postgres load.

The desired product behavior is:

- If a user asks how to launch an NFT, the bot should answer naturally and
  explain that Solana NFT launches must start with a collection first.
- If a user asks to launch or mint a single NFT and the chain is unclear, the
  bot should ask whether they want Robinhood or Solana.
- If the user chooses Robinhood, the bot should say Robinhood NFT launches are
  not wired yet.
- If the user chooses Solana, the bot should check the user's confirmed NFT
  collections efficiently.
- If the user has a collection, the bot should ask whether they want to mint
  into that collection, using the collection name.
- If the user confirms through the X reply/context flow, the NFT should launch
  through the existing queue/worker system, similarly to coin launches.
- If the request is unclear, the bot should keep the conversation open and ask
  for the missing information instead of executing.

## Current System Findings

The app already has the pieces needed for a safe NFT flow, but they are not
connected through the same confirmation model as coin launches.

Relevant files and behavior:

- `supabase/functions/_shared/x_ai_intake.ts`
  - Public X reply routing already separates conversational replies from
    executable commands.
  - It uses `capabilityPromptFacts()` and the Linkr persona prompt to answer
    capability questions naturally.
  - This is the right place to teach the model that Solana NFT launches require
    a collection first.
- `supabase/functions/_shared/linkr_capabilities.ts`
  - Current capability facts do not include NFT collection/mint behavior.
  - Add compact NFT capability facts here instead of hard-coding canned answers.
- `supabase/functions/_shared/x_nft_command.ts`
  - Existing parser/classifier supports `create_collection` and `mint_nft`.
  - It does not currently model chain ambiguity, Robinhood, collection
    availability, or confirmation state.
  - It also does not consistently treat "launch an NFT" as NFT intent.
- `supabase/functions/worker-command-prepare/index.ts`
  - Launch confirmations are handled first by loading pending
    `linkr_pending_actions` for the same X conversation.
  - NFT commands currently enqueue `nft.solana` directly after
    parsing/classification.
  - This direct enqueue is the main safety gap for the desired flow.
- `supabase/functions/worker-nft-solana/index.ts`
  - Consumes `nft_solana` work and calls `executeXNftCommand`.
  - It should keep owning the heavy NFT/Solana execution path.
- `supabase/functions/_shared/x_nft_execute.ts`
  - Mints collections and NFTs.
  - Dynamically imports the heavy Solana NFT mint module, which is good for
    CPU/boot budget.
  - It already resolves collections but should be made retry-safe with
    pending-action idempotency.
- `linkr_pending_actions`
  - Existing table supports draft-backed pending actions, confirmation phrases,
    idempotency keys, expiry, and statuses.
  - This should be reused for NFT value-moving work.
- `enqueue_linkr_nft_solana_v1`
  - Existing RPC queues NFT work and serializes by wallet/user.
  - A v2 RPC should enqueue only after confirmation and include
    `pending_action_id` in the payload/idempotency key.

## Design Principles

1. Conversational answers are model-driven, action safety is deterministic.
   - Do not write a hard-coded "if user says how can I launch an NFT" response.
   - Do add compact capability facts so the model can answer correctly.
   - Do use deterministic confirmation checks before any value-moving NFT mint.

2. Command preparation stays lightweight.
   - No Solana SDK imports in `worker-command-prepare`.
   - No metadata upload, image rehosting, or mint transaction construction
     before confirmation.
   - The command-preparation worker only extracts intent, loads small indexed
     rows, creates drafts/pending actions, and queues replies.

3. NFT execution stays isolated.
   - `worker-nft-solana` remains the only place that executes Solana NFT
     minting.
   - Heavy mint code remains dynamically imported from
     `_shared/solana_nft/mint.ts`.

4. Postgres reads stay bounded and indexed.
   - Collection lookup must be limited and use `(user_id, status, created_at)`
     and exact-name/symbol indexes.
   - Never scan all NFT mints or collections for conversational replies.

5. Existing queue semantics are preserved.
   - Use `linkr_pending_actions` for user authorization.
   - Use wallet resource serialization in the NFT queue handoff.
   - Use idempotency keys based on `pending_action_id`, not raw tweet text.

## Target User Flows

### 1. User asks how to launch an NFT

Example:

> how can I launch an nft?

Expected behavior:

- Route to the public conversational reply lane.
- The bot answers naturally.
- The answer should mention that on Solana the user must create a collection
  first, then mint NFTs into that collection.
- The bot can mention that Robinhood NFT launching is not wired yet.
- The bot should not query private tables or create a draft for a pure how-to
  question.
- The bot should not ask for confirmation or attempt to execute.

Implementation:

- Add NFT facts to `LINKR_CAPABILITIES`.
- Adjust the X reply prompt only enough to make NFT guidance available to the
  model.
- Add routing tests proving "how do I launch an NFT?" stays in reply lane.

### 2. User asks to launch an NFT, chain unclear

Example:

> launch this nft

Expected behavior:

- Treat as executable NFT intent, not a pure how-to answer.
- Create or update an action draft in the X conversation.
- Ask: Robinhood or Solana?
- Do not enqueue `nft_solana`.
- Do not query collections yet unless the user already specified Solana.

Implementation:

- Extend NFT intent extraction to produce structured missing fields:
  - `action_type = nft_mint`
  - `chain = null`
  - `missing_fields = ["chain"]`
  - `execution_intent = true`
- Store the draft in `linkr_action_drafts` with `surface = "x"` and
  `surface_conversation_id = tweet.conversation_id`.

### 3. User chooses Robinhood for an NFT

Example:

> robinhood

Expected behavior:

- Resolve the open NFT draft in the same X conversation.
- Reply that Robinhood NFT launches are not wired yet.
- Close or cancel the draft.
- Do not create a pending action.
- Do not enqueue NFT work.

Implementation:

- Add a draft continuation resolver that can apply short follow-up answers like
  "solana" or "robinhood" to an existing NFT draft.
- If chain resolves to `robinhood`, update draft status to `cancelled` or
  `completed` with reason `robinhood_nft_not_wired`.

### 4. User chooses Solana and has no collection

Example:

> solana

Expected behavior:

- Resolve the open NFT draft.
- Load a bounded list of the user's confirmed Solana NFT collections.
- If none exist, explain they need a collection first and ask whether they want
  to create one.
- Do not mint a single NFT.
- Do not enqueue NFT work.

Implementation:

- Query only:
  - `nft_collections`
  - `user_id = <user>`
  - `status = "confirmed"`
  - `order by created_at desc`
  - `limit 5`
- Keep the reply conversational, but grounded in the product rule:
  - Solana single NFTs must be minted into a collection.

### 5. User chooses Solana and has exactly one collection

Example:

> launch this nft on solana

Expected behavior:

- Load the user's confirmed collections.
- If exactly one collection exists, ask whether to mint into that collection by
  name.
- If required image/media is missing, ask for an image before creating a pending
  action.
- If image/media is present, create a pending action with a concise confirmation
  phrase.
- Do not enqueue NFT work until confirmation.

Suggested confirmation copy:

> I found your <collection-name> collection. Reply `confirm nft` and I will mint
> this NFT into it.

Implementation:

- Create `linkr_pending_actions` with:
  - `action_type = "nft_mint"`
  - `confirmation_phrase = "confirm nft"`
  - `summary = "Mint NFT into <collection-name>"`
  - `action_payload.collection_id = <collection uuid>`
  - `action_payload.chain = "solana"`
  - `action_payload.tweet_id = <tweet id>`
  - `action_payload.image_source = "tweet_media"` or resolved media pointer
  - `idempotency_key = "x:nft:<conversation_id>:<draft_id or root_work_item_id>:v1"`
  - expiry consistent with launch actions, preferably 15 minutes

### 6. User chooses Solana and has multiple collections

Expected behavior:

- Ask which collection to use.
- Show a short, bounded list of collection names.
- Save the draft as awaiting collection selection.
- Do not create a pending action until one collection is resolved.

Implementation:

- Use the same bounded collection query.
- If the user named a collection in the original request, run exact lookup
  first:
  - lower(name)
  - lower(symbol)
  - mint address if supplied
- Only use limited fuzzy matching after exact matching fails.

### 7. User asks to create an NFT collection

Example:

> launch an nft collection called Neon Keys on Solana

Expected behavior:

- Treat as `nft_create_collection`.
- Require Solana for now.
- Require collection name, symbol, and image.
- Ask for missing fields.
- Once complete, create pending action and ask for confirmation.
- On confirmation, enqueue `nft_solana`.

Implementation:

- Reuse existing `create_collection` execution logic.
- Add draft state for missing name, symbol, chain, and image.
- Suggested confirmation phrase: `confirm collection`.

### 8. User confirms or cancels

Examples:

> confirm nft

> cancel nft

Expected behavior:

- Match only pending NFT actions in the same X conversation.
- Confirming a launch should not confirm an NFT.
- Confirming an NFT should not confirm a token launch.
- Expired actions should be marked expired and not enqueued.
- Duplicate confirmations should be idempotent.

Implementation:

- Add NFT-specific confirmation/cancellation helpers in
  `worker-command-prepare`.
- Accept `confirm nft` and `confirm collection`.
- Optionally accept bare `confirm` only if there is exactly one pending action
  in the conversation and it is an NFT action.
- Add SQL/RPC confirmation so status transition and queue insertion happen
  atomically.

## Proposed Data Model Changes

### 1. Add pending-action references to NFT records

Migration:

```sql
alter table public.nft_collections
  add column if not exists pending_action_id uuid
    references public.linkr_pending_actions(id) on delete set null;

alter table public.nft_mints
  add column if not exists pending_action_id uuid
    references public.linkr_pending_actions(id) on delete set null;

create unique index if not exists nft_collections_pending_action_uidx
  on public.nft_collections (pending_action_id)
  where pending_action_id is not null;

create unique index if not exists nft_mints_pending_action_uidx
  on public.nft_mints (pending_action_id)
  where pending_action_id is not null;
```

Reason:

- Prevent duplicate collection/mint rows across worker retries.
- Give `worker-nft-solana` a durable execution fence.

### 2. Add efficient collection lookup indexes

Migration:

```sql
create index if not exists nft_collections_user_status_created_idx
  on public.nft_collections (user_id, status, created_at desc);

create index if not exists nft_collections_user_status_lower_name_idx
  on public.nft_collections (user_id, status, lower(name));

create index if not exists nft_collections_user_status_lower_symbol_idx
  on public.nft_collections (user_id, status, lower(symbol));
```

Reason:

- The bot will check existing collections during Solana NFT mint preparation.
- The lookup must remain bounded and index-backed.

### 3. Add an NFT queue handoff RPC

Add `enqueue_linkr_nft_solana_v2` or `confirm_linkr_nft_action_v1`.

Preferred shape:

```sql
create or replace function public.confirm_linkr_nft_action_v1(
  p_pending_action_id uuid,
  p_confirmation_work_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
-- Atomically:
-- 1. Lock linkr_pending_actions row.
-- 2. Validate status = pending, action_type in ('nft_create_collection', 'nft_mint').
-- 3. Validate same user as confirmation work item.
-- 4. Expire if expires_at <= now().
-- 5. Reserve wallet/user resource sequence.
-- 6. Insert or reuse nft_solana work item with idempotency key
--    'nft-solana:' || pending_action_id || ':v1'.
-- 7. Set pending status = confirmed and confirmed_at = now().
-- 8. Return pending_action_id, work_item_id, message_id, duplicate.
$$;
```

Notes:

- Keep the existing `enqueue_linkr_nft_solana_v1` for compatibility and replay
  safety.
- New confirmed NFT work should use v2/confirm RPC only.
- The work item payload should include:
  - `pending_action_id`
  - `kind = "create_collection"` or `"mint_nft"`
  - `tweet_id`
  - normalized command fields
  - `consumer_version`

## Structured Intent Layer

Create a new shared module or evolve `x_nft_command.ts` into a two-layer design:

- `x_nft_command.ts`
  - Fast deterministic parser for clear legacy command forms.
  - Backward-compatible `XNftCommand` types used by the executor.
- `x_nft_intent.ts`
  - Higher-level structured intent used by `worker-command-prepare`.
  - Handles chain ambiguity, Robinhood unsupported state, draft continuation,
    and missing fields.

Suggested type:

```ts
export type XNftIntent = {
  intent: "nft_guidance" | "create_collection" | "mint_nft" | "none";
  executionIntent: boolean;
  chain: "solana" | "robinhood" | null;
  missingFields: Array<"chain" | "collection" | "name" | "symbol" | "image">;
  collectionQuery: string | null;
  collectionId: string | null;
  collectionName: string | null;
  nftName: string | null;
  confidence: "low" | "medium" | "high";
  reason: string | null;
};
```

Rules:

- Pure how-to questions return `intent = "nft_guidance"` and
  `executionIntent = false`.
- Explicit "launch/mint/create" requests return `executionIntent = true`.
- Chain is nullable. Missing chain becomes a draft clarification.
- Robinhood is recognized, but `mint_nft`/`create_collection` on Robinhood is
  unsupported for now.
- The AI classifier should only produce structure. It should not generate
  user-facing action copy.

## Prompt Updates

### `linkr_capabilities.ts`

Add a compact NFT capability:

```ts
{
  key: "nft",
  summary:
    "Solana NFT collections and NFT mints are supported. On Solana, users must create a collection first, then mint NFTs into that confirmed collection. Robinhood NFT launches are not wired yet.",
  examples: [
    "Create a Solana NFT collection from attached art.",
    "Mint an NFT into one of the user's confirmed Solana collections.",
  ],
}
```

Keep it short because these facts are injected into public reply prompts.

### `x_ai_intake.ts`

Only add prompt rails if tests show the model still misses the behavior after
the capability fact. If needed, add one compact sentence:

```text
For NFT capability questions, explain the collection-first Solana rule; never start minting from a question.
```

Do not add deterministic response templates.

### `linkr_persona.ts`

Optionally add a short persona support line:

```text
Linkr can help with Solana NFT collections and NFT mints; Robinhood NFT minting is not wired yet.
```

Only add this if capability facts are not consistently present in every relevant
surface.

## Worker Changes

### `worker-command-prepare/index.ts`

Add NFT handling in this order:

1. Existing pending-action confirmation/cancellation handling.
2. NFT pending-action confirmation/cancellation handling.
3. NFT draft continuation handling.
4. NFT intent extraction for new requests.
5. Existing trade/launch/schedule/conversation routing.

Detailed behavior:

- If a pending NFT action exists in the same X conversation:
  - `confirm nft` or `confirm collection` calls `confirm_linkr_nft_action_v1`.
  - `cancel nft` or `cancel collection` marks it cancelled.
- If an open NFT draft exists:
  - Merge the new reply into the draft.
  - Re-run validation.
  - Ask the next missing question or create pending action.
- If a new NFT intent is found:
  - For `nft_guidance`, let it escape to the reply lane.
  - For executable NFT intent, create/update draft and validate.
- Replace the current direct `enqueue_linkr_nft_solana_v1` path with
  pending-action creation.
- Keep a guarded compatibility path for already-normalized internal/retry
  payloads if needed, but new X requests should not direct-enqueue.

### `worker-nft-solana/index.ts`

Update payload handling:

- Accept v2 payloads with `pending_action_id`.
- Load the pending action.
- Validate:
  - `status in ("confirmed", "executing")`
  - `action_type in ("nft_create_collection", "nft_mint")`
  - `pending.user_id = work_item.user_id`
  - payload command matches pending action payload
- Set status to `executing` before calling the executor.
- Call `executeXNftCommand`.
- Mark pending action `executed` on success.
- Mark pending action `failed` on terminal failure.
- Preserve support for existing v1 payloads until all old queue items drain.

### `x_nft_execute.ts`

Refactor minimally:

- Accept optional `pendingActionId`.
- Insert `nft_collections.pending_action_id` or `nft_mints.pending_action_id`.
- Use `on conflict (pending_action_id) where pending_action_id is not null` to
  reuse rows on retry.
- Keep existing media resolution and dynamic import behavior.
- Update insufficient SOL copy so it reflects actual NFT requirements if the
  mint module exposes a better estimate later.

## Draft And Pending Action Payloads

### NFT mint pending payload

```json
{
  "kind": "mint_nft",
  "chain": "solana",
  "tweet_id": "123",
  "collection_id": "uuid",
  "collection_name": "Collection Name",
  "collection_query": "Collection Name",
  "nft_name": "Optional NFT Name",
  "media": {
    "source": "tweet_media",
    "tweet_id": "123"
  }
}
```

### NFT collection pending payload

```json
{
  "kind": "create_collection",
  "chain": "solana",
  "tweet_id": "123",
  "name": "Collection Name",
  "symbol": "SYMBOL",
  "description": "Optional description",
  "website_url": null,
  "twitter_url": null,
  "telegram_url": null,
  "media": {
    "source": "tweet_media",
    "tweet_id": "123"
  }
}
```

Payload constraints:

- Store IDs and normalized short strings only.
- Do not store large media blobs.
- Keep user-facing generated copy out of payload except for short summaries.
- Re-resolve image through bounded media/existing helper at execution time.

## Collection Lookup Helper

Add a helper such as:

```ts
export async function loadUserConfirmedNftCollections(
  admin: any,
  userId: string,
  options?: { query?: string | null; limit?: number },
): Promise<NftCollectionChoice[]> {
  // Exact match by mint, lower(name), lower(symbol) first when query exists.
  // Otherwise return most recent confirmed collections, limit 5.
}
```

Requirements:

- Always filter by `user_id`.
- Always filter by `status = "confirmed"`.
- Always apply a limit, default 5, hard cap 10.
- Return only:
  - `id`
  - `name`
  - `symbol`
  - `mint_address`
  - `created_at`
- Do not join mints.
- Do not fetch image URLs unless the UI/reply needs them.

## Confirmation Phrase Policy

Add NFT-specific phrases:

- `nft_mint`: `confirm nft`
- `nft_create_collection`: `confirm collection`

Safety rules:

- Do not let `confirm launch` confirm an NFT.
- Do not let `confirm nft` confirm a token launch.
- Bare `confirm` is only allowed when exactly one pending action exists in the
  conversation and it is unambiguous.
- Cancellation follows the same scoping rules.

## CPU And Postgres Safeguards

CPU safeguards:

- No Solana SDK imports in command preparation, reply generation, or intent
  classification modules.
- Keep NFT intent classification to one bounded AI call only after fast path
  routing fails.
- Do not classify pure conversational how-to messages as executable work.
- Keep reply prompt NFT facts compact.
- Keep `worker-nft-solana` concurrency unchanged unless production metrics prove
  it needs adjustment.

Postgres safeguards:

- All collection queries must use `user_id` and `status`.
- Collection lists are limited to 5 by default.
- Exact lookup happens before fuzzy lookup.
- Fuzzy lookup is limited and only runs after exact lookup misses.
- Pending actions use unique idempotency keys.
- NFT collection/mint rows use `pending_action_id` unique indexes to prevent
  duplicate rows on retries.
- Queue handoff is atomic in SQL.
- Wallet resource serialization remains in the queue layer.

Operational safeguards:

- Deploy behind an env flag first:
  - `LINKR_NFT_PENDING_CONFIRMATION_ENABLED=false` by default.
- When disabled, keep current NFT execution behavior only if needed for
  compatibility.
- Enable for internal/test users first if rollout controls exist.
- Monitor queue failures, dead letters, duplicate pending action counts, and
  Postgres query timings.

## Testing Plan

### Unit tests

Add or update tests for:

- `linkr_capabilities.ts`
  - NFT capability fact includes collection-first Solana rule.
  - Robinhood NFT unsupported fact is present.
- `x_ai_intake.ts`
  - "how can I launch an NFT?" routes to reply lane.
  - "launch this NFT" routes to executable/legacy path.
  - "can I launch an NFT on Robinhood?" can be answered as a capability
    question.
- `x_nft_command.ts` or new `x_nft_intent.ts`
  - "launch this nft" returns executable NFT intent with missing chain.
  - "launch this nft on solana" returns Solana mint intent.
  - "launch this nft on robinhood" returns Robinhood NFT intent with unsupported
    chain.
  - "create an nft collection called Foo" returns collection intent.
  - "how do I launch an nft" does not return an executable intent.

### Worker tests

Add tests for `worker-command-prepare` behavior if the repo's test harness
supports it:

- No collection:
  - User says "launch this NFT on Solana".
  - Worker asks user to create a collection first.
  - No NFT work item is enqueued.
- One collection:
  - Worker creates `nft_mint` pending action.
  - Reply mentions the collection name.
  - No NFT work item is enqueued before confirmation.
- Multiple collections:
  - Worker asks which collection.
  - Draft remains awaiting clarification.
- Robinhood:
  - Worker replies unsupported/not wired.
  - No pending action and no work item.
- Confirmation:
  - `confirm nft` calls `confirm_linkr_nft_action_v1`.
  - NFT work item is enqueued once.
  - Duplicate confirmation returns duplicate without adding a second work item.
- Cancellation:
  - `cancel nft` cancels only the NFT pending action.

### SQL tests

Test the new RPC/migration behavior:

- `confirm_linkr_nft_action_v1` rejects missing pending action.
- It rejects non-pending status except idempotent confirmed/executing/executed.
- It expires stale pending actions.
- It rejects wrong confirmation work item user.
- It enqueues one `nft_solana` work item per pending action.
- It preserves wallet resource serialization.
- The `pending_action_id` unique indexes prevent duplicate NFT rows.

### Runtime checks

Before deploy:

```powershell
deno test --allow-env --allow-net --allow-read supabase/functions/_shared/*nft*test.ts
deno test --allow-env --allow-net --allow-read supabase/functions/_shared/x_ai_intake_test.ts
supabase functions deploy worker-command-prepare
supabase functions deploy worker-nft-solana
```

Adjust exact commands to match the repo's existing script names.

## Rollout Plan

1. Add prompt facts only.
   - Update `linkr_capabilities.ts`.
   - Add tests proving how-to NFT questions remain conversational.
   - Deploy reply-related functions.

2. Add the structured NFT intent layer.
   - Keep backward-compatible parser exports.
   - Add tests for NFT intent extraction and draft continuation.
   - Do not switch execution yet.

3. Add database migration.
   - Add `pending_action_id` columns.
   - Add collection lookup indexes.
   - Add `confirm_linkr_nft_action_v1` or `enqueue_linkr_nft_solana_v2`.
   - Apply migration to staging first.

4. Add pending-action flow behind a flag.
   - Update `worker-command-prepare`.
   - Create pending actions instead of direct-enqueueing new NFT requests when
     the flag is enabled.
   - Preserve old direct enqueue for old queue payloads and emergency rollback.

5. Update NFT worker execution fence.
   - Validate pending action before executing v2 payloads.
   - Mark pending action statuses through `executing`, `executed`, or `failed`.
   - Preserve v1 payload support until existing queue items drain.

6. Staged deployment.
   - Deploy migrations.
   - Deploy `worker-nft-solana`.
   - Deploy `worker-command-prepare`.
   - Deploy reply/intake-related functions.
   - Keep the flag disabled.

7. Controlled enablement.
   - Enable the flag for internal/test users if rollout targeting exists.
   - Run manual X-thread tests:
     - how-to question
     - chain clarification
     - Robinhood unsupported
     - no collection
     - one collection and confirmation
     - cancellation
   - Monitor logs and queue metrics.

8. Full enablement.
   - Enable globally after test threads pass and no queue/Postgres anomalies
     appear.
   - Keep the old v1 queue path for at least one deployment cycle.
   - Remove or retire v1 only after all queued v1 items are gone and logs are
     clean.

## File-By-File Implementation Checklist

- `supabase/functions/_shared/linkr_capabilities.ts`
  - Add NFT capability facts.
- `supabase/functions/_shared/x_ai_intake.ts`
  - Keep how-to NFT requests in public reply lane.
  - Add a minimal prompt rail only if capability facts are insufficient.
- `supabase/functions/_shared/x_nft_command.ts`
  - Extend action wording to include launch/drop/mint.
  - Keep existing command parser compatibility.
- `supabase/functions/_shared/x_nft_intent.ts`
  - Add structured NFT intent and draft-continuation helpers.
- `supabase/functions/_shared/x_nft_execute.ts`
  - Accept optional `pendingActionId`.
  - Use pending-action idempotency for NFT rows.
- `supabase/functions/worker-command-prepare/index.ts`
  - Replace direct NFT queueing with draft/pending/confirmation flow.
  - Add NFT confirmation and cancellation handling.
- `supabase/functions/worker-nft-solana/index.ts`
  - Validate pending action for v2 payloads.
  - Update pending action status around execution.
  - Keep v1 compatibility.
- `supabase/migrations/<timestamp>_nft_pending_action_flow.sql`
  - Add indexes, pending references, and confirmation/queue RPC.
- Tests
  - Add prompt, intent, worker, and SQL coverage listed above.

## Acceptance Criteria

The change is complete when:

- "How can I launch an NFT?" gets a natural guidance reply.
- The guidance mentions Solana collection-first behavior.
- Asking to launch a single NFT without a chain asks Robinhood or Solana.
- Robinhood NFT requests are clearly declined as not wired yet.
- Solana NFT mint requests check confirmed collections with bounded indexed
  queries.
- No confirmed collection means the bot asks to create a collection first.
- One confirmed collection means the bot asks to mint into that named
  collection.
- Multiple confirmed collections means the bot asks the user to choose.
- No NFT mint or collection mint is enqueued before explicit confirmation.
- Confirmation enqueues exactly one NFT work item.
- Duplicate confirmation does not enqueue duplicate work.
- Worker retries do not duplicate NFT collection/mint rows.
- Existing token launch confirmation behavior is unchanged.
- Existing direct NFT worker payloads continue to drain safely during rollout.
- CPU-heavy Solana NFT code remains isolated in `worker-nft-solana`.
- Collection lookup queries are bounded and index-backed.

## Preferred Final Architecture

The clean final architecture is:

```text
X tweet/reply
  -> x_ai_intake
     -> reply lane for NFT how-to/capability questions
     -> command lane for executable NFT requests
  -> worker-command-prepare
     -> structured NFT intent
     -> draft clarification when chain/collection/image/details are missing
     -> linkr_pending_actions when ready
     -> confirmation/cancellation handling
  -> confirm_linkr_nft_action_v1
     -> atomic pending-action confirmation
     -> wallet/user resource serialization
     -> nft_solana work item enqueue
  -> worker-nft-solana
     -> pending-action validation
     -> bounded media resolution
     -> dynamic Solana NFT mint import
     -> collection/mint row idempotency
     -> reply + status finalization
```

This keeps the user experience intelligent and conversational while keeping
execution deterministic, confirmed, idempotent, and isolated from high-traffic
prompt/prepare paths.
