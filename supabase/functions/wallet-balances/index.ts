// deno-lint-ignore-file no-explicit-any no-import-prefix
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getEthUsdPrice } from "../_shared/eth_price.ts";
import { internalErrorResponse } from "../_shared/http.ts";
import { getEthBalance, ROBINHOOD_NATIVE_SYMBOL } from "../_shared/robinhood_chain.ts";
import {
  LAMPORTS_PER_SOL,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { getSolUsdPrice } from "../_shared/sol_price.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const userId = await getCallerUserId(req);
    if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

    const admin = serviceClient();
    const { data: wallets, error } = await admin
      .from("wallets")
      .select("id,public_key,address,wallet_type,chain_id,explorer_url,is_primary,created_at")
      .eq("user_id", userId)
      .in("wallet_type", ["evm", "solana"])
      .order("wallet_type", { ascending: true })
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw error;

    const [ethPrice, solPrice] = await Promise.all([
      getEthUsdPrice(admin).catch(() => null),
      getSolUsdPrice(admin).catch(() => null),
    ]);
    const connection = (wallets ?? []).some((wallet: any) => wallet.wallet_type === "solana")
      ? solanaConnection()
      : null;
    const usdcMint = connection ? new PublicKey(SOLANA_USDC_MINT) : null;

    const balances = await Promise.all(
      (wallets ?? []).map(async (wallet: any) => {
        const address = String(wallet.address ?? wallet.public_key ?? "").trim();
        const base = {
          wallet_id: wallet.id,
          wallet_type: wallet.wallet_type,
          address,
          is_primary: Boolean(wallet.is_primary),
          explorer_url: wallet.explorer_url ?? null,
        };

        try {
          if (wallet.wallet_type === "solana") {
            const publicKey = new PublicKey(normalizeSolanaPublicKey(address));
            const [lamports, tokenAccounts] = await Promise.all([
              connection!.getBalance(publicKey, "confirmed"),
              connection!.getParsedTokenAccountsByOwner(
                publicKey,
                { mint: usdcMint! },
                "confirmed",
              ),
            ]);
            const usdcRaw = tokenAccounts.value.reduce((sum: bigint, account: any) => {
              const amount = account?.account?.data?.parsed?.info?.tokenAmount?.amount;
              return sum + (/^\d+$/.test(String(amount ?? "")) ? BigInt(amount) : 0n);
            }, 0n);
            return {
              ...base,
              native_symbol: "SOL",
              native_balance: lamports / LAMPORTS_PER_SOL,
              native_price_usd: solPrice?.price ?? null,
              usdc_balance: formatTokenAmount(usdcRaw, USDC_DECIMALS),
              error: null,
            };
          }

          return {
            ...base,
            native_symbol: ROBINHOOD_NATIVE_SYMBOL,
            native_balance: await getEthBalance(address),
            native_price_usd: ethPrice?.price ?? null,
            usdc_balance: null,
            error: null,
          };
        } catch (balanceError) {
          console.error(
            JSON.stringify({
              event: "wallet_balance_lookup_failed",
              wallet_id: wallet.id,
              wallet_type: wallet.wallet_type,
              error: balanceError instanceof Error ? balanceError.message : String(balanceError),
            }),
          );
          return {
            ...base,
            native_symbol: wallet.wallet_type === "solana" ? "SOL" : ROBINHOOD_NATIVE_SYMBOL,
            native_balance: null,
            native_price_usd:
              wallet.wallet_type === "solana"
                ? (solPrice?.price ?? null)
                : (ethPrice?.price ?? null),
            usdc_balance: null,
            error: "balance_unavailable",
          };
        }
      }),
    );

    return jsonResponse({ balances, fetched_at: new Date().toISOString() });
  } catch (error) {
    return internalErrorResponse(error, { function: "wallet-balances" });
  }
});

function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = (raw % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
