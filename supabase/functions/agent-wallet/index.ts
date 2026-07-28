// deno-lint-ignore-file no-explicit-any
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.2?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import { agentErrorResponse, agentJsonResponse, methodNotAllowed } from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import {
  getAddressExplorerUrl,
  getEthBalance,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_SYMBOL,
} from "../_shared/robinhood_chain.ts";
import {
  getSolanaAccountExplorerUrl,
  LAMPORTS_PER_SOL,
  normalizeSolanaPublicKey,
  SOLANA_NATIVE_SYMBOL,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "profile:read");
    const evmAddress = ctx.wallet.address ?? ctx.wallet.public_key;
    const solanaWallet = await findSolanaWallet(admin, ctx.userId);
    const [ethBalance, solBalance] = await Promise.all([
      safe(() => getEthBalance(evmAddress), null as number | null),
      solanaWallet
        ? safe(() => getSolBalance(solanaWallet.address), null as number | null)
        : Promise.resolve(null),
    ]);

    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({
      wallets: {
        robinhood: {
          id: ctx.wallet.id,
          address: evmAddress,
          chain_id: ROBINHOOD_CHAIN_ID,
          native_asset: ROBINHOOD_NATIVE_SYMBOL,
          explorer_url: ctx.wallet.explorer_url ?? getAddressExplorerUrl(evmAddress),
          balance_eth: ethBalance,
        },
        solana: solanaWallet
          ? {
              id: solanaWallet.id,
              address: solanaWallet.address,
              chain_id: null,
              native_asset: SOLANA_NATIVE_SYMBOL,
              explorer_url: solanaWallet.explorer_url ?? getSolanaAccountExplorerUrl(solanaWallet.address),
              balance_sol: solBalance,
            }
          : null,
      },
      deposit_addresses: {
        robinhood: evmAddress,
        solana: solanaWallet?.address ?? null,
      },
      balances: {
        eth: ethBalance,
        sol: solBalance,
      },
    });
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(() => {});
    return agentErrorResponse(error);
  }
});

async function findSolanaWallet(admin: any, userId: string) {
  const { data, error } = await admin
    .from("wallets")
    .select("id,user_id,public_key,address,wallet_type,chain_id,explorer_url,is_primary")
    .eq("user_id", userId)
    .eq("wallet_type", "solana")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const address = normalizeSolanaPublicKey(data.address ?? data.public_key);
  return { ...data, address, public_key: address };
}

async function getSolBalance(address: string): Promise<number> {
  const publicKey = normalizeSolanaPublicKey(address);
  const lamports = await solanaConnection().getBalance(new PublicKey(publicKey), "confirmed");
  return lamports / LAMPORTS_PER_SOL;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}
