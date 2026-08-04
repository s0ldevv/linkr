// deno-lint-ignore-file no-explicit-any
import {
  Keypair,
  PublicKey,
  Transaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "https://esm.sh/@solana/spl-token@0.4.15?target=deno";
import { base58Encode } from "./solana_chain.ts";
import { sha256Hex } from "./transaction_outbox.ts";

export type ImmutableBatchRecipient = {
  ordinal: number;
  owner_address: string;
  allocation_raw: string;
};

export function buildHolderAirdropBatchTransaction(args: {
  mint: string;
  sourceTokenAccount: string;
  authority: string;
  decimals: number;
  recipients: ImmutableBatchRecipient[];
}): { transaction: Transaction; destinationAccounts: string[] } {
  if (!args.recipients.length || args.recipients.length > 4) {
    throw new Error("holder_airdrop_batch_size_invalid");
  }
  const mint = new PublicKey(args.mint);
  const source = new PublicKey(args.sourceTokenAccount);
  const authority = new PublicKey(args.authority);
  const transaction = new Transaction();
  const destinationAccounts: string[] = [];
  for (const recipient of args.recipients) {
    const owner = new PublicKey(recipient.owner_address);
    const allocation = BigInt(recipient.allocation_raw);
    if (allocation <= 0n) throw new Error("holder_airdrop_allocation_invalid");
    const destination = getAssociatedTokenAddressSync(
      mint,
      owner,
      true,
      TOKEN_PROGRAM_ID,
    );
    destinationAccounts.push(destination.toBase58());
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        authority,
        destination,
        owner,
        mint,
        TOKEN_PROGRAM_ID,
      ),
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        authority,
        allocation,
        args.decimals,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  return { transaction, destinationAccounts };
}

export async function dryRunHolderAirdropBatch(args: {
  connection: any;
  transaction: Transaction;
  authority: string;
  destinationAccounts: string[];
  requiredTokenRaw: bigint;
  currentSourceTokenRaw: bigint;
  simulate?: (
    transaction: Transaction,
  ) => Promise<{ err: unknown; logs?: string[] }>;
}): Promise<
  {
    feeLamports: bigint;
    rentLamports: bigint;
    requiredSolLamports: bigint;
    blockhash: string;
    lastValidBlockHeight: number;
  }
> {
  if (args.currentSourceTokenRaw < args.requiredTokenRaw) {
    throw new Error("holder_airdrop_insufficient_token_balance");
  }
  const authority = new PublicKey(args.authority);
  const latest = await args.connection.getLatestBlockhash("confirmed");
  args.transaction.feePayer = authority;
  args.transaction.recentBlockhash = latest.blockhash;
  const infos = await args.connection.getMultipleAccountsInfo(
    args.destinationAccounts.map((value) => new PublicKey(value)),
    "confirmed",
  );
  const missingCount = infos.filter((value: unknown) => value == null).length;
  const rentEach = BigInt(
    await args.connection.getMinimumBalanceForRentExemption(
      ACCOUNT_SIZE,
      "confirmed",
    ),
  );
  const fee = await args.connection.getFeeForMessage(
    args.transaction.compileMessage(),
    "confirmed",
  );
  const feeLamports = BigInt(fee.value ?? 5_000);
  const rentLamports = rentEach * BigInt(missingCount);
  const requiredSolLamports = feeLamports + rentLamports;
  const solBalance = BigInt(
    await args.connection.getBalance(authority, "confirmed"),
  );
  if (solBalance < requiredSolLamports) {
    throw new Error("holder_airdrop_insufficient_sol_for_fees_and_rent");
  }
  if (args.simulate) {
    const simulation = await args.simulate(args.transaction);
    if (simulation.err) throw new Error("holder_airdrop_simulation_failed");
  }
  return {
    feeLamports,
    rentLamports,
    requiredSolLamports,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

export async function signHolderAirdropBatchTransaction(args: {
  transaction: Transaction;
  authority: Keypair;
  blockhash: string;
  lastValidBlockHeight: number;
}): Promise<{
  signedBytes: Uint8Array;
  signedTransactionHash: string;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  args.transaction.feePayer = args.authority.publicKey;
  args.transaction.recentBlockhash = args.blockhash;
  args.transaction.sign(args.authority);
  const signatureBytes = args.transaction.signatures[0]?.signature;
  if (!signatureBytes) throw new Error("holder_airdrop_signature_missing");
  const signedBytes = args.transaction.serialize();
  if (signedBytes.byteLength < 1 || signedBytes.byteLength > 1232) {
    signedBytes.fill(0);
    throw new Error("holder_airdrop_signed_transaction_size_invalid");
  }
  return {
    signedBytes,
    signedTransactionHash: await sha256Hex(signedBytes),
    signature: base58Encode(signatureBytes),
    blockhash: args.blockhash,
    lastValidBlockHeight: args.lastValidBlockHeight,
  };
}

export async function validateStoredHolderAirdropBatchTransaction(args: {
  signedTransaction: string;
  signedTransactionHash: string;
  signature: string;
  blockhash: string;
  mint: string;
  sourceTokenAccount: string;
  authority: string;
  decimals: number;
  recipients: ImmutableBatchRecipient[];
}): Promise<Uint8Array> {
  const signedBytes = fromPostgresBytea(args.signedTransaction);
  try {
    if (signedBytes.byteLength < 1 || signedBytes.byteLength > 1232) {
      throw new Error("holder_airdrop_signed_transaction_size_invalid");
    }
    if ((await sha256Hex(signedBytes)) !== args.signedTransactionHash) {
      throw new Error("holder_airdrop_signed_transaction_hash_mismatch");
    }
    const transaction = Transaction.from(signedBytes);
    if (!transaction.verifySignatures()) {
      throw new Error("holder_airdrop_signature_invalid");
    }
    const authority = new PublicKey(args.authority);
    const mint = new PublicKey(args.mint);
    const source = new PublicKey(args.sourceTokenAccount);
    if (transaction.feePayer?.toBase58() !== authority.toBase58()) {
      throw new Error("holder_airdrop_fee_payer_mismatch");
    }
    if (transaction.recentBlockhash !== args.blockhash) {
      throw new Error("holder_airdrop_blockhash_mismatch");
    }
    const signatureBytes = transaction.signatures[0]?.signature;
    if (!signatureBytes || base58Encode(signatureBytes) !== args.signature) {
      throw new Error("holder_airdrop_signature_mismatch");
    }
    if (transaction.instructions.length !== args.recipients.length * 2) {
      throw new Error("holder_airdrop_instruction_count_invalid");
    }
    for (let index = 0; index < args.recipients.length; index++) {
      const recipient = args.recipients[index];
      const owner = new PublicKey(recipient.owner_address);
      const destination = getAssociatedTokenAddressSync(
        mint,
        owner,
        true,
        TOKEN_PROGRAM_ID,
      );
      const ataIx = transaction.instructions[index * 2];
      if (
        !ataIx.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) ||
        ataIx.keys[0]?.pubkey.toBase58() !== authority.toBase58() ||
        ataIx.keys[1]?.pubkey.toBase58() !== destination.toBase58() ||
        ataIx.keys[2]?.pubkey.toBase58() !== owner.toBase58() ||
        ataIx.keys[3]?.pubkey.toBase58() !== mint.toBase58()
      ) {
        throw new Error("holder_airdrop_ata_instruction_mismatch");
      }
      const transfer = decodeTransferCheckedInstruction(
        transaction.instructions[index * 2 + 1],
      );
      if (
        transfer.keys.source.pubkey.toBase58() !== source.toBase58() ||
        transfer.keys.mint.pubkey.toBase58() !== mint.toBase58() ||
        transfer.keys.destination.pubkey.toBase58() !==
          destination.toBase58() ||
        transfer.keys.owner.pubkey.toBase58() !== authority.toBase58() ||
        transfer.data.amount !== BigInt(recipient.allocation_raw) ||
        transfer.data.decimals !== args.decimals
      ) {
        throw new Error("holder_airdrop_transfer_instruction_mismatch");
      }
    }
    return signedBytes;
  } catch (error) {
    signedBytes.fill(0);
    throw error;
  }
}

export function classifyHolderAirdropSignatureStatus(value: any):
  | { kind: "confirmed"; slot: number | null }
  | { kind: "failed"; slot: number | null }
  | { kind: "pending"; slot: number | null }
  | { kind: "unknown"; slot: null } {
  if (!value) return { kind: "unknown", slot: null };
  const slot = Number.isSafeInteger(Number(value.slot))
    ? Number(value.slot)
    : null;
  if (value.err) return { kind: "failed", slot };
  const confirmationStatus = String(value.confirmationStatus ?? "");
  if (
    confirmationStatus === "confirmed" || confirmationStatus === "finalized"
  ) {
    return { kind: "confirmed", slot };
  }
  return { kind: "pending", slot };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function fromPostgresBytea(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error("holder_airdrop_signed_transaction_encoding_invalid");
  }
  return Uint8Array.from(
    hex.match(/.{2}/g) ?? [],
    (part) => Number.parseInt(part, 16),
  );
}
