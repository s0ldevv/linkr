// deno-lint-ignore-file no-explicit-any

import { ethers } from "https://esm.sh/ethers@6";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
  robinhoodProvider,
} from "../robinhood_chain.ts";
import { sha256Hex } from "../transaction_outbox.ts";

export type FundingKind = "first_launch_minimum" | "per_launch_minimum";

export type FundingResult =
  | {
    funded: false;
    status: "disabled" | "not_needed";
    amountWei: bigint;
    txHash: null;
    sourceAddress: null;
  }
  | {
    funded: true;
    status: "confirmed";
    amountWei: bigint;
    txHash: string;
    sourceAddress: string;
    explorerUrl: string;
  };

const ACTIVE_FUNDING_STATUSES = [
  "pending",
  "prepared",
  "submitted",
  "confirmed",
];

export async function fundFirstLaunchIfNeeded(
  admin: any,
  args: {
    launchId: string;
    userId: string;
    walletId: string;
    destinationAddress: string;
    amountWei: bigint;
    enabled?: boolean;
    fundingKind?: FundingKind;
  },
): Promise<FundingResult> {
  const fundingKind = args.fundingKind ?? "first_launch_minimum";
  if (args.amountWei <= 0n) {
    return {
      funded: false,
      status: "not_needed",
      amountWei: 0n,
      txHash: null,
      sourceAddress: null,
    };
  }

  if (
    args.enabled !== true && !readBoolean("FIRST_LAUNCH_SUBSIDY_ENABLED", false)
  ) {
    return {
      funded: false,
      status: "disabled",
      amountWei: args.amountWei,
      txHash: null,
      sourceAddress: null,
    };
  }

  assertWithinFundingCap(args.amountWei, fundingKind);

  const destinationAddress = normalizeEvmAddress(args.destinationAddress);
  const provider = robinhoodProvider();
  const wallet = new ethers.Wallet(
    requiredPrivateKey("ETH_DEV_WALLET"),
    provider,
  );
  const sourceAddress = normalizeEvmAddress(wallet.address);
  if (sourceAddress.toLowerCase() === destinationAddress.toLowerCase()) {
    throw new Error("funding_source_matches_destination");
  }

  let event = await loadExistingFundingEvent(
    admin,
    args.userId,
    args.launchId,
    fundingKind,
  );
  if (
    fundingKind === "first_launch_minimum" &&
    event &&
    !ACTIVE_FUNDING_STATUSES.includes(String(event.status ?? ""))
  ) {
    throw new Error("first_launch_subsidy_already_used");
  }
  event = event ??
    (await insertFundingEvent(
      admin,
      args,
      sourceAddress,
      destinationAddress,
      fundingKind,
    ));
  event = await refreshPendingFundingAmount(
    admin,
    event,
    args.amountWei,
    fundingKind,
  );

  try {
    const eventAmount = bigintFromText(event.amount_wei) ?? args.amountWei;
    if (event.status === "confirmed" && event.tx_hash) {
      return confirmedResult(
        eventAmount,
        String(event.tx_hash),
        normalizeEvmAddress(event.source_address ?? sourceAddress),
      );
    }

    if (!event.signed_transaction_base64) {
      event = await prepareFundingTransaction(
        admin,
        event,
        wallet,
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
    const txHash = String(event.tx_hash);
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt?.status === 1) {
        await markFundingConfirmed(admin, event, receipt, fundingKind);
        return confirmedResult(eventAmount, txHash, sourceAddress);
      }
      if (receipt?.status === 0) {
        await markFundingFailed(
          admin,
          event,
          fundingKind,
          `funding_transaction_reverted:${txHash}`,
        );
        throw new Error(`funding_transaction_reverted:${txHash}`);
      }

      event = await markFundingSubmitted(admin, event, txHash, fundingKind);
      await broadcastStoredFundingTransaction(provider, signedBytes, txHash);
      const confirmed = await provider.waitForTransaction(txHash, 1, 120_000);
      if (confirmed?.status === 1) {
        await markFundingConfirmed(admin, event, confirmed, fundingKind);
        return confirmedResult(eventAmount, txHash, sourceAddress);
      }
      if (confirmed?.status === 0) {
        await markFundingFailed(
          admin,
          event,
          fundingKind,
          `funding_transaction_reverted:${txHash}`,
        );
        throw new Error(`funding_transaction_reverted:${txHash}`);
      }
      await recordFundingRetryableError(
        admin,
        event,
        "funding_transaction_confirmation_pending",
      );
      throw new Error("funding_transaction_confirmation_pending");
    } finally {
      signedBytes.fill(0);
    }
  } catch (error) {
    const message = sanitizeError(error);
    if (!event.tx_hash || isTerminalFundingError(message)) {
      await markFundingFailed(admin, event, fundingKind, message);
    } else {
      await recordFundingRetryableError(admin, event, message);
    }
    throw error;
  }
}

export async function fundRobinhoodLaunchIfNeeded(
  admin: any,
  args: {
    launchId: string;
    userId: string;
    walletId: string;
    destinationAddress: string;
    amountWei: bigint;
    fundingKind: FundingKind;
    enabled?: boolean;
  },
): Promise<FundingResult> {
  return await fundFirstLaunchIfNeeded(admin, args);
}

async function loadExistingFundingEvent(
  admin: any,
  userId: string,
  launchId: string,
  fundingKind: FundingKind,
) {
  const query = admin
    .from("wallet_funding_events")
    .select("*")
    .eq("funding_kind", fundingKind)
    .order("created_at", { ascending: true })
    .limit(1);

  if (fundingKind === "first_launch_minimum") {
    query.eq("user_id", userId);
  } else {
    query.eq("coin_launch_id", launchId).eq("user_id", userId)
      .in("status", ACTIVE_FUNDING_STATUSES);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (
    fundingKind === "first_launch_minimum" &&
    data.coin_launch_id &&
    data.coin_launch_id !== launchId
  ) {
    throw new Error(
      data.status === "confirmed"
        ? "first_launch_subsidy_already_used"
        : "first_launch_funding_already_pending",
    );
  }
  return data;
}

async function insertFundingEvent(
  admin: any,
  args: {
    launchId: string;
    userId: string;
    walletId: string;
    amountWei: bigint;
  },
  sourceAddress: string,
  destinationAddress: string,
  fundingKind: FundingKind,
) {
  const { data, error } = await admin
    .from("wallet_funding_events")
    .insert({
      chain: "robinhood",
      coin_launch_id: args.launchId,
      user_id: args.userId,
      wallet_id: args.walletId,
      funding_kind: fundingKind,
      source_address: sourceAddress,
      destination_address: destinationAddress,
      amount_wei: args.amountWei.toString(),
      status: "pending",
      raw_result: {
        chain: "robinhood",
        policy: fundingPolicyName(fundingKind),
        amount_wei: args.amountWei.toString(),
      },
    })
    .select("*")
    .single();

  if (!error) return data;
  if (!isUniqueViolation(error)) throw error;

  const existing = await loadExistingFundingEvent(
    admin,
    args.userId,
    args.launchId,
    fundingKind,
  );
  if (existing) return existing;
  throw error;
}

async function refreshPendingFundingAmount(
  admin: any,
  event: any,
  amountWei: bigint,
  fundingKind: FundingKind,
) {
  if (
    event.status !== "pending" ||
    event.tx_hash ||
    event.signed_transaction_base64 ||
    String(event.amount_wei) === amountWei.toString()
  ) {
    return event;
  }
  const rawResult = {
    ...(recordObject(event.raw_result)),
    amount_wei: amountWei.toString(),
  };
  const { data, error } = await admin
    .from("wallet_funding_events")
    .update({
      amount_wei: amountWei.toString(),
      raw_result: rawResult,
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

async function prepareFundingTransaction(
  admin: any,
  event: any,
  wallet: ethers.Wallet,
  destinationAddress: string,
  amountWei: bigint,
  fundingKind: FundingKind,
) {
  const provider = wallet.provider!;
  const gasEstimate = BigInt(
    await wallet.estimateGas({
      to: destinationAddress,
      value: amountWei,
    }),
  );
  const gasLimit = (gasEstimate * 120n) / 100n;
  const feeData = await provider.getFeeData();
  const gasPrice = BigInt(feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n);
  if (gasPrice <= 0n) throw new Error("funding_gas_price_unavailable");
  const requiredWei = amountWei + gasLimit * gasPrice;
  const balance = BigInt(await provider.getBalance(wallet.address));
  if (balance < requiredWei) throw new Error("dev_wallet_insufficient_balance");
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`unexpected_robinhood_chain_id_${network.chainId}`);
  }

  const nonce = await wallet.getNonce("pending");
  const signedHex = await wallet.signTransaction({
    to: destinationAddress,
    value: amountWei,
    chainId: ROBINHOOD_CHAIN_ID,
    nonce,
    gasLimit,
    gasPrice,
    type: 0,
  });
  const signedBytes = ethers.getBytes(signedHex);
  const txHash = ethers.keccak256(signedHex);
  const signedHash = await sha256Hex(signedBytes);
  const rawResult = {
    ...(recordObject(event.raw_result)),
    chain: "robinhood",
    policy: fundingPolicyName(fundingKind),
    amount_wei: amountWei.toString(),
    tx_hash: txHash,
    explorer_url: getTxExplorerUrl(txHash),
    gas_limit: gasLimit.toString(),
    gas_price_wei: gasPrice.toString(),
    nonce,
  };
  try {
    const { data, error } = await admin
      .from("wallet_funding_events")
      .update({
        chain: "robinhood",
        status: "prepared",
        tx_hash: txHash,
        signed_transaction_base64: toBase64(signedBytes),
        signed_transaction_hash: signedHash,
        raw_result: rawResult,
        error: null,
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
    if (data) return data;

    const existing = await admin
      .from("wallet_funding_events")
      .select("*")
      .eq("id", event.id)
      .eq("funding_kind", fundingKind)
      .eq("tx_hash", txHash)
      .eq("signed_transaction_hash", signedHash)
      .eq("signed_transaction_base64", toBase64(signedBytes))
      .in("status", ["prepared", "submitted", "confirmed"])
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;
    throw new Error("funding_prepare_conflict");
  } finally {
    signedBytes.fill(0);
  }
}

export async function validateStoredFundingTransaction(
  event: any,
  sourceAddress: string,
  destinationAddress: string,
  amountWei: bigint,
): Promise<Uint8Array> {
  const signedBytes = fromBase64(String(event.signed_transaction_base64 ?? ""));
  if (signedBytes.length < 1 || signedBytes.length > 4096) {
    signedBytes.fill(0);
    throw new Error("funding_signed_transaction_size_invalid");
  }
  if ((await sha256Hex(signedBytes)) !== event.signed_transaction_hash) {
    signedBytes.fill(0);
    throw new Error("funding_signed_transaction_hash_mismatch");
  }
  const signedHex = ethers.hexlify(signedBytes);
  const parsed = ethers.Transaction.from(signedHex);
  if (parsed.hash?.toLowerCase() !== String(event.tx_hash).toLowerCase()) {
    signedBytes.fill(0);
    throw new Error("funding_transaction_hash_mismatch");
  }
  if (!parsed.from || normalizeEvmAddress(parsed.from) !== sourceAddress) {
    signedBytes.fill(0);
    throw new Error("funding_source_mismatch");
  }
  if (!parsed.to || normalizeEvmAddress(parsed.to) !== destinationAddress) {
    signedBytes.fill(0);
    throw new Error("funding_destination_mismatch");
  }
  if (BigInt(parsed.value) !== amountWei) {
    signedBytes.fill(0);
    throw new Error("funding_amount_mismatch");
  }
  if (Number(parsed.chainId) !== ROBINHOOD_CHAIN_ID) {
    signedBytes.fill(0);
    throw new Error("funding_chain_id_mismatch");
  }
  return signedBytes;
}

async function broadcastStoredFundingTransaction(
  provider: ethers.Provider,
  signedBytes: Uint8Array,
  txHash: string,
) {
  try {
    const response = await provider.broadcastTransaction(
      ethers.hexlify(signedBytes),
    );
    if (response.hash.toLowerCase() !== txHash.toLowerCase()) {
      throw new Error("funding_broadcast_hash_mismatch");
    }
  } catch (error) {
    if (!isKnownBroadcastDuplicate(error)) throw error;
  }
}

async function markFundingSubmitted(
  admin: any,
  event: any,
  txHash: string,
  fundingKind: FundingKind,
) {
  const { data, error } = await admin
    .from("wallet_funding_events")
    .update({
      chain: "robinhood",
      status: "submitted",
      broadcast_attempt_count: Number(event.broadcast_attempt_count ?? 0) + 1,
      last_broadcast_at: new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
      raw_result: {
        ...(recordObject(event.raw_result)),
        tx_hash: txHash,
        explorer_url: getTxExplorerUrl(txHash),
      },
    })
    .eq("id", event.id)
    .eq("funding_kind", fundingKind)
    .eq("tx_hash", txHash)
    .in("status", ["prepared", "submitted"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ?? event;
}

async function markFundingConfirmed(
  admin: any,
  event: any,
  receipt: any,
  fundingKind: FundingKind,
) {
  const txHash = String(
    receipt.hash ?? receipt.transactionHash ?? event.tx_hash,
  );
  const { data, error } = await admin
    .from("wallet_funding_events")
    .update({
      chain: "robinhood",
      status: "confirmed",
      confirmed_at: event.confirmed_at ?? new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
      raw_result: {
        ...(recordObject(event.raw_result)),
        chain: "robinhood",
        policy: fundingPolicyName(fundingKind),
        tx_hash: txHash,
        explorer_url: getTxExplorerUrl(txHash),
        block_number: receipt.blockNumber ?? null,
        gas_used: receipt.gasUsed?.toString?.() ?? null,
      },
    })
    .eq("id", event.id)
    .eq("funding_kind", fundingKind)
    .eq("tx_hash", txHash)
    .select("*")
    .maybeSingle();
  if (error) throw error;

  const launchPatch: Record<string, unknown> = {
    funding_policy: fundingPolicyName(fundingKind),
    funding_status: "confirmed",
    funding_amount_wei: String(event.amount_wei),
    funding_tx_hash: txHash,
    funding_error: null,
  };
  if (fundingKind === "first_launch_minimum") {
    launchPatch.first_launch_subsidy_eligible = true;
    launchPatch.first_launch_subsidized = true;
  }
  const launchUpdate = await admin
    .from("coin_launches")
    .update(launchPatch)
    .eq("id", event.coin_launch_id);
  if (launchUpdate.error) throw launchUpdate.error;
  return data;
}

async function markFundingFailed(
  admin: any,
  event: any,
  fundingKind: FundingKind,
  error: string,
) {
  const failed = await admin
    .from("wallet_funding_events")
    .update({
      status: "failed",
      error: sanitizeError(error),
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id)
    .eq("funding_kind", fundingKind)
    .in("status", ["pending", "prepared", "submitted"])
    .select("*")
    .maybeSingle();
  if (failed.error) throw failed.error;
  const row = failed.data ?? event;
  const launchUpdate = await admin
    .from("coin_launches")
    .update({
      funding_status: "failed",
      funding_tx_hash: row.tx_hash ?? null,
      funding_error: sanitizeError(error),
    })
    .eq("id", event.coin_launch_id);
  if (launchUpdate.error) throw launchUpdate.error;
  return row;
}

async function recordFundingRetryableError(
  admin: any,
  event: any,
  error: string,
) {
  const result = await admin
    .from("wallet_funding_events")
    .update({
      error: sanitizeError(error),
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
  if (result.error) throw result.error;
}

function confirmedResult(
  amountWei: bigint,
  txHash: string,
  sourceAddress: string,
): FundingResult {
  return {
    funded: true,
    status: "confirmed",
    amountWei,
    txHash,
    sourceAddress,
    explorerUrl: getTxExplorerUrl(txHash),
  };
}

function assertWithinFundingCap(amountWei: bigint, fundingKind: FundingKind) {
  const maxEth = Deno.env.get("MAX_FIRST_LAUNCH_SUBSIDY_ETH")?.trim() ||
    "0.005";
  const maxWei = ethers.parseEther(maxEth);
  if (amountWei > maxWei) {
    throw new Error(`${fundingKind}_cap_exceeded:max_${maxEth}_eth`);
  }
}

function fundingPolicyName(fundingKind: FundingKind): string {
  return fundingKind === "per_launch_minimum"
    ? "robinhood_per_launch_minimum_v1"
    : "robinhood_first_launch_minimum_v1";
}

function requiredPrivateKey(name: string): string {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) throw new Error(`${name}_missing`);
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${name}_invalid`);
  }
  return normalized;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function isUniqueViolation(error: any): boolean {
  return (
    error?.code === "23505" ||
    /duplicate key|already exists|unique/i.test(
      String(error?.message ?? error ?? ""),
    )
  );
}

function isKnownBroadcastDuplicate(error: unknown): boolean {
  return /already known|known transaction|already imported|nonce too low|replacement transaction underpriced/i
    .test(sanitizeError(error));
}

function isTerminalFundingError(message: string): boolean {
  return /reverted|invalid_|mismatch|conflict|cap_exceeded|source_matches_destination/
    .test(message);
}

function sanitizeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 500);
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
    throw new Error("funding_signed_transaction_base64_invalid");
  }
}

function bigintFromText(value: unknown): bigint | null {
  try {
    const text = String(value ?? "").trim();
    return text ? BigInt(text) : null;
  } catch (_) {
    return null;
  }
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
