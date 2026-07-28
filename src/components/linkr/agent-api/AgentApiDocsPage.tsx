import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  KeyRound,
  Lock,
  PlayCircle,
  ShieldCheck,
  Terminal,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import "@/components/linkr/docs/linkr-docs.css";
import "./agent-api-docs.css";

const tocGroups = [
  {
    label: "Tutorial",
    items: [
      { id: "start-here", label: "Start here" },
      { id: "login", label: "Log in with X" },
      { id: "create-agent", label: "Create an agent" },
      { id: "register-runtime", label: "Register runtime" },
      { id: "fund-wallet", label: "Fund wallet" },
    ],
  },
  {
    label: "Requests",
    items: [
      { id: "signing", label: "Signing" },
      { id: "first-calls", label: "First calls" },
      { id: "endpoints", label: "Endpoints" },
    ],
  },
  {
    label: "Operate",
    items: [
      { id: "workflows", label: "Workflows" },
      { id: "monitor", label: "Monitor" },
      { id: "safety", label: "Safety" },
    ],
  },
] as const;

const endpoints = [
  [
    "POST",
    "/api/agents/register",
    "onboarding token",
    "Redeem a one-time onboarding token and receive the runtime credentials once.",
  ],
  [
    "GET",
    "/api/me",
    "profile:read",
    "Authenticated agent profile, EVM wallet, scopes, and limits.",
  ],
  [
    "GET",
    "/api/wallet",
    "profile:read",
    "Robinhood and Solana deposit addresses and native balances.",
  ],
  ["GET", "/api/portfolio", "profile:read", "Current native balances and token holdings."],
  [
    "GET",
    "/api/history",
    "actions:read",
    "Private transactions, launches, settings, agent history, pending work, and recent activity.",
  ],
  ["GET", "/api/coins/new", "coins:read", "Recent Linkr-launched coins."],
  [
    "GET",
    "/api/coin-info",
    "coin:read",
    "Robinhood coin detail or Solana token analytics with Pump fee-sharing rewards.",
  ],
  [
    "POST",
    "/api/launch-token",
    "launch:write",
    "Queue a Robinhood Chain or Solana/Pump.fun token launch.",
  ],
  [
    "POST",
    "/api/trade",
    "trade:buy / trade:sell",
    "Dry-run or execute buys and sells by full EVM address or Solana mint.",
  ],
  ["POST", "/api/transfer", "transfer:write", "Dry-run or transfer native ETH or SOL."],
  [
    "GET",
    "/api/schedules",
    "schedule:read",
    "List scheduled wallet, launch, rewards, and liquidity actions.",
  ],
  ["POST", "/api/schedules", "schedule:write", "Create timed, recurring, or market-cap schedules."],
  [
    "PATCH",
    "/api/schedules/{id}",
    "schedule:write",
    "Pause, resume, cancel, or update a schedule.",
  ],
  [
    "POST",
    "/api/burn-token",
    "burn:write",
    "Prepare, separately confirm, or cancel an irreversible fungible-token burn.",
  ],
  [
    "GET",
    "/api/liquidity/positions",
    "actions:read",
    "List Robinhood V3 and Solana PumpSwap LP positions.",
  ],
  [
    "POST",
    "/api/liquidity/add",
    "liquidity:write",
    "Dry-run or add Robinhood V3 or PumpSwap liquidity.",
  ],
  [
    "POST",
    "/api/liquidity/remove",
    "liquidity:write",
    "Dry-run or remove Robinhood V3 or PumpSwap liquidity.",
  ],
  [
    "POST",
    "/api/liquidity/collect-fees",
    "liquidity:write",
    "Dry-run or collect Robinhood V3 LP fees.",
  ],
  [
    "POST",
    "/api/creator-rewards/claim",
    "rewards:claim",
    "Dry-run or claim Robinhood Chain launch rewards or eligible Solana Pump.fun fee-sharing rewards.",
  ],
  [
    "GET",
    "/api/actions/<id>",
    "actions:read",
    "Poll queued launches, submitted actions, and pending burn execution.",
  ],
] as const;

export function AgentApiDocsPage() {
  return (
    <div className="lkd-page agent-api-page">
      <MarketingHeader />
      <div className="lkd-shell agent-api-shell" role="main">
        <section className="lkd-masthead agent-api-masthead">
          <div className="lkd-masthead-main">
            <h1>
              Linkr <span>Agent API</span>
            </h1>
            <p>
              A step-by-step guide for connecting an AI agent to Linkr: log in with X, create an
              agent in the dashboard, register its runtime, fund its wallet, and send signed
              requests for coins, trades, launches, transfers, separately confirmed token burns,
              liquidity, rewards, and monitoring.
            </p>
            <div className="lkd-masthead-actions">
              <Link to="/app/api-keys">Open Agents dashboard</Link>
              <a href="/skill.md">Open skill.md</a>
              <a href="/api/openapi.json">OpenAPI JSON</a>
            </div>
          </div>
          <div className="lkd-command-preview agent-api-signing-card">
            <span>Signed request</span>
            <code>Authorization: Bearer linkr_live_...</code>
            <code>X-Linkr-Timestamp: 1783890000</code>
            <code>X-Linkr-Nonce: 13e4c9b7f86d4a81</code>
            <code>X-Linkr-Body-SHA256: {"<hash>"}</code>
            <code>X-Linkr-Signature: {"<hmac>"}</code>
          </div>
        </section>

        <MobileTopIndex />

        <div className="lkd-layout agent-api-layout">
          <aside className="lkd-sidebar agent-api-sidebar" aria-label="Agent API index">
            <SidebarNav onNavigate={() => {}} />
          </aside>

          <article className="lkd-content agent-api-content">
            <InfoSection
              id="start-here"
              icon={Terminal}
              eyebrow="Start here"
              title="From zero to a live agent"
            >
              <div className="agent-api-copy">
                <p>
                  The Linkr Agent API lets a user give an AI agent a controlled Linkr identity, a
                  generated Robinhood Chain EVM wallet, an automatically prepared Solana app wallet
                  on the same profile, and narrowly scoped API access. Once set up, that agent can
                  read EVM and Solana coin data, inspect wallets, portfolio, and history, launch
                  supported tokens, buy and sell by full contract address or Solana mint, transfer
                  native ETH or SOL, prepare and separately confirm irreversible token burns, manage
                  Robinhood V3 and PumpSwap liquidity, claim supported creator rewards, and report
                  every action back to the user.
                </p>
                <p>
                  The user always controls the agent from the dashboard. They log in with X, create
                  an agent profile, copy a one-time API key or onboarding token, fund the right
                  profile wallets, and can later revoke a key or disable the whole agent.
                </p>
              </div>
              <div className="agent-api-flow">
                <FlowStep
                  label="01"
                  title="Log in"
                  text="The user signs in with X so Linkr can attach agents to their account."
                />
                <FlowStep
                  label="02"
                  title="Create agent"
                  text="The Agents dashboard creates the profile, wallet access, scopes, limits, and key."
                />
                <FlowStep
                  label="03"
                  title="Fund wallet"
                  text="The user funds Robinhood Chain ETH and Solana SOL for the chains the agent will use."
                />
                <FlowStep
                  label="04"
                  title="Operate"
                  text="The agent signs requests, dry-runs first, executes, and tracks action ids."
                />
              </div>
            </InfoSection>

            <InfoSection id="login" icon={Wallet} eyebrow="Step 1" title="Log in with X">
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Start as the human owner</h3>
                  <p>
                    Open Linkr, sign in with your X account, and go to the dashboard. This creates
                    the user-owned Linkr profile that agents, wallets, API keys, limits, and action
                    logs will be attached to.
                  </p>
                  <CheckList
                    items={[
                      "Use the same X account that should own and supervise the agents.",
                      "Open Dashboard -> Agents after login.",
                      "Do not hand an agent your X login. Agents use generated API credentials instead.",
                    ]}
                  />
                </div>
                <div className="lkd-info-panel">
                  <h3>Why login is required</h3>
                  <p>
                    Agent profiles are not anonymous. Each one belongs to a Linkr user, gets a
                    generated EVM wallet plus the user's Solana wallet set, and is governed by
                    scopes, spending limits, revocable keys, and dashboard activity history.
                  </p>
                  <CheckList
                    items={[
                      "The user controls funding by funding only the Linkr wallet addresses they intend to use.",
                      "The user controls permissions by choosing scopes and caps.",
                      "The user can stop access by revoking a key or disabling an agent.",
                    ]}
                  />
                </div>
              </div>
              <div className="lkd-masthead-actions agent-api-bottom-actions">
                <Link to="/auth" search={{ returnTo: "/agent-api" }}>
                  Log in with X
                </Link>
                <Link to="/app/api-keys">Open Agents</Link>
              </div>
            </InfoSection>

            <InfoSection
              id="create-agent"
              icon={KeyRound}
              eyebrow="Step 2"
              title="Create the agent in the dashboard"
            >
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Direct setup</h3>
                  <p>
                    Use this when you control the runtime yourself. In Dashboard -&gt; Agents, enter
                    an agent name and contact, then click Create agent and key. Linkr creates the
                    profile, generated EVM wallet, scopes, limits, and first API key.
                  </p>
                  <CheckList
                    items={[
                      "Copy the API key immediately; Linkr will not show it again.",
                      "Store it in the AI runtime's secret manager.",
                      "Use the key only from the runtime that should control this agent.",
                    ]}
                  />
                </div>
                <div className="lkd-info-panel">
                  <h3>Onboarding token setup</h3>
                  <p>
                    Use this when an external AI runtime needs to register itself. In Dashboard
                    -&gt; Agents, click Create onboarding token, give that one-time token to the
                    runtime, and have the runtime redeem it through /api/agents/register.
                  </p>
                  <CheckList
                    items={[
                      "Onboarding tokens are temporary and redeem once.",
                      "Redemption returns the generated EVM wallet and first API key.",
                      "After redemption, normal requests must be HMAC signed.",
                    ]}
                  />
                </div>
              </div>
            </InfoSection>

            <InfoSection
              id="register-runtime"
              icon={ShieldCheck}
              eyebrow="Step 3"
              title="Register the AI runtime"
            >
              <div className="agent-api-copy">
                <p>
                  If the user created a direct key, registration is already complete: store the key
                  and start with GET /api/me. If the user created an onboarding token, redeem it
                  once. Registration is the only setup call that can run before the agent has an API
                  key.
                </p>
              </div>
              <CodeBlock>
                {`POST /api/agents/register
{
  "onboarding_token": "one-time-token",
  "agent_name": "Research Bot",
  "public_contact": "ops@example.com",
  "requested_scopes": [
    "profile:read",
    "actions:read",
    "coins:read",
    "coin:read",
    "trade:buy",
    "trade:sell"
  ],
  "limits": {
    "max_buy_eth": 0.01,
    "max_buy_sol": 0.05,
    "max_sell_percent": 25,
    "max_transfer_eth": 0,
    "max_transfer_sol": 0,
    "max_launch_initial_buy_eth": 0.01,
    "max_liquidity_eth": 0
  }
}`}
              </CodeBlock>
              <div className="agent-api-copy">
                <p>
                  The response includes the agent profile id, generated EVM wallet, scopes, limits,
                  and one plaintext API key. The API key is also the HMAC secret. Store it securely
                  and never expose it in prompts, logs, browser URLs, or public repositories.
                </p>
                <p>
                  Request <code>burn:write</code> only when the runtime genuinely needs destructive
                  token operations. It is opt-in in the dashboard and does not remove the mandatory
                  separate burn confirmation.
                </p>
              </div>
            </InfoSection>

            <InfoSection id="fund-wallet" icon={Wallet} eyebrow="Step 4" title="Fund the wallet">
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Find the profile wallets</h3>
                  <p>
                    Every value-moving API call uses a Linkr wallet on the user's profile, not the
                    user's X account and not a random wallet supplied by the agent. Robinhood Chain
                    actions use the generated EVM wallet. Solana trades, SOL transfers, Pump.fun
                    launches, PumpSwap liquidity, and Solana rewards use the user's primary Solana
                    wallet.
                  </p>
                  <CodeBlock compact>
                    {`GET /api/me

{
  "wallet": {
    "address": "0x...",
    "chain_id": 4663
  }
}

GET /api/wallet

{
  "deposit_addresses": {
    "robinhood": "0x...",
    "solana": "<Solana address>"
  }
}`}
                  </CodeBlock>
                </div>
                <div className="lkd-info-panel">
                  <h3>Fund deliberately</h3>
                  <p>
                    The user sends Robinhood Chain ETH to the generated EVM wallet for EVM actions
                    and SOL to the primary Solana wallet for Solana swaps, fees, and transfers. No
                    funded wallet means no buys, launches with initial buys, transfers, liquidity
                    changes, or reward-claim gas.
                  </p>
                  <CheckList
                    items={[
                      "Start with small balances and low per-key caps.",
                      "Dry-run value-moving requests before execution.",
                      "Only fund wallet addresses returned by Linkr.",
                      "Use GET /api/wallet or the app Wallet page for separate Robinhood and Solana deposit addresses and native balances.",
                    ]}
                  />
                </div>
              </div>
            </InfoSection>

            <InfoSection id="signing" icon={Lock} eyebrow="Step 5" title="Sign every request">
              <div className="agent-api-copy">
                <p>
                  Every business endpoint requires the API key as a bearer token plus HMAC headers.
                  POST requests also require an idempotency key. Replayed nonces, stale timestamps,
                  invalid body hashes, missing scopes, and exceeded limits fail before wallet work
                  starts.
                </p>
                <CheckList
                  items={[
                    "Keep scopes narrow and issue separate keys per agent runtime.",
                    "Sign the canonical Linkr app path, for example /api/trade, not an underlying service or redirected URL.",
                    "For GET requests, include the query string exactly as sent.",
                    "For POST requests, hash the exact JSON string you send.",
                  ]}
                />
              </div>
              <CodeBlock>
                {`Authorization: Bearer linkr_live_<prefix>_<secret>
X-Linkr-Timestamp: <unix_seconds>
X-Linkr-Nonce: <unique_random_nonce>
X-Linkr-Body-SHA256: <sha256_hex_of_exact_body>
X-Linkr-Signature: <hmac_sha256_hex>
Idempotency-Key: <required_for_post>`}
              </CodeBlock>
              <CodeBlock>
                {`LINKR-HMAC-SHA256
POST
/api/trade
<BODY_SHA256_HEX>
<X_LINKR_TIMESTAMP>
<X_LINKR_NONCE>
<IDEMPOTENCY_KEY>`}
              </CodeBlock>
            </InfoSection>

            <InfoSection
              id="first-calls"
              icon={PlayCircle}
              eyebrow="Step 6"
              title="Make the first safe calls"
            >
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Confirm identity</h3>
                  <p>
                    The first signed request should be GET /api/me. It proves the key works and
                    returns the agent profile, generated EVM wallet, scopes, limits, and current
                    status.
                  </p>
                  <CodeBlock compact>{`GET /api/me`}</CodeBlock>
                </div>
                <div className="lkd-info-panel">
                  <h3>Read before trading</h3>
                  <p>
                    List new coins or inspect one coin before attempting value-moving actions. Coin
                    info should be the source for market data, creator rewards, pool data, and the
                    full contract address. For Solana, use the mint parameter for market analytics
                    and Pump fee-sharing reward status.
                  </p>
                  <CodeBlock compact>
                    {`GET /api/coins/new?limit=20
GET /api/coin-info?token_address=0x...
GET /api/coin-info?mint=So11111111111111111111111111111111111111112`}
                  </CodeBlock>
                </div>
              </div>
              <div className="agent-api-copy">
                <p>
                  Once the wallet is funded and the read calls work, use dry_run on value-moving
                  endpoints. Only execute after the dry run returns the expected token, amounts,
                  limits, and risk checks.
                </p>
              </div>
            </InfoSection>

            <section id="endpoints" className="lkd-section agent-api-section" data-doc-section>
              <div className="lkd-section-head">
                <span>
                  <Code2 size={16} aria-hidden="true" />
                  Reference
                </span>
                <h2>Endpoints</h2>
                <p>
                  Registration uses the one-time onboarding flow described above. Use the remaining
                  endpoints after the agent is registered, funded where needed, and able to sign
                  requests. Coin info supports Robinhood Chain EVM contracts and Solana mints for
                  analytics, including Solana creator reward status from Pump fee sharing when
                  available. Trading supports full Robinhood Chain EVM contract addresses or full
                  Solana mint addresses. Launches use Robinhood Chain unless the request sets
                  chain=solana or chain=pump_fun for Pump.fun. Liquidity add/remove supports
                  Robinhood Chain Uniswap V3 and Solana Pump.fun/PumpSwap positions; collect-fees is
                  Robinhood V3 only. Cashtags, symbols, names, and guesses are not executable
                  inputs. Solana NFT minting is available through the X and app NFT flow, not
                  through the Agent API.
                </p>
              </div>
              <div className="agent-api-endpoint-list">
                {endpoints.map(([method, path, scope, text]) => (
                  <article key={path} className="agent-api-endpoint-row">
                    <strong>{method}</strong>
                    <code>{path}</code>
                    <span>{scope}</span>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
              <div className="lkd-split agent-api-endpoint-notes">
                <div className="lkd-info-panel">
                  <h3>Value-moving payloads</h3>
                  <CheckList
                    items={[
                      "Trade: for Robinhood use token_address plus amount_eth for buys or percent for sells; for Solana use chain=solana, token_mint, amount_sol for buys or percent for sells.",
                      "Launch: name, symbol, description, HTTPS image_url, dry_run, optional chain=solana or chain=pump_fun for Pump.fun, initial_buy_eth for Robinhood, initial_buy_sol for Solana, optional HTTPS website_url, twitter_url, telegram_url, and optional Solana creator-reward recipient settings.",
                      "Transfer: for Robinhood use recipient plus amount_eth; for Solana use chain=solana, recipient, amount_sol, dry_run, and a low max_transfer_sol cap.",
                      "Schedules: use /api/schedules with action_type buy, sell, transfer, launch_coin, claim_creator_rewards, add_liquidity, remove_liquidity, or collect_liquidity_fees. Timed triggers accept scheduled_for/run_at/starts_at, delay_seconds/after_seconds, or interval_seconds for the first run; schedule_kind can be one_time, interval, daily, or weekly. Market-cap triggers support buy/sell condition schedules, including recurring conditions.",
                      "Burn: POST /api/burn-token with action=prepare, explicit chain, one full CA/mint, and an exact token amount or all. Show the returned warning, then use a separate signed action=confirm request with the frozen pending id and IRREVERSIBLE_TOKEN_BURN acknowledgement.",
                      "Liquidity add: for Robinhood use token_address plus amount_eth; for PumpSwap use chain=solana or platform=pump_swap, token_mint, token_amount or token_amount_raw, dry_run, and risk_acknowledged.",
                      "Liquidity remove: use position_id, position_token_id, token_address, or token_mint plus percent, dry_run, risk_acknowledged, and chain/platform when needed.",
                      "Liquidity collect-fees: Robinhood V3 positions only.",
                      "Rewards: use token_address for Robinhood Chain or token_address/mint for Solana, dry_run first, then execute only after the user approves the exact claim.",
                    ]}
                  />
                </div>
                <div className="lkd-info-panel">
                  <h3>Read-only payloads</h3>
                  <CheckList
                    items={[
                      "Me: no body; returns wallet, scopes, status, and limits.",
                      "Wallet: no body; returns Robinhood and Solana deposit addresses plus native balances.",
                      "Portfolio: optional chain, token, and limit query parameters.",
                      "History: optional kind, token, action, after, before, sort, and limit query parameters.",
                      "New coins: optional limit and status query parameters.",
                      "Coin info: token_address=<0x...> for Robinhood Chain detail, or mint=<Solana mint> for Solana market analytics and Pump fee-sharing reward data.",
                      "Liquidity positions: optional chain, platform, status, token, include_closed, and limit query parameters.",
                      "Actions: action id in the URL path.",
                      "Schedules: optional status and limit query parameters, or /api/schedules/<id> for one schedule.",
                    ]}
                  />
                </div>
              </div>
            </section>

            <InfoSection
              id="workflows"
              icon={PlayCircle}
              eyebrow="Workflows"
              title="What a working agent can do"
            >
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Buy or sell a token</h3>
                  <p>
                    Use /api/trade with a full Robinhood Chain contract address or Solana mint. For
                    buys, send amount_eth on Robinhood or amount_sol on Solana. For sells, send
                    percent. Dry-run first, then execute after explicit user approval.
                  </p>
                  <CodeBlock compact>
                    {`POST /api/trade
{
  "side": "buy",
  "token_address": "0x...",
  "amount_eth": "0.001",
  "dry_run": true
}

POST /api/trade
{
  "chain": "solana",
  "side": "buy",
  "token_mint": "So11111111111111111111111111111111111111112",
  "amount_sol": "0.01",
  "dry_run": true
}`}
                  </CodeBlock>
                </div>
                <div className="lkd-info-panel">
                  <h3>Launch a token</h3>
                  <p>
                    Use /api/launch-token when the user provides launch metadata. The generated
                    wallet for the selected chain pays gas and any approved initial buy. Omit chain
                    for Robinhood Chain, or send chain=solana for a Pump.fun launch from the user's
                    primary Solana wallet. If website_url is omitted, Linkr uses
                    https://linkr.cash/coin/&lt;token&gt;. Optional website, X/Twitter, Telegram,
                    and source metadata URLs must be HTTPS links. Solana launches can also configure
                    Pump.fun creator-reward mode and an optional recipient split. The response can
                    include an action id to poll through /api/actions/&lt;id&gt;.
                  </p>
                  <CodeBlock compact>
                    {`POST /api/launch-token
{
  "name": "Example",
  "symbol": "EXAMPLE",
  "description": "A token launched through Linkr.",
  "image_url": "https://...",
  "website_url": "https://example.xyz",
  "twitter_url": "https://x.com/user/status/123",
  "telegram_url": "https://t.me/example"
}

POST /api/launch-token
{
  "chain": "solana",
  "name": "Example",
  "symbol": "EXAMPLE",
  "description": "A token launched through Linkr on Pump.fun.",
  "image_url": "https://...",
  "initial_buy_sol": "0.1",
  "telegram_url": "https://t.me/example",
  "creator_reward_recipient": "@recipient",
  "creator_reward_share_bps": 2500,
  "dry_run": true
}`}
                  </CodeBlock>
                </div>
              </div>
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Burn fungible tokens</h3>
                  <p>
                    Burns are intentionally a two-request operation. Prepare with an explicit chain,
                    one full CA or mint, and an exact token-unit amount (or the explicit value all).
                    Show the returned exact warning to the user. Only after a new, explicit
                    confirmation should the runtime send the separate confirm request. The pending
                    action expires after 15 minutes and its wallet, chain, token, decimals, and raw
                    amount cannot be edited.
                  </p>
                  <CodeBlock compact>
                    {`POST /api/burn-token
{
  "action": "prepare",
  "chain": "solana",
  "token": "<full-solana-mint>",
  "amount": "100.25"
}

// Send only after the user confirms the returned warning.
POST /api/burn-token
{
  "action": "confirm",
  "pending_action_id": "<pending-action-uuid>",
  "acknowledgement": "IRREVERSIBLE_TOKEN_BURN"
}`}
                  </CodeBlock>
                </div>
                <div className="lkd-info-panel">
                  <h3>Burn safety contract</h3>
                  <CheckList
                    items={[
                      "No prepare-and-execute request exists; confirm is a separately signed request.",
                      "Tickers, names, links, prior context, native ETH/SOL, NFTs, and LP removal are rejected.",
                      "Solana uses BurnChecked from wallet-owned SPL Token or Token-2022 accounts.",
                      "Robinhood Chain requires a token contract with the standard holder burn(uint256) function and a successful simulation.",
                      "After an EVM receipt confirms, Linkr verifies that the wallet balance and total supply both decreased by the exact frozen amount.",
                      "Unsupported EVM tokens are refused; Linkr never silently substitutes a dead-address transfer.",
                      "A retry can only rebroadcast the same signed transaction; it cannot create a second burn.",
                    ]}
                  />
                </div>
              </div>
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Transfer funds</h3>
                  <p>
                    Use /api/transfer to move native ETH from the generated EVM wallet or native SOL
                    from the primary Solana wallet. Keep this scope off by default unless the agent
                    truly needs it, and keep max_transfer_eth and max_transfer_sol low.
                  </p>
                  <CodeBlock compact>
                    {`POST /api/transfer
{
  "recipient": "0x...",
  "amount_eth": "0.001",
  "dry_run": true
}

POST /api/transfer
{
  "chain": "solana",
  "recipient": "7YttLkHDoU8cbxC2q2wA3GcU6s4YtZ8VXjZJfGQWbS9u",
  "amount_sol": "0.01",
  "dry_run": true
}`}
                  </CodeBlock>
                </div>
                <div className="lkd-info-panel">
                  <h3>Add or remove liquidity</h3>
                  <p>
                    Use /api/liquidity/add and /api/liquidity/remove for Robinhood Chain Uniswap V3
                    positions and graduated Pump.fun PumpSwap pools. Use /api/liquidity/positions to
                    inspect positions first. Fee collection is currently Robinhood V3 only. Agents
                    should dry-run and explain the exact token, position, amount, and expected
                    effect first.
                  </p>
                  <CodeBlock compact>
                    {`POST /api/liquidity/add
{
  "token_address": "0x...",
  "amount_eth": "0.001",
  "risk_acknowledged": true,
  "dry_run": true
}

POST /api/liquidity/add
{
  "chain": "solana",
  "platform": "pump_swap",
  "token_mint": "So11111111111111111111111111111111111111112",
  "token_amount": "1000",
  "slippage_bps": 100,
  "risk_acknowledged": true,
  "dry_run": true
}

POST /api/liquidity/remove
{
  "chain": "solana",
  "position_token_id": "<lp-token-account>",
  "percent": 25,
  "risk_acknowledged": true,
  "dry_run": true
}`}
                  </CodeBlock>
                </div>
              </div>
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Schedule actions</h3>
                  <p>
                    Use /api/schedules for one-time or recurring timed actions. Market-cap
                    conditions are available for buy and sell schedules only. Scheduled launches,
                    rewards, and liquidity still run through the same validation as their immediate
                    endpoints.
                  </p>
                  <CodeBlock compact>
                    {`POST /api/schedules
{
  "chain": "solana",
  "action_type": "buy",
  "token_address": "<Solana mint>",
  "amount": "0.02",
  "amount_unit": "sol",
  "trigger_type": "time",
  "delay_seconds": 3600,
  "schedule_kind": "one_time"
}

POST /api/schedules
{
  "chain": "robinhood",
  "action_type": "sell",
  "token_address": "0x...",
  "sell_percent": 50,
  "trigger_type": "market_cap",
  "trigger_direction": "above",
  "trigger_value_usd": "1000000",
  "schedule_kind": "condition"
}`}
                  </CodeBlock>
                </div>
                <div className="lkd-info-panel">
                  <h3>Control schedules</h3>
                  <p>
                    Use GET /api/schedules to list schedules, GET /api/schedules/&lt;id&gt; to read
                    one schedule, PATCH to pause, resume, cancel, or update it, and DELETE to cancel
                    it. Agents should show the user the exact trigger and action before creating or
                    changing a schedule.
                  </p>
                  <CodeBlock compact>
                    {`GET /api/schedules?status=active

PATCH /api/schedules/<id>
{
  "action": "pause"
}

PATCH /api/schedules/<id>
{
  "action": "update",
  "scheduled_for": "2026-08-01T17:00:00Z"
}`}
                  </CodeBlock>
                </div>
              </div>
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Claim creator rewards</h3>
                  <p>
                    Use /api/coin-info with a Robinhood Chain token address or Solana mint to
                    inspect creator reward status first. Then dry-run /api/creator-rewards/claim for
                    rewards controlled by the matching Linkr profile wallet. The endpoint supports
                    Robinhood Chain launch rewards and eligible Solana Pump.fun fee-sharing rewards.
                  </p>
                  <CodeBlock compact>
                    {`POST /api/creator-rewards/claim
{
  "token_address": "0x...",
  "dry_run": true
}

POST /api/creator-rewards/claim
{
  "chain": "solana",
  "mint": "<Solana mint>",
  "dry_run": true
}`}
                  </CodeBlock>
                </div>
                <div className="lkd-info-panel">
                  <h3>Track coins and actions</h3>
                  <p>
                    Use /api/coins/new to find recent launches, /api/coin-info for the same coin
                    detail data users see, /api/coin-info?mint=&lt;Solana mint&gt; for Solana token
                    analytics and Pump fee-sharing rewards, /api/wallet and /api/portfolio for the
                    same wallet visibility users can ask for on X, /api/history for prior private
                    activity, and /api/actions/&lt;id&gt; to track queued or submitted work.
                  </p>
                </div>
              </div>
            </InfoSection>

            <InfoSection
              id="monitor"
              icon={BookOpen}
              eyebrow="Dashboard"
              title="Monitor and control agents"
            >
              <div className="lkd-split">
                <div className="lkd-info-panel">
                  <h3>Agent actions</h3>
                  <p>
                    The Agents page shows recent API actions for linked agents: method, endpoint
                    path, key prefix, response status, timestamp, and any error code. Use it to
                    understand what each runtime is doing.
                  </p>
                  <CheckList
                    items={[
                      "Successful requests show their status code.",
                      "Failed requests show an error code and message.",
                      "Action ids can also be polled through /api/actions/<id>.",
                    ]}
                  />
                </div>
                <div className="lkd-info-panel">
                  <h3>Stop access</h3>
                  <p>
                    Revoke one API key to stop one runtime without deleting the whole agent. Disable
                    the agent profile to stop the profile and revoke its keys.
                  </p>
                  <CheckList
                    items={[
                      "Use separate keys for separate runtimes.",
                      "Disable unused agents instead of leaving dormant keys active.",
                      "Rotate credentials after any suspected leak.",
                    ]}
                  />
                </div>
              </div>
            </InfoSection>

            <InfoSection id="safety" icon={ShieldCheck} eyebrow="Safety" title="Operational rules">
              <div className="agent-api-safety-grid">
                <div className="lkd-info-panel">
                  <h3>Funds stay scoped</h3>
                  <p>
                    Each agent acts from Linkr profile wallets. Fund the right wallet deliberately,
                    keep per-key transaction caps low, and only enable scopes the runtime actually
                    needs.
                  </p>
                </div>
                <div className="lkd-info-panel">
                  <h3>Execution stays explicit</h3>
                  <p>
                    Use dry_run, idempotency keys, and exact contract addresses. Responses return
                    plain transaction hashes when execution succeeds; agents should not invent links
                    or pretend a dry run moved funds.
                  </p>
                  <p>
                    Burns are the exception to the normal dry-run/execute shape: prepare returns a
                    frozen preview, and only a later separately signed confirm request can execute
                    it. Never create a second burn because confirmation is slow.
                  </p>
                </div>
              </div>
              <div className="agent-api-copy">
                <p>
                  A complete production setup is: user logs in with X, creates an agent on the
                  Agents dashboard, gives the runtime a direct key or onboarding token, confirms the
                  generated EVM wallet with /api/me, checks chain-specific addresses with
                  /api/wallet, funds the right wallet, verifies read calls, dry-runs value-moving
                  requests, executes only with clear user intent, then monitors every action from
                  the dashboard.
                </p>
              </div>
              <div className="lkd-masthead-actions agent-api-bottom-actions">
                <Link to="/app/api-keys">Manage agents</Link>
                <Link to="/docs">Bot docs</Link>
              </div>
            </InfoSection>
          </article>
        </div>
      </div>
    </div>
  );
}

function MobileTopIndex() {
  return (
    <nav className="lkd-mobile-index agent-api-index" aria-label="Mobile agent API index">
      <div className="lkd-mobile-index-head">
        <span>
          <BookOpen aria-hidden="true" size={15} strokeWidth={2.5} />
          Agent API index
        </span>
        <small>{tocGroups.reduce((count, group) => count + group.items.length, 0)} sections</small>
      </div>
      <div className="lkd-mobile-index-groups">
        {tocGroups.map((group) => (
          <div className="lkd-mobile-index-group" key={group.label}>
            <span>{group.label}</span>
            <div>
              {group.items.map((item) => (
                <a key={item.id} href={"#" + item.id}>
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="lkd-sidebar-inner">
      <div className="lkd-sidebar-title">
        <span>Agent API index</span>
      </div>
      <nav>
        {tocGroups.map((group) => (
          <div className="lkd-nav-group" key={group.label}>
            <span>{group.label}</span>
            {group.items.map((item) => (
              <a key={item.id} href={"#" + item.id} onClick={onNavigate}>
                <ChevronRight aria-hidden="true" size={14} />
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

function InfoSection({
  id,
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="lkd-section agent-api-section" data-doc-section>
      <div className="lkd-section-head">
        <span>
          <Icon size={16} aria-hidden="true" />
          {eyebrow}
        </span>
        <h2>{title}</h2>
      </div>
      <div className="agent-api-section-body">{children}</div>
    </section>
  );
}

function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="lkd-check-list">
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" size={16} strokeWidth={2.8} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FlowStep({ label, title, text }: { label: string; title: string; text: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function CodeBlock({ children, compact = false }: { children: string; compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "lkd-code-block lkd-code-block-compact agent-api-code-block"
          : "lkd-code-block agent-api-code-block"
      }
    >
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}
