// deno-lint-ignore-file no-explicit-any
// Native SOL transfer from a Linkr-managed Solana wallet.

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  LAMPORTS_PER_SOL,
  getSolanaTxExplorerUrl,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "./solana_chain.ts";
import { insufficientNativeBalanceErrorMessage } from "./wallet_balance_reply.ts";

export type SolTransferBalancePreflight = {
  balanceLamports: bigint;
  transferLamports: bigint;
  feeLamports: bigint;
  requiredLamports: bigint;
};

export function parseSolToLamports(value: number | string): bigint {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) throw new Error("invalid_amount");
  const [whole, fraction = ""] = text.split(".");
  const lamports =
    BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt((fraction + "0".repeat(9)).slice(0, 9));
  if (lamports <= 0n) throw new Error("amount_must_be_positive");
  return lamports;
}

export async function estimateSolTransferBalancePreflight(args: {
  from_address: string;
  recipient: string;
  amount_sol: number | string;
}): Promise<SolTransferBalancePreflight> {
  const connection = solanaConnection();
  const from = new PublicKey(normalizeSolanaPublicKey(args.from_address));
  const recipient = new PublicKey(normalizeSolanaPublicKey(args.recipient));
  const transferLamports = parseSolToLamports(args.amount_sol);
  if (transferLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount_too_large");

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: recipient,
      lamports: Number(transferLamports),
    }),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = from;
  const fee = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
  const feeLamports = BigInt(fee.value ?? 5000);
  const balanceLamports = BigInt(await connection.getBalance(from, "confirmed"));
  return {
    balanceLamports,
    transferLamports,
    feeLamports,
    requiredLamports: transferLamports + feeLamports,
  };
}

export async function transferSol(args: {
  secret_key: Uint8Array;
  expected_from_address: string;
  recipient: string;
  amount_sol: number | string;
}): Promise<{ signature: string; tx_hash: string; confirmed: boolean; explorer_url: string }> {
  const connection = solanaConnection();
  const sender = Keypair.fromSecretKey(args.secret_key);
  const expected = normalizeSolanaPublicKey(args.expected_from_address);
  const recipient = new PublicKey(normalizeSolanaPublicKey(args.recipient));

  if (sender.publicKey.toBase58() !== expected) {
    throw new Error("loaded_secret_key_address_mismatch");
  }

  const lamports = parseSolToLamports(args.amount_sol);
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount_too_large");
  const preflight = await estimateSolTransferBalancePreflight({
    from_address: sender.publicKey.toBase58(),
    recipient: recipient.toBase58(),
    amount_sol: args.amount_sol,
  });
  if (preflight.balanceLamports < preflight.requiredLamports) {
    throw new Error(
      insufficientNativeBalanceErrorMessage({
        symbol: "SOL",
        currentBalance: Number(preflight.balanceLamports) / LAMPORTS_PER_SOL,
        requiredAmount: Number(preflight.requiredLamports) / LAMPORTS_PER_SOL,
      }),
    );
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: Number(lamports),
    }),
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [sender], {
    commitment: "confirmed",
  });

  return {
    signature,
    tx_hash: signature,
    confirmed: true,
    explorer_url: getSolanaTxExplorerUrl(signature),
  };
}
