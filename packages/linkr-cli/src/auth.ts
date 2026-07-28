import { randomUUID } from "node:crypto";
import open from "open";
import prompts from "prompts";
import { LinkrCredentials, writeCredentials } from "./config.js";
import { unsignedJson } from "./api.js";
import { VERSION } from "./version.js";

const DEFAULT_API_URL = "https://www.linkr.cash";

type LoginStartResponse = {
  device_code: string;
  verification_url: string;
  expires_at: string;
};

type LoginCompleteResponse = {
  api_key: string;
  key: {
    prefix: string;
    scopes: string[];
  };
  agent_profile: {
    id: string;
  };
};

export async function login(options: {
  apiUrl?: string;
  full?: boolean;
  readOnly?: boolean;
  noBrowser?: boolean;
}) {
  if (options.full && options.readOnly) {
    throw new Error("Choose either --full or --read-only, not both.");
  }
  const apiUrl = (options.apiUrl || process.env.LINKR_API_URL || DEFAULT_API_URL).replace(
    /\/+$/,
    "",
  );
  const requestedScopes = scopesForLogin(options);
  const requestedLimits = limitsForLogin(options);
  const start = await unsignedJson<LoginStartResponse>(apiUrl, "/api/cli/auth/start", {
    client_name: clientName(),
    cli_version: VERSION,
    requested_scopes: requestedScopes,
    requested_limits: requestedLimits,
  });

  console.log("Open this URL to authorize Linkr CLI:");
  console.log(start.verification_url);
  if (!options.noBrowser) {
    await open(start.verification_url, { wait: false }).catch(() => undefined);
  }

  const answer = await prompts({
    type: "text",
    name: "code",
    message: "Paste the Linkr authorization code",
    validate: (value) => (String(value ?? "").trim() ? true : "Authorization code is required."),
  });
  if (!answer.code) throw new Error("Login cancelled.");

  const completed = await unsignedJson<LoginCompleteResponse>(apiUrl, "/api/cli/auth/complete", {
    device_code: start.device_code,
    user_code: answer.code,
  });

  const credentials: LinkrCredentials = {
    apiKey: completed.api_key,
    apiUrl,
    keyPrefix: completed.key.prefix,
    agentProfileId: completed.agent_profile.id,
    installId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await writeCredentials(credentials);
  console.log(`Logged in with key ${completed.key.prefix}.`);
}

function scopesForLogin(options: { full?: boolean; readOnly?: boolean }): string[] {
  const base = ["profile:read", "actions:read", "coins:read", "coin:read", "chat:write"];
  if (options.readOnly || !options.full) return base;
  return [
    ...base,
    "launch:write",
    "trade:buy",
    "trade:sell",
    "transfer:write",
    "schedule:read",
    "schedule:write",
    "rewards:claim",
    "liquidity:write",
    "burn:write",
  ];
}

function limitsForLogin(options: { full?: boolean }) {
  if (!options.full) {
    return {
      max_buy_eth: 0,
      max_buy_sol: 0,
      max_sell_percent: 0,
      max_transfer_eth: 0,
      max_transfer_sol: 0,
      max_launch_initial_buy_eth: 0,
      max_launch_initial_buy_sol: 0,
      max_liquidity_eth: 0,
      daily_request_limit: 500,
      daily_tx_limit: 0,
    };
  }
  return {
    max_buy_eth: 0.01,
    max_buy_sol: 0.05,
    max_sell_percent: 25,
    max_transfer_eth: 0,
    max_transfer_sol: 0,
    max_launch_initial_buy_eth: 0.01,
    max_launch_initial_buy_sol: 0.05,
    max_liquidity_eth: 0.01,
    daily_request_limit: 500,
    daily_tx_limit: 25,
  };
}

function clientName(): string {
  const user = process.env.USERNAME || process.env.USER || "User";
  return `${user}'s ${process.platform} device`.slice(0, 80);
}
