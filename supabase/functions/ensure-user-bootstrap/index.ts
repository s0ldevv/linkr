// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, getCallerUserId } from "../_shared/supabase.ts";
import { ensureProvisionedAuthUser } from "../_shared/provisioning.ts";
import { getActiveBanForAuthUser } from "../_shared/x_bans.ts";
import { safeErrorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });

  try {
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

    const admin = serviceClient();
    const activeBan = await getActiveBanForAuthUser(admin, userId);
    if (activeBan.ban) {
      return jsonResponse(
        {
          error: "banned_x_user",
          message: "This X account is banned from Linkr.",
          ban: {
            x_user_id: activeBan.ban.x_user_id,
            username_at_ban: activeBan.ban.username_at_ban,
            banned_at: activeBan.ban.banned_at,
          },
        },
        { status: 403 },
      );
    }

    const provisioned = await ensureProvisionedAuthUser(admin, userId, "auth_session");
    const profile = provisioned.profile ?? {};

    return jsonResponse({
      ok: true,
      profile: {
        twitter_id: profile.twitter_id ?? null,
        twitter_username: profile.twitter_username ?? null,
        twitter_name: profile.twitter_name ?? null,
        twitter_profile_image_url: profile.twitter_profile_image_url ?? null,
        profile_completed: Boolean(profile.profile_completed),
        default_slippage_bps: Number(profile.default_slippage_bps ?? 0),
        max_auto_buy_eth: Number(profile.max_auto_buy_eth ?? 0),
        max_auto_buy_sol: Number(profile.max_auto_buy_sol ?? 0),
        max_auto_sell_percent: Number(profile.max_auto_sell_percent ?? 0),
        max_auto_transfer_eth: Number(profile.max_auto_transfer_eth ?? 0),
        max_auto_transfer_sol: Number(profile.max_auto_transfer_sol ?? 0),
        max_auto_dev_buy_eth: Number(profile.max_auto_dev_buy_eth ?? 0),
        max_auto_dev_buy_sol: Number(profile.max_auto_dev_buy_sol ?? 0),
        default_dev_buy_eth: Number(profile.default_dev_buy_eth ?? 0),
        default_dev_buy_sol: Number(profile.default_dev_buy_sol ?? 0),
        require_confirmation_for_all_tx: Boolean(profile.require_confirmation_for_all_tx),
      },
      wallet: {
        public_key: provisioned.wallet.public_key,
        address: provisioned.wallet.address ?? provisioned.wallet.public_key,
        chain_id: provisioned.wallet.chain_id ?? 4663,
      },
      solana_wallet: {
        public_key: provisioned.solanaWallet.public_key,
        address: provisioned.solanaWallet.address ?? provisioned.solanaWallet.public_key,
        chain_id: provisioned.solanaWallet.chain_id ?? null,
      },
      createdProfile: provisioned.createdProfile,
      createdWallet: provisioned.createdWallet,
      createdSolanaWallet: provisioned.createdSolanaWallet,
      initializedDefaultRules: provisioned.initializedDefaultRules,
    });
  } catch (e) {
    return safeErrorResponse(e, { functionName: "ensure-user-bootstrap" });
  }
});
