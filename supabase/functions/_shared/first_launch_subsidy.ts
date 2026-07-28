// deno-lint-ignore-file no-explicit-any

import { readLaunchFundingPolicy } from "./admin_settings.ts";

export type FirstLaunchSubsidyChain = "robinhood" | "solana";

export async function isFirstLaunchSubsidyEligible(
  admin: any,
  userId: string,
  options: { chain?: FirstLaunchSubsidyChain } = {},
): Promise<boolean> {
  const chain = options.chain ?? "robinhood";
  const fundingPolicy = await readLaunchFundingPolicy(admin);
  if (fundingPolicy.mode === "funding_disabled") return false;
  if (
    chain === "solana" &&
    !Deno.env.get("SOL_FUNDING_WALLET")?.trim()
  ) {
    return false;
  }

  try {
    const { count: launchesCount, error: launchesError } = await admin
      .from("coin_launches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("status", "failed");
    if (launchesError) throw launchesError;
    if ((launchesCount ?? 0) > 0) return false;

    const { count: fundingCount, error: fundingError } = await admin
      .from("wallet_funding_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("funding_kind", "first_launch_minimum")
      .in("status", ["pending", "prepared", "submitted", "confirmed"]);
    if (fundingError) throw fundingError;
    return (fundingCount ?? 0) === 0;
  } catch (error) {
    // Fail closed (never over-grant), but keep eligibility failures visible:
    // a transient DB error here silently downgrades a first launch to the
    // manual-confirmation path.
    console.error(
      JSON.stringify({
        event: "first_launch_subsidy_eligibility_error",
        chain,
        message: String(error instanceof Error ? error.message : error)
          .slice(0, 300),
      }),
    );
    return false;
  }
}
