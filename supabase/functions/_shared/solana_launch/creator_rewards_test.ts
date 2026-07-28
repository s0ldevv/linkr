import {
  type PumpCreatorRewardsConfig,
  pumpCreatorRewardsShareholders,
  shouldUpdatePumpCreatorRewards,
} from "./creator_rewards.ts";

Deno.test("Solana creator reward shares remain bounded and exact", () => {
  const creator = "Creator111111111111111111111111111111111111";
  const config = {
    should_update_on_chain: true,
    recipients: [
      { address: creator, shareBps: 7500 },
      { address: "Recipient111111111111111111111111111111111", shareBps: 2500 },
    ],
  } as unknown as PumpCreatorRewardsConfig;
  const shares = pumpCreatorRewardsShareholders(config, creator);
  if (
    shares.length !== 2 ||
    shares.reduce((sum, row) => sum + row.shareBps, 0) !== 10_000
  ) {
    throw new Error("creator shares lost their exact basis-point total");
  }
  if (!shouldUpdatePumpCreatorRewards(config, creator)) {
    throw new Error("multi-recipient update was not detected");
  }
});

Deno.test("Solana creator reward shares reject invalid totals", () => {
  let rejected = false;
  try {
    pumpCreatorRewardsShareholders(
      {
        recipients: [{
          address: "Creator111111111111111111111111111111111111",
          shareBps: 9999,
        }],
      } as PumpCreatorRewardsConfig,
      "Creator111111111111111111111111111111111111",
    );
  } catch (error) {
    rejected = String(error).includes("invalid_creator_reward_share_total");
  }
  if (!rejected) throw new Error("invalid share total was accepted");
});
