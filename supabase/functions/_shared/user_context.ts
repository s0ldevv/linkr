// deno-lint-ignore-file no-explicit-any

export interface MinimalUserState {
  profile: any | null;
  wallet: { public_key: string; address?: string | null; chain_id?: number | null } | null;
  account_summary: {
    twitter_username: string | null;
    wallet_public_key: string | null;
    settings_present: {
      slippage: boolean;
      max_buy: boolean;
      max_buy_sol: boolean;
      max_sell: boolean;
      max_dev_buy: boolean;
      max_dev_buy_sol: boolean;
      max_transfer_sol: boolean;
    };
    require_confirmation_for_all_tx: boolean;
    profile_completed: boolean;
  };
}

export async function loadMinimalUserState(
  admin: any,
  twitterId: string,
): Promise<MinimalUserState> {
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("twitter_id", twitterId)
    .maybeSingle();
  const { data: wallet } = profile?.user_id
    ? await admin
        .from("wallets")
        .select("public_key,address,chain_id,wallet_type")
        .eq("user_id", profile.user_id)
        .eq("wallet_type", "evm")
        .eq("chain_id", 4663)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };

  return {
    profile: profile ?? null,
    wallet: wallet ?? null,
    account_summary: {
      twitter_username: profile?.twitter_username ?? null,
      wallet_public_key: wallet?.address ?? wallet?.public_key ?? null,
      settings_present: {
        slippage: Number(profile?.default_slippage_bps ?? 0) > 0,
        max_buy: Number(profile?.max_auto_buy_eth ?? 0) > 0,
        max_buy_sol: Number(profile?.max_auto_buy_sol ?? 0) > 0,
        max_sell: Number(profile?.max_auto_sell_percent ?? 0) > 0,
        max_dev_buy: Number(profile?.max_auto_dev_buy_eth ?? 0) > 0,
        max_dev_buy_sol: Number(profile?.max_auto_dev_buy_sol ?? 0) > 0,
        max_transfer_sol: Number(profile?.max_auto_transfer_sol ?? 0) > 0,
      },
      require_confirmation_for_all_tx: !!profile?.require_confirmation_for_all_tx,
      profile_completed: !!profile?.profile_completed,
    },
  };
}

export function summarizeMinimalUserState(state: MinimalUserState): string {
  const s = state.account_summary;
  return [
    "username: @" + (s.twitter_username ?? "?"),
    "wallet: " + (s.wallet_public_key ?? "none"),
    "settings_present: slippage=" +
      (s.settings_present.slippage ? "yes" : "no") +
      ", max_buy=" +
      (s.settings_present.max_buy ? "yes" : "no") +
      ", max_buy_sol=" +
      (s.settings_present.max_buy_sol ? "yes" : "no") +
      ", max_sell=" +
      (s.settings_present.max_sell ? "yes" : "no") +
      ", max_dev_buy=" +
      (s.settings_present.max_dev_buy ? "yes" : "no") +
      ", max_dev_buy_sol=" +
      (s.settings_present.max_dev_buy_sol ? "yes" : "no") +
      ", max_transfer_sol=" +
      (s.settings_present.max_transfer_sol ? "yes" : "no"),
    "confirm_all: " + (s.require_confirmation_for_all_tx ? "yes" : "no"),
    "profile_completed: " + (s.profile_completed ? "yes" : "no"),
  ].join(" | ");
}
