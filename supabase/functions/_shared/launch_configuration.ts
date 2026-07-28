export function launchConfiguration(
  workItem: Record<string, unknown>,
  payload: Record<string, unknown>,
  chain: "solana" | "robinhood",
): Record<string, unknown> {
  const amount = normalizedInitialBuy(payload, chain);
  const shared: Record<string, unknown> = {
    source_surface: workItem.source_surface,
    idempotency_key: `queue-launch:${workItem.id}`,
    metadata_website_url: optionalHttps(payload.website_url),
    metadata_twitter_url: optionalHttps(payload.twitter_url),
    metadata_telegram_url: optionalHttps(payload.telegram_url),
    creator_rewards_config: validRewardsConfig(payload.creator_rewards_config),
  };
  if (chain === "solana") {
    return {
      ...shared,
      dev_buy_sol: amount,
      launch_method: "pump_fun_create_v2",
    };
  }
  return {
    ...shared,
    requested_initial_buy_eth: amount,
    dev_buy_eth: amount,
    launch_method: "single_sided_uniswap_v3_lp",
  };
}

export function normalizedInitialBuy(
  payload: Record<string, unknown>,
  chain: "solana" | "robinhood",
): number {
  let value = chain === "solana"
    ? payload.dev_buy_sol ?? payload.initial_buy_sol
    : payload.dev_buy_eth ?? payload.initial_buy_eth;
  if (value == null && typeof payload.dev_buy_amount === "string") {
    const match = payload.dev_buy_amount.trim().match(
      /^(\d+(?:\.\d+)?)\s*(SOL|ETH)$/i,
    );
    if (match) {
      if (match[2].toLowerCase() !== (chain === "solana" ? "sol" : "eth")) {
        throw new Error("initial_buy_chain_mismatch");
      }
      value = match[1];
    }
  }
  const text = String(value ?? "0").trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(text)) {
    throw new Error("invalid_initial_buy_amount");
  }
  const amount = Number(text);
  const maximum = chain === "solana" ? 5 : 0.1;
  if (!Number.isFinite(amount) || amount < 0 || amount > maximum) {
    throw new Error("initial_buy_out_of_range");
  }
  return amount;
}

function optionalHttps(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 2048 || !/^https:\/\//i.test(text)) {
    throw new Error("launch_metadata_url_invalid");
  }
  return text;
}

function validRewardsConfig(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("creator_rewards_config_invalid");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16 * 1024) {
    throw new Error("creator_rewards_config_too_large");
  }
  return value as Record<string, unknown>;
}
