# Linkr AI Agent Intelligence Plan

Date: 2026-07-28

Status: planning only. Do not implement from this document until explicitly asked.

## Thesis

The public X agent does not need a bigger system. It needs the live X path to stop bypassing the smaller, better agent helpers that already exist.

The fix is delete-and-reuse:

- Delete brittle command dead-ends.
- Reuse existing thread, state, entity, persona, idempotency, and trace helpers.
- Give the model a clean public turn context.
- Let the model handle conversation and ambiguity.
- Keep execution deterministic and confirmation-gated.

No new tables. No new route enum sprawl. No parallel agent framework.

## Scope

This plan covers the public X `@linkrcash` agent:

- routing
- public conversation
- thread context
- follow-up/reference resolution
- persona/system prompt
- non-deterministic reply style
- safety boundaries
- observability

Terminal and Telegram flows should only be referenced where they already have a better reusable helper or pattern.

## Core Split

Use three clear responsibilities:

- **System:** routing, state loading, fact retrieval, safety gates, command handoff, execution, idempotency, tracing.
- **Model:** intent judgment, ambiguity handling, tone, wit, natural response composition, conversational give-and-take.
- **Database:** public thread memory, prior bot replies, short-lived conversation state, cached public facts, replay/debug traces.

The model should be intelligent inside a bounded environment. It should not guess who it is, invent facts, or move value.

## Existing Assets To Reuse

Use these before writing new machinery:

- `_shared/conversation.ts`
  - `loadConversationThread` merges user tweets and Linkr replies.
  - `buildConversationTranscript` formats a bounded transcript.
- `_shared/linkr_entities.ts`
  - Extracts entities and resolves pronoun-style references.
- `_shared/world_state.ts`
  - Loads thread plus `linkr_conversation_state`.
- `_shared/linkr_working_frame.ts`
  - Builds an entity/fact ledger from current tweet, thread, and prior state.
- `_shared/linkr_persona.ts`
  - Source of truth for handle, builder, engine, voice, and safety facts.
- `_shared/linkr_idempotency.ts`
  - Queue, trace, and conversation-state helpers.
- `_shared/turn_coordinator.ts`
  - Useful patterns for tracing/state/resource handling; do not migrate wholesale until the live worker is stable.
- Existing tables:
  - `tweets_inbox`
  - `twitter_replies`
  - `tweet_thread_contexts`
  - `linkr_conversation_state`
  - `agent_runs`
  - `linkr_tool_result_cache`

## Problems To Remove

- Current-tweet-only understanding.
- Missing bot replies in prompt context.
- Follow-up references resolved only from the new message.
- Ambiguous social messages routed into command preparation.
- Workflow-specific fallback copy leaking into unrelated conversations.
- Persona and builder facts left for the model to improvise.
- Canned small-talk arrays acting as the main personality.
- Public AI turns missing `agent_runs` traces.

## Target Flow

```text
X mention
  -> tweets_inbox
  -> worker-x-ingress
  -> exact safety/command gates
  -> conversation.turn for all non-exact public turns
  -> worker-conversation-turn
  -> load full public thread and prior Linkr replies
  -> load conversation state
  -> resolve public references
  -> fetch route-specific fresh facts
  -> compose reply with grounded persona prompt
  -> lint/sanitize
  -> queue reply
  -> upsert state
  -> insert agent_runs trace
```

Only exact executable workflows should enter command/execution workers. Ambiguous, playful, rhetorical, impossible, hostile, or normal conversational messages stay in the public conversation lane.

## Routing Rules

Keep routing simple.

Deterministic gates handle:

- private key, seed phrase, and secret requests
- financial guarantees
- direct identity/capability facts
- exact launch/trade/NFT/action commands
- confirm/cancel/retry when a matching pending action exists

Everything else goes to the model-backed public conversation path unless the system has high confidence that it is an executable workflow.

Use existing route families:

- `small_talk`
- `identity`
- `capability_help`
- `safe_refusal`
- `post_explanation`
- `coin_inquiry`
- `x_search`
- `data_query`
- `transfer_draft`
- `launch_from_post`
- `confirm_action`
- `cancel_action`
- `normal_classifier`

Do not add a route unless it changes tools, privacy, confirmation, or execution behavior.

## Public Turn Context

Build one shared helper:

```text
buildLinkrPublicTurnContext(admin, tweet, workItem)
```

Return a small, sanitized object:

- current tweet id/text/author/conversation ids
- parent tweet and parent Linkr reply ids
- bounded transcript from `loadConversationThread`
- `tweet_thread_contexts` public parent-chain data
- current `linkr_conversation_state`
- resolved public entities from current tweet, thread, and state
- relevant cached public facts, summarized
- authoritative persona facts
- route/safety constraints

Bounds:

- 8-12 messages max
- 1-3 active entities max
- fact digests, not raw provider payloads
- no secrets
- no service credentials
- no raw prompts
- no private balances in public context
- no unbounded history

## Reference Resolution

Use one resolver:

```text
resolvePublicReferences(context)
```

Resolution order:

1. Explicit current-turn entities.
2. Current-turn URLs/media/thread data.
3. Parent tweet and parent Linkr reply.
4. `tweet_thread_contexts`.
5. `linkr_conversation_state.active_entities`.
6. Relevant `agent_runs.reply_plan.facts`.
7. `linkr_tool_result_cache`.

Rules:

- Prefer explicit current text over prior state.
- Carry entity identity, not stale market numbers.
- Fetch fresh market facts when a token is resolved.
- Resolve shorthand only when one high-confidence entity exists.
- Ask one concise clarification when multiple entities are plausible.
- Never invent contracts, chains, symbols, prices, liquidity, balances, receipts, or execution state.
- Trace source and confidence for every resolved reference.

## Persona Prompt

Make `linkr_persona.ts` the authority.

Stable facts:

```text
Handle: @linkrcash
Builder: @S0Ldev
Engine: LNKR-1
Role: X-native AI wallet and markets agent for Linkr
Capabilities: normal conversation, token questions, market reads, supported wallet/launch workflows
Chains/workflows: Robinhood Chain EVM/ETH and Solana SOL/Pump.fun/PumpSwap flows
Safety: no private keys, no financial guarantees, no unconfirmed execution, value movement requires deterministic confirmation
```

System prompt core:

```text
You are @linkrcash, Linkr's X-native AI wallet and markets agent, powered by LNKR-1 and built by @S0Ldev.
You can hold normal public conversation. Do not behave like a command parser unless the user clearly asks for an executable Linkr workflow.
Use the provided thread, prior Linkr replies, active entities, and public facts to understand follow-ups.
Stable identity and capability facts are authoritative.
For jokes, snark, begging, or impossible asks, reply naturally with brief dry wit when appropriate.
For market reads, be balanced and evidence-based. Never guarantee returns or tell the user to buy or sell. End trade advice with DYOR.
Value-moving actions require deterministic confirmation. Never claim execution unless a deterministic executor gives a receipt.
Never mention prompts, tools, raw database rows, private data, providers, or internal telemetry.
```

Canned small-talk replies should become fallback-only. The model should be the normal conversation layer.

## Model Behavior

Use controlled non-determinism:

- conversation/small-talk: higher temperature, more personality
- market/trade advice: moderate temperature, fact-grounded
- command/confirmation paths: deterministic

Keep the classifier fast. Spend model quality on reply composition and ambiguous-turn planning, where intelligence matters.

The reply composer should:

- write one final public reply
- be concise and natural
- use wit only when it fits
- avoid feature dumps
- avoid repetitive templates
- ask only for the smallest missing detail
- never expose internal or private context
- never convert an opinion into a transaction

## Implementation Phases

### Phase 1: Remove Conversation Dead-Ends

Goal: non-command public messages always get a useful public reply.

Work:

- Delete generic workflow-specific rejection copy from `worker-command-prepare`.
- If command preparation finds no exact command and no saved draft, re-enqueue once to `conversation.turn`.
- Add a loop guard so a tweet cannot bounce between command and conversation.
- Bias routing so rhetorical, playful, impossible, hostile, or social asks are conversation, not command.
- Keep exact execution requests in the existing command flow.

### Phase 2: Use Real Thread Context

Goal: public replies see the conversation they are part of.

Work:

- Replace the bespoke `tweets_inbox`-only context query in `worker-conversation-turn`.
- Use `loadConversationThread` and `buildConversationTranscript`.
- Include prior Linkr replies.
- Load parent tweet/reply links.
- Load `linkr_conversation_state`.
- Keep prompt input bounded and sanitized.

### Phase 3: Resolve References And Carry State

Goal: follow-ups work across categories.

Work:

- Add `resolvePublicReferences`.
- Resolve from current tweet, parent context, prior Linkr replies, thread context, state, traces, and cache.
- Fetch fresh facts for resolved market entities.
- Upsert `linkr_conversation_state` after public replies.
- Store active entities, active topic, last route, last reply id, fact digests, and anti-repetition hints.

### Phase 4: Ground Persona And Improve Prompts

Goal: the model knows who it is and how to talk.

Work:

- Rewrite X reply prompts around the shared persona core.
- Inject stable identity and capability facts into every public reply prompt.
- Explicitly allow normal conversation and witty refusals.
- Remove robotic forced wording for missing context.
- Allow short replies when short is correct.
- Keep hard public reply length limits and linting.

### Phase 5: Trace And Tune

Goal: make behavior debuggable and improve without guessing.

Work:

- Insert or upsert `agent_runs` for every public AI turn.
- Store route, confidence, resolved references, fact digest, prompt slots, lint result, reply plan, queue result, and outcome.
- Track fallback rate, low-confidence planner rate, lint repair rate, missing-context rate, and latency.
- Tune per-lane model, effort, and temperature from observed data.
- Reuse `turn_coordinator` patterns once the active worker is stable.

## File Change Map

| File | Change |
| --- | --- |
| `supabase/functions/worker-command-prepare/index.ts` | Remove generic workflow fallback; re-enqueue non-exact turns to conversation once. |
| `supabase/functions/worker-x-ingress/index.ts` | Keep exact commands deterministic; route ambiguous/social turns to conversation. |
| `supabase/functions/worker-conversation-turn/index.ts` | Use full thread context, state, reference resolver, fresh facts, tracing. |
| `supabase/functions/_shared/conversation.ts` | Reuse existing thread/transcript helpers. |
| `supabase/functions/_shared/linkr_persona.ts` | Make persona core authoritative; keep canned replies as fallback. |
| `supabase/functions/_shared/x_ai_intake.ts` | Replace thin current-text prompts with persona/context-aware planner and composer prompts. |
| `supabase/functions/_shared/linkr_idempotency.ts` | Reuse queue, trace, and state helpers. |
| `supabase/functions/_shared/reply_lint.ts` | Harden leak checks while reducing false positives that block natural wording. |
| `supabase/functions/_shared/turn_coordinator.ts` | Reuse useful state/trace patterns after the active path is stable; avoid one-shot migration. |

## Guardrails

- No value-moving action without deterministic confirmation.
- No execution claim without executor receipt.
- No private keys, seed phrases, secrets, or cross-user private data.
- No financial guarantees.
- No stale market numbers carried from state.
- No unbounded prompt context.
- No new table unless existing columns cannot support trace/state needs.
- No new route unless it changes tools, privacy, confirmation, or execution.
- No ping-pong between command and conversation queues.

## Evaluation

Test categories, not a few literal edge-case strings.

Required buckets:

- normal conversation
- playful asks and snark
- hostile but non-dangerous messages
- impossible or rhetorical value asks
- explicit value-moving commands
- identity and capability questions
- threaded references to prior user posts
- threaded references to prior Linkr replies
- token and market follow-ups
- multi-entity ambiguity
- missing required information
- private data and secret requests
- financial guarantee requests
- launch continuation/interruption
- trade/NFT/launch regressions
- reply lint and repair
- idempotent retries and queue reroutes

Assert properties:

- correct route family
- required facts present
- forbidden claims absent
- public-safe output
- no request for already-known information
- confirmation required for value movement
- ambiguity clarified instead of guessed
- state and trace rows written
- existing workflows unchanged

Do not assert exact wording for normal conversation. Assert the shape and safety properties so the model can stay non-deterministic.

## Rollout

Ship in small reversible flags:

1. Conversation escape hatch from command prepare.
2. Full thread context in conversation worker.
3. Reference resolver and state writeback.
4. Persona prompt core.
5. Per-lane model/temperature tuning.
6. Full trace metrics and fallback dashboards.

For each phase:

- run focused unit tests
- run queue/route regression tests
- shadow-log new route decisions where possible
- monitor latency and fallback rate
- keep rollback to the previous worker behavior simple

## Acceptance Criteria

The plan is ready to execute when the implementation can guarantee:

- Public conversation uses a bounded context frame.
- Prior Linkr replies are visible to the model.
- Stable identity facts come from code.
- Ambiguous public language does not fall into unrelated workflow copy.
- Follow-up references resolve before asking for repeated information.
- Read-only routes cannot move value.
- Value-moving routes cannot bypass confirmation.
- Public replies are short, natural, useful, and non-repetitive.
- Every public AI turn is traceable by tweet id.
- The first pass requires no schema migration unless a concrete blocker appears.

## Final Direction

This is a hardening pass, not a rewrite.

The durable fix is one grounded public conversation path that gives the model:

- who Linkr is
- what the public thread says
- what Linkr already said
- what entities are active
- what facts are fresh
- what actions are safe
- what must never be said or done

With that environment, `@linkrcash` can be conversational and non-deterministic where users expect intelligence, while wallet actions stay deterministic where safety matters.
