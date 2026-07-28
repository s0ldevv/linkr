// deno-lint-ignore-file no-explicit-any no-import-prefix
// Internal, service-only wallet/portfolio read for the Linkr conversational
// runtime.
//
// The shared conversational runtime (linkr_agent_runtime.ts, used by
// terminal-chat + telegram-webhook) must stay free of the chain SDKs
// (ethers / @solana/web3.js), otherwise its deployed edge bundle exceeds the
// worker boot budget and every request fails with HTTP 546 (WORKER_RESOURCE_LIMIT).
//
// Balance / portfolio answers still need live chain reads, so those two route
// handlers relay here. This function is chain-isolated and single-purpose, so it
// stays well under the boot budget (same footprint as wallet-balances, which
// boots fine).
//
// AUTH: internal only. The caller must present the service-role key as the
// bearer token. It is never exposed to browsers (terminal-chat calls it
// server-side inside the edge isolate).

import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { jsonResponse } from "../_shared/cors.ts";
import {
  internalErrorResponse,
  readJsonBody,
  requestBodyErrorResponse,
} from "../_shared/http.ts";
import { isCronAuthorized } from "../_shared/cron_auth.ts";
import { getErc20TokenBalances, getEthBalance } from "../_shared/robinhood_chain.ts";
import { loadWallet } from "../_shared/wallet.ts";
import {
  LAMPORTS_PER_SOL,
  loadSolanaWallet,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { getSolanaTokenBalances } from "../_shared/solana_portfolio.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  if (!isCronAuthorized(req)) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await readJsonBody(req, 16 * 1024);
  } catch (error) {
    return requestBodyErrorResponse(error) ??
      internalErrorResponse(error, { function: "linkr-agent-wallet-read", phase: "parse" });
  }
  const userId = String(body?.user_id ?? "").trim();
  const scope = body?.scope === "portfolio" ? "portfolio" : "wallet";
  if (!userId) return jsonResponse({ error: "user_id_required" }, { status: 400 });

  try {
    const admin = serviceClient();
    const [evmWallet, solWallet] = await Promise.all([
      loadWallet(admin, userId).catch(() => null),
      loadSolanaWallet(admin, userId).catch(() => null),
    ]);

    const wallets = {
      evmWallet: evmWallet
        ? { address: evmWallet.address, explorer_url: evmWallet.explorer_url }
        : null,
      solWallet: solWallet
        ? { address: solWallet.address, explorer_url: solWallet.explorer_url }
        : null,
    };

    if (scope === "portfolio") {
      const [evmTokens, solTokens] = await Promise.all([
        evmWallet ? getErc20TokenBalances(evmWallet.address).catch(() => []) : [],
        solWallet ? getSolanaTokenBalances(solWallet.address).catch(() => []) : [],
      ]);
      return jsonResponse({ ...wallets, evmTokens, solTokens });
    }

    const [eth, sol] = await Promise.all([
      evmWallet ? getEthBalance(evmWallet.address).catch(() => null) : null,
      solWallet
        ? solanaConnection()
          .getBalance(new PublicKey(solWallet.address), "confirmed")
          .then((v: number) => v / LAMPORTS_PER_SOL)
          .catch(() => null)
        : null,
    ]);
    return jsonResponse({ ...wallets, eth, sol });
  } catch (error) {
    return internalErrorResponse(error, { function: "linkr-agent-wallet-read" });
  }
});
