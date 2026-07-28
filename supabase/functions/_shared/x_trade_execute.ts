// deno-lint-ignore-file no-explicit-any
// Executes X-originated buy / sell / transfer commands using the same
// swap and transfer primitives the agent API uses. Enforces the same
// per-user auto caps and returns a short user-facing reply.

import { ethers } from "https://esm.sh/ethers@6";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";

import type { XTradeCommand } from "./x_trade_command.ts";
import {
  loadSolanaWallet,
  solanaConnection,
} from "./solana_chain.ts";
import { loadWallet } from "./wallet.ts";
import { parseSolToLamports, transferSol } from "./solana_transfer.ts";
import { transferEth } from "./eth_transfer.ts";
import {
  executeSolanaBuySwap,
  executeSolanaSellSwap,
  getSolanaTokenBalanceRaw,
} from "./solana_swap/execute.ts";
import { amountFromPercent as solanaAmountFromPercent } from "./solana_swap/amount.ts";
import { readSolanaSwapEnabled } from "./solana_swap/constants.ts";
import {
  executeBuySwap,
  executeSellSwap,
} from "./robinhood_swap/execute.ts";
import { amountFromPercent as evmAmountFromPercent } from "./robinhood_swap/amount.ts";
import { isSwapEnabled } from "./robinhood_swap/constants.ts";
import { getErc20TokenBalances } from "./robinhood_chain.ts";
import {
  insufficientNativeBalanceReplyFromError,
  insufficientNativeBalanceReply,
} from "./wallet_balance_reply.ts";

// Approx SOL headroom for tx fee + ATA rent + priority fee on Jupiter swaps.
// Keep conservative — better to reject fast than pay for a failed simulation.
const SOLANA_BUY_FEE_RESERVE_SOL = 0.003;
const LAMPORTS_PER_SOL = 1_000_000_000;

// Strip bare on-chain addresses (Solana base58 25-64, EVM 0x hex 40) from
// reply text so X's "crypto addresses prohibited" filter (403) does not
// reject the reply. Addresses inside URLs (solscan.io/tx/...) are preserved
// because they are wrapped by t.co and pass the filter.
function sanitizeReplyText(text: string): string {
  return String(text ?? "")
    // EVM hex addresses not preceded by URL-ish chars
    .replace(/(?<![\/=?&])0x[a-fA-F0-9]{40}/g, (m) => `${m.slice(0, 6)}…${m.slice(-4)}`)
    // Base58 addresses (Solana mints / pubkeys / program ids) not inside a URL path
    .replace(/(?<![\/=?&])[1-9A-HJ-NP-Za-km-z]{25,64}/g, (m) => `${m.slice(0, 4)}…${m.slice(-4)}`);
}

export interface XTradeExecutionInput {
  admin: any;
  userId: string;
  tweetId: string;
  command: XTradeCommand;
}

export interface XTradeExecutionResult {
  ok: boolean;
  replyKind: string;
  replyText: string;
}

function trimReply(text: string): string {
  const safe = sanitizeReplyText(text);
  return safe.length > 260 ? safe.slice(0, 257) + "..." : safe;
}

function shortAddr(address: string): string {
  const clean = address.trim();
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function fmt(n: number, max = 6): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Number(n.toFixed(max));
  return String(rounded);
}

async function loadProfile(admin: any, userId: string) {
  const { data } = await admin
    .from("profiles")
    .select(
      "default_slippage_bps,max_auto_buy_sol,max_auto_buy_eth,max_auto_sell_percent,max_auto_transfer_sol,max_auto_transfer_eth,solana_priority_fee_lamports",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? {};
}

export async function executeXTradeCommand(
  input: XTradeExecutionInput,
): Promise<XTradeExecutionResult> {
  const { admin, userId, tweetId, command } = input;
  try {
    const profile = await loadProfile(admin, userId);
    const slippageBps = clampSlippage(profile.default_slippage_bps);
    const idempotencyKey = `x-trade:${tweetId}`;

    if (command.chain === "solana") {
      if (!readSolanaSwapEnabled() && command.kind !== "transfer") {
        return reject("trade_disabled", "Solana trading isn't enabled on this bot yet.");
      }
      return await executeSolana(admin, userId, command, {
        profile,
        slippageBps,
        idempotencyKey,
        tweetId,
      });
    }

    if (command.kind !== "transfer" && !isSwapEnabled()) {
      return reject("trade_disabled", "Robinhood trading isn't enabled on this bot yet.");
    }
    return await executeRobinhood(admin, userId, command, {
      profile,
      slippageBps,
      idempotencyKey,
      tweetId,
    });
  } catch (error) {
    const balance = insufficientNativeBalanceReplyFromError(error);
    if (balance) return reject("insufficient_balance", balance);
    const message = String((error as any)?.message ?? error);
    // Retryable infrastructure blips bubble up so the queue worker can requeue.
    // Configuration problems (missing/placeholder RPC URLs, invalid keys, etc.)
    // should produce a user-facing reply instead of tripping the whole stage.
    if (isRetryableInfrastructureError(message)) throw error;
    return reject("trade_failed", `Couldn't complete that command: ${sanitize(message)}`);
  }
}

function isRetryableInfrastructureError(message: string): boolean {
  if (/\b(?:missing|must be|invalid|unsupported|disabled)\b/i.test(message)) {
    return false;
  }
  return /timeout|network|fetch|abort|provider_http_(?:408|425|429|500|502|503|504)|(?:^|[_\s-])(?:408|425|429|500|502|503|504)(?:$|[_\s-])|rate\s*limit|temporarily\s+unavailable/i
    .test(message);
}

function sanitize(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 140);
}

function reject(kind: string, text: string): XTradeExecutionResult {
  return { ok: false, replyKind: kind, replyText: trimReply(text) };
}

function ok(kind: string, text: string): XTradeExecutionResult {
  return { ok: true, replyKind: kind, replyText: trimReply(text) };
}

function clampSlippage(value: unknown): number {
  const n = Number(value ?? 100);
  if (!Number.isFinite(n) || n < 10) return 100;
  return Math.min(Math.floor(n), 5000);
}

function checkCap(kind: string, amount: number, cap: unknown, capLabel: string): string | null {
  const capNumber = Number(cap ?? 0);
  if (!Number.isFinite(capNumber) || capNumber <= 0) {
    return `${capLabel} is disabled on your account. Enable a cap in the Linkr app to allow auto-execution.`;
  }
  if (amount > capNumber) {
    return `That ${kind} is above your ${capLabel} of ${fmt(capNumber)}. Adjust caps in the Linkr app or lower the amount.`;
  }
  return null;
}

async function executeSolana(
  admin: any,
  userId: string,
  command: XTradeCommand,
  ctx: { profile: any; slippageBps: number; idempotencyKey: string; tweetId: string },
): Promise<XTradeExecutionResult> {
  const wallet = await loadSolanaWallet(admin, userId);
  if (!wallet) {
    return reject(
      "no_wallet",
      "You don't have a Solana wallet yet. Open the Linkr app to create one, then try again.",
    );
  }

  if (command.kind === "transfer") {
    const violation = checkCap("transfer", command.amount, ctx.profile.max_auto_transfer_sol, "Solana transfer cap");
    if (violation) return reject("cap_exceeded", violation);
    const result = await transferSol({
      secret_key: wallet.secret_key,
      expected_from_address: wallet.address,
      recipient: command.recipient!,
      amount_sol: command.amount,
    });
    return ok(
      "transfer_solana",
      `Sent ${fmt(command.amount)} SOL to ${shortAddr(command.recipient!)}. ${result.explorer_url}`,
    );
  }

  if (command.kind === "buy") {
    const violation = checkCap("buy", command.amount, ctx.profile.max_auto_buy_sol, "Solana buy cap");
    if (violation) return reject("cap_exceeded", violation);
    const lamports = parseSolToLamports(command.amount);
    // Pre-flight balance check so we return a clean, human-readable reply
    // instead of letting Jupiter simulation fail with opaque program logs.
    const balanceLamports = BigInt(
      await solanaConnection().getBalance(new PublicKey(wallet.address), "confirmed"),
    );
    const reserveLamports = BigInt(Math.ceil(SOLANA_BUY_FEE_RESERVE_SOL * LAMPORTS_PER_SOL));
    const requiredLamports = lamports + reserveLamports;
    if (balanceLamports < requiredLamports) {
      return reject(
        "insufficient_balance",
        insufficientNativeBalanceReply({
          symbol: "SOL",
          currentBalance: Number(balanceLamports) / LAMPORTS_PER_SOL,
          requiredAmount: Number(requiredLamports) / LAMPORTS_PER_SOL,
        }),
      );
    }
    const result = await executeSolanaBuySwap(admin, {
      side: "buy",
      userId,
      walletId: wallet.id,
      walletAddress: wallet.address,
      inputLamports: lamports.toString(),
      outputMint: command.token_address!,
      slippageBps: ctx.slippageBps,
      priorityFeeLamports: numberOrNull(ctx.profile.solana_priority_fee_lamports),
      idempotencyKey: ctx.idempotencyKey,
      sourceTweetId: ctx.tweetId,
      sourceSurface: "x",
    });
    return ok(
      "trade_buy_solana",
      `Bought ${result.outputToken.symbol ?? shortAddr(command.token_address!)} with ${fmt(command.amount)} SOL. ${result.explorerUrl}`,
    );
  }

  // sell
  const violation = checkCap("sell", command.amount, ctx.profile.max_auto_sell_percent, "Solana sell cap");
  if (violation) return reject("cap_exceeded", violation);
  const balance = await getSolanaTokenBalanceRaw({
    owner: wallet.address,
    mint: command.token_address!,
  });
  if (balance.amount <= 0n) {
    return reject("no_token_balance", "You don't hold any of that token on Solana.");
  }
  const amountRaw = solanaAmountFromPercent(balance.amount, command.amount);
  if (amountRaw <= 0n) {
    return reject("no_token_balance", "That sell percent rounds to zero for your current balance.");
  }
  const result = await executeSolanaSellSwap(admin, {
    side: "sell",
    userId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputMint: command.token_address!,
    inputTokenAmount: amountRaw.toString(),
    slippageBps: ctx.slippageBps,
    priorityFeeLamports: numberOrNull(ctx.profile.solana_priority_fee_lamports),
    idempotencyKey: ctx.idempotencyKey,
    sourceTweetId: ctx.tweetId,
    sourceSurface: "x",
  });
  return ok(
    "trade_sell_solana",
    `Sold ${command.amount}% of ${result.inputToken.symbol ?? shortAddr(command.token_address!)}. ${result.explorerUrl}`,
  );
}

async function executeRobinhood(
  admin: any,
  userId: string,
  command: XTradeCommand,
  ctx: { profile: any; slippageBps: number; idempotencyKey: string; tweetId: string },
): Promise<XTradeExecutionResult> {
  const wallet = await loadWallet(admin, userId);
  if (!wallet) {
    return reject(
      "no_wallet",
      "You don't have a Robinhood Chain wallet yet. Open the Linkr app to create one, then try again.",
    );
  }

  if (command.kind === "transfer") {
    const violation = checkCap("transfer", command.amount, ctx.profile.max_auto_transfer_eth, "Robinhood transfer cap");
    if (violation) return reject("cap_exceeded", violation);
    const result = await transferEth({
      private_key_hex: wallet.private_key_hex,
      expected_from_address: wallet.address,
      recipient: command.recipient!,
      amount_eth: command.amount,
    });
    return ok(
      "transfer_robinhood",
      `Sent ${fmt(command.amount)} ETH to ${shortAddr(command.recipient!)}. ${result.explorer_url}`,
    );
  }

  if (command.kind === "buy") {
    const violation = checkCap("buy", command.amount, ctx.profile.max_auto_buy_eth, "Robinhood buy cap");
    if (violation) return reject("cap_exceeded", violation);
    const wei = ethers.parseEther(fmt(command.amount, 18));
    const result = await executeBuySwap(admin, {
      side: "buy",
      userId,
      walletId: wallet.id,
      walletAddress: wallet.address,
      inputEthWei: wei.toString(),
      outputTokenAddress: command.token_address!,
      slippageBps: ctx.slippageBps,
      idempotencyKey: ctx.idempotencyKey,
      sourceTweetId: ctx.tweetId,
      sourceSurface: "x",
    });
    return ok(
      "trade_buy_robinhood",
      `Bought ${result.outputToken.symbol ?? shortAddr(command.token_address!)} with ${fmt(command.amount)} ETH. ${result.explorerUrl}`,
    );
  }

  // sell
  const violation = checkCap("sell", command.amount, ctx.profile.max_auto_sell_percent, "Robinhood sell cap");
  if (violation) return reject("cap_exceeded", violation);
  const balances = await getErc20TokenBalances(wallet.address);
  const holding = balances.find(
    (row: any) =>
      String(row.token_address ?? row.mint).toLowerCase() ===
        command.token_address!.toLowerCase(),
  );
  const balanceWei = holding?.raw_value == null ? 0n : BigInt(holding.raw_value);
  if (balanceWei <= 0n) {
    return reject("no_token_balance", "You don't hold any of that token on Robinhood Chain.");
  }
  const amountWei = evmAmountFromPercent(balanceWei, command.amount);
  if (amountWei <= 0n) {
    return reject("no_token_balance", "That sell percent rounds to zero for your current balance.");
  }
  const result = await executeSellSwap(admin, {
    side: "sell",
    userId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputTokenAddress: command.token_address!,
    inputTokenAmountWei: amountWei.toString(),
    slippageBps: ctx.slippageBps,
    idempotencyKey: ctx.idempotencyKey,
    sourceTweetId: ctx.tweetId,
    sourceSurface: "x",
  });
  return ok(
    "trade_sell_robinhood",
    `Sold ${command.amount}% of ${result.inputToken.symbol ?? shortAddr(command.token_address!)}. ${result.explorerUrl}`,
  );
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
// Silence unused import warning when only one code path references PublicKey.
void PublicKey;
