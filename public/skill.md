---
name: linkr-agent-api
version: 4
base_url: https://linkr.cash
openapi_url: https://linkr.cash/api/openapi.json
docs_url: https://linkr.cash/agent-api
auth: bearer-api-key-plus-hmac
chain: Robinhood Chain and Solana
chain_id: 4663
native_asset: ETH and SOL
token_input_rule: full_evm_contract_address_or_full_solana_mint_only
---

# Linkr Agent API Skill

This file teaches an AI agent how to use Linkr from a clean start.

Linkr is an interface and execution layer for permissionless token launch, trading, wallet, history, token-burn, and liquidity workflows on Robinhood Chain and Solana. Through the Agent API, an authenticated AI agent can receive a Linkr-controlled profile, use generated Linkr wallets, inspect wallet addresses, balances, portfolio, and history, launch tokens, buy and sell tokens by full EVM contract address or full Solana mint, transfer native ETH or SOL, prepare and separately confirm irreversible fungible-token burns, manage user-owned Robinhood Uniswap V3 and Pump.fun/PumpSwap liquidity positions, claim supported creator rewards, list recently launched Linkr coins, and inspect detailed coin data.

The API is not anonymous and not free-form. Each agent must have a Linkr agent profile, a generated wallet, and a scoped API key. Every business request must be signed with HMAC headers. Value-moving actions should be dry-run first, then executed only when the agent has clear user intent and the generated wallet is funded.

## Mental Model

- Linkr is the platform.
- The agent profile is the API identity.
- The generated Linkr wallets are the on-chain accounts used for trades, transfers, launches, liquidity, and reward claims.
- The API key authenticates the agent.
- HMAC headers prove the request body, timestamp, nonce, path, and idempotency key were not altered.
- Scopes decide which actions the key may perform.
- Caps decide the maximum value the key may move.
- Idempotency keys protect POST endpoints from duplicate execution.
- Transaction hashes are returned as plain hashes. Do not invent explorer links unless the user explicitly asks and you have the explorer URL from a response.

## Base URLs

Use the app-domain API:

```text
https://linkr.cash/api/...
```

Do not sign or call an underlying service or redirected URL. The HMAC canonical path is the Linkr app path such as `/api/trade`, `/api/coin-info?token_address=0x...`, or `/api/actions/<id>`.

Helpful public resources:

- Agent docs: `https://linkr.cash/agent-api`
- OpenAPI JSON: `https://linkr.cash/api/openapi.json`
- This skill file: `https://linkr.cash/skill.md`

## Supported Scopes

Request only the scopes your runtime needs.

```text
profile:read       Read your agent profile, key metadata, limits, wallet addresses, balances, and portfolio.
actions:read       Poll queued launches, transactions, liquidity actions, LP positions, and private history.
coins:read         List recently launched Linkr coins.
coin:read          Read full coin detail and market data for one token.
launch:write       Queue a Robinhood Chain or Solana/Pump.fun token launch.
trade:buy          Buy a token with ETH or SOL.
trade:sell         Sell a held token for ETH or SOL.
transfer:write     Transfer native ETH or SOL from the generated wallet.
burn:write         Prepare and separately confirm an irreversible fungible-token burn.
liquidity:write    Add/remove Robinhood V3 or PumpSwap liquidity; collect Robinhood V3 fees.
rewards:claim      Claim supported creator rewards for launches created by the wallet.
```

## First-Time Setup

There are two setup paths.

### Path A: Dashboard-Created Agent

A human logs into Linkr, opens the dashboard API key page, creates an agent profile, and copies the one-time API key. Use that key for signed business requests.

The dashboard returns the API key only once. Store it securely in the agent runtime's secret manager.

### Path B: Onboarding Token

A human creates a one-time onboarding token in the dashboard and gives it to the agent runtime. The agent then registers itself:

```http
POST /api/agents/register
Content-Type: application/json

{
  "onboarding_token": "one-time-token-from-human",
  "agent_name": "Research Trading Agent",
  "public_contact": "ops@example.com",
  "requested_scopes": ["profile:read", "coins:read", "coin:read", "trade:buy"],
  "limits": {
    "max_buy_eth": 0.01,
    "max_sell_percent": 25,
    "max_transfer_eth": 0,
    "max_launch_initial_buy_eth": 0,
    "max_liquidity_eth": 0
  }
}
```

This registration endpoint does not use HMAC because you do not have an API key yet. It must use either a dashboard user session or a valid onboarding token.

Successful registration returns:

```json
{
  "agent_profile_id": "...",
  "wallet": {
    "id": "...",
    "address": "0x...",
    "chain_id": 4663
  },
  "api_key": "linkr_live_<prefix>_<secret>",
  "key": {
    "id": "...",
    "key_prefix": "...",
    "scopes": ["profile:read"],
    "status": "active"
  },
  "signing": {
    "algorithm": "HMAC-SHA256",
    "required_headers": [
      "Authorization",
      "X-Linkr-Timestamp",
      "X-Linkr-Nonce",
      "X-Linkr-Body-SHA256",
      "X-Linkr-Signature"
    ]
  }
}
```

After registration, call signed `GET /api/me` to verify the profile and `GET /api/wallet` to retrieve the chain-specific deposit addresses. Robinhood Chain actions use the EVM address and ETH; Solana actions use the Solana address and SOL.

## Funding the Wallet

All value-moving endpoints use the generated Linkr wallet returned by `GET /api/me` or registration. The API does not magically fund the wallet.

Before buying, launching with an initial buy, transferring, adding liquidity, or claiming rewards that require gas:

1. Call `GET /api/me`, then `GET /api/wallet`.
2. Read `deposit_addresses.robinhood` and `deposit_addresses.solana` from the wallet response.
3. Ask the user to fund the address for the intended action with Robinhood Chain ETH or Solana SOL.
4. Use dry-run endpoints to confirm the wallet has enough balance before executing.

## Authentication for Business Endpoints

Every business endpoint requires these headers:

```text
Authorization: Bearer linkr_live_<prefix>_<secret>
X-Linkr-Timestamp: <unix_seconds_or_iso_timestamp>
X-Linkr-Nonce: <unique_random_nonce>
X-Linkr-Body-SHA256: <sha256_hex_of_exact_request_body>
X-Linkr-Signature: <hmac_sha256_hex>
```

Every `POST` business endpoint also requires:

```text
Idempotency-Key: <stable_unique_key_for_this_logical_action>
```

Rules:

- Never put the API key in a URL.
- Use a fresh nonce for every request. Reusing a nonce causes `replay_detected`.
- Keep timestamps within 5 minutes of the current time.
- Hash the exact body bytes you send. For `GET` requests and empty bodies, the SHA-256 hash is the hash of the empty string:
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- For `POST`, stringify JSON once, hash that exact string, and send that exact string.
- For `GET`, the canonical path includes the query string exactly as sent.
- For app-domain requests, sign `/api/...`, not `/functions/v1/...`.
- For duplicate-safe retries of the same logical `POST`, reuse the same `Idempotency-Key` and body.
- For a different logical action, use a new `Idempotency-Key`.

### Canonical Signing String

Build this exact string with newline separators:

```text
LINKR-HMAC-SHA256
<HTTP_METHOD_UPPERCASE>
<PATH_WITH_QUERY>
<BODY_SHA256_HEX>
<X_LINKR_TIMESTAMP>
<X_LINKR_NONCE>
<IDEMPOTENCY_KEY_OR_EMPTY_STRING>
```

Then compute:

```text
hex(HMAC_SHA256(secret = full_plaintext_api_key, message = canonical_string))
```

The HMAC secret is the full API key string, for example `linkr_live_<prefix>_<secret>`.

### JavaScript Signing Sketch

```js
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signedHeaders({ apiKey, method, pathWithQuery, body = "", idempotencyKey = "" }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(body);
  const canonical = [
    "LINKR-HMAC-SHA256",
    method.toUpperCase(),
    pathWithQuery,
    bodyHash,
    timestamp,
    nonce,
    idempotencyKey,
  ].join("\n");
  const signature = await hmacHex(apiKey, canonical);
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Linkr-Timestamp": timestamp,
    "X-Linkr-Nonce": nonce,
    "X-Linkr-Body-SHA256": bodyHash,
    "X-Linkr-Signature": signature,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}
```

## Standard Response and Error Shape

Successful responses are JSON. Errors use this shape:

```json
{
  "error": {
    "code": "invalid_signature",
    "message": "X-Linkr-Signature is invalid.",
    "details": {}
  },
  "request_id": "..."
}
```

Common error codes:

```text
invalid_body_hash              The body hash does not match the sent body.
invalid_api_key                Missing, malformed, or unknown API key.
api_key_not_active             Key was revoked, disabled, or expired.
api_key_expired                Key expired.
forbidden_scope                Key does not include the required scope.
missing_timestamp              Timestamp header missing.
stale_timestamp                Timestamp is more than 5 minutes away from server time.
invalid_nonce                  Nonce missing or too long.
replay_detected                Nonce was already used.
invalid_signature              HMAC signature mismatch.
idempotency_required           POST endpoint requires Idempotency-Key.
invalid_evm_address            A full 0x EVM address was expected.
invalid_eth_amount             ETH amount must be positive.
max_buy_eth_exceeded           Buy amount exceeds the key/profile cap.
max_sell_percent_exceeded      Sell percentage exceeds cap.
max_transfer_eth_exceeded      Transfer amount exceeds cap.
risk_acknowledgement_required  Liquidity action needs risk_acknowledged: true.
```

## Safe Agent Operating Procedure

Use this sequence for every value-moving request:

1. Understand the user's intent.
2. Refuse to execute if the user did not clearly ask for an on-chain action.
3. Require a full EVM contract address for trades and coin-specific actions.
4. Call `GET /api/me` to confirm identity, wallet, scopes, and limits.
5. For buys, sells, transfers, launches, liquidity, and rewards, send the request with `"dry_run": true`.
6. Summarize the dry-run result to the user when your policy or product flow requires confirmation.
7. Execute with the same parameters and a fresh idempotency key only after confirmation or clear authorization.
8. Return the result plainly, especially `tx_hash`, `tx_hashes`, `status`, and any `action` or `status_url`.
9. If execution returns an action id, poll `GET /api/actions/<id>` until status is terminal or until your runtime times out.

Do not:

- Guess token contracts from symbols, tickers, names, or cashtags.
- Trade a token by `$CASHTAG`.
- Use a contract address found in an unrelated context unless the user clearly indicated it.
- Bypass dry-run for value-moving actions.
- Prepare and confirm a token burn in one request. Burns always require two separately signed requests and explicit user confirmation.
- Confirm a burn unless the user has seen the exact chain, full CA/mint, token amount, and irreversible warning.
- Substitute an EVM dead-address transfer when the token lacks the standard `burn(uint256)` holder function.
- Exceed the returned key limits.
- Reuse a nonce.
- Reuse an idempotency key for a different action.
- Store API keys in conversation memory or logs.

## Token Input Rules

For executable trades and coin-specific actions, the token must be a complete EVM address:

```text
0x0000000000000000000000000000000000000000
```

These are not executable token inputs:

```text
$CASH
CASH
cash token
the green coin
the token from yesterday
```

If a user gives a symbol or cashtag, ask for the full contract address. You may use read-only endpoints to research tokens, but you must not execute from fuzzy matching.

For burns, the chain must also be explicit. Never infer it from address shape, prior context, or token metadata. A burn request must identify exactly one full CA/mint and an exact token-unit amount or the explicit word `all`. Native ETH, native SOL, NFTs, and LP-removal requests are not token-burn commands.

## Endpoint Reference

All endpoint paths below are relative to `https://linkr.cash`.

### GET /api/me

Purpose: verify the authenticated agent, key, scopes, limits, and generated wallet.

Required scope: `profile:read`

Signed: yes

Body: none

Canonical path example:

```text
/api/me
```

Response includes:

```json
{
  "agent_profile": {
    "id": "...",
    "name": "Research Agent",
    "status": "active",
    "type": "ai_agent",
    "public_contact": null
  },
  "key": {
    "id": "...",
    "prefix": "...",
    "name": "API key",
    "scopes": ["profile:read", "trade:buy"],
    "status": "active",
    "expires_at": null,
    "limits": {
      "max_buy_eth": 0.01,
      "max_sell_percent": 25,
      "max_transfer_eth": 0,
      "max_launch_initial_buy_eth": 0,
      "max_liquidity_eth": 0
    }
  },
  "wallet": {
    "id": "...",
    "address": "0x...",
    "chain_id": 4663
  }
}
```

Use this endpoint before actions to confirm the wallet address and current caps.

### GET /api/wallet

Purpose: read Robinhood Chain and Solana deposit addresses plus native balances.

Required scope: `profile:read`

Signed: yes

Body: none

Example:

```text
GET /api/wallet
```

Response includes:

```json
{
  "wallets": {
    "robinhood": {
      "address": "0x...",
      "chain_id": 4663,
      "native_asset": "ETH",
      "balance_eth": 0.01
    },
    "solana": {
      "address": "7Ytt...",
      "chain_id": null,
      "native_asset": "SOL",
      "balance_sol": 0.5
    }
  },
  "deposit_addresses": {
    "robinhood": "0x...",
    "solana": "7Ytt..."
  }
}
```

Use this for X-style wallet balance and deposit-address questions. Never reveal private keys or seed phrases.

### GET /api/portfolio

Purpose: read current native balances and token holdings.

Required scope: `profile:read`

Signed: yes

Query parameters:

```text
chain   Optional. all, robinhood, or solana.
token   Optional. Full address/mint or exact symbol/name filter.
limit   Optional. 1 to 100. Default 50.
```

Example:

```text
GET /api/portfolio?chain=solana&limit=25
```

Response includes:

```json
{
  "native_balances": {
    "eth": 0.01,
    "sol": 0.5
  },
  "holdings": [
    {
      "chain": "solana",
      "mint": "...",
      "amount": 1000,
      "raw_value": "1000000000"
    }
  ],
  "summary": {
    "holding_count": 1,
    "total_known_usd": null
  }
}
```

### GET /api/history

Purpose: read private Linkr history that users can ask about on X.

Required scope: `actions:read`

Signed: yes

Query parameters:

```text
kind    Optional. recent, transactions, launches, settings, agent, portfolio, pending, or all.
token   Optional. Token address or mint filter where supported.
symbol  Optional. Symbol filter where supported.
action  Optional. buy, sell, burn, or transfer for transaction history.
after   Optional ISO timestamp lower bound.
before  Optional ISO timestamp upper bound.
sort    Optional. recent, oldest, largest_eth, or largest_usd.
limit   Optional. 1 to 50. Default 20.
```

Example:

```text
GET /api/history?kind=recent&limit=10
```

The response returns a `history` object with the selected sanitized result sets and a summary.

### GET /api/coins/new

Purpose: list recent Linkr-launched coins.

Required scope: `coins:read`

Signed: yes

Query parameters:

```text
limit     Optional. 1 to 100. Default 25.
status    Optional. Default confirmed. Use all to include non-confirmed launches.
```

Example:

```text
GET /api/coins/new?limit=25
```

Response:

```json
{
  "data": [
    {
      "id": "...",
      "token_address": "0x...",
      "name": "...",
      "symbol": "...",
      "description": "...",
      "image_url": "https://...",
      "status": "confirmed",
      "created_at": "...",
      "tx_hash": "0x...",
      "pool": "0x...",
      "position_id": "...",
      "market": {
        "price_usd": null,
        "market_cap_usd": null,
        "liquidity_usd": null,
        "volume_24h_usd": null,
        "price_change_24h": null
      }
    }
  ],
  "next_cursor": "..."
}
```

### GET /api/coin-info

Purpose: get the complete Linkr coin detail payload for a token address.

Required scope: `coin:read`

Signed: yes

Query parameters:

```text
token_address  Required. Full EVM token address.
analytics      Optional. Use analytics=false to skip heavier market analytics.
```

Example:

```text
GET /api/coin-info?token_address=0x...&analytics=false
```

Response includes:

```json
{
  "token_address": "0x...",
  "launch": {
    "id": "...",
    "name": "...",
    "symbol": "...",
    "status": "confirmed",
    "tx_hash": "0x...",
    "creator_user_id": "...",
    "launch_method": "single_sided_lp"
  },
  "market": {},
  "creator_rewards": {},
  "pool": {
    "pool_address": "0x...",
    "pool_fee": 10000,
    "position_id": "..."
  },
  "metadata": {
    "name": "...",
    "symbol": "...",
    "description": "...",
    "image_url": "https://..."
  },
  "links": {
    "app": "https://linkr.cash/coin/0x...",
    "explorer": "https://...",
    "pair": null
  },
  "warnings": []
}
```

Use this endpoint when the user asks what a coin is, what Linkr knows about it, or what creator rewards are visible for it.

### POST /api/launch-token

Purpose: queue a Linkr token launch.

Required scope: `launch:write`

Signed: yes

Requires `Idempotency-Key`: yes

Recommended first step: dry-run.

Request fields:

```text
name             Required. Token name. Max 64 chars.
symbol           Required. Up to 12 alphanumeric chars after normalization. Uppercased.
description      Required. Max 512 chars.
image_url        Required. Public image URL.
initial_buy_eth  Optional. Non-negative ETH amount. Also accepts dev_buy_eth.
website_url      Optional. Metadata website URL.
twitter_url      Optional. Metadata X/Twitter URL.
dry_run          Optional boolean.
```

Dry-run example:

```json
{
  "name": "Example Token",
  "symbol": "EXAMPLE",
  "description": "A token launched through Linkr.",
  "image_url": "https://example.com/image.png",
  "initial_buy_eth": "0",
  "dry_run": true
}
```

Dry-run response:

```json
{
  "dry_run": true,
  "predicted_token": "0x...",
  "launch_fee_wei": "...",
  "total_msg_value_wei": "...",
  "required_balance_wei": "...",
  "signer_balance_wei": "..."
}
```

Execution response:

```json
{
  "id": "...",
  "status": "queued",
  "token_address": "0x...",
  "mint": "0x...",
  "created_at": "...",
  "estimated": {
    "launch_fee_wei": "...",
    "total_msg_value_wei": "...",
    "required_balance_wei": "..."
  },
  "status_url": "https://linkr.cash/api/actions/<id>"
}
```

After launch execution, poll `/api/actions/<id>`.

### POST /api/trade

Purpose: buy or sell a token by full Robinhood Chain EVM contract address or full Solana mint.

Required scopes:

```text
trade:buy   for side buy
trade:sell  for side sell
```

Signed: yes

Requires `Idempotency-Key`: yes

Recommended first step: dry-run.

Buy request fields:

```text
side           Optional. Defaults to buy unless exactly sell.
token_address  Required. Full EVM token address. Also accepts token.
amount_eth     Required for buy. Also accepts eth_amount.
slippage_bps   Optional. Defaults to profile default or 100 bps.
dry_run        Optional boolean.
```

Buy dry-run:

```json
{
  "side": "buy",
  "token_address": "0x...",
  "amount_eth": "0.001",
  "slippage_bps": 100,
  "dry_run": true
}
```

Sell request fields:

```text
side           Required as sell.
token_address  Required. Full EVM token address. Also accepts token.
percent        Required for sell. 1 to 100. Also accepts sell_percent.
slippage_bps   Optional. Defaults to profile default or 100 bps.
dry_run        Optional boolean.
```

Sell dry-run:

```json
{
  "side": "sell",
  "token_address": "0x...",
  "percent": 25,
  "slippage_bps": 100,
  "dry_run": true
}
```

Execution response:

```json
{
  "status": "confirmed",
  "tx_hash": "0x...",
  "side": "buy",
  "input_amount_wei": "...",
  "output_amount_wei": "...",
  "quoted_output_amount_wei": "...",
  "min_output_amount_wei": "...",
  "gas_used_wei": "...",
  "approval_tx_hash": null,
  "input_token": "...",
  "output_token": "..."
}
```

Important:

- Buying is capped by `max_buy_eth`.
- Solana buying is capped by `max_buy_sol`.
- Selling is capped by `max_sell_percent`.
- The wallet must have enough ETH or SOL for buys and gas/fees.
- The wallet must hold the token for sells.
- Cashtags and symbols are not valid executable inputs.

### POST /api/transfer

Purpose: transfer native ETH or SOL from the generated wallet.

Required scope: `transfer:write`

Signed: yes

Requires `Idempotency-Key`: yes

Recommended first step: dry-run.

Request fields:

```text
chain       Optional. Use solana for SOL transfers; omitted defaults to Robinhood/EVM.
recipient   Required. EVM address for ETH or Solana public key for SOL. Also accepts to.
amount_eth  Required for Robinhood. Positive ETH amount. Also accepts eth_amount.
amount_sol  Required for Solana. Positive SOL amount. Also accepts sol_amount.
dry_run     Optional boolean.
```

Dry-run:

```json
{
  "recipient": "0x...",
  "amount_eth": "0.01",
  "dry_run": true
}
```

Execution response:

```json
{
  "status": "confirmed",
  "tx_hash": "0x...",
  "amount_eth": "0.01",
  "recipient": "0x..."
}
```

Transfers are disabled if the key/profile transfer cap is zero.

For SOL transfers, send:

```json
{
  "chain": "solana",
  "recipient": "7YttLkHDoU8cbxC2q2wA3GcU6s4YtZ8VXjZJfGQWbS9u",
  "amount_sol": "0.01",
  "dry_run": true
}
```

### POST /api/burn-token

Purpose: prepare, separately confirm, or cancel an irreversible fungible-token burn from the generated Linkr wallet.

Required scope: `burn:write`

Signed: yes

Requires `Idempotency-Key`: yes, and each logical prepare/confirm/cancel request uses its own stable key.

There is no one-call execution mode. A prepare request freezes the exact wallet, chain, CA/mint, decimals, and raw token amount. It returns HTTP `202` and a confirmation message that must be shown to the user.

Prepare request:

```json
{
  "action": "prepare",
  "chain": "solana",
  "token": "<full-solana-mint>",
  "amount": "100.25"
}
```

`chain` is required and must be `robinhood` or `solana`. `token` must be one full address/mint written by the user. `amount` must be an exact positive token-unit string or the explicit string `all`.

Prepare response:

```json
{
  "status": "awaiting_confirmation",
  "confirmation_required": true,
  "action": {
    "id": "<pending-action-uuid>",
    "type": "burn_token",
    "status": "pending",
    "expires_at": "<iso-timestamp>",
    "preview": {
      "chain": "solana",
      "token": "<full-solana-mint>",
      "amount": "100.25",
      "amount_raw": "100250000",
      "wallet_address": "<linkr-wallet>",
      "decimals": 6
    }
  },
  "confirmation": {
    "message": "Confirm token burn: ... This action is irreversible ...",
    "confirm_request": {
      "action": "confirm",
      "pending_action_id": "<pending-action-uuid>",
      "acknowledgement": "IRREVERSIBLE_TOKEN_BURN"
    }
  }
}
```

After the user explicitly confirms the displayed details, send a new signed request with a fresh nonce and a different idempotency key:

```json
{
  "action": "confirm",
  "pending_action_id": "<pending-action-uuid>",
  "acknowledgement": "IRREVERSIBLE_TOKEN_BURN"
}
```

To stop instead:

```json
{
  "action": "cancel",
  "pending_action_id": "<pending-action-uuid>"
}
```

Safety rules:

- The pending action expires after 15 minutes.
- Only the same user and API key that prepared the burn can confirm it.
- Confirmation executes the frozen amount; request fields cannot replace or modify it.
- Solana supports fungible tokens owned by the SPL Token Program or Token-2022 and burns only from token accounts owned by the Linkr wallet.
- Robinhood Chain supports only verified contracts whose published ABI contains the exact nonpayable holder `burn(uint256)` function and whose call successfully simulates. After confirmation, Linkr verifies that both the wallet balance and total supply decreased by the exact frozen amount. Unsupported or unverifiable contracts are refused; Linkr does not silently transfer to a dead address.
- `all` freezes the balance seen during preparation. Tokens received afterward are not added to that burn.
- Native ETH, native SOL, NFTs, and liquidity-removal/LP-token burns are not accepted by this endpoint.

### GET /api/liquidity/positions

Purpose: list Robinhood V3 and Solana PumpSwap LP positions owned by the authenticated user.

Required scope: `actions:read`

Signed: yes

Query parameters:

```text
chain           Optional. robinhood or solana.
platform        Optional. robinhood_uniswap_v3 or pump_swap.
status          Optional. active, partially_removed, closed, transferred_out, stale, failed_refresh.
token           Optional. EVM token address, Solana mint, or exact symbol.
include_closed  Optional. true to include closed/transferred/stale positions.
limit           Optional. 1 to 100. Default 25.
```

Example:

```text
GET /api/liquidity/positions?chain=solana&limit=10
```

### POST /api/liquidity/add

Purpose: add user-owned Robinhood Uniswap V3 liquidity or Solana Pump.fun/PumpSwap liquidity.

Required scope: `liquidity:write`

Signed: yes

Requires `Idempotency-Key`: yes

Requires `risk_acknowledged: true`: yes

Recommended first step: dry-run.

Request fields:

```text
token_address       Required. Full EVM token address. Also accepts token, token_query, tokenAddress.
amount_eth          Required. ETH amount to pair. Also accepts eth_amount or ethAmount.
token_amount        Optional. Token amount override. Also accepts amount_token or tokenAmount.
chain               Optional. Use solana for PumpSwap.
platform            Optional. Use pump_swap for PumpSwap.
token_mint          Required for PumpSwap unless token_address/token/token_query contains the Solana mint.
token_amount_raw    Optional raw base-unit token amount for PumpSwap.
slippage_bps        Optional. Also accepts slippageBps. Default 100.
risk_acknowledged   Required true.
dry_run             Optional boolean.
```

Dry-run:

```json
{
  "token_address": "0x...",
  "amount_eth": "0.01",
  "slippage_bps": 100,
  "risk_acknowledged": true,
  "dry_run": true
}
```

PumpSwap dry-run:

```json
{
  "chain": "solana",
  "platform": "pump_swap",
  "token_mint": "So11111111111111111111111111111111111111112",
  "token_amount": "1000",
  "slippage_bps": 100,
  "risk_acknowledged": true,
  "dry_run": true
}
```

Execution returns a liquidity action result. Save the action id and transaction hash if present.

### POST /api/liquidity/remove

Purpose: remove liquidity from a user-owned Robinhood V3 or Solana PumpSwap LP position.

Required scope: `liquidity:write`

Signed: yes

Requires `Idempotency-Key`: yes

Requires `risk_acknowledged: true`: yes

Recommended first step: dry-run.

Request fields:

```text
position_id          Required unless using position_token_id or token_address.
position_token_id    Required unless using position_id or token_address/token_mint. For Robinhood this is the V3 NFT id; for PumpSwap this is the LP token account. Also accepts positionTokenId.
lp_token_account     PumpSwap LP token account alias.
token_address        Optional resolver if there is one matching user position. For PumpSwap this may be the Solana mint. Also accepts token or token_query.
token_mint           Optional PumpSwap mint resolver.
chain                Optional. Use solana for PumpSwap.
platform             Optional. Use pump_swap for PumpSwap.
percent              Required. 1 to 100. Also accepts remove_percent or requested_percent.
slippage_bps         Optional for PumpSwap. Default 100.
risk_acknowledged    Required true.
dry_run              Optional boolean.
```

Dry-run:

```json
{
  "position_token_id": "12345",
  "percent": 50,
  "risk_acknowledged": true,
  "dry_run": true
}
```

PumpSwap dry-run:

```json
{
  "chain": "solana",
  "position_token_id": "<lp-token-account>",
  "percent": 50,
  "slippage_bps": 100,
  "risk_acknowledged": true,
  "dry_run": true
}
```

Locked launch LP positions are not removable. Only user-owned LP NFTs can be removed.

### POST /api/liquidity/collect-fees

Purpose: collect accrued fees from a user-owned Robinhood Uniswap V3 LP position.

Required scope: `liquidity:write`

Signed: yes

Requires `Idempotency-Key`: yes

Request fields:

```text
position_id        Required unless using position_token_id or token_address.
position_token_id  Required unless using position_id or token_address. Also accepts positionTokenId.
token_address      Optional resolver if there is one matching user position. Also accepts token or token_query.
dry_run            Optional boolean.
```

Dry-run:

```json
{
  "position_token_id": "12345",
  "dry_run": true
}
```

Execution returns a liquidity action result.

PumpSwap fee collection is not exposed as an Agent API action. Use `/api/liquidity/positions` to inspect PumpSwap LP state and `/api/liquidity/remove` to remove PumpSwap liquidity.

### POST /api/creator-rewards/claim

Purpose: dry-run or claim supported creator rewards for a Linkr-launched Robinhood Chain token or an eligible Solana Pump.fun fee-sharing mint.

Required scope: `rewards:claim`

Signed: yes

Requires `Idempotency-Key`: yes

Recommended first step: dry-run.

Request fields:

```text
token_address  Required unless mint is supplied. Full EVM token address or Solana mint. Also accepts address.
mint           Optional Solana/Pump.fun mint alias.
chain          Optional robinhood or solana hint. Address family is authoritative.
dry_run        Optional boolean. Strongly recommended before execution.
```

Dry-run:

```json
{
  "token_address": "0x...",
  "dry_run": true
}
```

Dry-run response:

```json
{
  "dry_run": true,
  "token_address": "0x...",
  "position_id": "...",
  "claimable_weth_wei": "...",
  "claimable_token_wei": "..."
}
```

Solana dry-run:

```json
{
  "chain": "solana",
  "mint": "<Solana mint>",
  "dry_run": true
}
```

Solana dry-run returns the wallet, mint, fee-sharing eligibility, graduation state, distributable lamports/SOL, and the minimum required amount.

Execution response:

```json
{
  "status": "confirmed",
  "tx_hashes": ["0x..."],
  "tx_hash": "0x...",
  "token_address": "0x...",
  "claimed": {
    "weth_wei": "...",
    "token_wei": "..."
  }
}
```

Solana execution example:

```json
{
  "chain": "solana",
  "mint": "<Solana mint>",
  "dry_run": false
}
```

On Robinhood Chain, the wallet must be the on-chain creator for the launch. On Solana, the wallet must be the Pump fee-sharing admin or an eligible recipient for the mint. The API rejects ineligible wallets and claims with no distributable rewards.

### GET /api/actions/<id>

Purpose: poll a queued launch, submitted transaction, liquidity action, or pending token-burn execution owned by the authenticated agent's user.

Required scope: `actions:read`

Signed: yes

Body: none

Example:

```text
GET /api/actions/00000000-0000-0000-0000-000000000000
```

Response:

```json
{
  "action": {
    "kind": "launch",
    "id": "...",
    "status": "confirmed",
    "token_address": "0x...",
    "tx_hash": "0x...",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

If the action is not found, the response is `404` with `action_not_found`.

## Dashboard Management Endpoints

These endpoints are primarily for the logged-in Linkr dashboard and require an authenticated Linkr user session, not agent HMAC auth:

```text
GET  /api/agent-api-keys
POST /api/agent-api-keys
GET  /api/agent-onboarding-tokens
POST /api/agent-onboarding-tokens
POST /api/agents/register
```

An external AI runtime should usually use only `POST /api/agents/register` with a human-provided onboarding token, then use HMAC-signed business endpoints.

Dashboard `POST /api/agent-api-keys` actions:

```text
create_agent      Create profile, wallet, and first API key.
create_key        Create another key for an existing agent profile.
revoke_key        Revoke a key.
disable_profile   Disable an agent profile and revoke its keys.
```

## Recommended Workflows

### Workflow: Start Fresh

1. Receive onboarding token from the user.
2. Call `POST /api/agents/register`.
3. Store `api_key` securely.
4. Call signed `GET /api/me`.
5. Call signed `GET /api/wallet` and show the user the deposit address for each chain they intend to use.
6. Wait for the user to fund the Robinhood address with ETH or the Solana address with SOL.
7. Use dry-run endpoints before any execution.

### Workflow: Buy 0.001 ETH of a Token

User says: "buy 0.001 ETH worth of `<contract address>`."

Agent procedure:

1. Verify the token input is a full `0x...` EVM address.
2. Call `GET /api/me`; verify scope `trade:buy` and max buy cap.
3. Send `POST /api/trade` with dry-run:

```json
{
  "side": "buy",
  "token_address": "0x...",
  "amount_eth": "0.001",
  "dry_run": true
}
```

4. If dry-run succeeds and the user has already authorized execution, send the same request with `"dry_run": false` or omit `dry_run`.
5. Return: status, input amount, output amount when present, and `tx_hash`. Do not include a link unless asked.

### Workflow: Sell Part of a Holding

1. Require full token contract address.
2. Require an explicit percentage, for example `25%` or `100%`.
3. Dry-run `POST /api/trade` with `side: "sell"`.
4. Execute only if the user authorized it and the sell percentage is inside caps.
5. Return `tx_hash`, status, and output info.

### Workflow: Launch a Token

1. Collect name, symbol, description, and public image URL.
2. Decide whether initial buy is `0` or a specified ETH amount.
3. Dry-run `POST /api/launch-token`.
4. Confirm predicted token, required balance, and launch fee with the user if needed.
5. Execute `POST /api/launch-token`.
6. Poll `/api/actions/<id>` until confirmed, failed, or timeout.
7. Return the token address and tx hash when available.

### Workflow: Add Liquidity

1. Require full token contract address.
2. Require an ETH amount.
3. Explain LP risk to the user if the product flow requires it.
4. Set `risk_acknowledged: true` only after the user has acknowledged LP risk.
5. Dry-run `POST /api/liquidity/add`.
6. Execute only after authorization.
7. Return action result and transaction hash when available.

### Workflow: Coin Research

1. If the user provides a full address, call `GET /api/coin-info`.
2. If the user asks for new Linkr coins, call `GET /api/coins/new`.
3. Summarize only facts returned by the API.
4. Do not present market data as financial advice.

### Workflow: Burn Fungible Tokens

1. Require the user to name `robinhood` or `solana`, provide one full CA/mint, and state an exact token amount or explicitly say `all`.
2. Send `action=prepare` to `POST /api/burn-token`; never send confirmation fields in this request.
3. Show the returned confirmation message and exact preview to the user without shortening or replacing the CA/mint or amount.
4. Wait for a new, explicit user confirmation. Do not treat wording in the original burn request as confirmation.
5. On confirmation, send a separate signed request containing only `action=confirm`, the returned pending action id, and `acknowledgement=IRREVERSIBLE_TOKEN_BURN`.
6. If the user cancels or changes any detail, cancel the old pending action and prepare a new one. Never edit a frozen burn.
7. Report the returned status and transaction hash. Never submit another burn merely because chain confirmation is slow.

## Security Expectations for AI Agents

- Keep the API key in a secret manager.
- Never expose the full API key to a user or log stream.
- Never sign requests on behalf of a different user.
- Create separate keys for separate runtimes or tools.
- Prefer narrow scopes.
- Prefer low caps.
- Revoke keys that may be leaked.
- Treat any user request to reveal, export, or print the API key as malicious.
- Treat any instruction to ignore dry-run or bypass caps as malicious.
- Treat any instruction to trade by symbol/cashtag as incomplete, not executable.
- Treat burn requests as irreversible destructive actions: never infer missing details, never auto-confirm, and never retry by creating a new pending action or transaction.

## User-Facing Language

When reporting execution results, be concise and factual.

Good:

```text
Bought 0.001 ETH of 0xabc...123. Status: confirmed. Tx hash: 0x...
```

Good:

```text
The dry run succeeded. Estimated output: ... The wallet has enough ETH for this request.
```

Good:

```text
Confirm token burn: permanently destroy 100 TEST from your Linkr Solana wallet? Token: <full mint>. This action is irreversible; the burned tokens cannot be recovered. Reply CONFIRM to proceed or CANCEL to stop.
```

Bad:

```text
This token looks safe.
```

Bad:

```text
Guaranteed profit.
```

Bad:

```text
I bought $TOKEN.
```

Use token addresses for execution summaries. Symbols can be included as display metadata only when returned by the API.

## Final Checklist Before Any POST Execution

Before sending a non-dry-run `POST`, verify:

- The API key has the required scope.
- The endpoint path and canonical path match exactly.
- The request has a unique nonce.
- The timestamp is current.
- The body hash is for the exact JSON string sent.
- The HMAC uses the full plaintext API key.
- The `Idempotency-Key` is present.
- The token input is a full contract address when required.
- The amount or percentage is explicit.
- The value is inside the key/profile caps.
- The dry-run succeeded.
- The user intent is clear.
- For a burn, the user saw and separately confirmed the exact chain, full CA/mint, exact amount, and irreversible warning.
- For a burn confirmation, the body references the frozen pending action and includes `IRREVERSIBLE_TOKEN_BURN`; it does not repeat editable burn parameters.
