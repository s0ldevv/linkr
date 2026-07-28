# Linkr User Image Generation Plan

Status: bulletproof implementation blueprint  
Date: 2026-07-28  
Scope: explicit image generation from Terminal, Telegram, X, and Agent API. CLI stays excluded.

## 1. Non-Negotiable Design Rules

These rules are what keep this feature clean inside the current Linkr backend:

1. No image provider call runs inside request intake, webhooks, X ingress, or Agent API responses.
2. No image bytes or base64 are stored in Postgres or `linkr_work_items.payload`.
3. The existing launch `image_generate` stage and token-logo code stay untouched.
4. User image generation gets its own queue stage, worker, resource fence, rate limits, and edge budget.
5. Every intake path uses one SQL acceptance RPC so image request, work item, idempotency, and queue enqueue commit atomically.
6. Reference images are bounded and rehosted before queueing. The worker only reads controlled Supabase media URLs or allowlisted X media URLs.
7. The AI provider receives inspiration images as image inputs. Linkr must not replace them with deterministic local image generation.
8. If the provider fails or rejects the prompt, the request fails gracefully. Do not return fake deterministic fallback art.
9. Terminal and Telegram history updates use the existing `linkr_terminal_messages.parts` model through an atomic JSONB updater RPC.
10. X final image delivery uses the existing `twitter_replies` / `worker-reply-x` queue path, extended with optional media.
11. OAuth 1.0a media auth is connected from `/secretpanel` and stored encrypted in Postgres. OAuth 2.0 stays unchanged.
12. Rollout starts disabled, with concurrency 1, and each surface is enabled separately.

## 2. Existing Backend Fit

The plan must align with these current contracts:

- `worker-image-generate` is launch-only and consumes `image_generate`.
- `runStageWorker` processes one claimed item per invocation and completes via `complete_linkr_stage_work`, `retry_linkr_stage_work`, or `dead_letter_linkr_stage_work`.
- `complete_linkr_stage_work` requires terminal states such as `succeeded` or `rejected` unless a `nextRoute` is supplied.
- `accept_linkr_work_item` does not accept `surface_conversation_id`, so image generation needs a domain-specific wrapper RPC.
- `linkr_terminal_messages.status` supports `sending`, `typing`, `completed`, `failed`, and `cancelled`. Image progress belongs inside `parts`, not message status.
- Telegram private DMs already run through `processLinkrAgentTurn`; Telegram groups do not.
- `tweets_inbox.ai_processing_lane` currently permits only `reply` and `legacy`; add `image_generation`.
- `worker-reply-x` posts text-only tweets today; extend it rather than bypassing it.
- `/secretpanel` currently supports OAuth 2.0 bot PKCE login only. OAuth 1.0a signing exists, but browser login and DB token storage need to be added.

## 3. Runtime Flags

Add these flags with safe defaults:

```env
LINKR_USER_IMAGE_GENERATION_ENABLED=false
LINKR_USER_IMAGE_GENERATION_SURFACES=terminal,telegram,x,agent_api
LINKR_TELEGRAM_GROUP_IMAGE_GENERATION_ENABLED=false
LINKR_X_IMAGE_GENERATION_ENABLED=false
LINKR_AGENT_IMAGE_API_ENABLED=false
LINKR_X_MEDIA_UPLOAD_ENABLED=false
LINKR_X_MEDIA_UPLOAD_DRIVER=v1_1_simple
LINKR_USER_IMAGE_MAX_PROMPT_CHARS=1600
LINKR_USER_IMAGE_MAX_REFERENCES=2
LINKR_USER_IMAGE_MAX_REFERENCE_BYTES_TOTAL=6291456
LINKR_USER_IMAGE_MAX_ACTIVE_PER_SUBJECT=2
LINKR_USER_IMAGE_REQUESTS_PER_DAY=20
LINKR_USER_IMAGE_PROVIDER_TIMEOUT_MS=90000
```

Do not enable any surface until migrations, worker deployment, tests, and `/secretpanel` OAuth 1.0a verification are complete.

## 4. Database Migration

Create one additive migration:

`supabase/migrations/YYYYMMDDHHMMSS_user_image_generation.sql`

### 4.1 Storage

Create or provision a public controlled media bucket:

- Bucket: `linkr-generated-media`
- Input references: `inputs/{surface}/{owner_key}/{sha256}.{ext}`
- Generated outputs: `outputs/{surface}/{image_request_id}/{sha256}.{ext}`

Reason: current `validateMediaUrl` already trusts the Supabase project host, which keeps the worker fetch path simple and compatible with Terminal, Telegram, X, and Agent API.

Do not reuse `token-logos`.

### 4.2 `linkr_image_requests`

Add one table. Keep it compact and indexed for active-cap checks:

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `idempotency_key text not null unique`
- `user_id uuid null`
- `surface text not null check in ('terminal','telegram','x','agent_api')`
- `surface_conversation_id text null`
- `source_event_id text null`
- `platform_user_id text null`
- `platform_username text null`
- `terminal_conversation_id uuid null`
- `user_message_id uuid null`
- `assistant_message_id uuid null`
- `run_id uuid null`
- `work_item_id uuid null unique`
- `status text not null default 'queued' check in ('queued','running','succeeded','failed','cancelled')`
- `prompt text not null`
- `negative_prompt text null`
- `requested_aspect_ratio text null`
- `resolved_aspect_ratio text not null check in ('1:1','16:9','9:16','4:3','3:4')`
- `requested_size text null`
- `resolved_size text not null default '1K'`
- `output_format text not null default 'png' check in ('png','jpeg','webp')`
- `reference_images jsonb not null default '[]'::jsonb`
- `delivery jsonb not null default '{}'::jsonb`
- `provider text null`
- `model text null`
- `reference_mode text null`
- `storage_bucket text null`
- `storage_path text null`
- `public_url text null`
- `content_type text null`
- `byte_length integer null`
- `sha256 text null`
- `error_code text null`
- `error_message text null`
- `created_at`, `started_at`, `completed_at`, `updated_at`

Constraints:

- `octet_length(idempotency_key) between 1 and 256`
- `octet_length(prompt) between 1 and 8000`
- `octet_length(reference_images::text) <= 8192`
- `octet_length(delivery::text) <= 8192`

Indexes:

- `(user_id, status, created_at desc)`
- `(surface, platform_user_id, status, created_at desc)`
- `(work_item_id)` where not null
- `(assistant_message_id)` where not null
- `(surface, source_event_id)` where source event is not null

RLS:

- service role can read/write all rows
- authenticated users can read rows where `user_id = auth.uid()`

### 4.3 Image Acceptance RPC

Add `public.accept_linkr_image_request_v1(...)`.

This RPC is mandatory. Do not implement intake as edge-code insert plus separate queue accept.

Inputs:

- `p_idempotency_key text`
- `p_user_id uuid`
- `p_surface text`
- `p_surface_conversation_id text`
- `p_source_event_id text`
- `p_platform_user_id text`
- `p_platform_username text`
- `p_terminal_conversation_id uuid`
- `p_user_message_id uuid`
- `p_assistant_message_id uuid`
- `p_run_id uuid`
- `p_prompt text`
- `p_negative_prompt text`
- `p_requested_aspect_ratio text`
- `p_resolved_aspect_ratio text`
- `p_requested_size text`
- `p_resolved_size text`
- `p_output_format text`
- `p_reference_images jsonb`
- `p_delivery jsonb`
- `p_priority smallint`
- `p_resource_key text`

Behavior:

1. Take `pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0))`.
2. If the image request already exists, return its ids and `duplicate=true`.
3. Enforce active cap with indexed lookup:
   - `status in ('queued','running')`
   - user id when present, otherwise `surface + platform_user_id`
4. Insert `linkr_image_requests`.
5. Call `public.accept_linkr_work_item` with:
   - same idempotency key
   - `source_surface = p_surface`
   - `source_event_id = p_source_event_id`
   - `user_id = p_user_id`
   - `conversation_id = p_terminal_conversation_id` only when it is a UUID terminal conversation, otherwise null
   - `request_type = 'user_image_generation'`
   - `route = 'image.user_generate'`
   - `priority = p_priority`
   - `resource_type = 'image_generation_user'`
   - `resource_key = p_resource_key`
   - payload only `{ "schema_version": 1, "image_request_id": "...", "surface": "..." }`
6. Update `linkr_work_items.surface_conversation_id` for the returned work item when null.
7. Update `linkr_image_requests.work_item_id`.
8. Return `{ image_request_id, work_item_id, duplicate, enqueued, message_id }`.

The edge caller wakes `user_image_generate` only when `enqueued=true`.

### 4.4 Message Part Updater RPC

Add `public.upsert_linkr_generated_image_part_v1(...)`.

Inputs:

- `p_message_id uuid`
- `p_user_id uuid`
- `p_image_request_id uuid`
- `p_part jsonb`

Behavior:

- requires `p_part->>'type' = 'generated_image'`
- requires `p_part->>'image_request_id' = p_image_request_id::text`
- updates the matching part in `linkr_terminal_messages.parts` by `image_request_id`
- appends the part if missing
- only touches assistant messages owned by `p_user_id`
- leaves row `status='completed'` unless the part status is `failed`, then set row `status='failed'` only if the assistant message has no other successful content
- does not emit extra events

Use this RPC from workers. Runtime should create the initial queued part with `setAssistantMessage`.

### 4.5 Queue Stage

Add:

- Stage: `user_image_generate`
- Route: `image.user_generate`
- Worker function: `worker-user-image-generate`
- Consumer version: `worker-user-image-generate-v1`
- Visibility timeout: `300`
- Runtime config enabled: `false`
- Capacity slots: one slot initially

Update:

- `public.linkr_queue_for_route`
- `supabase/functions/_shared/queue_contracts.ts`
- `queue_contracts_test.ts`
- `edge-budgets.json`

Do not add high-priority lanes for v1.

### 4.6 X Schema

Add:

- `tweets_inbox.media_urls jsonb not null default '[]'::jsonb`
- extend `tweets_inbox_ai_processing_lane_check` to include `image_generation`
- `twitter_replies.media_attachments jsonb not null default '[]'::jsonb`
- same nullable column to `twitter_replies_archive`

Add `public.enqueue_linkr_x_reply_with_media_v1(...)`.

It must mirror the latest `enqueue_linkr_x_reply_v1` root-parent lookup and insert into:

- `linkr_work_items`
- `twitter_replies`
- `linkr_notification_deliveries`

It accepts `p_media_attachments jsonb`, validates at most one generated image for v1, stores it on `twitter_replies.media_attachments`, and includes attachment URL/hash in `content_hash`.

Keep `enqueue_linkr_x_reply_v1` compatible for text-only callers.

### 4.7 OAuth 1.0a Tables

Add:

- `x_bot_oauth1_tokens`
- `x_oauth1_request_tokens`

Both are service-role only with RLS enabled.

`x_bot_oauth1_tokens` stores encrypted access token and encrypted access token secret for `account_key='linkrcash'`.

`x_oauth1_request_tokens` stores encrypted temporary request token secret, token hash, admin user id, expiry, and used timestamp.

Use existing `x_token_crypto.ts` encryption.

## 5. Shared Edge Modules

### 5.1 Media Storage

Create `_shared/generated_media_storage.ts`.

Functions:

- `storeUserImageInput(admin, captured, { surface, ownerKey })`
- `storeGeneratedImage(admin, captured, { surface, requestId })`

Both use `CapturedImage` from `bounded_media.ts`.

Update only these upload/capture paths:

- `terminal-upload` for frontend inspiration uploads
- Telegram chat photo capture
- Agent API image upload or external reference capture

Do not change `cli-upload`.
Do not change launch storage.

### 5.2 Image Request Helper

Create `_shared/user_image_requests.ts`.

Functions:

- `detectImageGenerationRequest({ text, surface })`
- `extractImageGenerationSpec(...)`
- `prepareReferenceImagesForIntake(...)`
- `acceptUserImageRequest(...)`
- `buildGeneratedImagePart(...)`
- `upsertGeneratedImagePart(...)`
- `wakeUserImageStage(...)`

Detection rules:

- return false for CLI
- reject launch/trade/transfer/liquidity phrases before image detection
- require an image generation verb and image noun
- image-only attachment is not enough

Defaults:

- aspect ratio: `1:1`
- size: `1K`
- output format: `png`
- max references: 2
- max total reference bytes: 6MB

References:

- Terminal/Telegram/Agent API external references are captured and rehosted at intake.
- X references can remain X media URLs until worker time because `captureBoundedXImage` already allowlists X media hosts.
- Store reference metadata only: URL, storage path if any, MIME, width, height, byte length, sha256, origin.

### 5.3 Image Provider

Create `_shared/user_image_generation.ts`.

It may reuse parsing and limits from `launch_image_generation.ts`, but not its prompt text or fallback behavior.

Provider call:

- use existing `COMET_API_KEY`
- use `LINKR_IMAGE_MODEL` or current image model default
- send `generationConfig.imageConfig.aspectRatio`
- send reference images as provider image inputs, not just text
- provider timeout from `LINKR_USER_IMAGE_PROVIDER_TIMEOUT_MS`
- provider response max 8MB
- decoded image max 4MB
- output validated through `capturedImageFromBytes`

Reference handling:

1. First attempt: native image inputs in the generation request.
2. If the provider rejects reference-image request shape, call the existing vision/text model to produce an AI visual brief, then retry image generation once using prompt plus that brief.
3. If that fails, mark the request failed.

No deterministic local fallback images.

### 5.4 OAuth 1.0a and X Media

Create:

- `_shared/x_oauth1_tokens.ts`
- `_shared/x_media_upload.ts`

Update:

- `_shared/x_oauth1.ts`
- `_shared/x_posting_auth.ts`
- `_shared/x_posting_verifier.ts`

OAuth 1.0a token loading:

- prefer encrypted DB token from `x_bot_oauth1_tokens`
- fall back to env `X_OAUTH1_ACCESS_TOKEN` and `X_OAUTH1_ACCESS_TOKEN_SECRET`
- keep existing OAuth 2.0 behavior unchanged

Media upload:

- use OAuth 1.0a even when `X_BOT_POST_AUTH_MODE=oauth2`
- use `X_MEDIA_UPLOAD_URL` or default `https://upload.twitter.com/1.1/media/upload.json`
- use multipart `FormData` upload so media bytes are not included in the OAuth signature base string
- return `media_id_string`
- retry only network, 429, and 5xx
- on missing/rejected OAuth 1.0a auth, signal non-retryable fallback to URL reply

## 6. `/secretpanel` OAuth 1.0a Login

Do not replace OAuth 2.0. Add OAuth 1.0a next to it.

### 6.1 Secretpanel Backend

File: `supabase/functions/secretpanel/index.ts`

Changes:

- keep current OAuth 2.0 login URL behavior
- add `oauth1_login_url`
- add `oauth1_media_auth` status
- add POST action `verify_oauth1_media_auth`
- `verify_posting_auth` still verifies `X_BOT_POST_AUTH_MODE`
- `verify_oauth1_media_auth` always verifies DB/env OAuth 1.0a against `X_BOT_USER_ID` and `X_BOT_HANDLE`

Status shape:

```ts
{
  oauth_login_url,       // existing OAuth 2.0 compatibility field
  oauth2_login_url,
  oauth1_login_url,
  posting_auth,
  oauth1_media_auth: {
    configured: boolean,
    source: "db" | "env" | "missing",
    expected_user_id,
    expected_handle,
    last_verified_at,
    last_verification_status,
    last_error,
    needs_attention
  }
}
```

### 6.2 Secretpanel Frontend

File: `src/routes/secretpanel.tsx`

Add:

- "Connect OAuth 1.0a media" button
- "Verify OAuth 1.0a media" button
- status display for DB/env/missing source

Keep the existing OAuth 2.0 connect and verify UI.

### 6.3 `x-oauth` OAuth 1.0a Flow

File: `supabase/functions/x-oauth/index.ts`

Add paths:

- `GET /functions/v1/x-oauth/oauth1?oauth_state=...`
- `GET /functions/v1/x-oauth/oauth1/callback`

Flow:

1. Start validates `oauth_state` with existing `admin_oauth_start_states`.
2. POST request token to `X_OAUTH1_REQUEST_TOKEN_URL` or `https://api.twitter.com/oauth/request_token`.
3. Sign with consumer key/secret and form parameter `oauth_callback`.
4. Store request token hash and encrypted request token secret.
5. Redirect to `X_OAUTH1_AUTHORIZE_URL` or `https://api.twitter.com/oauth/authorize`.
6. Callback receives `oauth_token` and `oauth_verifier`.
7. Look up unused, unexpired request token by hash.
8. POST access token exchange to `X_OAUTH1_ACCESS_TOKEN_URL` or `https://api.twitter.com/oauth/access_token`.
9. Sign with consumer key/secret, request token/secret, and form parameter `oauth_verifier`.
10. Parse `oauth_token`, `oauth_token_secret`, `user_id`, `screen_name`.
11. Require `user_id` and `screen_name` to match configured Linkr bot identity.
12. Encrypt and upsert `x_bot_oauth1_tokens`.
13. Mark temporary request token used.
14. Record `x_bot_token_events` event `oauth1_login`.
15. Return success HTML.

Signer requirement:

- current OAuth 1.0a access-token signing must keep passing existing tests
- add support for no-token request-token signatures
- add support for temporary-token access-token exchange
- include form parameters in the signature base string

## 7. Runtime and Surfaces

### 7.1 Runtime

Files:

- `_shared/linkr_agent_runtime.ts`
- `_shared/linkr_agent_runtime_types.ts`
- `_shared/linkr_capabilities.ts`

Add route `image_generation`.

Decision order:

1. pending-action confirm/cancel
2. explicit image generation, excluding CLI
3. launch/trade/transfer/value-moving routes
4. existing read/chat routes

For Terminal and Telegram private DM:

1. detect request
2. capture/rehost references
3. call acceptance RPC
4. `setAssistantMessage` with acknowledgement and queued `generated_image` part
5. return completed runtime result with `image_request_ids` and `media_job_ids`

Do not use `action_job_ids`.

### 7.2 Terminal

- Existing `/app/terminal` upload path becomes inspiration-image input.
- Add `generated_image` rendering in `MessagePartView`.
- No polling loop. Realtime on `linkr_terminal_messages` is enough.
- Initial queued part comes from runtime; worker updates through RPC.

### 7.3 Telegram Private DM

- Replace chat-photo use of `uploadTelegramPhotoForLaunch` with generic user-media capture.
- Add `sendTelegramPhoto`.
- Add `upload_photo` chat action.
- Private DM keeps using runtime.
- Worker sends final photo and updates persisted message part.
- Use `linkr_notification_deliveries` idempotency key `image:telegram:{image_request_id}`.
- Before `sendPhoto`, claim the delivery row by moving `queued/retryable` to `sending` and incrementing `attempt_count`.
- If Telegram returns a message id, store it as `provider_message_id` and mark `sent`.
- If the send outcome is unknown, mark delivery `ambiguous` and do not auto-repeat `sendPhoto` blindly.

### 7.4 Telegram Group

- Handle only when addressed and existing verification passes.
- Detect image generation before `PRIVATE_ACTION_RE`.
- No private Linkr account context.
- If enabled, use acceptance RPC with `user_id=null`, `surface='telegram'`, and delivery JSON containing chat id, thread id, reply id, and group marker.
- Acknowledge in group immediately.
- Worker sends final photo using delivery idempotency handling.

### 7.5 X

In `cron-fetch-mentions`:

- keep `media_url`
- add `media_urls` array with all supported image/previews

In `worker-x-ingress`:

1. resolve user id as today
2. detect image generation before launch/trade
3. call image acceptance RPC
4. delivery JSON must include original X ingress `work_item_id` as `x_parent_work_item_id`
5. enqueue acknowledgement through `enqueue_linkr_x_reply_v1`
6. wake `reply.x`
7. update tweet row:
   - `status='completed'`
   - `ai_processing_lane='image_generation'`
   - `ai_route_kind='image_generation'`
   - `processed_at=now()`
8. complete x ingress work as `succeeded`

In `worker-user-image-generate` after image success:

- call `enqueue_linkr_x_reply_with_media_v1` using `delivery.x_parent_work_item_id`
- kind `image_generation_result`
- media array contains the generated public URL and hash
- wake `reply.x`

In `worker-reply-x`:

- text-only replies behave exactly as today
- if `media_attachments` exists:
  - upload media first with OAuth 1.0a
  - post `/2/tweets` with `media.media_ids`
  - retry only before a tweet is posted
  - on OAuth 1.0a missing/rejected, post text fallback with generated URL and record `x_media_auth_missing`

### 7.6 Agent API

Do not add `/api/chat` for this feature.

Add:

- `POST /api/images`
- `GET /api/images/{id}`
- optional `POST /api/images/uploads` only if direct upload is required

Use existing Agent API HMAC auth through `requireAgentApiKey`.

Add scope:

- `image:write`

`POST /api/images`:

- requires `image:write`
- requires `Idempotency-Key`
- always returns `202`
- no `wait=true` in v1
- external references must be captured/rehosted at intake

`GET /api/images/{id}`:

- requires `image:write`
- returns only rows owned by `ctx.userId`

Gateway:

- add exact route for `POST /api/images`
- add dynamic match for `/api/images/{id}`
- only raise body limit for `/api/images/uploads`, not for `/api/images`

## 8. Worker

Create:

`supabase/functions/worker-user-image-generate/index.ts`

Config:

- stage: `user_image_generate`
- functionName: `worker-user-image-generate`
- consumerVersion: `worker-user-image-generate-v1`
- visibilitySeconds: `300`
- edge budget entry required before deploy

Process:

1. read `payload.image_request_id`
2. load request row
3. if already `succeeded`, complete `succeeded`
4. mark request `running`
5. update message part to `running` when present
6. fetch reference images with bounded helpers
7. call AI provider
8. validate generated image with `capturedImageFromBytes`
9. store generated output
10. mark request `succeeded`
11. update message part to `succeeded`
12. deliver by surface
13. complete work item `succeeded`

Retry:

- provider timeout, 429, 5xx, network: retry
- storage failure: retry
- bad prompt/content rejection/unsupported provider response: mark failed and complete `rejected`
- delivery after successful generation:
  - X delivery is delegated to reply worker
  - Telegram claims `linkr_notification_deliveries` before send and must not blind-resend ambiguous photos
  - Terminal/Agent API need only persisted state

## 9. CPU and Postgres Guardrails

Required guardrails:

- queue concurrency starts at 1
- no high-priority image lane in v1
- no synchronous Agent API wait mode
- no provider calls from Telegram webhook, X ingress, Terminal request handler, or Agent API request handler
- no DB polling from frontend; Terminal uses existing Realtime
- work item payload under 4KB
- `reference_images` JSON under 8KB
- references max 2 and total bytes max 6MB in v1
- generated output max 4MB
- provider response max 8MB
- OAuth media upload uses multipart to avoid signing image bytes
- message part updates occur at most queued, running, succeeded/failed
- active cap enforced in SQL RPC using indexed columns
- daily rate limits enforced per user/platform subject before acceptance
- `linkr_request_events` logging is compact metadata only
- no prompt/provider request body with image data is stored

## 10. Tests

Run:

```bash
npm run typecheck
npm run lint
npm run test:edge
npm run check:edge-budget
npm run build
```

Required tests:

- detector accepts explicit image requests
- detector rejects CLI, launch, trade, transfer, image-only, and "what is in this image"
- spec parser normalizes size/aspect ratio
- intake RPC is idempotent and atomic
- active cap blocks excess queued/running requests
- queue route maps `image.user_generate` to `user_image_generate`
- generated-image part RPC updates existing part without duplicating it
- terminal uses `setAssistantMessage` for initial queued part
- Telegram `sendPhoto` and ambiguous delivery handling
- X `media_urls` extraction preserves `media_url`
- X ingress image branch updates `ai_processing_lane='image_generation'`
- X media reply RPC stores `media_attachments`
- `worker-reply-x` text-only path unchanged
- `worker-reply-x` media path uploads then posts media tweet
- X OAuth 1.0a request-token and access-token flow
- OAuth 1.0a DB token preferred over env fallback
- media upload works while `X_BOT_POST_AUTH_MODE=oauth2`
- provider receives reference images as image inputs
- AI visual-brief fallback uses model output, not deterministic local logic
- Agent API `POST /api/images` returns `202`
- Agent API `GET /api/images/{id}` enforces ownership

## 11. Rollout

Order:

1. ship migrations with `user_image_generate` disabled
2. deploy shared helpers and tests
3. deploy worker with stage disabled
4. deploy `/secretpanel` OAuth 1.0a flow
5. login through `/secretpanel` and verify OAuth 1.0a media auth
6. enable Terminal in staging
7. enable Agent API in staging
8. enable Telegram private DM in staging
9. enable X only after media upload succeeds in staging
10. enable Telegram groups last
11. raise concurrency only after queue age, provider latency, Postgres load, and failure rate are healthy

Rollback:

- `LINKR_USER_IMAGE_GENERATION_ENABLED=false`
- disable `user_image_generate` in `linkr_queue_runtime_config`
- `LINKR_X_MEDIA_UPLOAD_ENABLED=false`
- keep OAuth 2.0 posting mode unchanged
- launch `image_generate` stays untouched

## 12. Definition of Done

Done means:

- Terminal, Telegram, X, and Agent API can queue explicit image generation.
- CLI never triggers it.
- All intakes acknowledge quickly.
- AI receives inspiration images as image inputs or AI-generated visual briefs.
- No deterministic local fallback image is used.
- Generated outputs are stored in generic media storage.
- No image bytes/base64 are stored in Postgres.
- Terminal and Telegram history update without JSONB races.
- X final media posts through the existing reply queue.
- OAuth 1.0a media login works from `/secretpanel`.
- OAuth 2.0 remains unchanged.
- Launch image generation still works unchanged.
- Validation commands, edge budget, and staging checks pass.
