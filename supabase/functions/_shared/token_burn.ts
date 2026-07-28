// deno-lint-ignore-file no-explicit-any
// Fail-closed token burn preview and execution for Linkr-managed wallets.

import { ethers } from "https://esm.sh/ethers@6";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_BASE_URL,
  robinhoodProvider,
} from "./robinhood_chain.ts";
import {
  getSolanaTxExplorerUrl,
  loadSolanaWallet,
  loadSolanaWalletById,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "./solana_chain.ts";
import { loadWallet, loadWalletById } from "./wallet.ts";

export type TokenBurnChain = "robinhood" | "solana";

export interface TokenBurnPreview {
  chain: TokenBurnChain;
  wallet_id: string;
  wallet_address: string;
  token: string;
  symbol: string | null;
  decimals: number;
  amount: string;
  amount_raw: string;
  balance: string;
  balance_raw: string;
  burn_all_requested: boolean;
  token_program: string | null;
  token_accounts: string[];
  gas_estimate: string | null;
  total_supply_raw?: string | null;
}

export interface ExecuteTokenBurnArgs {
  admin: any;
  userId: string;
  preview: TokenBurnPreview;
  idempotencyKey: string;
  sourceSurface: string;
  pendingActionId?: string | null;
  legacyPendingActionId?: string | null;
  agentApiKeyId?: string | null;
  sourceReferenceId?: string | null;
}

export interface ParsedTokenBurnCommand {
  chain: TokenBurnChain | null;
  token: string | null;
  amount: string | null;
  address_count: number;
  errors: string[];
}

const EVM_BURN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function burn(uint256 value)",
];
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export function normalizeTokenBurnChain(value: unknown): TokenBurnChain {
  const chain = String(value ?? "").trim().toLowerCase();
  if (["robinhood", "robinhood chain", "evm", "eth"].includes(chain)) {
    return "robinhood";
  }
  if (["solana", "sol"].includes(chain)) return "solana";
  throw new Error("burn_chain_required");
}

export function parseTokenBurnCommand(
  textValue: unknown,
): ParsedTokenBurnCommand {
  const text = String(textValue ?? "");
  const lower = text.toLowerCase();
  const solanaNamed = /\b(sol|solana)\b/.test(lower);
  const robinhoodNamed = /\b(eth|evm|robinhood(?: chain)?|rhood)\b/.test(lower);
  const chain = solanaNamed === robinhoodNamed
    ? null
    : solanaNamed
    ? "solana"
    : "robinhood";
  const addresses = new Set<string>();
  for (const match of text.matchAll(/\b0x[a-fA-F0-9]{40}\b/g)) {
    addresses.add(match[0]);
  }
  for (const match of text.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)) {
    if (!/^0x/i.test(match[0])) addresses.add(match[0]);
  }
  const addressList = [...addresses];
  const all = /\bburn(?:ing)?\s+(?:all|everything)\b/i.test(text) ||
    /\bburn\b[^.!?]*\ball\b/i.test(text);
  const amount = all
    ? "all"
    : /\bburn(?:ing)?\s+(?:exactly\s+)?(\d+(?:\.\d+)?)/i.exec(text)?.[1] ??
      /(\d+(?:\.\d+)?)\s+(?:tokens?|units?)\b/i.exec(text)?.[1] ??
      null;
  const token = addressList.length === 1 ? addressList[0] : null;
  const errors: string[] = [];
  if (!chain) errors.push("burn_chain_required");
  if (addressList.length === 0) errors.push("burn_token_required");
  else if (addressList.length > 1) errors.push("burn_multiple_tokens");
  if (!amount) errors.push("burn_amount_required");
  if (/\b\d+(?:\.\d+)?\s*(?:eth|sol)\b/i.test(text)) {
    errors.push("native_asset_burn_not_supported");
  }
  if (
    chain && token &&
    ((chain === "robinhood" && !/^0x[a-fA-F0-9]{40}$/.test(token)) ||
      (chain === "solana" && /^0x/i.test(token)))
  ) errors.push("burn_chain_address_mismatch");
  return { chain, token, amount, address_count: addressList.length, errors };
}

export function parseTokenAmountToRaw(
  value: unknown,
  decimals: number,
): bigint {
  const text = String(value ?? "").trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("invalid_token_decimals");
  }
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("invalid_burn_amount");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error("burn_amount_exceeds_token_precision");
  }
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const raw = BigInt(normalizedWhole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n) throw new Error("burn_amount_must_be_positive");
  if (raw > MAX_UINT256) throw new Error("burn_amount_too_large");
  return raw;
}

export function formatTokenAmount(
  rawValue: bigint | string,
  decimals: number,
): string {
  const raw = BigInt(rawValue);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("invalid_token_decimals");
  }
  if (decimals === 0) return raw.toString();
  const padded = raw.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function tokenBurnConfirmationText(preview: TokenBurnPreview): string {
  const label = preview.symbol ? ` ${preview.symbol}` : " tokens";
  return `Confirm token burn: permanently destroy ${preview.amount}${label} from your Linkr ${
    preview.chain === "solana" ? "Solana" : "Robinhood Chain"
  } wallet? Token: ${preview.token}. This action is irreversible; the burned tokens cannot be recovered. Reply CONFIRM to proceed or CANCEL to stop.`;
}

export function tokenBurnXConfirmationText(preview: TokenBurnPreview): string {
  return `Confirm burn: permanently destroy ${preview.amount}${
    preview.symbol ? ` ${preview.symbol}` : " token units"
  } on ${
    preview.chain === "solana" ? "Solana" : "Robinhood Chain"
  }? CA: ${preview.token}. Irreversible; burned tokens cannot be recovered. Reply CONFIRM or CANCEL.`;
}

export async function previewTokenBurn(
  admin: any,
  args: {
    userId: string;
    chain: unknown;
    token: unknown;
    amount: unknown;
    walletId?: string | null;
  },
): Promise<TokenBurnPreview> {
  const chain = normalizeTokenBurnChain(args.chain);
  const amountText = String(args.amount ?? "").trim().toLowerCase();
  if (!amountText) throw new Error("burn_amount_required");
  if (chain === "solana") {
    return previewSolanaTokenBurn(admin, {
      userId: args.userId,
      walletId: args.walletId,
      token: args.token,
      amount: amountText,
    });
  }
  return previewEvmTokenBurn(admin, {
    userId: args.userId,
    walletId: args.walletId,
    token: args.token,
    amount: amountText,
  });
}

async function previewEvmTokenBurn(
  admin: any,
  args: {
    userId: string;
    walletId?: string | null;
    token: unknown;
    amount: string;
  },
): Promise<TokenBurnPreview> {
  const token = normalizeEvmAddress(String(args.token ?? ""));
  const wallet = args.walletId
    ? await loadWalletById(admin, args.walletId, args.userId)
    : await loadWallet(admin, args.userId);
  if (!wallet) throw new Error("burn_wallet_not_found");
  const provider = robinhoodProvider();
  if ((await provider.getNetwork()).chainId !== BigInt(ROBINHOOD_CHAIN_ID)) {
    throw new Error("unexpected_robinhood_chain_id");
  }
  if ((await provider.getCode(token)) === "0x") {
    throw new Error("burn_token_contract_not_found");
  }
  await requireVerifiedEvmBurnFunction(token);
  const contract = new ethers.Contract(token, EVM_BURN_ABI, provider);
  const [decimalsValue, symbolValue, balanceValue, totalSupplyValue] =
    await Promise.all([
      contract.decimals(),
      contract.symbol().catch(() => null),
      contract.balanceOf(wallet.address),
      contract.totalSupply(),
    ]);
  const decimals = Number(decimalsValue);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("invalid_token_decimals");
  }
  const balance = BigInt(balanceValue);
  if (balance <= 0n) throw new Error("no_token_balance");
  const amountRaw = args.amount === "all"
    ? balance
    : parseTokenAmountToRaw(args.amount, decimals);
  if (amountRaw > balance) throw new Error("insufficient_token_balance");
  const data = contract.interface.encodeFunctionData("burn", [amountRaw]);
  await provider.call({ from: wallet.address, to: token, data }).catch(() => {
    throw new Error("evm_token_burn_not_supported");
  });
  const gasEstimate = await provider.estimateGas({
    from: wallet.address,
    to: token,
    data,
  }).catch(
    () => {
      throw new Error("evm_token_burn_not_supported");
    },
  );
  const [nativeBalance, feeData] = await Promise.all([
    provider.getBalance(wallet.address),
    provider.getFeeData(),
  ]);
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (gasPrice != null && nativeBalance < gasEstimate * gasPrice) {
    throw new Error("insufficient_native_balance_for_burn_gas");
  }
  const symbol = sanitizeTokenSymbol(symbolValue);
  return {
    chain: "robinhood",
    wallet_id: wallet.id,
    wallet_address: wallet.address,
    token,
    symbol,
    decimals,
    amount: formatTokenAmount(amountRaw, decimals),
    amount_raw: amountRaw.toString(),
    balance: formatTokenAmount(balance, decimals),
    balance_raw: balance.toString(),
    burn_all_requested: args.amount === "all",
    token_program: null,
    token_accounts: [],
    gas_estimate: gasEstimate.toString(),
    total_supply_raw: BigInt(totalSupplyValue).toString(),
  };
}

async function previewSolanaTokenBurn(
  admin: any,
  args: {
    userId: string;
    walletId?: string | null;
    token: unknown;
    amount: string;
  },
): Promise<TokenBurnPreview> {
  const mintAddress = normalizeSolanaPublicKey(String(args.token ?? ""));
  const wallet = args.walletId
    ? await loadSolanaWalletById(admin, args.walletId, args.userId)
    : await loadSolanaWallet(admin, args.userId);
  if (!wallet) throw new Error("burn_wallet_not_found");
  const connection = solanaConnection();
  const mint = new PublicKey(mintAddress);
  const mintAccount = await connection.getAccountInfo(mint, "confirmed");
  if (!mintAccount) throw new Error("solana_mint_not_found");
  const programId = mintAccount.owner.equals(TOKEN_PROGRAM_ID)
    ? TOKEN_PROGRAM_ID
    : mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : null;
  if (!programId) throw new Error("unsupported_solana_token_program");
  const mintInfo = decodeMintAccount(mintAccount.data);
  const accounts = await loadOwnedSolanaTokenAccounts(
    connection,
    new PublicKey(wallet.address),
    mint,
    programId,
  );
  const balance = accounts.reduce((sum, account) => sum + account.amount, 0n);
  if (balance <= 0n) throw new Error("no_token_balance");
  const amountRaw = args.amount === "all"
    ? balance
    : parseTokenAmountToRaw(args.amount, mintInfo.decimals);
  if (amountRaw > balance) throw new Error("insufficient_token_balance");
  const allocations = allocateSolanaBurn(accounts, amountRaw);
  const transaction = await buildSolanaBurnTransaction({
    connection,
    walletAddress: wallet.address,
    mint,
    decimals: mintInfo.decimals,
    programId,
    allocations,
  });
  transaction.partialSign(Keypair.fromSecretKey(wallet.secret_key));
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    throw new Error("solana_token_burn_simulation_failed");
  }
  return {
    chain: "solana",
    wallet_id: wallet.id,
    wallet_address: wallet.address,
    token: mintAddress,
    symbol: null,
    decimals: mintInfo.decimals,
    amount: formatTokenAmount(amountRaw, mintInfo.decimals),
    amount_raw: amountRaw.toString(),
    balance: formatTokenAmount(balance, mintInfo.decimals),
    balance_raw: balance.toString(),
    burn_all_requested: args.amount === "all",
    token_program: programId.toBase58(),
    token_accounts: allocations.map((item) => item.address.toBase58()),
    gas_estimate: null,
    total_supply_raw: mintInfo.supply.toString(),
  };
}

export async function executeTokenBurn(
  args: ExecuteTokenBurnArgs,
): Promise<any> {
  validateFrozenPreview(args.preview);
  const existing = await loadBurnExecution(
    args.admin,
    args.userId,
    args.idempotencyKey,
  );
  if (existing) return resumeBurnExecution(args, existing);
  return args.preview.chain === "solana"
    ? executeSolanaTokenBurn(args)
    : executeEvmTokenBurn(args);
}

export async function reconcileOutstandingTokenBurns(admin: any, limit = 3) {
  const boundedLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const selected = await admin
    .from("token_burn_executions")
    .select("*")
    .in("state", ["signed", "broadcast", "reconciling"])
    .order("updated_at", { ascending: true })
    .limit(boundedLimit);
  if (selected.error) throw selected.error;
  const summary = { checked: 0, confirmed: 0, pending: 0, failed: 0 };
  for (const execution of selected.data ?? []) {
    summary.checked++;
    try {
      const args = await executionArgsForReconciliation(admin, execution);
      const result = execution.chain === "solana"
        ? await reconcileSolanaBurn(args, execution)
        : await reconcileEvmBurn(args, execution);
      if (
        result?.status === "confirmed" ||
        result?.status === "confirmed_unverified_effect"
      ) {
        summary.confirmed++;
        await settlePendingBurn(admin, execution, "executed");
      } else {
        summary.pending++;
      }
    } catch {
      const current = await admin
        .from("token_burn_executions")
        .select("state")
        .eq("id", execution.id)
        .maybeSingle();
      if (current.data?.state === "failed") {
        summary.failed++;
        await settlePendingBurn(admin, execution, "failed");
      } else {
        summary.pending++;
      }
    }
  }
  return summary;
}

async function executeEvmTokenBurn(args: ExecuteTokenBurnArgs): Promise<any> {
  const preview = args.preview;
  const fresh = await previewTokenBurn(args.admin, {
    userId: args.userId,
    walletId: preview.wallet_id,
    chain: preview.chain,
    token: preview.token,
    amount: preview.amount,
  });
  assertPreviewIdentity(preview, fresh);
  const wallet = await loadWalletById(
    args.admin,
    preview.wallet_id,
    args.userId,
  );
  if (
    !wallet ||
    wallet.address.toLowerCase() !== preview.wallet_address.toLowerCase()
  ) {
    throw new Error("burn_wallet_changed");
  }
  const provider = robinhoodProvider();
  const signer = new ethers.Wallet(wallet.private_key_hex, provider);
  const contract = new ethers.Contract(preview.token, EVM_BURN_ABI, provider);
  const data = contract.interface.encodeFunctionData("burn", [
    BigInt(preview.amount_raw),
  ]);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const fee = await provider.getFeeData();
  const gasEstimate = await provider.estimateGas({
    from: wallet.address,
    to: preview.token,
    data,
  });
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;
  if (
    gasPrice != null &&
    await provider.getBalance(wallet.address) < gasEstimate * gasPrice
  ) {
    throw new Error("insufficient_native_balance_for_burn_gas");
  }
  const txRequest: ethers.TransactionRequest = {
    type: fee.maxFeePerGas != null ? 2 : 0,
    chainId: ROBINHOOD_CHAIN_ID,
    nonce,
    to: preview.token,
    data,
    value: 0n,
    gasLimit: (gasEstimate * 120n + 99n) / 100n,
  };
  if (fee.maxFeePerGas != null) {
    txRequest.maxFeePerGas = fee.maxFeePerGas;
    txRequest.maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 0n;
  } else if (fee.gasPrice != null) {
    txRequest.gasPrice = fee.gasPrice;
  }
  const signed = await signer.signTransaction(txRequest);
  const txHash = ethers.keccak256(signed);
  const execution = await insertBurnExecution({ ...args, preview: fresh }, {
    signed_transaction: signed,
    tx_hash: txHash,
    nonce: String(nonce),
    state: "signed",
  });
  return broadcastEvmBurn(args, execution);
}

async function executeSolanaTokenBurn(
  args: ExecuteTokenBurnArgs,
): Promise<any> {
  const preview = args.preview;
  const wallet = await loadSolanaWalletById(
    args.admin,
    preview.wallet_id,
    args.userId,
  );
  if (!wallet || wallet.address !== preview.wallet_address) {
    throw new Error("burn_wallet_changed");
  }
  const connection = solanaConnection();
  const mint = new PublicKey(normalizeSolanaPublicKey(preview.token));
  const programId = new PublicKey(String(preview.token_program));
  if (
    !programId.equals(TOKEN_PROGRAM_ID) &&
    !programId.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error("unsupported_solana_token_program");
  }
  const mintAccount = await connection.getAccountInfo(mint, "confirmed");
  if (!mintAccount || !mintAccount.owner.equals(programId)) {
    throw new Error("burn_token_program_changed");
  }
  const mintInfo = decodeMintAccount(mintAccount.data);
  if (mintInfo.decimals !== preview.decimals) {
    throw new Error("burn_token_decimals_changed");
  }
  const accounts = await loadOwnedSolanaTokenAccounts(
    connection,
    new PublicKey(wallet.address),
    mint,
    programId,
  );
  const allocations = allocateSolanaBurn(accounts, BigInt(preview.amount_raw));
  const transaction = await buildSolanaBurnTransaction({
    connection,
    walletAddress: wallet.address,
    mint,
    decimals: preview.decimals,
    programId,
    allocations,
  });
  transaction.sign(Keypair.fromSecretKey(wallet.secret_key));
  const signed = transaction.serialize();
  const signature = ethers.encodeBase58(transaction.signature!);
  const execution = await insertBurnExecution(args, {
    signed_transaction: bytesToBase64(signed),
    tx_hash: signature,
    blockhash: transaction.recentBlockhash,
    last_valid_block_height:
      Number((transaction as any).__lastValidBlockHeight ?? 0) || null,
    state: "signed",
  });
  return broadcastSolanaBurn(args, execution);
}

async function resumeBurnExecution(
  args: ExecuteTokenBurnArgs,
  execution: any,
): Promise<any> {
  if (execution.state === "confirmed") return executionResult(execution, true);
  if (execution.state === "failed") {
    throw new Error(execution.error_code ?? "token_burn_failed");
  }
  return execution.chain === "solana"
    ? broadcastSolanaBurn(args, execution)
    : broadcastEvmBurn(args, execution);
}

async function broadcastEvmBurn(
  args: ExecuteTokenBurnArgs,
  execution: any,
): Promise<any> {
  const provider = robinhoodProvider();
  const receipt = await provider.getTransactionReceipt(execution.tx_hash).catch(
    () => null,
  );
  if (receipt) return finalizeEvmBurn(args, execution, receipt);
  const sent = await provider.broadcastTransaction(execution.signed_transaction)
    .catch(async (error) => {
      const known = await provider.getTransaction(execution.tx_hash).catch(() =>
        null
      );
      if (known) return known;
      throw error;
    });
  await markBurnBroadcast(args.admin, execution.id, sent.hash);
  const mined = await provider.waitForTransaction(sent.hash, 1);
  if (!mined) throw new Error("token_burn_confirmation_timeout");
  return finalizeEvmBurn(args, execution, mined);
}

async function finalizeEvmBurn(
  args: ExecuteTokenBurnArgs,
  execution: any,
  receipt: any,
) {
  if (Number(receipt.status) !== 1) {
    await markBurnFailed(args.admin, execution.id, "token_burn_tx_reverted");
    throw new Error("token_burn_tx_reverted");
  }
  const contract = new ethers.Contract(
    execution.token_address,
    EVM_BURN_ABI,
    robinhoodProvider(),
  );
  const [balanceAfterValue, supplyAfterValue] = await Promise.all([
    contract.balanceOf(args.preview.wallet_address),
    contract.totalSupply(),
  ]);
  const frozen = execution.metadata?.preview ?? {};
  const amount = BigInt(execution.amount_raw);
  const balanceBefore = BigInt(frozen.balance_raw ?? "-1");
  const supplyBefore = BigInt(frozen.total_supply_raw ?? "-1");
  const balanceAfter = BigInt(balanceAfterValue);
  const supplyAfter = BigInt(supplyAfterValue);
  if (
    balanceBefore < amount || supplyBefore < amount ||
    balanceBefore - balanceAfter !== amount ||
    supplyBefore - supplyAfter !== amount
  ) {
    await args.admin
      .from("token_burn_executions")
      .update({
        state: "confirmed",
        broadcast_at: execution.broadcast_at ?? new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        error_code: "burn_effect_verification_failed",
        metadata: {
          ...execution.metadata,
          effect_verification: {
            balance_before: balanceBefore.toString(),
            balance_after: balanceAfter.toString(),
            supply_before: supplyBefore.toString(),
            supply_after: supplyAfter.toString(),
            expected_decrease: amount.toString(),
          },
        },
      })
      .eq("id", execution.id);
    return {
      ...executionResult(
        { ...execution, state: "confirmed" },
        false,
        getTxExplorerUrl(execution.tx_hash),
      ),
      status: "confirmed_unverified_effect",
      summary:
        `The contract transaction confirmed, but the expected token balance and total-supply decrease could not be verified. Do not submit another burn. TX: ${execution.tx_hash}`,
    };
  }
  return finalizeBurn(
    args,
    execution,
    execution.tx_hash,
    getTxExplorerUrl(execution.tx_hash),
  );
}

async function broadcastSolanaBurn(
  args: ExecuteTokenBurnArgs,
  execution: any,
): Promise<any> {
  const connection = solanaConnection();
  const status = await connection.getSignatureStatus(execution.tx_hash, {
    searchTransactionHistory: true,
  });
  if (status.value?.err) {
    await markBurnFailed(args.admin, execution.id, "token_burn_tx_failed");
    throw new Error("token_burn_tx_failed");
  }
  if (
    status.value?.confirmationStatus === "confirmed" ||
    status.value?.confirmationStatus === "finalized"
  ) {
    return finalizeBurn(
      args,
      execution,
      execution.tx_hash,
      getSolanaTxExplorerUrl(execution.tx_hash),
    );
  }
  const raw = base64ToBytes(execution.signed_transaction);
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 3,
  });
  if (signature !== execution.tx_hash) {
    throw new Error("solana_burn_signature_mismatch");
  }
  await markBurnBroadcast(args.admin, execution.id, signature);
  const latest = await connection.getLatestBlockhash("confirmed");
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: execution.blockhash,
      lastValidBlockHeight: execution.last_valid_block_height ??
        latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (confirmation.value.err) {
    await markBurnFailed(args.admin, execution.id, "token_burn_tx_failed");
    throw new Error("token_burn_tx_failed");
  }
  return finalizeBurn(
    args,
    execution,
    signature,
    getSolanaTxExplorerUrl(signature),
  );
}

async function reconcileEvmBurn(args: ExecuteTokenBurnArgs, execution: any) {
  const provider = robinhoodProvider();
  const receipt = await provider.getTransactionReceipt(execution.tx_hash).catch(
    () => null,
  );
  if (receipt) return finalizeEvmBurn(args, execution, receipt);
  const confirmedNonce = await provider.getTransactionCount(
    args.preview.wallet_address,
    "latest",
  );
  if (execution.nonce != null && confirmedNonce > Number(execution.nonce)) {
    await markBurnFailed(
      args.admin,
      execution.id,
      "evm_burn_nonce_consumed_without_receipt",
    );
    throw new Error("evm_burn_nonce_consumed_without_receipt");
  }
  if (execution.state === "signed" || execution.state === "reconciling") {
    const sent = await provider.broadcastTransaction(
      execution.signed_transaction,
    ).catch(async (error) => {
      const known = await provider.getTransaction(execution.tx_hash).catch(() =>
        null
      );
      if (known) return known;
      throw error;
    });
    await markBurnBroadcast(args.admin, execution.id, sent.hash);
  }
  return { status: "awaiting_confirmation", tx_hash: execution.tx_hash };
}

async function reconcileSolanaBurn(args: ExecuteTokenBurnArgs, execution: any) {
  const connection = solanaConnection();
  const status = await connection.getSignatureStatus(execution.tx_hash, {
    searchTransactionHistory: true,
  });
  if (status.value?.err) {
    await markBurnFailed(args.admin, execution.id, "token_burn_tx_failed");
    throw new Error("token_burn_tx_failed");
  }
  if (
    status.value?.confirmationStatus === "confirmed" ||
    status.value?.confirmationStatus === "finalized"
  ) {
    return finalizeBurn(
      args,
      execution,
      execution.tx_hash,
      getSolanaTxExplorerUrl(execution.tx_hash),
    );
  }
  if (
    execution.last_valid_block_height != null &&
    await connection.getBlockHeight("confirmed") >
      Number(execution.last_valid_block_height)
  ) {
    await markBurnFailed(
      args.admin,
      execution.id,
      "solana_burn_blockhash_expired",
    );
    throw new Error("solana_burn_blockhash_expired");
  }
  if (execution.state === "signed" || execution.state === "reconciling") {
    const signature = await connection.sendRawTransaction(
      base64ToBytes(execution.signed_transaction),
      { skipPreflight: false, maxRetries: 0 },
    );
    if (signature !== execution.tx_hash) {
      throw new Error("solana_burn_signature_mismatch");
    }
    await markBurnBroadcast(args.admin, execution.id, signature);
  }
  return { status: "awaiting_confirmation", tx_hash: execution.tx_hash };
}

async function finalizeBurn(
  args: ExecuteTokenBurnArgs,
  execution: any,
  txHash: string,
  explorerUrl: string,
) {
  const now = new Date().toISOString();
  const updated = await args.admin
    .from("token_burn_executions")
    .update({
      state: "confirmed",
      tx_hash: txHash,
      broadcast_at: execution.broadcast_at ?? now,
      confirmed_at: now,
      updated_at: now,
    })
    .eq("id", execution.id)
    .select("*")
    .maybeSingle();
  if (updated.error) throw updated.error;
  const row = updated.data ??
    { ...execution, state: "confirmed", tx_hash: txHash };
  await args.admin.from("transactions").upsert(
    {
      user_id: args.userId,
      tweet_id: args.sourceSurface === "x"
        ? args.sourceReferenceId ?? null
        : null,
      action: "burn",
      chain: args.preview.chain,
      input_mint: args.preview.token,
      output_mint: null,
      amount_original: args.preview.amount,
      amount_original_unit: "token",
      wallet_id: args.preview.wallet_id,
      wallet_address: args.preview.wallet_address,
      input_amount_wei: args.preview.chain === "robinhood"
        ? args.preview.amount_raw
        : null,
      input_token_decimals: args.preview.decimals,
      input_token_symbol: args.preview.symbol,
      tx_hash: txHash,
      tx_signature: txHash,
      explorer_url: explorerUrl,
      chain_id: args.preview.chain === "robinhood" ? ROBINHOOD_CHAIN_ID : null,
      native_symbol: args.preview.chain === "robinhood" ? "ETH" : "SOL",
      status: "confirmed",
      source_surface: args.sourceSurface,
      raw_request: {
        source_reference_id: args.sourceReferenceId ?? null,
        pending_action_id: args.pendingActionId ?? args.legacyPendingActionId ??
          null,
        token: args.preview.token,
        amount: args.preview.amount,
        amount_raw: args.preview.amount_raw,
        irreversible: true,
      },
      raw_result: { burn_execution_id: execution.id, tx_hash: txHash },
      confirmed_at: now,
      idempotency_key: `token-burn-transaction:${args.idempotencyKey}`,
    },
    { onConflict: "idempotency_key" },
  );
  return executionResult(row, false, explorerUrl);
}

function executionResult(
  execution: any,
  replay: boolean,
  explorerUrl?: string,
) {
  return {
    burn_execution_id: execution.id,
    chain: execution.chain,
    status: execution.state,
    tx_hash: execution.tx_hash,
    signature: execution.chain === "solana" ? execution.tx_hash : null,
    explorer_url: explorerUrl ??
      (execution.chain === "solana"
        ? getSolanaTxExplorerUrl(execution.tx_hash)
        : getTxExplorerUrl(execution.tx_hash)),
    token: execution.token_address,
    amount: execution.amount_display,
    amount_raw: execution.amount_raw,
    symbol: execution.symbol,
    idempotent_replay: replay,
    summary:
      `Burn confirmed: permanently destroyed ${execution.amount_display}${
        execution.symbol ? ` ${execution.symbol}` : " tokens"
      }. TX: ${execution.tx_hash}`,
  };
}

async function insertBurnExecution(
  args: ExecuteTokenBurnArgs,
  values: Record<string, unknown>,
) {
  const inserted = await args.admin
    .from("token_burn_executions")
    .insert({
      user_id: args.userId,
      wallet_id: args.preview.wallet_id,
      chain: args.preview.chain,
      token_address: args.preview.token,
      token_account_addresses: args.preview.token_accounts,
      amount_raw: args.preview.amount_raw,
      amount_display: args.preview.amount,
      symbol: args.preview.symbol,
      decimals: args.preview.decimals,
      source_surface: args.sourceSurface,
      pending_action_id: args.pendingActionId ?? null,
      legacy_pending_action_id: args.legacyPendingActionId ?? null,
      agent_api_key_id: args.agentApiKeyId ?? null,
      idempotency_key: args.idempotencyKey,
      metadata: { preview: args.preview },
      ...values,
    })
    .select("*")
    .maybeSingle();
  if (!inserted.error) return inserted.data;
  if (String(inserted.error.code) === "23505") {
    const existing = await loadBurnExecution(
      args.admin,
      args.userId,
      args.idempotencyKey,
    );
    if (existing) return existing;
  }
  throw inserted.error;
}

async function loadBurnExecution(
  admin: any,
  userId: string,
  idempotencyKey: string,
) {
  const result = await admin
    .from("token_burn_executions")
    .select("*")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function executionArgsForReconciliation(
  admin: any,
  execution: any,
): Promise<ExecuteTokenBurnArgs> {
  const preview = execution.metadata?.preview as TokenBurnPreview | undefined;
  if (!preview) throw new Error("invalid_burn_preview");
  validateFrozenPreview(preview);
  let sourceReferenceId: string | null = null;
  if (execution.legacy_pending_action_id) {
    const pending = await admin
      .from("pending_actions")
      .select("tweet_id")
      .eq("id", execution.legacy_pending_action_id)
      .maybeSingle();
    if (pending.error) throw pending.error;
    sourceReferenceId = pending.data?.tweet_id ?? null;
  }
  return {
    admin,
    userId: execution.user_id,
    preview,
    idempotencyKey: execution.idempotency_key,
    sourceSurface: execution.source_surface,
    pendingActionId: execution.pending_action_id,
    legacyPendingActionId: execution.legacy_pending_action_id,
    agentApiKeyId: execution.agent_api_key_id,
    sourceReferenceId,
  };
}

async function settlePendingBurn(
  admin: any,
  execution: any,
  status: "executed" | "failed",
) {
  if (execution.pending_action_id) {
    await admin
      .from("linkr_pending_actions")
      .update({ status })
      .eq("id", execution.pending_action_id)
      .eq("action_type", "burn_token");
  }
  if (execution.legacy_pending_action_id) {
    await admin
      .from("pending_actions")
      .update({ status })
      .eq("id", execution.legacy_pending_action_id)
      .eq("intent", "burn_token");
  }
}

async function markBurnBroadcast(admin: any, id: string, txHash: string) {
  const result = await admin
    .from("token_burn_executions")
    .update({
      state: "broadcast",
      tx_hash: txHash,
      broadcast_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (result.error) throw result.error;
}

async function markBurnFailed(admin: any, id: string, errorCode: string) {
  await admin
    .from("token_burn_executions")
    .update({
      state: "failed",
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

function validateFrozenPreview(preview: TokenBurnPreview) {
  normalizeTokenBurnChain(preview.chain);
  if (!preview.wallet_id || !preview.wallet_address) {
    throw new Error("invalid_burn_preview_wallet");
  }
  if (BigInt(preview.amount_raw) <= 0n) {
    throw new Error("invalid_burn_preview_amount");
  }
  if (
    formatTokenAmount(preview.amount_raw, preview.decimals) !== preview.amount
  ) {
    throw new Error("invalid_burn_preview_amount_display");
  }
  if (preview.chain === "robinhood") normalizeEvmAddress(preview.token);
  else normalizeSolanaPublicKey(preview.token);
}

function assertPreviewIdentity(
  frozen: TokenBurnPreview,
  fresh: TokenBurnPreview,
) {
  if (
    frozen.chain !== fresh.chain ||
    frozen.wallet_id !== fresh.wallet_id ||
    frozen.wallet_address.toLowerCase() !==
      fresh.wallet_address.toLowerCase() ||
    frozen.token.toLowerCase() !== fresh.token.toLowerCase() ||
    frozen.decimals !== fresh.decimals ||
    frozen.amount_raw !== fresh.amount_raw
  ) throw new Error("burn_preview_changed_before_execution");
}

async function loadOwnedSolanaTokenAccounts(
  connection: any,
  owner: PublicKey,
  mint: PublicKey,
  programId: PublicKey,
) {
  const response = await connection.getTokenAccountsByOwner(
    owner,
    { programId },
    "confirmed",
  );
  const accounts: Array<{ address: PublicKey; amount: bigint }> = [];
  for (const item of response.value) {
    if (!item.account.owner.equals(programId)) continue;
    const account = decodeTokenAccount(item.account.data);
    if (
      !account.owner.equals(owner) || !account.mint.equals(mint) ||
      account.isFrozen
    ) continue;
    if (account.amount > 0n) {
      accounts.push({ address: item.pubkey, amount: account.amount });
    }
  }
  accounts.sort((a, b) =>
    a.address.toBase58().localeCompare(b.address.toBase58())
  );
  return accounts;
}

function allocateSolanaBurn(
  accounts: Array<{ address: PublicKey; amount: bigint }>,
  requested: bigint,
) {
  let remaining = requested;
  const allocations: Array<{ address: PublicKey; amount: bigint }> = [];
  for (const account of accounts) {
    if (remaining <= 0n) break;
    const amount = account.amount < remaining ? account.amount : remaining;
    if (amount > 0n) allocations.push({ address: account.address, amount });
    remaining -= amount;
  }
  if (remaining > 0n) throw new Error("insufficient_token_balance");
  return allocations;
}

function decodeMintAccount(data: Uint8Array) {
  if (data.length < 82) throw new Error("invalid_solana_mint_account");
  const initialized = data[45] === 1;
  if (!initialized) throw new Error("uninitialized_solana_mint");
  return {
    supply: readU64Le(data, 36),
    decimals: data[44],
  };
}

function decodeTokenAccount(data: Uint8Array) {
  if (data.length < 165) throw new Error("invalid_solana_token_account");
  const state = data[108];
  if (state === 0) throw new Error("uninitialized_solana_token_account");
  return {
    mint: new PublicKey(data.subarray(0, 32)),
    owner: new PublicKey(data.subarray(32, 64)),
    amount: readU64Le(data, 64),
    isFrozen: state === 2,
  };
}

function readU64Le(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length) {
    throw new Error("invalid_u64_buffer");
  }
  let value = 0n;
  for (let index = 7; index >= 0; index--) {
    value = (value << 8n) | BigInt(data[offset + index]);
  }
  return value;
}

function writeU64Le(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_UINT64) {
    throw new Error("solana_burn_amount_too_large");
  }
  const data = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < data.length; index++) {
    data[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return data;
}

export function encodeBurnCheckedInstructionData(
  amount: bigint,
  decimals: number,
): Uint8Array {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("invalid_token_decimals");
  }
  const data = new Uint8Array(10);
  data[0] = 15; // TokenInstruction::BurnChecked
  data.set(writeU64Le(amount), 1);
  data[9] = decimals;
  return data;
}

function createBurnCheckedInstructionMinimal(args: {
  account: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
  programId: PublicKey;
}) {
  const data = encodeBurnCheckedInstructionData(args.amount, args.decimals);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.account, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: true },
      { pubkey: args.owner, isSigner: true, isWritable: false },
    ],
    data: data as any,
  });
}

async function buildSolanaBurnTransaction(args: {
  connection: any;
  walletAddress: string;
  mint: PublicKey;
  decimals: number;
  programId: PublicKey;
  allocations: Array<{ address: PublicKey; amount: bigint }>;
}) {
  const owner = new PublicKey(args.walletAddress);
  const latest = await args.connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: latest.blockhash,
  });
  (transaction as any).__lastValidBlockHeight = latest.lastValidBlockHeight;
  for (const allocation of args.allocations) {
    transaction.add(
      createBurnCheckedInstructionMinimal({
        account: allocation.address,
        mint: args.mint,
        owner,
        amount: allocation.amount,
        decimals: args.decimals,
        programId: args.programId,
      }),
    );
  }
  return transaction;
}

function sanitizeTokenSymbol(value: unknown): string | null {
  const symbol = String(value ?? "").replace(/[^\x20-\x7E]/g, "").trim().slice(
    0,
    20,
  );
  return symbol || null;
}

async function requireVerifiedEvmBurnFunction(token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${ROBINHOOD_EXPLORER_BASE_URL}/api/v2/smart-contracts/${token}`,
      { headers: { Accept: "application/json" }, signal: controller.signal },
    );
    if (!response.ok) throw new Error("evm_burn_verification_unavailable");
    const body = await response.json();
    const abi = Array.isArray(body?.abi) ? body.abi : [];
    const burn = abi.find((item: any) =>
      item?.type === "function" && item?.name === "burn" &&
      item?.stateMutability === "nonpayable" &&
      Array.isArray(item?.inputs) && item.inputs.length === 1 &&
      item.inputs[0]?.type === "uint256"
    );
    if (!burn) throw new Error("evm_token_burn_not_supported");
  } catch (error) {
    if (
      error instanceof Error && error.message === "evm_token_burn_not_supported"
    ) throw error;
    throw new Error("evm_burn_verification_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
