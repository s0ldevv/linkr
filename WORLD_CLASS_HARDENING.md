You previously helped me build this application as a complete multi-surface agent that operates through:

* X/Twitter through `@linkrcash`
* The terminal/chat page in the user dashboard
* Telegram
* The Agent API
* The dashboard’s dedicated action pages

The application already supports token launches, NFT launches, NFT collection launches, transfers, swaps, creator-reward claims, scheduling, and other Solana and Robinhood Chain operations.

Your task is to inspect the complete existing project and upgrade it into a genuinely production-grade, world-class system. Do not rebuild it into an unrelated architecture, remove working functionality, or change the intended user experience. The application should continue doing everything it currently does, but the underlying implementation must become substantially cleaner, faster, safer, more cohesive, more reliable, and easier to maintain.

This is an implementation task, not merely an architecture review. Inspect the actual source code, database schema, migrations, Supabase Edge Functions, queues, cron jobs, frontend logic, X integration, Telegram integration, AI-processing logic, Agent API, and administrative controls. Make the required changes and return the complete upgraded project in a deployable ZIP archive.

## Primary objective

The entire system must operate cohesively, intentionally, and extremely efficiently.

The final implementation must be:

* Production-ready
* Backward-compatible wherever reasonably possible
* Simple and understandable
* Logically organized
* Efficient under load
* Safe against duplicate execution
* Resistant to PostgreSQL overload
* Resistant to Edge Function CPU and timeout limits
* Reliable during traffic spikes and temporary provider failures
* Easy to deploy over the current database and frontend
* Fully functional without mock implementations
* Built using proven patterns rather than unnecessary complexity
* Observable, testable, and maintainable

Do not over-engineer the application. What the platform needs to accomplish is substantial, but the underlying flow should still be simple and logical. Every function, table, query, queue operation, AI call, and network request must have a clear purpose.

Quality is more important than speed. Perform the work with extreme rigor and attention to detail.

# Required execution order

Work through the following stages in order. Do not patch isolated symptoms without first understanding the complete request lifecycle.

## Phase 1: Audit the complete system

Begin by tracing every major request from ingestion to completion across all supported surfaces:

1. X/Twitter
2. Telegram
3. Dashboard terminal
4. Dashboard action pages
5. Scheduler page
6. Agent API
7. Administrative panel at `/secretpanel`

Audit:

* Supabase Edge Functions
* Database tables, indexes, triggers, functions, and RLS policies
* Frontend queries and subscriptions
* Authentication and account linking
* X webhook, polling, mention detection, and reply handling
* Telegram ingestion and identity linking
* AI intent parsing
* Action validation
* Balance checking
* Wallet management
* Solana transaction construction and confirmation
* Robinhood Chain transaction construction and confirmation
* Token and NFT launch flows
* Creator-reward claims
* Transfers
* Scheduling and recurring execution
* Queuing, retries, and failure recovery
* Admin configuration
* Logging and observability

Identify:

* Duplicate logic
* Large or overloaded Edge Functions
* Unnecessary AI calls
* Unnecessary database writes
* Repeated database queries
* N+1 queries
* Unbounded table scans
* Excessive polling
* Missing indexes
* Race conditions
* Non-atomic operations
* Weak idempotency
* Requests that can execute more than once
* Requests that remain permanently pending
* Functions that perform too many unrelated responsibilities
* Places where banned or ineligible users are checked too late
* Places where balances are checked too late
* Places where frontend code causes excessive PostgreSQL activity
* Robinhood functionality that is incomplete or inconsistent with Solana
* Scheduling paths that create records but do not reliably execute them
* Configuration that incorrectly depends on deployment secrets

Use this audit to guide the implementation. Do not preserve a poor pattern merely because the existing project uses it.

## Phase 2: Simplify and organize the architecture

Refactor the backend into clear, bounded responsibilities.

Split oversized Edge Functions when doing so improves:

* Reliability
* CPU usage
* Testability
* Retry behavior
* Security
* Maintainability
* Deployment isolation

However, do not split functions arbitrarily. Each service or function should have a clear responsibility.

The preferred request lifecycle should resemble:

1. Receive the external event.
2. Normalize the event into a shared internal format.
3. Reject banned, gated, duplicated, malformed, or unsupported requests immediately.
4. Store only the minimal required ingestion record.
5. Resolve the user and wallet.
6. Parse the user’s intent.
7. Validate the structured intent.
8. Perform an early balance and eligibility preflight.
9. Create an idempotent execution job.
10. Execute through the appropriate chain adapter.
11. Confirm the result.
12. Persist the final state.
13. Notify the user through the originating surface.
14. Retry safely or dead-letter the request when necessary.

X, Telegram, the dashboard terminal, dashboard forms, and the Agent API should share the same underlying action-processing services. Avoid maintaining separate business logic for each surface.

Create reusable internal modules for concerns such as:

* User eligibility
* Ban enforcement
* Funding policies
* Balance preflight
* AI intent parsing
* Action validation
* Idempotency
* Queue insertion
* Execution
* Transaction confirmation
* Notification
* Scheduling
* Token metadata
* Solana adapters
* Robinhood Chain adapters

Do not duplicate chain-independent logic between Solana and Robinhood Chain.

## Phase 3: Replace secret-based behavior with database-backed administration

Operational settings must not depend on Edge Function secrets being manually set to `true` or `false`.

Create or improve a database-backed configuration system that can be managed through `/secretpanel`.

Use a properly secured administrative settings table with typed settings, validation, defaults, timestamps, and auditability.

At minimum, `/secretpanel` must support the following controls.

### Launch-funding policy

Provide clear funding modes such as:

* Funding disabled
* Fund only the user’s first eligible launch
* Fund every eligible user launch

The backend must read this policy from the database rather than from an Edge Function secret.

Administrative changes should take effect safely without requiring a redeployment.

### User-gating policy

Provide configurable controls for:

* Banning individual users
* Minimum follower count
* Minimum following count, when enabled
* Minimum total post count
* Enabling or disabling each threshold independently
* Any existing gating rules already supported by the application

The values must be editable from `/secretpanel` and fully wired to the backend.

### Metadata testing policy

Provide an administrative setting that controls whether testing metadata overrides are enabled.

When test mode is enabled, the existing testing values may be used intentionally.

When test mode is disabled, token launches must use their real metadata. The production flow must never silently fall back to `https://google.com`.

All administrative settings must be:

* Validated
* Properly authorized
* Cached only when safe
* Refreshed reliably
* Auditable
* Protected from normal users
* Accompanied by sensible defaults

## Phase 4: Enforce bans and gating at the earliest possible point

Banned and ineligible users must be rejected before the system spends unnecessary resources on them.

For X requests, perform the ban and gating check immediately after receiving the minimum information needed to identify the X user. Whenever possible, reject the request before:

* Inserting the tweet into normal processing tables
* Calling an AI model
* Downloading media
* Generating token artwork
* Generating metadata
* Resolving wallets
* Performing chain queries
* Creating pending launches
* Creating queue jobs

A banned user must have no meaningful access to the platform.

Ban enforcement must cover:

* X/Twitter requests and replies
* Dashboard authentication
* Existing dashboard sessions
* Dashboard terminal usage
* Dashboard forms and actions
* Telegram usage
* Telegram-to-X identity linking
* Agent API usage
* Any action invoked indirectly through a scheduled job

The canonical ban should be associated with the user’s X/Twitter user ID rather than only their username, because usernames can change.

When applicable, also associate and block linked internal user IDs, Telegram identities, API credentials, and active sessions.

Banned users must:

* Receive no normal X response
* Be unable to execute Telegram commands
* Be unable to log in using the banned X identity
* Be unable to access protected dashboard functionality
* Be unable to bypass enforcement through another frontend route
* Be unable to continue executing previously created recurring schedules

Gating rules such as minimum followers, following, and post count must also be evaluated as early as reasonably possible.

Avoid repeatedly fetching the same X profile information for every stage. Store an appropriate short-lived eligibility snapshot or cache, with a clear refresh policy.

## Phase 5: Correct first-launch funding and balance preflight logic

The system must never waste AI, image-generation, database, or blockchain resources on requests that cannot be executed because the user lacks sufficient funds.

For every financial action, determine the estimated required balance as early as possible.

This includes:

* Token launches
* NFT launches
* NFT collection launches
* Buys
* Sells when network fees are required
* Transfers
* Liquidity additions
* Liquidity removals
* Creator-reward claims
* Scheduled actions
* Any Robinhood Chain action
* Any Solana action

The balance preflight should account for the relevant combination of:

* Requested transaction value
* Network fees
* Rent or account-creation costs
* Platform fees
* Slippage buffers where appropriate
* Token-account creation
* Launch costs
* Liquidity requirements
* Any chain-specific costs

Perform this preflight before:

* Calling the AI for optional creative generation
* Generating artwork
* Uploading metadata
* Creating a pending launch that cannot proceed
* Performing expensive provider calls

Do not create unusable pending records unless there is a clear product reason for doing so.

### First-launch funding guarantees

The first-launch funding system must guarantee that each eligible user can only receive first-launch funding once.

Do not rely on a simple application-level check that can race under concurrent requests.

Use database-enforced guarantees such as:

* Atomic transactions
* Unique constraints
* A funding ledger
* Idempotency keys
* Explicit funding states
* Transaction signatures
* Reconciliation states

The funding flow must safely handle:

* Two launch requests arriving simultaneously
* A funding transaction being submitted but confirmation timing out
* The Edge Function crashing after sending funds
* A provider returning an ambiguous result
* A retry occurring after funds were already sent
* A user changing their X username
* A launch failing after funding
* An administrator changing the funding mode during processing

The funding ledger should make it possible to determine:

* Why funding was issued
* Which policy authorized it
* Which user received it
* Which wallet received it
* Which launch or request it was associated with
* The amount
* The transaction signature
* The current reconciliation status
* Whether the funding can be retried
* Whether the user has already consumed first-launch funding

The “fund every launch” mode must also be implemented safely and intentionally. It must not weaken idempotency or permit duplicate funding for the same launch request.

## Phase 6: Build a proper request queue and execution pipeline

The application must handle request backlogs smoothly without overwhelming Supabase, PostgreSQL, RPC providers, CometAPI, or Edge Function CPU limits.

Implement or improve a proper database-backed queuing system appropriate for the existing stack.

The queue must support:

* Idempotent job creation
* Deduplication
* Atomic job claiming
* Worker leases
* Lease expiration and recovery
* Controlled concurrency
* Priority levels
* Retry counts
* Exponential backoff
* Retryable versus terminal errors
* Dead-letter handling
* Scheduled execution times
* Heartbeats when necessary
* Timeout recovery
* Job cancellation
* Clear status transitions
* Execution history
* Parent-child job relationships when useful

Do not allow multiple workers to execute the same financial action.

Every external event should have a stable source identifier, such as:

* X post ID
* Telegram update ID
* Dashboard request ID
* API idempotency key
* Schedule occurrence ID

Use these identifiers to prevent duplicated processing.

Financial actions must also have an execution-level idempotency key so that retries cannot create a duplicate transfer, launch, swap, funding payment, liquidity action, or creator-reward claim.

Queue workers should claim a small, controlled number of jobs and avoid large scans.

Add appropriate indexes for:

* Status
* Scheduled execution time
* Priority
* Lease expiration
* User ID
* Source event ID
* Idempotency key
* Schedule ID

Do not use aggressive high-frequency polling that repeatedly scans large tables.

The system should process requests as soon as they are detected while still protecting the database and external providers.

## Phase 7: Improve AI intelligence using GPT-5 Mini through CometAPI

Use `gpt-5-mini` through CometAPI. Do not use `gpt-5-nano`.

The model should be used intelligently and economically. Do not call it when a request can be handled without AI, but do not replace natural-language understanding with brittle keyword extraction.

The AI layer must understand the complete user request semantically.

For example:

> “hey @linkrcash launch a coin called testing ticker also test on Solana”

The correct interpretation should be approximately:

* Action: launch token
* Chain: Solana
* Token name: Testing
* Ticker: TEST

It must not incorrectly choose `$ALSO` merely because the word appears near “ticker.”

Replace simplistic token-position logic, fragile regular expressions, or deterministic “word after keyword” parsing with a proper intent-extraction process.

Use the AI for semantic interpretation, then validate its result using strict schemas and business rules.

The model should return structured, validated data representing:

* Intent
* Action type
* Chain
* Token or collection name
* Ticker
* Contract or mint address
* Amount
* Asset
* Recipient
* Metadata
* Schedule type
* Schedule frequency
* Start time
* End condition
* Market-cap condition
* Price condition
* Slippage
* Confidence
* Missing required information
* Whether clarification is necessary

Use strict structured outputs or tool-style schemas wherever supported by the CometAPI integration.

The AI layer must distinguish between:

* Words that are part of a token name
* Words that describe the requested ticker
* Filler words
* Chain names
* Timing instructions
* Recurrence instructions
* Conditions
* Addresses
* Amounts
* Action verbs
* References to a quoted or replied-to token

Do not allow the model to invent:

* Wallet addresses
* Token addresses
* Transaction amounts
* Recipients
* Chains
* Unsupported actions
* Metadata the user did not request
* Critical financial parameters

When a financially important request is genuinely ambiguous, request clarification rather than guessing.

The overall design should be AI-assisted but not AI-dependent for basic execution safety. The AI interprets intent; validated backend code decides whether and how the action may execute.

Make the most of `gpt-5-mini` by improving:

* System instructions
* Structured schemas
* Context construction
* Examples
* Validation
* Error correction
* Retry prompts
* Token usage
* Model invocation only when required

## Phase 8: Correct token-launch and metadata behavior

Review the complete token-launch pipeline for both Solana and Robinhood Chain.

Preserve all existing supported launch features while simplifying and hardening the flow.

### Production metadata

When testing metadata overrides are disabled, launches must use actual metadata.

When the user does not provide a website, default to:

`https://linkr.cash/coin/<token-mint>`

When the request originated on X and the user does not provide a Twitter/X URL, set the Twitter field to the URL of the original X post in which the user asked `@linkrcash` to launch the token.

Use the actual token mint in the Linkr coin URL. Handle this correctly based on the launch mechanism, whether that requires:

* Precomputing the mint address
* Creating the mint first
* Updating metadata after mint creation when supported
* Using another protocol-appropriate sequence

Do not use fake values in production.

Review the handling of:

* Website
* Twitter/X
* Telegram
* Description
* Token name
* Ticker
* Image
* Chain
* Creator
* Launch source
* Original request URL

User-provided metadata should take precedence when it is valid.

Defaults should only fill fields the user did not specify.

Validate URLs and prevent invalid, unsafe, or malformed metadata.

### Testing metadata

The current testing behavior that sets the website to `https://google.com` and uses configured Twitter and Telegram URLs must be controlled from `/secretpanel`.

The override must be:

* Explicit
* Clearly labelled as testing behavior
* Disabled safely for production
* Read from the database
* Applied consistently across all relevant launch paths

## Phase 9: Bring Robinhood Chain functionality to production parity

Most Solana operations are already wired more completely than the Robinhood Chain portions.

Inspect every Robinhood-related flow and complete it properly.

Create a consistent chain-adapter interface where practical so that shared actions can use the same orchestration while retaining chain-specific execution.

Review and complete:

* Token launches
* Token metadata
* Buys
* Sells
* Transfers
* Creator-reward claims
* Adding liquidity
* Removing liquidity
* Transaction confirmation
* Fee estimation
* Balance checks
* Error classification
* Retry behavior
* Explorer links
* Scheduling
* Notifications
* Execution history
* Dashboard display
* Agent API support

Do not claim Robinhood support for an action unless that action is actually wired and tested end to end.

Where Pump.fun and the Robinhood token contracts behave differently, use explicit chain-specific adapters rather than forcing both through incorrect shared assumptions.

## Phase 10: Optimize dashboard transfers and frontend behavior

Review transfers initiated from the dashboard.

Transfers must be:

* Fast
* Validated
* Idempotent
* Responsive
* Safe against duplicate clicks
* Clear about pending, submitted, confirmed, and failed states
* Protected from stale balances
* Protected from invalid recipients
* Protected from unsupported assets or chains
* Properly reconciled after ambiguous provider errors

Do not let the frontend directly orchestrate complex financial workflows through many unrelated database calls.

The frontend should submit a validated request to a clear backend endpoint or service and then observe its state.

Audit all frontend data access for:

* Excessive polling
* Repeated full-table queries
* Unbounded subscriptions
* N+1 requests
* Queries missing pagination
* Queries missing indexes
* Duplicate submissions
* Stale cache behavior
* Poor loading and error states

The frontend and backend must not cause unnecessary PostgreSQL load.

## Phase 11: Rebuild the scheduler into a complete execution system

The scheduler must become a first-class, reliable platform capability shared across:

* X
* Telegram
* Dashboard terminal
* Dashboard scheduler page
* Agent API

Users must be able to create, inspect, edit, pause, resume, and cancel scheduled actions.

### Supported schedule types

Support:

* One-time execution at a specific time
* Execution after a relative delay
* Fixed recurring intervals
* Daily schedules
* Weekly schedules where applicable
* Condition-based schedules
* Recurring condition-based schedules
* Schedules with an end time
* Schedules with a maximum occurrence count
* Schedules that continue until manually cancelled

Examples include:

* “Launch a coin called XYZ in 2 hours.”
* “Buy 0.01 SOL of this token every hour.”
* “Buy 0.01 SOL of AXcDHZp3KrCnRPLjWaw73z7bXeeYnP2rW1shRUYQpump every hour.”
* “Add 0.01 SOL of liquidity to AXcDHZp3KrCnRPLjWaw73z7bXeeYnP2rW1shRUYQpump every hour.”
* “Sell this token tomorrow at 5 PM.”
* “Transfer 0.1 SOL to this wallet in 30 minutes.”
* “Claim my Pump.fun creator rewards every day.”
* “Claim my Robinhood creator rewards every day.”
* “Buy this token when its market cap goes above $500,000.”
* “Sell this token when its market cap drops below $100,000.”
* “Add liquidity every 10 minutes.”
* “Remove liquidity in 3 hours.”
* “Stop buying 0.01 SOL of AXcDHZp3KrCnRPLjWaw73z7bXeeYnP2rW1shRUYQpump every minute.”
* “What do I currently have scheduled?”

### Supported scheduled actions

At minimum, scheduling must support all technically supported forms of:

* Token launches
* NFT launches
* NFT collection launches
* Buys
* Sells
* Transfers
* Pump.fun creator-reward claims
* Robinhood creator-reward claims
* Pump.fun liquidity additions
* Pump.fun liquidity removals
* Robinhood liquidity additions
* Robinhood liquidity removals
* Other existing executable platform actions where scheduling is safe

Do not implement a separate scheduler for every surface. All surfaces must create the same normalized schedule model.

### Natural-language scheduling

Use the AI to understand scheduling requests semantically rather than relying exclusively on rigid phrase templates.

The AI should translate the request into a structured schedule specification.

The backend must then validate:

* Action type
* Amount
* Token
* Chain
* Recipient
* Recurrence
* Start time
* Time zone
* End condition
* Market condition
* User permissions
* Balance requirements
* Whether the requested frequency is supported
* Whether the requested action is technically schedulable

Do not use the AI to calculate whether a job is due. Once the schedule has been parsed and stored, due-job detection and execution should be deterministic and reliable.

### One-minute and frequent schedules

Users should be able to request frequencies such as:

* Every minute
* Every 10 minutes
* Every hour
* Every day

Implement frequent schedules in a way that does not create a dedicated cron job for every user schedule and does not overload PostgreSQL.

Use a shared due-schedule dispatcher that:

* Selects only due schedules
* Uses indexes
* Claims schedules atomically
* Creates occurrence jobs idempotently
* Advances the next execution time safely
* Handles missed occurrences intentionally
* Prevents overlapping execution
* Applies controlled concurrency
* Supports cancellation immediately

Define a clear policy for missed occurrences. Do not execute an uncontrolled burst of hundreds of old occurrences after downtime.

### Conditional schedules

For conditions such as market cap above or below a threshold:

* Store the condition structurally
* Use reliable market data
* Avoid fetching the same market data separately for every schedule
* Batch or cache condition evaluations when possible
* Prevent repeated triggering while a condition remains true unless recurrence is explicitly requested
* Record the data source and observed value used to trigger execution
* Apply cooldowns when appropriate
* Handle provider outages without falsely triggering

### Balance handling for schedules

A balance check at schedule creation is helpful but not sufficient.

Every occurrence must perform a fresh preflight before execution.

When funds are insufficient:

* Do not partially execute unexpectedly
* Do not repeatedly waste resources
* Record the occurrence result
* Notify the user according to a sensible throttling policy
* Decide whether the schedule remains active, pauses, or retries based on its configuration and error type

### Schedule cancellation and modification

Users must be able to:

* List active schedules
* View schedule details
* Change frequency
* Change amount
* Change timing
* Pause a schedule
* Resume a schedule
* Cancel a schedule
* Cancel through natural language
* Cancel from the scheduler page
* Cancel through the Agent API

Cancellation must prevent future occurrences from being created and prevent unclaimed pending occurrences from executing.

Already submitted blockchain transactions cannot be falsely represented as cancelled.

### Scheduler page

The dashboard scheduler page must clearly display:

* Action
* Asset or token
* Chain
* Amount
* Recipient when applicable
* Frequency
* Conditions
* Next execution
* Last execution
* Status
* Failure state
* Created source
* X source post when applicable
* Controls to edit, pause, resume, and cancel
* Execution history

The page must reflect the actual backend state and not maintain a disconnected frontend-only representation.

### X execution replies

When a schedule was created from an X post, store the original X post ID and conversation context.

When the scheduled action executes, reply under the original X post to tell the user that the scheduled action was executed.

The execution reply should accurately describe:

* Which scheduled action ran
* Whether it succeeded or failed
* The amount and asset when appropriate
* The transaction or launch link when available
* The next execution time for recurring schedules when useful

Do not send duplicate replies for the same occurrence.

Notification failure must not cause the blockchain action to be executed again.

## Phase 12: Ensure full feature parity across all surfaces

The same underlying capabilities should be available through:

* X
* Telegram
* Dashboard terminal
* Dashboard forms
* Scheduler page
* Agent API

Each surface may present information differently, but it must use the same:

* User eligibility rules
* Ban enforcement
* Intent schema
* Validation
* Balance preflight
* Queue
* Execution services
* Scheduling engine
* Idempotency rules
* Transaction status model
* Audit history

Do not create a situation where an action works from the dashboard but silently fails from Telegram, or works from X but cannot be managed through the scheduler page.

## Phase 13: Protect PostgreSQL and Edge Function resources

The final system must not overload PostgreSQL or repeatedly hit CPU limits.

Review every high-frequency code path.

Implement appropriate:

* Indexes
* Pagination
* Query limits
* Atomic database functions
* Batched operations
* Connection-efficient patterns
* Cached configuration reads
* Cached profile and market-data reads
* Controlled worker concurrency
* Locking or leasing
* Query timeout handling
* Retention policies
* Archive or cleanup policies
* Lightweight health checks

Avoid:

* Full-table scans in cron jobs
* Repeatedly loading large JSON payloads
* Updating rows when nothing changed
* Creating unnecessary pending records
* Multiple frontend subscriptions to the same data
* Reprocessing already completed X posts
* Calling the AI multiple times for the same request
* Downloading the same media repeatedly
* Repeated balance lookups within the same execution
* A single Edge Function performing ingestion, AI processing, blockchain execution, notification, and cleanup in one invocation

Use observability that is useful but not excessively noisy.

Every request should have a correlation ID that can be followed through:

* Ingestion
* Intent parsing
* Validation
* Queueing
* Execution
* Transaction confirmation
* Notification
* Completion or failure

Do not log private keys, secrets, complete sensitive payloads, or unnecessary personal data.

## Phase 14: Database migrations and deployment compatibility

I must be able to deploy the upgraded project over my current application and database without the platform breaking.

Provide additive, ordered, production-safe migrations.

The migration strategy must account for existing:

* Users
* Linked X accounts
* Telegram accounts
* Wallets
* Token launches
* NFTs
* Schedules
* Pending requests
* Completed requests
* Administrative settings
* Funding records
* API credentials

Requirements:

* Do not destroy production data.
* Do not reset the database.
* Avoid renaming or dropping critical columns without a safe compatibility period.
* Backfill new columns when necessary.
* Add indexes safely.
* Preserve current authentication.
* Preserve current wallet associations.
* Preserve existing schedules or migrate them into the new model.
* Include defaults for all new administrative settings.
* Make migrations repeat-safe where possible.
* Document migration order.
* Document any one-time reconciliation or backfill command.
* Clearly identify any manual step that cannot safely be automated.

The frontend and backend should remain compatible throughout the deployment sequence whenever reasonably possible.

## Phase 15: Security and authorization

Review authorization across every surface.

Ensure:

* `/secretpanel` is protected by server-side authorization, not only hidden frontend routing.
* Administrative database operations cannot be performed by normal users.
* RLS policies are correct and minimal.
* Service-role usage is restricted to trusted backend contexts.
* Users cannot view or modify another user’s schedules, wallets, jobs, launches, or execution history.
* Agent API keys are scoped and revocable.
* Banned users cannot bypass controls through direct API requests.
* User-provided URLs and metadata are validated.
* Financial amounts are parsed safely.
* Private keys and signing material never reach the browser.
* Webhook requests are authenticated when the provider supports it.
* Telegram and X identities cannot be linked insecurely.
* Replayed external events cannot create duplicate actions.
* All administrative changes are audited.

## Phase 16: Testing and verification

Do not consider the work complete because the code compiles.

Add or improve tests for the critical workflows.

At minimum, verify:

### Ingestion and gating

* A valid X request enters the pipeline once.
* A duplicated X event is ignored.
* A banned X user is rejected before normal ingestion.
* A user below the configured follower threshold is rejected early.
* A user below the configured post threshold is rejected early.
* Changes in `/secretpanel` affect new requests.
* Telegram and dashboard requests enforce the same bans.

### Funding

* First-launch funding occurs once.
* Two simultaneous first launches cannot receive duplicate funding.
* A retry after transaction submission does not resend funds.
* Funding-disabled mode does not fund.
* Always-fund mode funds each unique eligible launch once.
* Funding policy changes do not corrupt in-flight requests.

### Balance preflight

* An underfunded launch fails before AI artwork or metadata generation.
* An underfunded transfer fails before transaction construction.
* A scheduled occurrence rechecks the current balance.
* Fee and rent requirements are included correctly.

### AI interpretation

Test requests including:

* “Launch a coin called testing ticker also test on Solana.”
* Requests with names containing common command words
* Requests that omit a ticker
* Requests that specify both a name and ticker
* Requests referencing a replied-to token
* Requests containing multiple amounts
* Ambiguous transfer recipients
* One-time schedules
* Recurring schedules
* Conditional schedules
* Cancellation requests
* Listing active schedules

The AI output must conform to the schema and be validated before execution.

### Metadata

* Testing override enabled
* Testing override disabled
* User-provided website
* Default Linkr coin website
* Original X post URL
* User-provided Twitter field
* Missing Telegram field
* Invalid URL rejection

### Queue and idempotency

* Worker crash after claiming
* Lease expiration
* Retryable provider failure
* Terminal validation error
* Duplicate job insertion
* Duplicate execution attempt
* Notification retry without transaction replay
* Dead-letter handling
* Backlog processing with controlled concurrency

### Scheduling

* One-time execution
* Every-minute execution
* Every-10-minute execution
* Hourly execution
* Daily execution
* Market-cap condition
* Editing frequency
* Pausing
* Resuming
* Cancellation
* Listing schedules
* Original X-thread execution reply
* No duplicate occurrences
* No duplicate X replies
* Insufficient balance
* Missed occurrence after downtime
* Concurrent scheduler workers

### Chain execution

Test supported actions on both Solana and Robinhood Chain:

* Launch
* Buy
* Sell
* Transfer
* Creator-reward claim
* Add liquidity
* Remove liquidity
* Transaction confirmation
* Failure reconciliation

Clearly identify any action that a chain or protocol does not actually support.

### Load and database behavior

Simulate a realistic burst of X requests and verify:

* No duplicate execution
* Stable queue depth processing
* Controlled AI concurrency
* Controlled RPC concurrency
* No unbounded PostgreSQL query
* No runaway cron invocation
* No excessive frontend polling
* Graceful recovery after provider failures

## Phase 17: Documentation and final delivery

Update all relevant documentation, including:

* Project architecture
* Request lifecycle
* Queue design
* Scheduler design
* Funding policy
* Gating and banning
* Administrative settings
* Token metadata behavior
* Solana support
* Robinhood Chain support
* Telegram support
* X support
* Dashboard terminal support
* Agent API
* Environment variables
* Database migrations
* Deployment order
* Rollback considerations
* Troubleshooting
* Testing instructions

Update the Agent API documentation to include:

* Creating scheduled actions
* Listing schedules
* Retrieving a schedule
* Updating a schedule
* Pausing and resuming
* Cancelling
* Viewing occurrences and execution history
* Idempotency requirements
* Supported action types
* Supported schedule types
* Status values
* Error responses
* Example requests and responses

Return:

1. The complete upgraded source code in a ZIP archive.
2. All database migrations.
3. Updated documentation.
4. A concise architecture summary.
5. A list of important problems discovered.
6. A changelog of what was modified.
7. Exact deployment steps for the existing application.
8. Any required backfill or reconciliation steps.
9. A verification checklist.
10. A list of tests performed and their results.
11. Any limitations that remain because of an external chain, protocol, API, or provider.

# Final acceptance criteria

The project is not complete unless all of the following are true:

* Existing working functionality remains intact.
* Banned users are blocked everywhere.
* Gated X users are skipped before expensive processing.
* Administrative policies are database-backed and editable through `/secretpanel`.
* First-launch funding cannot occur twice for the same user.
* Always-fund mode cannot duplicate funding for the same launch.
* Balance checks occur before expensive processing.
* X requests are queued and executed reliably.
* Financial actions are idempotent.
* PostgreSQL load is controlled.
* Edge Function CPU usage is controlled.
* GPT-5 Mini is used through CometAPI.
* GPT-5 Nano is not used.
* Natural-language requests are interpreted semantically.
* The ticker example produces `$TEST`, not `$ALSO`.
* Production token metadata no longer uses `https://google.com`.
* The default website is `https://linkr.cash/coin/<token-mint>`.
* The default X metadata points to the original launch request.
* Solana functionality remains fully operational.
* Robinhood Chain functionality is completed and verified wherever supported.
* Dashboard transfers are fast and reliable.
* Schedules actually execute rather than merely being stored.
* Recurring and conditional schedules are reliable.
* Users can list, modify, pause, resume, and cancel schedules.
* Scheduled executions can reply beneath the original X post.
* X, Telegram, dashboard terminal, scheduler page, and Agent API use the same backend capabilities.
* Migrations can be deployed over the current database safely.
* The delivered ZIP contains complete, real, deployable code.
* There are no mock functions, fake success states, disconnected UI controls, or undocumented critical steps.

Do not make superficial changes and describe the system as production-ready. Trace and verify the complete lifecycle of every critical action.

Take whatever implementation effort is required to make the system as close to perfect as reasonably possible, while keeping it clean, logical, efficient, and based on proven engineering practices.

Quality over speed.
