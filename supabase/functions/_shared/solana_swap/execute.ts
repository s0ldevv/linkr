// deno-lint-ignore-file no-explicit-any
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  base58Encode,
  SOLANA_NATIVE_ASSET_ID,
  SOLANA_NATIVE_SYMBOL,
  getSolanaTxExplorerUrl,
  loadSolanaWallet,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "../solana_chain.ts";
import { readHeliusSenderUrl } from "./constants.ts";
import { createSolanaSwapTransaction, quoteSolanaSwap } from "./quote.ts";
import type {
  SolanaBuySwapRequest,
  SolanaSellSwapRequest,
  SolanaSwapExecutionResult,
  SolanaSwapRequest,
  SolanaTokenInfo,
} from "./types.ts";

export async function executeSolanaBuySwap(
  admin: any,
  request: SolanaBuySwapRequest,
): Promise<SolanaSwapExecutionResult> {
  return executeSolanaSwap(admin, request);
}

export async function executeSolanaSellSwap(
  admin: any,
  request: SolanaSellSwapRequest,
): Promise<SolanaSwapExecutionResult> {
  return executeSolanaSwap(admin, request);
}

export async function getSolanaTokenBalanceRaw(args: {
  owner: string;
  mint: string;
}): Promise<{ amount: bigint; decimals: number; uiAmount: number | null }> {
  const connection = solanaConnection();
  const mint = new PublicKey(normalizeSolanaPublicKey(args.mint));
  const owner = new PublicKey(normalizeSolanaPublicKey(args.owner));
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint }, "confirmed");
  let total = 0n;
  let decimals = 0;
  let uiAmount: number | null = null;
  for (const account of accounts.value) {
    const tokenAmount = (account.account.data as any)?.parsed?.info?.tokenAmount;
    if (!tokenAmount) continue;
    decimals = Number(tokenAmount.decimals ?? decimals);
    total += BigInt(String(tokenAmount.amount ?? "0"));
    uiAmount = (uiAmount ?? 0) + Number(tokenAmount.uiAmount ?? 0);
  }
  return { amount: total, decimals, uiAmount };
}

async function executeSolanaSwap(
  admin: any,
  request: SolanaSwapRequest,
): Promise<SolanaSwapExecutionResult> {
  const wallet = await loadSolanaWallet(admin, request.userId);
  if (!wallet) throw new Error("no_solana_wallet");
  if (wallet.id !== request.walletId) throw new Error("solana_wallet_changed_before_swap");
  if (wallet.address !== normalizeSolanaPublicKey(request.walletAddress)) {
    throw new Error("solana_wallet_address_changed_before_swap");
  }

  const existing = await findExistingTransaction(admin, request.idempotencyKey);
  if (existing?.tx_hash && existing.status === "confirmed")
    throw new Error("swap_already_confirmed");
  if (existing?.tx_hash && existing.status === "submitted")
    throw new Error("swap_already_submitted");
  if (existing) throw new Error("swap_already_in_progress");
  await reserveSwapTransaction(admin, request);

  const signer = Keypair.fromSecretKey(wallet.secret_key);
  if (signer.publicKey.toBase58() !== wallet.address) {
    throw new Error("loaded_solana_secret_key_address_mismatch");
  }

  const quote = await quoteSolanaSwap(request);
  const swapResponse = await createSolanaSwapTransaction(
    quote,
    wallet.address,
    request.priorityFeeLamports,
  );
  const transaction = VersionedTransaction.deserialize(base64ToBytes(swapResponse.swapTransaction));
  transaction.sign([signer]);
  const signedTransaction = transaction.serialize();
  const signature = base58Encode(transaction.signatures[0]);

  const inputToken = await tokenInfo(quote.inputMint, request.side === "buy" ? "SOL" : null);
  const outputToken = await tokenInfo(quote.outputMint, request.side === "sell" ? "SOL" : null);

  await upsertSubmittedTransaction(
    admin,
    request,
    quote,
    inputToken,
    outputToken,
    swapResponse,
    signature,
  );
  const submittedSignature = await sendSignedTransaction(signedTransaction);
  if (submittedSignature && submittedSignature !== signature) {
    throw new Error("solana_sender_signature_mismatch");
  }

  await admin
    .from("transactions")
    .update({
      tx_hash: signature,
      tx_signature: signature,
      explorer_url: getSolanaTxExplorerUrl(signature),
    })
    .eq("idempotency_key", request.idempotencyKey);

  const confirmed = await confirmSignature(signature);
  const result: SolanaSwapExecutionResult = {
    txHash: signature,
    signature,
    status: confirmed ? "confirmed" : "submitted",
    inputAmount: quote.inputAmount,
    outputAmount: null,
    quotedOutputAmount: quote.quotedOutputAmount,
    minOutputAmount: quote.minOutputAmount,
    explorerUrl: getSolanaTxExplorerUrl(signature),
    quote,
    inputToken,
    outputToken,
    rawResult: { signature, confirmed },
  };

  await admin
    .from("transactions")
    .update({
      status: result.status,
      tx_hash: signature,
      tx_signature: signature,
      explorer_url: result.explorerUrl,
      output_amount_wei: result.outputAmount,
      raw_result: result.rawResult,
      confirmed_at: confirmed ? new Date().toISOString() : null,
    })
    .eq("idempotency_key", request.idempotencyKey);

  return result;
}

async function sendSignedTransaction(serialized: Uint8Array): Promise<string | null> {
  const senderUrl = readHeliusSenderUrl();
  const encoded = bytesToBase64(serialized);
  if (senderUrl) {
    const response = await fetch(senderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "sendTransaction",
        params: [
          encoded,
          {
            encoding: "base64",
            skipPreflight: true,
            maxRetries: 0,
          },
        ],
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.error) {
      throw new Error(json?.error?.message ?? `helius_sender_${response.status}`);
    }
    return typeof json?.result === "string" ? json.result : null;
  }

  return await solanaConnection().sendRawTransaction(serialized, {
    skipPreflight: false,
    maxRetries: 3,
  });
}

async function confirmSignature(signature: string): Promise<boolean> {
  // Poll getSignatureStatuses instead of connection.confirmTransaction — the
  // web3.js confirm helper is tied to blockhash expiry and throws
  // TransactionExpiredTimeoutError after ~30s even when the tx has landed.
  // We poll for up to ~90s and only treat an explicit on-chain error as a
  // failure. If we never see a status, we return false (status: "submitted")
  // so the caller still reports the signature/explorer link to the user
  // rather than a scary "unknown if it succeeded" message.
  const connection = solanaConnection();
  const deadline = Date.now() + 90_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const { value } = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = value?.[0];
      if (status) {
        if (status.err) throw new Error("solana_swap_tx_failed");
        const conf = status.confirmationStatus;
        if (conf === "confirmed" || conf === "finalized") return true;
        if (typeof status.confirmations === "number" && status.confirmations > 0) {
          return true;
        }
      }
    } catch (err) {
      if ((err as Error)?.message === "solana_swap_tx_failed") throw err;
      // transient RPC error — keep polling
    }
    // 1s poll interval, gentle backoff after 15 attempts
    await new Promise((r) => setTimeout(r, attempt > 15 ? 2_000 : 1_000));
  }
  return false;
}

async function tokenInfo(mint: string, nativeSymbol: string | null): Promise<SolanaTokenInfo> {
  const normalized = normalizeSolanaPublicKey(mint);
  if (normalized === SOLANA_NATIVE_ASSET_ID) {
    return { mint: normalized, symbol: nativeSymbol ?? SOLANA_NATIVE_SYMBOL, decimals: 9 };
  }
  const account = await solanaConnection().getParsedAccountInfo(
    new PublicKey(normalized),
    "confirmed",
  );
  const parsed = (account.value?.data as any)?.parsed?.info;
  const decimals = Number(parsed?.decimals ?? 0);
  return { mint: normalized, symbol: null, decimals };
}

async function findExistingTransaction(admin: any, idempotencyKey: string): Promise<any | null> {
  const { data } = await admin
    .from("transactions")
    .select("id,status,tx_hash")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return data ?? null;
}

async function upsertSubmittedTransaction(
  admin: any,
  request: SolanaSwapRequest,
  quote: any,
  inputToken: SolanaTokenInfo,
  outputToken: SolanaTokenInfo,
  swapResponse: any,
  signature: string,
) {
  const isBuy = request.side === "buy";
  const { error } = await admin.from("transactions").upsert(
    {
      user_id: request.userId,
      tweet_id: request.sourceTweetId,
      action: request.side,
      chain: "solana",
      input_mint: isBuy ? SOLANA_NATIVE_ASSET_ID : request.inputMint,
      output_mint: isBuy ? request.outputMint : SOLANA_NATIVE_ASSET_ID,
      amount_original_unit: isBuy ? "sol" : "token",
      amount_sol: isBuy ? Number(request.inputLamports) / 1_000_000_000 : null,
      slippage_bps: request.slippageBps,
      chain_id: null,
      native_symbol: SOLANA_NATIVE_SYMBOL,
      wallet_id: request.walletId,
      wallet_address: request.walletAddress,
      input_amount_wei: quote.inputAmount,
      quoted_output_amount_wei: quote.quotedOutputAmount,
      min_output_amount_wei: quote.minOutputAmount,
      input_token_decimals: inputToken.decimals,
      output_token_decimals: outputToken.decimals,
      input_token_symbol: inputToken.symbol,
      output_token_symbol: outputToken.symbol,
      router_address: null,
      route_source: quote.routeSource,
      quote_id: quote.quoteId,
      quote_payload: quote.raw as any,
      execution_payload: swapResponse as any,
      raw_request: { request, quote } as any,
      source_surface: request.sourceSurface ?? null,
      status: "submitted",
      tx_hash: signature,
      tx_signature: signature,
      explorer_url: getSolanaTxExplorerUrl(signature),
      submitted_at: new Date().toISOString(),
      idempotency_key: request.idempotencyKey,
    },
    { onConflict: "idempotency_key" },
  );
  if (error) throw error;
}

async function reserveSwapTransaction(admin: any, request: SolanaSwapRequest) {
  const isBuy = request.side === "buy";
  const { error } = await admin.from("transactions").insert({
    user_id: request.userId,
    tweet_id: request.sourceTweetId,
    action: request.side,
    chain: "solana",
    input_mint: isBuy ? SOLANA_NATIVE_ASSET_ID : request.inputMint,
    output_mint: isBuy ? request.outputMint : SOLANA_NATIVE_ASSET_ID,
    wallet_id: request.walletId,
    wallet_address: request.walletAddress,
    source_surface: request.sourceSurface ?? null,
    status: "preparing",
    idempotency_key: request.idempotencyKey,
    raw_request: { request, reservation: true },
  });
  if (!error) return;
  if (String(error.code ?? "") === "23505") {
    throw new Error("swap_already_in_progress");
  }
  throw error;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
