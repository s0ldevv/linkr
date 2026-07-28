// deno-lint-ignore-file no-explicit-any
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { readJsonBody, safeErrorResponse } from "../_shared/http.ts";
import { getSolUsdPrice } from "../_shared/sol_price.ts";

const SOLANA_WALLET_TYPE = "solana";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LAMPORTS_PER_SOL = 1_000_000_000;

function formatUsdcRaw(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(
    /0+$/,
    "",
  );
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function getUsdcBalanceRaw(
  connection: any,
  PublicKey: any,
  ownerAddress: string,
) {
  const accounts = await connection.getParsedTokenAccountsByOwner(
    new PublicKey(ownerAddress),
    { mint: new PublicKey(SOLANA_USDC_MINT) },
    "confirmed",
  );
  return accounts.value.reduce((sum: bigint, account: any) => {
    const amount = account?.account?.data?.parsed?.info?.tokenAmount?.amount;
    return sum + (/^\d+$/.test(String(amount ?? "")) ? BigInt(amount) : 0n);
  }, 0n);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const userId = await getCallerUserId(req);
    if (!userId) {
      return jsonResponse({ error: "unauthorized" }, { status: 401 });
    }

    const admin = serviceClient();
    const url = new URL(req.url);
    const body = req.method === "POST"
      ? await readJsonBody(req, 64 * 1024) as any
      : {};
    const walletId = String(
      body.wallet_id ?? body.walletId ?? url.searchParams.get("wallet_id") ??
        "",
    ).trim();

    let query = admin
      .from("wallets")
      .select(
        "id,public_key,address,wallet_type,chain_id,explorer_url,is_primary,created_at",
      )
      .eq("user_id", userId)
      .eq("wallet_type", SOLANA_WALLET_TYPE);

    if (walletId) {
      query = query.eq("id", walletId).limit(1);
    } else {
      query = query
        .order("is_primary", { ascending: false })
        .order("created_at", {
          ascending: true,
        })
        .limit(1);
    }

    const { data: wallet, error } = await query.maybeSingle();
    if (error) throw error;
    if (!wallet) {
      return jsonResponse({ error: "no_solana_wallet" }, { status: 404 });
    }

    const [{ PublicKey }, solana] = await Promise.all([
      import("https://esm.sh/@solana/web3.js@1.98.4?target=deno"),
      import("../_shared/solana_chain.ts"),
    ]);
    const publicKey = solana.normalizeSolanaPublicKey(
      wallet.address ?? wallet.public_key,
    );
    const connection = solana.solanaConnection();
    const [lamports, usdcRaw, solPrice] = await Promise.all([
      connection.getBalance(new PublicKey(publicKey), "confirmed"),
      getUsdcBalanceRaw(connection, PublicKey, publicKey),
      getSolUsdPrice(admin).catch(() => null),
    ]);

    return jsonResponse({
      wallet_id: wallet.id,
      address: publicKey,
      public_key: publicKey,
      wallet_type: SOLANA_WALLET_TYPE,
      chain_id: null,
      lamports,
      sol: lamports / LAMPORTS_PER_SOL,
      usdc_raw: usdcRaw.toString(),
      usdc: formatUsdcRaw(usdcRaw),
      sol_price_usd: solPrice?.price ?? null,
      explorer_url: wallet.explorer_url ??
        solana.getSolanaAccountExplorerUrl(publicKey),
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return safeErrorResponse(e, { functionName: "solana-wallet-balance" });
  }
});
