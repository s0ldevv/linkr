export type PumpRewardTarget =
  | { kind: "wallet"; address: string }
  | { kind: "x_handle"; handle: string };

export type PumpCreatorRewardsConfig = {
  version: 1;
  source: string;
  chain: "solana";
  platform: "pump_fun";
  mode: "cashback" | "creator_rewards";
  pump_reward_mode: "cashback" | "creator";
  pump_cashback_enabled: boolean;
  selected_wallet_id: string | null;
  creator_address: string;
  creator_wallet_id: string | null;
  requested_recipient_share_bps: number;
  creator_share_bps: number;
  configurable_on_chain: boolean;
  should_update_on_chain: boolean;
  recipients: Array<{
    address: string;
    label: string;
    role: "creator" | "shared_creator_rewards";
    shareBps: number;
    sharePercent: number;
    source: "creator_wallet" | "wallet_address" | "x_handle";
    userId?: string | null;
    walletId?: string | null;
    twitterUsername?: string | null;
    twitterId?: string | null;
  }>;
  share_request: {
    target: PumpRewardTarget | null;
    explicit: boolean;
    share_bps: number | null;
    share_percent: number | null;
    defaulted_to_100_percent: boolean;
  };
  notes: string;
};

export function pumpCreatorRewardsShareholders(
  config: PumpCreatorRewardsConfig | null | undefined,
  creatorAddress: string,
): Array<{ address: string; shareBps: number }> {
  const creator = requiredAddress(creatorAddress, "invalid_creator_wallet");
  const rows = Array.isArray(config?.recipients) ? config.recipients : [];
  const merged = new Map<string, number>();
  for (const row of rows) {
    const shareBps = Number(row?.shareBps ?? 0);
    if (!Number.isFinite(shareBps) || shareBps <= 0) continue;
    const address = requiredAddress(
      row?.address,
      "invalid_creator_rewards_recipient",
    );
    merged.set(address, (merged.get(address) ?? 0) + Math.floor(shareBps));
  }
  if (merged.size === 0) merged.set(creator, 10_000);
  const shareholders = [...merged.entries()].map(([address, shareBps]) => ({
    address,
    shareBps,
  }));
  const total = shareholders.reduce((sum, row) => sum + row.shareBps, 0);
  if (shareholders.length > 10) {
    throw new Error("too_many_creator_reward_shareholders");
  }
  if (total !== 10_000) throw new Error("invalid_creator_reward_share_total");
  return shareholders;
}

export function shouldUpdatePumpCreatorRewards(
  config: PumpCreatorRewardsConfig | null | undefined,
  creatorAddress: string,
): boolean {
  if (!config?.should_update_on_chain) return false;
  const creator = requiredAddress(creatorAddress, "invalid_creator_wallet");
  const shareholders = pumpCreatorRewardsShareholders(config, creator);
  return !(
    shareholders.length === 1 && shareholders[0].address === creator &&
    shareholders[0].shareBps === 10_000
  );
}

function requiredAddress(value: unknown, error: string): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > 64) throw new Error(error);
  return text;
}
