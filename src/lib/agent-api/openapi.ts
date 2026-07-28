export const agentApiOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Linkr Agent API",
    version: "1.4.1",
    description:
      "Authenticated API for Linkr agent profiles, wallets, portfolio, history, token launches, trades, transfers, schedules, separately confirmed token burns, Pump.fun/PumpSwap and Robinhood liquidity, rewards, and coin data.",
  },
  servers: [{ url: "https://linkr.cash" }],
  components: {
    securitySchemes: {
      LinkrApiKey: { type: "http", scheme: "bearer" },
      LinkrHmac: {
        type: "apiKey",
        in: "header",
        name: "X-Linkr-Signature",
        description:
          "HMAC-SHA256 over the canonical Linkr request. Also send X-Linkr-Timestamp, X-Linkr-Nonce, and X-Linkr-Body-SHA256.",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: { type: "object" },
            },
          },
        },
      },
      ActionResponse: {
        type: "object",
        properties: {
          result: { type: "object" },
          action: { type: "object" },
          dry_run: { type: "boolean" },
          quote: { type: "object" },
          idempotent_replay: { type: "boolean" },
        },
      },
      LaunchTokenRequest: {
        type: "object",
        required: ["name", "symbol", "description", "image_url"],
        properties: {
          chain: {
            type: "string",
            enum: ["robinhood", "evm", "4663", "solana", "sol", "pump_fun"],
            default: "robinhood",
          },
          name: {
            type: "string",
            maxLength: 60,
            description: "Token name. Solana/Pump.fun launches allow up to 32 characters.",
          },
          symbol: {
            type: "string",
            maxLength: 20,
            description: "Token ticker. Solana/Pump.fun launches allow up to 10 characters.",
          },
          description: { type: "string", maxLength: 512 },
          image_url: {
            type: "string",
            format: "uri",
            description: "HTTPS token image URL.",
          },
          initial_buy_eth: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Robinhood Chain initial buy amount in ETH. Defaults to 0.",
          },
          dev_buy_eth: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Alias for initial_buy_eth.",
          },
          initial_buy_sol: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Solana/Pump.fun initial buy amount in SOL. Defaults to 0.",
          },
          dev_buy_sol: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Alias for initial_buy_sol.",
          },
          website_url: {
            type: "string",
            format: "uri",
            description: "Optional HTTPS website metadata URL.",
          },
          twitter_url: {
            type: "string",
            format: "uri",
            description: "Optional HTTPS x.com or twitter.com metadata URL.",
          },
          telegram_url: {
            type: "string",
            format: "uri",
            description: "Optional HTTPS t.me metadata URL.",
          },
          source_url: {
            type: "string",
            format: "uri",
            description: "Optional HTTPS source URL.",
          },
          pump_reward_mode: {
            type: "string",
            enum: ["creator_rewards", "cashback"],
            description: "Solana/Pump.fun creator-reward mode.",
          },
          pump_cashback: {
            type: "boolean",
            description: "Set true to use Pump.fun cashback mode on Solana launches.",
          },
          creator_reward_recipient: {
            type: "string",
            description:
              "Optional Solana wallet address or X handle that receives a share of creator rewards.",
          },
          creator_rewards_recipient: {
            type: "string",
            description: "Alias for creator_reward_recipient.",
          },
          creator_reward_share_bps: {
            type: "integer",
            minimum: 1,
            maximum: 10000,
            description: "Recipient share in basis points when a recipient is provided.",
          },
          dry_run: { type: "boolean", default: true },
        },
        description:
          "Queue a Robinhood Chain token launch or a Solana/Pump.fun launch. Metadata URLs must be HTTPS links.",
      },
      TradeRequest: {
        type: "object",
        required: ["side"],
        properties: {
          chain: { type: "string", enum: ["robinhood", "solana"] },
          side: { type: "string", enum: ["buy", "sell"] },
          token_address: {
            type: "string",
            description: "Robinhood Chain EVM token address, or Solana mint when chain=solana.",
          },
          token_mint: { type: "string", description: "Solana mint for Solana trades." },
          mint: { type: "string", description: "Alias for Solana token_mint." },
          token: { type: "string", description: "Alias for token_address or token_mint." },
          amount_eth: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "ETH amount for Robinhood Chain buys.",
          },
          eth_amount: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Alias for amount_eth.",
          },
          amount_sol: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "SOL amount for Solana buys.",
          },
          sol_amount: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Alias for amount_sol.",
          },
          percent: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Percent of the current holding to sell.",
          },
          sell_percent: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Alias for percent.",
          },
          slippage_bps: { type: "integer", minimum: 0, maximum: 10000 },
          dry_run: { type: "boolean", default: true },
        },
        description:
          "Dry-run or execute buys and sells by full Robinhood Chain contract address or Solana mint. Cashtags and symbols are not executable inputs.",
      },
      TransferRequest: {
        type: "object",
        properties: {
          chain: { type: "string", enum: ["robinhood", "solana"] },
          recipient: {
            type: "string",
            description: "Full EVM address for Robinhood Chain or full Solana address for Solana.",
          },
          to: { type: "string", description: "Alias for recipient." },
          amount_eth: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Native ETH amount for Robinhood Chain transfers.",
          },
          eth_amount: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Alias for amount_eth.",
          },
          amount_sol: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Native SOL amount for Solana transfers.",
          },
          sol_amount: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Alias for amount_sol.",
          },
          dry_run: { type: "boolean", default: true },
        },
        description:
          "Dry-run or execute native ETH or native SOL transfers. The Agent API transfer endpoint does not transfer USDC.",
      },
      LiquidityAddRequest: {
        type: "object",
        required: ["risk_acknowledged"],
        properties: {
          chain: { type: "string", enum: ["robinhood", "solana"] },
          platform: {
            type: "string",
            enum: ["robinhood_uniswap_v3", "pump_swap"],
          },
          token_address: {
            type: "string",
            description:
              "Robinhood Chain EVM token address, or a Solana mint when chain/platform selects PumpSwap.",
          },
          token_mint: {
            type: "string",
            description: "Solana/Pump.fun mint for PumpSwap liquidity.",
          },
          amount_eth: {
            type: "string",
            description: "Robinhood Chain ETH amount for V3 liquidity.",
          },
          amount_sol: {
            type: "string",
            description:
              "Reserved for display; PumpSwap add derives required SOL from the token amount and pool state.",
          },
          token_amount: {
            type: "string",
            description:
              "Token amount to deposit. Required for PumpSwap unless token_amount_raw is provided; optional override for Robinhood V3.",
          },
          token_amount_raw: {
            type: "string",
            description: "Raw base-unit token amount for PumpSwap.",
          },
          slippage_bps: {
            type: "integer",
            minimum: 0,
            maximum: 10000,
            default: 100,
          },
          risk_acknowledged: { type: "boolean", const: true },
          dry_run: { type: "boolean", default: true },
        },
      },
      LiquidityRemoveRequest: {
        type: "object",
        required: ["percent", "risk_acknowledged"],
        properties: {
          chain: { type: "string", enum: ["robinhood", "solana"] },
          platform: {
            type: "string",
            enum: ["robinhood_uniswap_v3", "pump_swap"],
          },
          position_id: { type: "string" },
          position_token_id: {
            type: "string",
            description: "Robinhood V3 NFT id or PumpSwap LP token account.",
          },
          lp_token_account: {
            type: "string",
            description: "PumpSwap LP token account alias.",
          },
          token_address: {
            type: "string",
            description: "EVM token address or Solana mint resolver.",
          },
          token_mint: {
            type: "string",
            description: "Solana/Pump.fun mint resolver.",
          },
          percent: {
            oneOf: [
              { type: "number", minimum: 0, maximum: 100 },
              {
                type: "string",
              },
            ],
          },
          slippage_bps: {
            type: "integer",
            minimum: 0,
            maximum: 10000,
            default: 100,
          },
          risk_acknowledged: { type: "boolean", const: true },
          dry_run: { type: "boolean", default: true },
        },
      },
      LiquidityCollectFeesRequest: {
        type: "object",
        properties: {
          position_id: { type: "string" },
          position_token_id: { type: "string" },
          token_address: { type: "string" },
          dry_run: { type: "boolean", default: true },
        },
        description: "Robinhood Chain Uniswap V3 fee collection only.",
      },
      TokenBurnRequest: {
        type: "object",
        required: ["action"],
        oneOf: [
          {
            required: ["chain", "token", "amount"],
            properties: {
              action: { type: "string", const: "prepare" },
              chain: { type: "string", enum: ["robinhood", "solana"] },
              token: {
                type: "string",
                description:
                  "Full Robinhood Chain contract address or full Solana mint. Tickers and names are forbidden.",
              },
              amount: {
                type: "string",
                description: "Exact positive token-unit amount, or the explicit value all.",
              },
            },
          },
          {
            required: ["pending_action_id", "acknowledgement"],
            properties: {
              action: { type: "string", const: "confirm" },
              pending_action_id: { type: "string", format: "uuid" },
              acknowledgement: {
                type: "string",
                const: "IRREVERSIBLE_TOKEN_BURN",
              },
            },
          },
          {
            required: ["pending_action_id"],
            properties: {
              action: { type: "string", const: "cancel" },
              pending_action_id: { type: "string", format: "uuid" },
            },
          },
        ],
        description:
          "Burns are always two-request operations. Prepare freezes the exact wallet, chain, CA/mint, decimals, and raw amount. Confirm must be a separate signed request.",
      },
      CreatorRewardsClaimRequest: {
        type: "object",
        properties: {
          chain: { type: "string", enum: ["robinhood", "solana"] },
          token_address: {
            type: "string",
            description:
              "Robinhood Chain launch contract address or Solana mint. The address family can identify the chain when chain is omitted.",
          },
          mint: { type: "string", description: "Solana/Pump.fun mint alias." },
          dry_run: { type: "boolean", default: true },
        },
        description:
          "Dry-run or claim Robinhood Chain launch rewards or eligible Solana Pump.fun fee-sharing rewards controlled by the authenticated agent wallet.",
      },
      ScheduleRequest: {
        type: "object",
        required: ["chain", "action_type", "trigger_type"],
        properties: {
          chain: { type: "string", enum: ["robinhood", "solana"] },
          action_type: {
            type: "string",
            enum: [
              "buy",
              "sell",
              "transfer",
              "launch_coin",
              "claim_creator_rewards",
              "add_liquidity",
              "remove_liquidity",
              "collect_liquidity_fees",
            ],
          },
          token_address: {
            type: "string",
            description: "Full EVM contract address or full Solana mint for buy/sell schedules.",
          },
          recipient: {
            type: "string",
            description: "Full EVM or Solana address for transfer schedules.",
          },
          amount: {
            type: "string",
            description: "Positive buy or transfer amount.",
          },
          amount_unit: { type: "string", enum: ["eth", "sol", "usd"] },
          sell_mode: { type: "string", enum: ["all", "percent"] },
          sell_percent: { oneOf: [{ type: "number" }, { type: "string" }] },
          name: { type: "string", description: "Token name for scheduled launches." },
          symbol: { type: "string", description: "Token ticker or creator-rewards lookup symbol." },
          description: { type: "string", description: "Token description for scheduled launches." },
          image_url: { type: "string", format: "uri", description: "HTTPS launch image URL." },
          initial_buy_eth: { oneOf: [{ type: "number" }, { type: "string" }] },
          initial_buy_sol: { oneOf: [{ type: "number" }, { type: "string" }] },
          launch_id: { type: "string", description: "Launch id for creator-rewards schedules." },
          latest: { type: "boolean", description: "Claim rewards for the latest eligible launch." },
          amount_eth: { oneOf: [{ type: "number" }, { type: "string" }] },
          token_amount: {
            oneOf: [{ type: "number" }, { type: "string" }],
            description: "Token amount for scheduled liquidity additions.",
          },
          token_amount_raw: { type: "string" },
          position_id: { type: "string" },
          percent: { oneOf: [{ type: "number" }, { type: "string" }] },
          trigger_type: { type: "string", enum: ["time", "market_cap"] },
          scheduled_for: { type: "string", format: "date-time" },
          run_at: {
            type: "string",
            format: "date-time",
            description: "Alias for scheduled_for on timed schedules.",
          },
          starts_at: {
            type: "string",
            format: "date-time",
            description:
              "Alias for the first timed run, or the first market-condition check for recurring conditional schedules.",
          },
          delay_seconds: {
            type: "integer",
            minimum: 60,
            maximum: 2592000,
            description: "Relative delay before the first timed run.",
          },
          after_seconds: {
            type: "integer",
            minimum: 60,
            maximum: 2592000,
            description: "Alias for delay_seconds.",
          },
          start_after_seconds: {
            type: "integer",
            minimum: 60,
            maximum: 2592000,
            description: "Alias for delay_seconds.",
          },
          schedule_kind: {
            type: "string",
            enum: ["one_time", "interval", "daily", "weekly", "condition"],
            default: "one_time",
          },
          interval_seconds: { type: "integer", minimum: 60, maximum: 2592000 },
          every_seconds: {
            type: "integer",
            minimum: 60,
            maximum: 2592000,
            description: "Alias for interval_seconds.",
          },
          repeat_seconds: {
            type: "integer",
            minimum: 60,
            maximum: 2592000,
            description: "Alias for interval_seconds.",
          },
          trigger_direction: { type: "string", enum: ["below", "above"] },
          trigger_value_usd: {
            oneOf: [{ type: "number" }, { type: "string" }],
          },
        },
        description:
          "Create one-shot or recurring timed schedules for supported wallet, launch, rewards, and liquidity actions. Market-cap triggers support buy/sell condition schedules, including recurring condition schedules.",
      },
      ScheduleControlRequest: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: ["pause", "resume", "cancel", "update"],
          },
          scheduled_for: { type: "string", format: "date-time" },
          interval_seconds: { type: "integer", minimum: 60, maximum: 2592000 },
          ends_at: {
            type: ["string", "null"],
            format: "date-time",
            description: "Set a schedule end time, or send null to clear it.",
          },
          max_occurrences: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 10000,
            description: "Set the max run count for recurring schedules, or send null to clear it.",
          },
          priority: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
      AgentRegistrationRequest: {
        type: "object",
        required: ["onboarding_token", "agent_name"],
        properties: {
          onboarding_token: {
            type: "string",
            description: "One-time onboarding token created by the user in the Agents dashboard.",
          },
          agent_name: { type: "string" },
          agent_type: { type: "string" },
          public_contact: { type: "string" },
          requested_scopes: { type: "array", items: { type: "string" } },
          limits: { type: "object" },
        },
      },
    },
  },
  security: [{ LinkrApiKey: [], LinkrHmac: [] }],
  paths: {
    "/api/me": {
      get: endpoint(
        "profile:read",
        "Return authenticated agent profile, wallet, scopes, and limits.",
      ),
    },
    "/api/wallet": {
      get: endpoint(
        "profile:read",
        "Return Robinhood Chain and Solana deposit addresses plus native balances.",
      ),
    },
    "/api/portfolio": {
      get: endpoint(
        "profile:read",
        "Return current native balances and token holdings across Robinhood Chain and Solana.",
      ),
    },
    "/api/history": {
      get: endpoint(
        "actions:read",
        "Return private action, launch, settings, agent, pending, portfolio, or recent history.",
      ),
    },
    "/api/coins/new": {
      get: endpoint("coins:read", "List recent Linkr-launched coins."),
    },
    "/api/coin-info": { get: coinInfoEndpoint() },
    "/api/launch-token": {
      post: postEndpoint(
        "launch:write",
        "Queue a Linkr token launch on Robinhood Chain or Solana/Pump.fun.",
        "LaunchTokenRequest",
      ),
    },
    "/api/trade": {
      post: postEndpoint(
        "trade:buy or trade:sell",
        "Dry-run or execute a buy/sell swap by full Robinhood Chain contract address or Solana mint.",
        "TradeRequest",
      ),
    },
    "/api/transfer": {
      post: postEndpoint(
        "transfer:write",
        "Dry-run or execute a native ETH or SOL transfer.",
        "TransferRequest",
      ),
    },
    "/api/schedules": {
      get: endpoint("schedule:read", "List authenticated agent schedules."),
      post: postEndpoint(
        "schedule:write",
        "Create a timed or market-cap schedule for supported wallet, launch, rewards, and liquidity actions.",
        "ScheduleRequest",
      ),
    },
    "/api/schedules/{id}": {
      get: withPathId(endpoint("schedule:read", "Read one authenticated agent schedule.")),
      patch: withPathId(
        postEndpoint(
          "schedule:write",
          "Pause, resume, cancel, or update a schedule.",
          "ScheduleControlRequest",
        ),
      ),
      delete: withPathId(postEndpoint("schedule:write", "Cancel a schedule.")),
    },
    "/api/burn-token": {
      post: postEndpoint(
        "burn:write",
        "Prepare, separately confirm, or cancel an irreversible fungible-token burn. One-call execution is forbidden.",
        "TokenBurnRequest",
      ),
    },
    "/api/creator-rewards/claim": {
      post: postEndpoint(
        "rewards:claim",
        "Dry-run or claim Robinhood Chain launch rewards or eligible Solana Pump.fun fee-sharing rewards.",
        "CreatorRewardsClaimRequest",
      ),
    },
    "/api/liquidity/positions": {
      get: endpoint(
        "actions:read",
        "List authenticated user's Robinhood V3 and Solana PumpSwap LP positions.",
      ),
    },
    "/api/liquidity/add": {
      post: postEndpoint(
        "liquidity:write",
        "Dry-run or add user-owned Robinhood Uniswap V3 liquidity or Solana Pump.fun/PumpSwap liquidity.",
        "LiquidityAddRequest",
      ),
    },
    "/api/liquidity/remove": {
      post: postEndpoint(
        "liquidity:write",
        "Dry-run or remove user-owned Robinhood Uniswap V3 liquidity or Solana Pump.fun/PumpSwap liquidity.",
        "LiquidityRemoveRequest",
      ),
    },
    "/api/liquidity/collect-fees": {
      post: postEndpoint(
        "liquidity:write",
        "Dry-run or collect user-owned Robinhood Uniswap V3 LP fees. PumpSwap fee collection is not exposed.",
        "LiquidityCollectFeesRequest",
      ),
    },
    "/api/actions/{id}": {
      get: endpoint(
        "actions:read",
        "Poll a launch, transaction, liquidity action, or pending Agent API burn.",
      ),
    },
    "/api/agents/register": {
      post: registrationEndpoint(),
    },
  },
};

function registrationEndpoint() {
  return {
    description:
      "Redeem a one-time onboarding token to create an agent profile, generated EVM wallet, and first API key. This setup call does not use Agent API HMAC headers because the key does not exist yet.",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AgentRegistrationRequest" },
        },
      },
    },
    responses: {
      "200": {
        description: "Agent registered; plaintext API key is returned once.",
      },
      "400": { description: "Invalid request", content: errorContent() },
      "401": {
        description: "Missing or invalid onboarding token",
        content: errorContent(),
      },
      "409": {
        description: "Onboarding token was already redeemed",
        content: errorContent(),
      },
      "429": { description: "Rate limited", content: errorContent() },
    },
  };
}

function coinInfoEndpoint() {
  const base = endpoint(
    "coin:read",
    "Fetch coin detail and market data for a Linkr Robinhood Chain coin or a Solana token mint, including Pump fee-sharing reward data for Solana when available.",
  );
  return {
    ...base,
    parameters: [
      ...base.parameters,
      {
        name: "token_address",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Robinhood Chain EVM contract address.",
      },
      {
        name: "mint",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Solana mint address for token analytics and Pump fee-sharing rewards.",
      },
      {
        name: "analytics",
        in: "query",
        required: false,
        schema: { type: "boolean", default: true },
      },
    ],
  };
}

function postEndpoint(scope: string, description: string, schemaName?: string) {
  return {
    ...endpoint(scope, description),
    parameters: [...endpoint(scope, description).parameters, idempotencyHeader()],
    requestBody: schemaName
      ? {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schemaName}` },
            },
          },
        }
      : {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object" },
            },
          },
        },
  };
}

function endpoint(scope: string, description: string) {
  return {
    description,
    parameters: [
      {
        name: "X-Linkr-Timestamp",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "X-Linkr-Nonce",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "X-Linkr-Body-SHA256",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "X-Linkr-Signature",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      "200": { description: "OK" },
      "400": { description: "Invalid request", content: errorContent() },
      "401": {
        description: "Missing or invalid authentication",
        content: errorContent(),
      },
      "403": {
        description: `Missing scope or cap exceeded. Required: ${scope}`,
        content: errorContent(),
      },
      "429": { description: "Rate limited", content: errorContent() },
    },
  };
}

function idempotencyHeader() {
  return {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: { type: "string" },
    description: "Required for POST requests to prevent duplicate execution.",
  };
}

type OpenApiParameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
};

type OpenApiOperation = {
  parameters?: OpenApiParameter[];
  [key: string]: unknown;
};

function withPathId<T extends OpenApiOperation>(
  operation: T,
): T & { parameters: OpenApiParameter[] } {
  return {
    ...operation,
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      ...(operation.parameters ?? []),
    ],
  };
}

function errorContent() {
  return {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  };
}
