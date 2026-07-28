// deno-lint-ignore-file no-explicit-any
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.2?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import { agentErrorResponse, agentJsonResponse, methodNotAllowed } from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import {
  getErc20TokenBalances,
  getEthBalance,
  ROBINHOOD_CHAIN_ID,
} from "../_shared/robinhood_chain.ts";
import { getSolanaTokenBalances } from "../_shared/solana_portfolio.ts";
import {
  LAMPORTS_PER_SOL,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { serviceClient } from "../_shared/supabase.ts";

type ChainFilter = "all" | "robinhood" | "solana";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "profile:read");
    const url = new URL(req.url);
    const chain = normalizeChain(url.searchParams.get("chain"));
    const token = String(url.searchParams.get("token") ?? "").trim();
    const limit = clampLimit(url.searchParams.get("limit"), 50);
    const evmAddress = ctx.wallet.address ?? ctx.wallet.public_key;
    const solanaWallet = await findSolanaWallet(admin, ctx.userId);

    const [ethBalance, evmTokens, solBalance, solTokens] = await Promise.all([
      chain !== "solana" ? safe(() => getEthBalance(evmAddress), null as number | null) : null,
      chain !== "solana" ? safe(() => getErc20TokenBalances(evmAddress), [] as any[]) : [],
      chain !== "robinhood" && solanaWallet
        ? safe(() => getSolBalance(solanaWallet.address), null as number | null)
        : null,
      chain !== "robinhood" && solanaWallet
        ? safe(() => getSolanaTokenBalances(solanaWallet.address), [] as any[])
        : [],
    ]);

    const holdings = [...evmTokens, ...solTokens]
      .filter((holding: any) => Number(holding.amount ?? 0) > 0)
      .filter((holding: any) => matchesToken(holding, token))
      .slice(0, limit);

    const totalKnownUsd = holdings.reduce((sum: number, holding: any) => {
      const value = Number(holding.usd_value ?? holding.valueUsd ?? 0);
      return Number.isFinite(value) && value > 0 ? sum + value : sum;
    }, 0);

    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse({
      chain,
      wallets: {
        robinhood: chain !== "solana" ? { address: evmAddress, chain_id: ROBINHOOD_CHAIN_ID } : null,
        solana: chain !== "robinhood" && solanaWallet ? { address: solanaWallet.address, chain_id: null } : null,
      },
      native_balances: {
        eth: ethBalance,
        sol: solBalance,
      },
      holdings,
      summary: {
        holding_count: holdings.length,
        total_known_usd: totalKnownUsd > 0 ? totalKnownUsd : null,
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

function normalizeChain(value: string | null): ChainFilter {
  const text = String(value ?? "all").trim().toLowerCase();
  if (["rh", "robinhood", "evm", "eth"].includes(text)) return "robinhood";
  if (["sol", "solana", "pump", "pump.fun", "pumpfun"].includes(text)) return "solana";
  return "all";
}

function matchesToken(holding: any, token: string): boolean {
  if (!token) return true;
  const text = token.replace(/^\$/, "").toLowerCase();
  return [
    holding.mint,
    holding.token_address,
    holding.symbol,
    holding.name,
  ].some((value) => String(value ?? "").toLowerCase() === text);
}

function clampLimit(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : fallback;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}
