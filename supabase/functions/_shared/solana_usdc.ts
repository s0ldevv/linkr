// deno-lint-ignore-file no-explicit-any
// Native Circle USDC helpers for Solana mainnet.

import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  ACCOUNT_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "https://esm.sh/@solana/spl-token@0.4.15?target=deno";
import {
  getSolanaTxExplorerUrl,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "./solana_chain.ts";

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_USDC_DECIMALS = 6;
export const SOLANA_USDC_SYMBOL = "USDC";

export type UsdcTransferPreflight = {
  balanceRaw: bigint;
  transferRaw: bigint;
  feeLamports: bigint;
  rentLamports: bigint;
  requiredSolLamports: bigint;
  solBalanceLamports: bigint;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  createsDestinationAccount: boolean;
};

export function parseUsdcToRaw(value: number | string): bigint {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw new Error("invalid_usdc_amount");
  const [whole, fraction = ""] = text.split(".");
  const raw = BigInt(whole) * 1_000_000n +
    BigInt((fraction + "000000").slice(0, 6));
  if (raw <= 0n) throw new Error("amount_must_be_positive");
  return raw;
}

export function formatUsdcRaw(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(
    /0+$/,
    "",
  );
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function getUsdcBalanceRaw(ownerAddress: string): Promise<bigint> {
  const owner = walletPublicKey(ownerAddress);
  const accounts = await usdcTokenAccounts(owner);
  return accounts.reduce((sum, account) => sum + account.amount, 0n);
}

export async function estimateUsdcTransferBalancePreflight(args: {
  from_address: string;
  recipient: string;
  amount_usdc: number | string;
}): Promise<UsdcTransferPreflight> {
  const connection = solanaConnection();
  const from = walletPublicKey(args.from_address);
  const recipient = walletPublicKey(args.recipient);
  if (from.equals(recipient)) throw new Error("recipient_matches_sender");

  const transferRaw = parseUsdcToRaw(args.amount_usdc);
  const accounts = await usdcTokenAccounts(from);
  const balanceRaw = accounts.reduce(
    (sum, account) => sum + account.amount,
    0n,
  );
  const source = chooseSourceAccount(accounts, transferRaw);
  if (!source) {
    if (balanceRaw >= transferRaw) throw new Error("usdc_balance_fragmented");
    return emptyInsufficientPreflight(from, recipient, balanceRaw, transferRaw);
  }

  const mint = new PublicKey(SOLANA_USDC_MINT);
  const destination = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false,
    TOKEN_PROGRAM_ID,
  );
  const destinationInfo = await connection.getAccountInfo(
    destination,
    "confirmed",
  );
  const createsDestinationAccount = destinationInfo == null;
  const transaction = new Transaction();
  if (createsDestinationAccount) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        from,
        destination,
        recipient,
        mint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  transaction.add(
    createTransferCheckedInstruction(
      source.address,
      mint,
      destination,
      from,
      transferRaw,
      SOLANA_USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = from;
  const fee = await connection.getFeeForMessage(
    transaction.compileMessage(),
    "confirmed",
  );
  const feeLamports = BigInt(fee.value ?? 5000);
  const rentLamports = createsDestinationAccount
    ? BigInt(
      await connection.getMinimumBalanceForRentExemption(
        ACCOUNT_SIZE,
        "confirmed",
      ),
    )
    : 0n;
  const solBalanceLamports = BigInt(
    await connection.getBalance(from, "confirmed"),
  );

  return {
    balanceRaw,
    transferRaw,
    feeLamports,
    rentLamports,
    requiredSolLamports: feeLamports + rentLamports,
    solBalanceLamports,
    sourceTokenAccount: source.address.toBase58(),
    destinationTokenAccount: destination.toBase58(),
    createsDestinationAccount,
  };
}

export async function transferUsdc(args: {
  secret_key: Uint8Array;
  expected_from_address: string;
  recipient: string;
  amount_usdc: number | string;
}): Promise<{
  signature: string;
  tx_hash: string;
  confirmed: boolean;
  explorer_url: string;
  amount_raw: string;
  source_token_account: string;
  destination_token_account: string;
  created_destination_account: boolean;
}> {
  const connection = solanaConnection();
  const sender = Keypair.fromSecretKey(args.secret_key);
  const expected = walletPublicKey(args.expected_from_address);
  if (!sender.publicKey.equals(expected)) {
    throw new Error("loaded_secret_key_address_mismatch");
  }

  const recipient = walletPublicKey(args.recipient);
  const preflight = await estimateUsdcTransferBalancePreflight({
    from_address: expected.toBase58(),
    recipient: recipient.toBase58(),
    amount_usdc: args.amount_usdc,
  });
  if (preflight.balanceRaw < preflight.transferRaw) {
    throw new Error("insufficient_usdc");
  }
  if (preflight.solBalanceLamports < preflight.requiredSolLamports) {
    throw new Error("insufficient_sol_for_usdc_transfer_fee");
  }

  const mint = new PublicKey(SOLANA_USDC_MINT);
  const source = new PublicKey(preflight.sourceTokenAccount);
  const destination = new PublicKey(preflight.destinationTokenAccount);
  const transaction = new Transaction();
  if (preflight.createsDestinationAccount) {
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        sender.publicKey,
        destination,
        recipient,
        mint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  transaction.add(
    createTransferCheckedInstruction(
      source,
      mint,
      destination,
      sender.publicKey,
      preflight.transferRaw,
      SOLANA_USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  const signature = await sendAndConfirmTransaction(connection, transaction, [
    sender,
  ], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return {
    signature,
    tx_hash: signature,
    confirmed: true,
    explorer_url: getSolanaTxExplorerUrl(signature),
    amount_raw: preflight.transferRaw.toString(),
    source_token_account: source.toBase58(),
    destination_token_account: destination.toBase58(),
    created_destination_account: preflight.createsDestinationAccount,
  };
}

function walletPublicKey(value: string): PublicKey {
  const key = new PublicKey(normalizeSolanaPublicKey(value));
  if (!PublicKey.isOnCurve(key.toBytes())) {
    throw new Error("invalid_solana_wallet_address");
  }
  return key;
}

async function usdcTokenAccounts(
  owner: PublicKey,
): Promise<Array<{ address: PublicKey; amount: bigint }>> {
  const connection = solanaConnection();
  const mint = new PublicKey(SOLANA_USDC_MINT);
  const response = await connection.getParsedTokenAccountsByOwner(owner, {
    mint,
  }, "confirmed");
  return response.value.map((item) => ({
    address: item.pubkey,
    amount: BigInt(
      String(
        (item.account.data as any)?.parsed?.info?.tokenAmount?.amount ?? "0",
      ),
    ),
  }));
}

function chooseSourceAccount(
  accounts: Array<{ address: PublicKey; amount: bigint }>,
  amount: bigint,
): { address: PublicKey; amount: bigint } | null {
  return (
    [...accounts]
      .sort((
        a,
        b,
      ) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1))
      .find((account) => account.amount >= amount) ?? null
  );
}

function emptyInsufficientPreflight(
  from: PublicKey,
  recipient: PublicKey,
  balanceRaw: bigint,
  transferRaw: bigint,
): UsdcTransferPreflight {
  const destination = getAssociatedTokenAddressSync(
    new PublicKey(SOLANA_USDC_MINT),
    recipient,
    false,
    TOKEN_PROGRAM_ID,
  );
  return {
    balanceRaw,
    transferRaw,
    feeLamports: 0n,
    rentLamports: 0n,
    requiredSolLamports: 0n,
    solBalanceLamports: 0n,
    sourceTokenAccount: getAssociatedTokenAddressSync(
      new PublicKey(SOLANA_USDC_MINT),
      from,
      false,
      TOKEN_PROGRAM_ID,
    ).toBase58(),
    destinationTokenAccount: destination.toBase58(),
    createsDestinationAccount: false,
  };
}
