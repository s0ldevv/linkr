// deno-lint-ignore-file no-explicit-any
import { jsonResponse, sensitiveCorsHeaders, withSensitiveCors } from "../_shared/cors.ts";
import {
  consumeRateLimit,
  internalErrorResponse,
  rateLimitResponse,
  readJsonBody,
  requestBodyErrorResponse,
} from "../_shared/http.ts";
import { privateKeyHexToBytes } from "../_shared/robinhood_chain.ts";
import { parseSolanaPrivateKey } from "../_shared/solana_chain.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { importSolanaWalletForUser, importWalletForUser } from "../_shared/provisioning.ts";

type WalletChain = "evm" | "solana";

function publicError(message: string): { status: number; message: string } | null {
  if (message === "wallet_already_imported") return { status: 409, message };
  if (message === "invalid_evm_private_key" || message === "invalid_solana_private_key") {
    return { status: 400, message };
  }
  if (message === "unsupported_wallet_chain" || message === "private_key_required") {
    return { status: 400, message };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: sensitiveCorsHeaders(req) });
  if (req.method !== "POST") {
    return withSensitiveCors(req, jsonResponse({ error: "method_not_allowed" }, { status: 405 }));
  }

  try {
    const userId = await getCallerUserId(req);
    if (!userId) {
      return withSensitiveCors(req, jsonResponse({ error: "unauthorized" }, { status: 401 }));
    }
    const admin = serviceClient();
    const rateLimit = await consumeRateLimit(admin, {
      subjectType: "wallet_import",
      subjectId: userId,
      windowSeconds: 3600,
      limit: 10,
    });
    if (!rateLimit.allowed) return withSensitiveCors(req, rateLimitResponse(rateLimit.resetAt));

    const body = (await readJsonBody(req, 4_096)) as Record<string, unknown>;
    const chain = String(body.chain ?? "")
      .trim()
      .toLowerCase() as WalletChain;
    if (chain !== "evm" && chain !== "solana") throw new Error("unsupported_wallet_chain");
    const privateKey = String(body.private_key ?? "").trim();
    if (!privateKey) throw new Error("private_key_required");

    const wallet =
      chain === "solana"
        ? await importSolanaWalletForUser(admin, userId, parseSolanaPrivateKey(privateKey))
        : await importWalletForUser(
            admin,
            userId,
            privateKeyHexToBytes(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`),
          );

    return withSensitiveCors(
      req,
      jsonResponse(
        {
          id: wallet.id,
          public_key: wallet.public_key,
          address: wallet.address,
          chain_id: wallet.chain_id,
          wallet_type: wallet.wallet_type,
          explorer_url: wallet.explorer_url,
          is_primary: wallet.is_primary,
          created_at: wallet.created_at,
        },
        { status: 201 },
      ),
    );
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return withSensitiveCors(req, bodyError);
    const message = error instanceof Error ? error.message : String(error);
    const exposed = publicError(message);
    if (exposed) {
      return withSensitiveCors(
        req,
        jsonResponse({ error: exposed.message }, { status: exposed.status }),
      );
    }
    return withSensitiveCors(req, internalErrorResponse(error, { function: "import-user-wallet" }));
  }
});
