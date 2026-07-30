// deno-lint-ignore-file no-explicit-any

import { sha256Hex } from "../transaction_outbox.ts";
import {
  base58Encode,
  getSolanaTxExplorerUrl,
  Keypair,
  normalizeSolanaPublicKey,
  PublicKey,
  solanaConnection,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "./runtime.ts";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SOL_FIRST_LAUNCH_FUNDING_SOL = 0.02;
/**
 * Most Linkr will auto-send to a launch wallet, per launch.
 *
 * Raised from 20_000_000 alongside PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS. The
 * fallback reserve estimate is 0.02 SOL, which already sat exactly at the old
 * cap — adding 0.009 SOL of rent headroom on top would have pushed the deficit
 * past it, and funding is skipped entirely when the deficit exceeds the cap. A
 * launch on the fallback path would have silently stopped being funded.
 */
export const SOL_LAUNCH_FUNDING_CAP_LAMPORTS = 30_000_000n;
export const SOL_FIRST_LAUNCH_FUNDING_LAMPORTS =
  SOL_LAUNCH_FUNDING_CAP_LAMPORTS;
export type SolanaFundingKind =
  | "first_launch_minimum"
  | "per_launch_minimum";

export type SolanaFundingResult =
  | {
    funded: false;
    status: "disabled" | "not_needed" | "ineligible";
    reason: string | null;
    amountLamports: bigint;
    txHash: null;
    sourceAddress: string | null;
    explorerUrl: null;
  }
  | {
    funded: true;
    status: "confirmed";
    reason: null;
    amountLamports: bigint;
    txHash: string;
    sourceAddress: string;
    explorerUrl: string;
  };

type SignatureState =
  | { kind: "confirmed"; slot: number | null }
  | { kind: "failed"; slot: number | null }
  | { kind: "pending"; slot: number | null }
  | { kind: "unknown"; slot: null };

export function firstLaunchFundingDeficit(
  balanceLamports: number,
  requiredLamports: number,
): bigint {
  if (!Number.isSafeInteger(balanceLamports) || balanceLamports < 0) {
    throw new Error("solana_wallet_balance_invalid");
  }
  if (!Number.isSafeInteger(requiredLamports) || requiredLamports < 0) {
    throw new Error("solana_launch_requirement_invalid");
  }
  return BigInt(Math.max(0, requiredLamports - balanceLamports));
}

export function classifyFundingSignatureStatus(value: any): SignatureState {
  if (!value) return { kind: "unknown", slot: null };
  const slot = Number.isSafeInteger(Number(value.slot))
    ? Number(value.slot)
    : null;
  if (value.err) return { kind: "failed", slot };
  if (
    value.confirmationStatus === "confirmed" ||
    value.confirmationStatus === "finalized"
  ) {
    return { kind: "confirmed", slot };
  }
  return { kind: "pending", slot };
}

export async function fundFirstSolanaLaunchIfNeeded(
  admin: any,
  args: {
    launchId: string;
    userId: string;
    walletId: string;
    destinationAddress: string;
    amountLamports: bigint;
    rawResult?: Record<string, unknown>;
  },
): Promise<SolanaFundingResult> {
  return await fundSolanaLaunchIfNeeded(admin, {
    ...args,
    fundingKind: "first_launch_minimum",
  });
}

export async function fundSolanaLaunchIfNeeded(
  admin: any,
  args: {
    launchId: string;
    userId: string;
    walletId: string;
    destinationAddress: string;
    amountLamports: bigint;
    fundingKind?: SolanaFundingKind;
    rawResult?: Record<string, unknown>;
  },
): Promise<SolanaFundingResult> {
  const fundingKind = args.fundingKind ?? "first_launch_minimum";
  if (args.amountLamports <= 0n) {
    return noFunding("not_needed", null, 0n, null);
  }
  if (args.amountLamports > SOL_LAUNCH_FUNDING_CAP_LAMPORTS) {
    return noFunding(
      "ineligible",
      "solana_first_launch_funding_cap_exceeded",
      args.amountLamports,
      null,
    );
  }
  if (args.amountLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("solana_funding_amount_too_large");
  }

  const rawFundingWallet = Deno.env.get("SOL_FUNDING_WALLET")?.trim();
  if (!rawFundingWallet) {
    return noFunding(
      "disabled",
      "sol_funding_wallet_missing",
      args.amountLamports,
      null,
    );
  }

  const decodedSecret = secretKeyBytes(rawFundingWallet, "SOL_FUNDING_WALLET");
  let fundingWallet: Keypair | null = null;
  try {
    fundingWallet = decodedSecret.length === 64
      ? Keypair.fromSecretKey(decodedSecret)
      : decodedSecret.length === 32
      ? Keypair.fromSeed(decodedSecret)
      : (() => {
        throw new Error(
          `SOL_FUNDING_WALLET_invalid_secret_key_length_${decodedSecret.length}`,
        );
      })();
    const sourceAddress = fundingWallet.publicKey.toBase58();
    const destinationAddress = normalizeSolanaPublicKey(
      args.destinationAddress,
    );
    if (sourceAddress === destinationAddress) {
      throw new Error("funding_source_matches_destination");
    }

    const claim = await claimSolanaFundingEvent(
      admin,
      args,
      sourceAddress,
      destinationAddress,
      fundingKind,
    );
    if (claim.data?.eligible !== true) {
      return noFunding(
        "ineligible",
        String(claim.data?.reason ?? "first_launch_subsidy_ineligible"),
        args.amountLamports,
        sourceAddress,
      );
    }
    let event = claim.data?.event;
    if (!event?.id) throw new Error("solana_funding_event_missing");
    const eventAmount = bigintFromText(event.amount_wei) ?? args.amountLamports;
    event = await refreshSolanaPendingFundingEvent(
      admin,
      event,
      eventAmount,
      fundingKind,
      args.rawResult,
    );

    if (event.status === "confirmed" && event.tx_hash) {
      return confirmedResult(eventAmount, event.tx_hash, sourceAddress);
    }
    if (event.tx_hash && !event.signed_transaction_base64) {
      const legacyState = await readSignatureState(String(event.tx_hash));
      if (legacyState.kind === "confirmed") {
        event = await markFundingConfirmed(
          admin,
          event,
          legacyState.slot,
          fundingKind,
        );
        return confirmedResult(eventAmount, event.tx_hash, sourceAddress);
      }
      if (legacyState.kind === "failed") {
        await markFundingFailed(
          admin,
          event,
          fundingKind,
          "legacy_solana_funding_transaction_failed",
        );
        throw new Error("legacy_solana_funding_transaction_failed");
      }
      throw new Error("legacy_solana_funding_transaction_outcome_unknown");
    }

    const connection = solanaConnection();
    if (!event.signed_transaction_base64) {
      event = await prepareFundingTransaction(
        admin,
        event,
        fundingWallet,
        destinationAddress,
        eventAmount,
        fundingKind,
      );
    }
    const signedBytes = await validateStoredFundingTransaction(
      event,
      sourceAddress,
      destinationAddress,
      eventAmount,
    );
    const signature = String(event.tx_hash);
    const state = await readSignatureState(signature);
    if (state.kind === "confirmed") {
      await markFundingConfirmed(admin, event, state.slot, fundingKind);
      return confirmedResult(eventAmount, signature, sourceAddress);
    }
    if (state.kind === "failed") {
      await markFundingFailed(
        admin,
        event,
        fundingKind,
        "solana_funding_transaction_failed",
      );
      throw new Error("solana_funding_transaction_failed");
    }

    const lastValidBlockHeight = Number(event.last_valid_block_height);
    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    if (currentBlockHeight > lastValidBlockHeight) {
      await markFundingFailed(
        admin,
        event,
        fundingKind,
        "solana_funding_transaction_expired",
      );
      throw new Error("solana_funding_transaction_expired");
    }

    event = await recordFundingBroadcast(
      admin,
      event,
      signature,
      fundingKind,
    );
    const returnedSignature = await connection.sendRawTransaction(signedBytes, {
      skipPreflight: false,
      maxRetries: 3,
    });
    if (returnedSignature !== signature) {
      throw new Error("solana_funding_signature_mismatch");
    }

    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: String(event.recent_blockhash),
        lastValidBlockHeight,
      },
      "confirmed",
    );
    if (confirmation.value.err) {
      await markFundingFailed(
        admin,
        event,
        fundingKind,
        "solana_funding_transaction_failed",
      );
      throw new Error("solana_funding_transaction_failed");
    }
    await markFundingConfirmed(
      admin,
      event,
      confirmation.context.slot,
      fundingKind,
    );
    return confirmedResult(eventAmount, signature, sourceAddress);
  } finally {
    decodedSecret.fill(0);
    fundingWallet?.secretKey.fill(0);
  }
}

export async function cancelUnbroadcastSolanaFirstLaunchFundingIfPresent(
  admin: any,
  launchId: string,
  userId: string,
): Promise<void> {
  await cancelUnbroadcastSolanaLaunchFundingIfPresent(
    admin,
    launchId,
    userId,
    "first_launch_minimum",
  );
}

export async function cancelUnbroadcastSolanaLaunchFundingIfPresent(
  admin: any,
  launchId: string,
  userId: string,
  fundingKind: SolanaFundingKind,
): Promise<void> {
  const result = await admin
    .from("wallet_funding_events")
    .select("id,tx_hash,status")
    .eq("coin_launch_id", launchId)
    .eq("user_id", userId)
    .eq("funding_kind", fundingKind)
    .eq("status", "pending")
    .is("tx_hash", null)
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return;
  const failed = await admin
    .from("wallet_funding_events")
    .update({
      status: "failed",
      error: "solana_launch_funding_no_longer_needed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", result.data.id)
    .eq("funding_kind", fundingKind)
    .eq("status", "pending")
    .is("tx_hash", null);
  if (failed.error) throw failed.error;
}

async function claimSolanaFundingEvent(
  admin: any,
  args: {
    launchId: string;
    userId: string;
    walletId: string;
    amountLamports: bigint;
    rawResult?: Record<string, unknown>;
  },
  sourceAddress: string,
  destinationAddress: string,
  fundingKind: SolanaFundingKind,
) {
  if (fundingKind === "first_launch_minimum") {
    const claim = await admin.rpc("claim_solana_first_launch_funding_v1", {
      p_launch_id: args.launchId,
      p_user_id: args.userId,
      p_wallet_id: args.walletId,
      p_source_address: sourceAddress,
      p_destination_address: destinationAddress,
      p_amount_lamports: args.amountLamports.toString(),
    });
    if (claim.error) throw claim.error;
    return claim;
  }

  const launchResult = await admin
    .from("coin_launches")
    .select("id,user_id,chain,dev_buy_sol,status")
    .eq("id", args.launchId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (launchResult.error) throw launchResult.error;
  const launch = launchResult.data;
  if (!launch) throw new Error("solana_funding_launch_not_found");
  if (String(launch.chain ?? "").toLowerCase() !== "solana") {
    return { data: { eligible: false, reason: "chain_not_solana" } };
  }
  if (Number(launch.dev_buy_sol ?? 0) > 0) {
    return { data: { eligible: false, reason: "positive_dev_buy" } };
  }
  if (
    ["failed", "cancelled", "rejected"].includes(
      String(launch.status ?? "pending").toLowerCase(),
    )
  ) {
    return { data: { eligible: false, reason: "launch_terminal" } };
  }

  let existing = await loadActivePerLaunchFundingEvent(
    admin,
    args.launchId,
    args.userId,
    fundingKind,
  );
  if (existing) {
    if (
      existing.source_address !== sourceAddress ||
      existing.destination_address !== destinationAddress
    ) {
      throw new Error("solana_funding_event_address_conflict");
    }
    existing = await refreshSolanaPendingFundingAmount(
      admin,
      existing,
      args.amountLamports,
      fundingKind,
      args.rawResult,
    );
    await updateLaunchFundingFromEvent(admin, existing, fundingKind, false);
    return { data: { eligible: true, event: existing } };
  }

  const inserted = await admin
    .from("wallet_funding_events")
    .insert({
      chain: "solana",
      coin_launch_id: args.launchId,
      user_id: args.userId,
      wallet_id: args.walletId,
      funding_kind: fundingKind,
      source_address: sourceAddress,
      destination_address: destinationAddress,
      amount_wei: args.amountLamports.toString(),
      status: "pending",
      raw_result: {
        chain: "solana",
        policy: fundingPolicyName(fundingKind),
        ...(recordObject(args.rawResult)),
        amount_lamports: args.amountLamports.toString(),
      },
    })
    .select("*")
    .single();
  if (inserted.error) {
    if (!isUniqueViolation(inserted.error)) throw inserted.error;
    existing = await loadActivePerLaunchFundingEvent(
      admin,
      args.launchId,
      args.userId,
      fundingKind,
    );
    if (!existing) throw inserted.error;
    await updateLaunchFundingFromEvent(admin, existing, fundingKind, false);
    return { data: { eligible: true, event: existing } };
  }
  await updateLaunchFundingFromEvent(admin, inserted.data, fundingKind, false);
  return { data: { eligible: true, event: inserted.data } };
}

async function loadActivePerLaunchFundingEvent(
  admin: any,
  launchId: string,
  userId: string,
  fundingKind: SolanaFundingKind,
) {
  const { data, error } = await admin
    .from("wallet_funding_events")
    .select("*")
    .eq("coin_launch_id", launchId)
    .eq("user_id", userId)
    .eq("funding_kind", fundingKind)
    .in("status", ["pending", "prepared", "submitted", "confirmed"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function refreshSolanaPendingFundingAmount(
  admin: any,
  event: any,
  amountLamports: bigint,
  fundingKind: SolanaFundingKind,
  rawResult?: Record<string, unknown>,
) {
  return await refreshSolanaPendingFundingEvent(
    admin,
    event,
    amountLamports,
    fundingKind,
    rawResult,
  );
}

async function refreshSolanaPendingFundingEvent(
  admin: any,
  event: any,
  amountLamports: bigint,
  fundingKind: SolanaFundingKind,
  rawResult?: Record<string, unknown>,
) {
  const rawPatch = recordObject(rawResult);
  const mergedRawResult = {
    ...(recordObject(event.raw_result)),
    ...rawPatch,
    amount_lamports: amountLamports.toString(),
  };
  if (
    event.status !== "pending" ||
    event.tx_hash ||
    event.signed_transaction_base64 ||
    (String(event.amount_wei) === amountLamports.toString() &&
      Object.keys(rawPatch).length === 0)
  ) {
    return event;
  }
  const { data, error } = await admin
    .from("wallet_funding_events")
    .update({
      amount_wei: amountLamports.toString(),
      raw_result: mergedRawResult,
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id)
    .eq("funding_kind", fundingKind)
    .eq("status", "pending")
    .is("tx_hash", null)
    .is("signed_transaction_base64", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ?? event;
}

async function updateLaunchFundingFromEvent(
  admin: any,
  event: any,
  fundingKind: SolanaFundingKind,
  confirmed: boolean,
) {
  const patch: Record<string, unknown> = {
    funding_policy: fundingPolicyName(fundingKind),
    funding_status: confirmed ? "confirmed" : event.status,
    funding_amount_wei: String(event.amount_wei),
    funding_tx_hash: event.tx_hash ?? null,
    funding_error: event.error ?? null,
  };
  if (fundingKind === "first_launch_minimum") {
    patch.first_launch_subsidy_eligible = true;
    if (confirmed) patch.first_launch_subsidized = true;
  }
  const result = await admin
    .from("coin_launches")
    .update(patch)
    .eq("id", event.coin_launch_id)
    .eq("user_id", event.user_id);
  if (result.error) throw result.error;
}

async function prepareFundingTransaction(
  admin: any,
  event: any,
  fundingWallet: Keypair,
  destinationAddress: string,
  amountLamports: bigint,
  fundingKind: SolanaFundingKind,
) {
  const connection = solanaConnection();
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fundingWallet.publicKey,
      toPubkey: new PublicKey(destinationAddress),
      lamports: Number(amountLamports),
    }),
  );
  transaction.feePayer = fundingWallet.publicKey;
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latest.blockhash;
  const fee = await connection.getFeeForMessage(
    transaction.compileMessage(),
    "confirmed",
  );
  const required = amountLamports + BigInt(fee.value ?? 5_000);
  const balance = BigInt(
    await connection.getBalance(fundingWallet.publicKey, "confirmed"),
  );
  if (balance < required) {
    throw new Error("sol_funding_wallet_insufficient_balance");
  }
  transaction.sign(fundingWallet);
  const signedBytes = transaction.serialize();
  const signatureBytes = transaction.signatures[0]?.signature;
  if (!signatureBytes) throw new Error("solana_funding_signature_missing");
  const signature = base58Encode(signatureBytes);
  const signedHash = await sha256Hex(signedBytes);
  const rawResult = {
    ...(recordObject(event.raw_result)),
    chain: "solana",
    policy: fundingPolicyName(fundingKind),
    amount_lamports: amountLamports.toString(),
    amount_sol: lamportsToSol(amountLamports),
    tx_hash: signature,
    explorer_url: getSolanaTxExplorerUrl(signature),
  };
  try {
    if (fundingKind === "first_launch_minimum") {
      const prepared = await admin.rpc(
        "prepare_solana_first_launch_funding_v1",
        {
          p_event_id: event.id,
          p_user_id: event.user_id,
          p_launch_id: event.coin_launch_id,
          p_tx_hash: signature,
          p_signed_transaction_base64: toBase64(signedBytes),
          p_signed_transaction_hash: signedHash,
          p_recent_blockhash: latest.blockhash,
          p_last_valid_block_height: latest.lastValidBlockHeight,
          p_raw_result: rawResult,
        },
      );
      if (prepared.error) throw prepared.error;
      return prepared.data;
    }

    const prepared = await admin
      .from("wallet_funding_events")
      .update({
        chain: "solana",
        status: "prepared",
        tx_hash: signature,
        signed_transaction_base64: toBase64(signedBytes),
        signed_transaction_hash: signedHash,
        recent_blockhash: latest.blockhash,
        last_valid_block_height: latest.lastValidBlockHeight,
        raw_result: rawResult,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("user_id", event.user_id)
      .eq("coin_launch_id", event.coin_launch_id)
      .eq("funding_kind", fundingKind)
      .eq("status", "pending")
      .is("tx_hash", null)
      .is("signed_transaction_base64", null)
      .select("*")
      .maybeSingle();
    if (prepared.error) throw prepared.error;
    if (prepared.data) return prepared.data;

    const existing = await admin
      .from("wallet_funding_events")
      .select("*")
      .eq("id", event.id)
      .eq("funding_kind", fundingKind)
      .eq("tx_hash", signature)
      .eq("signed_transaction_hash", signedHash)
      .eq("signed_transaction_base64", toBase64(signedBytes))
      .in("status", ["prepared", "submitted", "confirmed"])
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;
    throw new Error("solana_funding_prepare_conflict");
  } finally {
    signedBytes.fill(0);
  }
}

export async function validateStoredFundingTransaction(
  event: any,
  sourceAddress: string,
  destinationAddress: string,
  amountLamports: bigint,
): Promise<Uint8Array> {
  const signedBytes = fromBase64(String(event.signed_transaction_base64 ?? ""));
  if (signedBytes.length < 1 || signedBytes.length > 1232) {
    signedBytes.fill(0);
    throw new Error("solana_funding_signed_transaction_size_invalid");
  }
  if ((await sha256Hex(signedBytes)) !== event.signed_transaction_hash) {
    signedBytes.fill(0);
    throw new Error("solana_funding_signed_transaction_hash_mismatch");
  }
  const transaction = Transaction.from(signedBytes);
  if (!transaction.verifySignatures()) {
    signedBytes.fill(0);
    throw new Error("solana_funding_signature_invalid");
  }
  if (transaction.feePayer?.toBase58() !== sourceAddress) {
    signedBytes.fill(0);
    throw new Error("solana_funding_source_mismatch");
  }
  if (transaction.recentBlockhash !== event.recent_blockhash) {
    signedBytes.fill(0);
    throw new Error("solana_funding_blockhash_mismatch");
  }
  if (transaction.instructions.length !== 1) {
    signedBytes.fill(0);
    throw new Error("solana_funding_instruction_count_invalid");
  }
  const instruction = transaction.instructions[0];
  if (!instruction.programId.equals(SystemProgram.programId)) {
    signedBytes.fill(0);
    throw new Error("solana_funding_program_invalid");
  }
  const transfer = SystemInstruction.decodeTransfer(instruction);
  const signatureBytes = transaction.signatures[0]?.signature;
  if (
    transfer.fromPubkey.toBase58() !== sourceAddress ||
    transfer.toPubkey.toBase58() !== destinationAddress ||
    BigInt(transfer.lamports) !== amountLamports ||
    !signatureBytes ||
    base58Encode(signatureBytes) !== event.tx_hash
  ) {
    signedBytes.fill(0);
    throw new Error("solana_funding_transaction_payload_mismatch");
  }
  return signedBytes;
}

async function readSignatureState(signature: string): Promise<SignatureState> {
  const result = await solanaConnection().getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  return classifyFundingSignatureStatus(result.value?.[0]);
}

async function recordFundingBroadcast(
  admin: any,
  event: any,
  signature: string,
  fundingKind: SolanaFundingKind,
) {
  if (fundingKind === "first_launch_minimum") {
    const recorded = await admin.rpc(
      "record_solana_first_launch_funding_broadcast_v1",
      { p_event_id: event.id, p_tx_hash: signature },
    );
    if (recorded.error) throw recorded.error;
    return recorded.data;
  }

  const { data, error } = await admin
    .from("wallet_funding_events")
    .update({
      status: "submitted",
      broadcast_attempt_count: Number(event.broadcast_attempt_count ?? 0) + 1,
      last_broadcast_at: new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id)
    .eq("funding_kind", fundingKind)
    .eq("tx_hash", signature)
    .in("status", ["prepared", "submitted"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  const row = data ?? event;
  await updateLaunchFundingFromEvent(admin, row, fundingKind, false);
  return row;
}

async function markFundingConfirmed(
  admin: any,
  event: any,
  slot: number | null,
  fundingKind: SolanaFundingKind,
) {
  if (fundingKind !== "first_launch_minimum") {
    const { data, error } = await admin
      .from("wallet_funding_events")
      .update({
        chain: "solana",
        status: "confirmed",
        confirmed_at: event.confirmed_at ?? new Date().toISOString(),
        error: null,
        raw_result: {
          ...(recordObject(event.raw_result)),
          chain: "solana",
          policy: fundingPolicyName(fundingKind),
          amount_lamports: String(event.amount_wei),
          amount_sol: lamportsToSol(bigintFromText(event.amount_wei) ?? 0n),
          source_address: event.source_address,
          destination_address: event.destination_address,
          explorer_url: getSolanaTxExplorerUrl(String(event.tx_hash)),
          slot,
          tx_hash: event.tx_hash,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("funding_kind", fundingKind)
      .eq("tx_hash", event.tx_hash)
      .in("status", ["prepared", "submitted", "confirmed"])
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const row = data ?? event;
    await updateLaunchFundingFromEvent(admin, row, fundingKind, true);
    return row;
  }

  const result = await admin.rpc("confirm_solana_first_launch_funding_v1", {
    p_event_id: event.id,
    p_tx_hash: event.tx_hash,
    p_slot: slot,
    p_raw_result: {
      chain: "solana",
      policy: fundingPolicyName(fundingKind),
      amount_lamports: String(event.amount_wei),
      amount_sol: lamportsToSol(bigintFromText(event.amount_wei) ?? 0n),
      source_address: event.source_address,
      destination_address: event.destination_address,
      explorer_url: getSolanaTxExplorerUrl(String(event.tx_hash)),
    },
  });
  if (result.error) throw result.error;
  return result.data;
}

async function markFundingFailed(
  admin: any,
  event: any,
  fundingKind: SolanaFundingKind,
  error: string,
) {
  if (fundingKind !== "first_launch_minimum") {
    const failed = await admin
      .from("wallet_funding_events")
      .update({
        status: "failed",
        error: error.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("funding_kind", fundingKind)
      .in("status", ["pending", "prepared", "submitted"])
      .select("*")
      .maybeSingle();
    if (failed.error) throw failed.error;
    const row = failed.data ?? event;
    await updateLaunchFundingFromEvent(admin, row, fundingKind, false);
    return row;
  }

  const result = await admin.rpc("fail_solana_first_launch_funding_v1", {
    p_event_id: event.id,
    p_tx_hash: event.tx_hash ?? null,
    p_error: error,
  });
  if (result.error) throw result.error;
  return result.data;
}

function confirmedResult(
  amountLamports: bigint,
  txHash: string,
  sourceAddress: string,
): SolanaFundingResult {
  return {
    funded: true,
    status: "confirmed",
    reason: null,
    amountLamports,
    txHash,
    sourceAddress,
    explorerUrl: getSolanaTxExplorerUrl(txHash),
  };
}

function noFunding(
  status: "disabled" | "not_needed" | "ineligible",
  reason: string | null,
  amountLamports: bigint,
  sourceAddress: string | null,
): SolanaFundingResult {
  return {
    funded: false,
    status,
    reason,
    amountLamports,
    txHash: null,
    sourceAddress,
    explorerUrl: null,
  };
}

function secretKeyBytes(value: string, name: string): Uint8Array {
  const text = value.trim();
  if (!text) throw new Error(`${name}_missing`);
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error(`${name}_invalid_json`);
    return bytesFromNumbers(
      parsed.map((item) => Number(item)),
      `${name}_invalid_json_byte`,
    );
  }
  if (/^\d+(,\s*\d+)+$/.test(text)) {
    return bytesFromNumbers(
      text.split(",").map((item) => Number(item.trim())),
      `${name}_invalid_csv_byte`,
    );
  }
  return base58Decode(text);
}

function base58Decode(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  let leadingZeros = 0;
  while (
    leadingZeros < value.length &&
    value[leadingZeros] === BASE58_ALPHABET[0]
  ) {
    leadingZeros += 1;
  }
  if (leadingZeros === value.length) return new Uint8Array(leadingZeros);
  const bytes = [0];
  for (const char of value.slice(leadingZeros)) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid_base58_secret");
    let carry = index;
    for (let cursor = 0; cursor < bytes.length; cursor++) {
      const next = bytes[cursor] * 58 + carry;
      bytes[cursor] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Uint8Array.from([
    ...Array(leadingZeros).fill(0),
    ...bytes.reverse(),
  ]);
}

function bytesFromNumbers(values: number[], error: string): Uint8Array {
  if (
    values.some((item) => !Number.isInteger(item) || item < 0 || item > 255)
  ) {
    throw new Error(error);
  }
  return Uint8Array.from(values);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch (_) {
    throw new Error("solana_funding_signed_transaction_base64_invalid");
  }
}

function lamportsToSol(value: bigint): number {
  return Number(value) / 1_000_000_000;
}

function fundingPolicyName(fundingKind: SolanaFundingKind): string {
  return fundingKind === "per_launch_minimum"
    ? "solana_per_launch_minimum_v1"
    : "solana_first_launch_minimum_v1";
}

function isUniqueViolation(error: any): boolean {
  return (
    error?.code === "23505" ||
    /duplicate key|already exists|unique/i.test(
      String(error?.message ?? error ?? ""),
    )
  );
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function bigintFromText(value: unknown): bigint | null {
  try {
    const text = String(value ?? "").trim();
    return text ? BigInt(text) : null;
  } catch (_) {
    return null;
  }
}
