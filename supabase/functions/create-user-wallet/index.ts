// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { readJsonBody, internalErrorResponse } from "../_shared/http.ts";
import { serviceClient, getCallerUserId } from "../_shared/supabase.ts";
import {
  createSolanaWalletForUser,
  createWalletForUser,
  ensureProvisionedAuthUser,
} from "../_shared/provisioning.ts";

type WalletChain = "evm" | "solana";
type WalletResponseRow = {
  id: string;
  public_key: string;
  address: string | null;
  chain_id: number | null;
  wallet_type: string;
  explorer_url: string | null;
  is_primary: boolean;
  created_at: string;
};

async function parseRequestedChain(req: Request): Promise<WalletChain> {
  const body = await readJsonBody(req, 64 * 1024) as any;
  const value = String(body.chain ?? body.wallet_type ?? "evm")
    .trim()
    .toLowerCase();
  if (value === "evm" || value === "robinhood") return "evm";
  if (value === "solana" || value === "sol") return "solana";
  throw new Error("unsupported_wallet_chain");
}

async function loadProvisionedWalletRow(
  admin: any,
  userId: string,
  chain: WalletChain,
  publicKey: string,
): Promise<WalletResponseRow> {
  let query = admin
    .from("wallets")
    .select("id,public_key,address,chain_id,wallet_type,explorer_url,is_primary,created_at")
    .eq("user_id", userId)
    .eq("wallet_type", chain)
    .eq("public_key", publicKey)
    .limit(1);

  query = chain === "solana" ? query.is("chain_id", null) : query.eq("chain_id", 4663);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("provisioned_wallet_row_not_found");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, { status: 405 });

  try {
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

    const chain = await parseRequestedChain(req);
    const admin = serviceClient();
    const provisioned = await ensureProvisionedAuthUser(admin, userId, "manual_wallet");
    const wallet =
      chain === "solana"
        ? provisioned.createdSolanaWallet
          ? await loadProvisionedWalletRow(
              admin,
              userId,
              "solana",
              provisioned.solanaWallet.public_key,
            )
          : await createSolanaWalletForUser(admin, userId)
        : provisioned.createdWallet
          ? await loadProvisionedWalletRow(admin, userId, "evm", provisioned.wallet.public_key)
          : await createWalletForUser(admin, userId);

    return jsonResponse({
      id: wallet.id,
      public_key: wallet.public_key,
      address: wallet.address ?? wallet.public_key,
      chain_id: wallet.chain_id ?? null,
      wallet_type: wallet.wallet_type ?? chain,
      explorer_url: wallet.explorer_url ?? null,
      is_primary: wallet.is_primary,
      created_at: wallet.created_at,
      existing: false,
      createdProfile: provisioned.createdProfile,
      createdWallet: chain === "evm" ? true : provisioned.createdWallet,
      createdSolanaWallet: chain === "solana" ? true : provisioned.createdSolanaWallet,
      initializedDefaultRules: provisioned.initializedDefaultRules,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "unsupported_wallet_chain" ? 400 : 500;
    if (status >= 500) return internalErrorResponse(e, { function: "create-user-wallet" });
    return jsonResponse({ error: message }, { status });
  }
});
