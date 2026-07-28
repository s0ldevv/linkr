// deno-lint-ignore-file no-explicit-any

import { ethers } from "https://esm.sh/ethers@6";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.2?target=deno";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  isCronAuthorized,
  unauthorizedCronResponse,
} from "../_shared/cron_auth.ts";
import { withCronLock } from "../_shared/cron_lock.ts";
import { recordHealthEvent } from "../_shared/health.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { normalizeAmount, normalizeSolAmount } from "../_shared/amounts.ts";
import {
  ethToWei,
  getErc20TokenBalances,
  getEthBalanceWei,
  getTxExplorerUrl,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_ASSET_ID,
} from "../_shared/robinhood_chain.ts";
import { loadWallet } from "../_shared/wallet.ts";
import {
  estimateEthTransferBalancePreflight,
  transferEth,
} from "../_shared/eth_transfer.ts";
import {
  executeBuySwap,
  executeSellSwap,
} from "../_shared/robinhood_swap/execute.ts";
import {
  amountFromPercent,
  formatTokenAmount,
} from "../_shared/robinhood_swap/amount.ts";
import {
  getSolanaTxExplorerUrl,
  loadSolanaWallet,
  SOLANA_NATIVE_ASSET_ID,
  SOLANA_NATIVE_SYMBOL,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import {
  estimateSolTransferBalancePreflight,
  transferSol,
} from "../_shared/solana_transfer.ts";
import {
  executeSolanaBuySwap,
  executeSolanaSellSwap,
  getSolanaTokenBalanceRaw,
} from "../_shared/solana_swap/execute.ts";
import {
  amountFromPercent as solanaAmountFromPercent,
  formatTokenAmount as formatSolanaTokenAmount,
  solToLamportsString,
} from "../_shared/solana_swap/amount.ts";
import { getMarketDataBundle } from "../_shared/market_data/index.ts";
import {
  formatScheduledExecutedReply,
  formatScheduledFailedReply,
  isRecurringScheduleKind,
  marketCapFromBundle,
  marketTriggerSatisfied,
  nextRecurringDueAt,
  occurrenceKeyForDueAt,
  SCHEDULER_MARKET_CHECK_INTERVAL_SECONDS,
} from "../_shared/scheduler.ts";
import {
  insufficientNativeBalanceErrorMessage,
  insufficientNativeBalanceReplyFromError,
  nativeAmountWithReserve,
  readNativeBalanceReserve,
} from "../_shared/wallet_balance_reply.ts";

const WORKER_NAME = "cron-process-scheduled-actions";

function requiredEthForBuy(amountEth: unknown): number {
  return nativeAmountWithReserve(
    amountEth,
    readNativeBalanceReserve("ROBINHOOD_SWAP_BALANCE_RESERVE_ETH", 0.00001),
  );
}

function requiredSolForBuy(amountSol: unknown): number {
  return nativeAmountWithReserve(
    amountSol,
    readNativeBalanceReserve("SOLANA_SWAP_BALANCE_RESERVE_SOL", 0.002),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const startedAt = Date.now();
  const admin = serviceClient();

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  if (!isCronAuthorized(req)) {
    await recordHealthEvent(admin, WORKER_NAME, "degraded", startedAt, {
      error: "unauthorized",
    });
    return unauthorizedCronResponse();
  }

  if (!readBoolean("SCHEDULED_ACTIONS_ENABLED", true)) {
    const body = { skipped: "scheduled_actions_disabled" };
    await recordHealthEvent(admin, WORKER_NAME, "ok", startedAt, body);
    return jsonResponse(body);
  }

  const locked = await withCronLock(
    admin,
    { name: WORKER_NAME, ttlSeconds: 300, allowWithoutRpc: true },
    async ({ owner }) => {
      const result = await processScheduledActionBatch(admin, owner);
      await recordHealthEvent(
        admin,
        WORKER_NAME,
        result.errors.length > 0 ? "degraded" : "ok",
        startedAt,
        result,
      );
      return jsonResponse(result);
    },
  );

  if (locked.locked) {
    const body = { skipped: "locked", owner: locked.owner };
    await recordHealthEvent(admin, WORKER_NAME, "ok", startedAt, body);
    return jsonResponse(body);
  }

  return locked.result;
});

async function processScheduledActionBatch(admin: any, owner: string) {
  const batchSize = Math.max(
    1,
    Math.min(readPositiveInt("SCHEDULED_ACTION_BATCH_SIZE", 10), 50),
  );
  const staleMinutes = readPositiveInt("SCHEDULED_ACTION_STALE_MINUTES", 10);
  const staleBefore = new Date(Date.now() - staleMinutes * 60_000)
    .toISOString();
  const { data, error } = await admin.rpc("claim_ready_scheduled_actions", {
    p_worker_id: owner,
    p_limit: batchSize,
    p_stale_before: staleBefore,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const result = {
    claimed: rows.length,
    executed: 0,
    requeued: 0,
    failed: 0,
    checked: 0,
    no_work: rows.length === 0,
    errors: [] as string[],
  };

  for (const row of rows) {
    try {
      const outcome = await processScheduledAction(admin, row);
      if (outcome === "executed") result.executed += 1;
      if (outcome === "checked") result.checked += 1;
      if (outcome === "requeued") result.requeued += 1;
    } catch (error) {
      const final = await handleScheduledFailure(admin, row, error);
      if (final) result.failed += 1;
      else result.requeued += 1;
      result.errors.push(`${row.id}: ${sanitizeError(error)}`);
    }
  }

  return result;
}

async function processScheduledAction(
  admin: any,
  row: any,
): Promise<"executed" | "checked" | "requeued"> {
  if (row.trigger_type === "market_cap") {
    const marketCap = await readMarketCap(admin, row);
    if (marketCap == null) {
      await requeueMarketCheck(admin, row, null, "market_data_unavailable");
      return "checked";
    }
    if (!marketTriggerSatisfied(row.trigger_payload, marketCap)) {
      await requeueMarketCheck(admin, row, marketCap, null);
      return "checked";
    }
    row.last_observed_value_usd = marketCap;
  }

  const occurrenceStarted = await beginScheduleOccurrence(admin, row);
  if (!occurrenceStarted) return "checked";

  const executed = await executeScheduledAction(admin, row);
  await markExecuted(admin, row, executed);
  await queueReply(
    admin,
    row,
    formatScheduledExecutedReply({
      actionType: row.action_type,
      chain: row.chain,
      txHash: executed.txHash,
    }),
    "executed",
  ).catch((error) => {
    console.error("scheduled_execution_reply_enqueue_failed", {
      schedule_id: row.id,
      occurrence_id: row.active_occurrence_id ?? null,
      error: sanitizeError(error),
    });
  });
  return "executed";
}

async function executeScheduledAction(admin: any, row: any) {
  if (row.action_type === "buy" && row.chain === "solana") {
    return executeSolanaBuy(admin, row);
  }
  if (row.action_type === "buy") return executeRobinhoodBuy(admin, row);
  if (row.action_type === "sell" && row.chain === "solana") {
    return executeSolanaSell(admin, row);
  }
  if (row.action_type === "sell") return executeRobinhoodSell(admin, row);
  if (row.action_type === "transfer" && row.chain === "solana") {
    return executeScheduledSolanaTransfer(admin, row);
  }
  if (row.action_type === "transfer") {
    return executeScheduledEthTransfer(admin, row);
  }
  if (row.action_type === "launch_coin") {
    return executeScheduledLaunch(admin, row);
  }
  if (row.action_type === "claim_creator_rewards") {
    return executeScheduledCreatorRewardsClaim(admin, row);
  }
  if (
    row.action_type === "add_liquidity" ||
    row.action_type === "remove_liquidity" ||
    row.action_type === "collect_liquidity_fees"
  ) {
    return executeScheduledLiquidityAction(admin, row);
  }
  throw new Error("unsupported_scheduled_action");
}

async function executeRobinhoodBuy(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const profile = await loadProfile(admin, row.user_id);
  const wallet = await loadWallet(admin, row.user_id);
  if (!wallet) throw new Error("no_wallet");
  const idempotencyKey = scheduledTxKey(row);
  const existing = await findExistingTransaction(admin, idempotencyKey);
  if (existing?.tx_hash) return existingExecution(existing);

  const amount = await normalizeExecutionAmount(admin, action, "robinhood");
  const amountEth = amount.amount_eth ?? action.amount_eth;
  if (!Number.isFinite(Number(amountEth)) || Number(amountEth) <= 0) {
    throw new Error("missing_amount");
  }
  const maxBuy = Number(profile?.max_auto_buy_eth ?? 0);
  if (maxBuy <= 0 || Number(amountEth) > maxBuy) {
    throw new Error("max_auto_buy_eth_exceeded");
  }
  const amountWei = ethToWei(String(amountEth));
  const requiredWei = ethToWei(String(requiredEthForBuy(amountEth)));
  const balanceWei = await getEthBalanceWei(wallet.address);
  if (balanceWei < requiredWei) {
    throw new Error(
      insufficientNativeBalanceErrorMessage({
        symbol: "ETH",
        currentBalance: Number(ethers.formatEther(balanceWei)),
        requiredAmount: Number(ethers.formatEther(requiredWei)),
      }),
    );
  }

  const result = await executeBuySwap(admin, {
    side: "buy",
    userId: row.user_id,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputEthWei: amountWei.toString(),
    outputTokenAddress: action.output_mint ?? row.token_address,
    slippageBps: Number(
      action.slippage_bps ?? profile?.default_slippage_bps ?? 0,
    ),
    idempotencyKey,
    sourceTweetId: row.source_tweet_id ?? `scheduled:${row.id}`,
    sourceSurface: actionSource(row),
  });
  const tx = await findExistingTransaction(admin, idempotencyKey);
  return {
    txHash: result.txHash,
    txSignature: result.txHash,
    transactionId: tx?.id ?? null,
    raw: result,
  };
}

async function executeSolanaBuy(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const profile = await loadProfile(admin, row.user_id);
  const wallet = await loadSolanaWallet(admin, row.user_id);
  if (!wallet) throw new Error("no_solana_wallet");
  const idempotencyKey = scheduledTxKey(row);
  const existing = await findExistingTransaction(admin, idempotencyKey);
  if (existing?.tx_hash) return existingExecution(existing);

  const amount = await normalizeExecutionAmount(admin, action, "solana");
  const amountSol = amount.amount_sol ?? action.amount_sol;
  if (!Number.isFinite(Number(amountSol)) || Number(amountSol) <= 0) {
    throw new Error("missing_amount");
  }
  const maxBuy = Number(profile?.max_auto_buy_sol ?? 0);
  if (maxBuy <= 0 || Number(amountSol) > maxBuy) {
    throw new Error("max_auto_buy_sol_exceeded");
  }
  const inputLamports = BigInt(solToLamportsString(amountSol));
  const requiredLamports = BigInt(
    solToLamportsString(requiredSolForBuy(amountSol).toFixed(9)),
  );
  const balanceLamports = await getSolBalanceLamports(wallet.address);
  if (balanceLamports < requiredLamports) {
    throw new Error(
      insufficientNativeBalanceErrorMessage({
        symbol: "SOL",
        currentBalance: Number(balanceLamports) / 1_000_000_000,
        requiredAmount: Number(requiredLamports) / 1_000_000_000,
      }),
    );
  }

  const result = await executeSolanaBuySwap(admin, {
    side: "buy",
    userId: row.user_id,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputLamports: inputLamports.toString(),
    outputMint: action.output_mint ?? row.token_address,
    slippageBps: Number(
      action.slippage_bps ?? profile?.default_slippage_bps ?? 0,
    ),
    idempotencyKey,
    sourceTweetId: row.source_tweet_id ?? `scheduled:${row.id}`,
    sourceSurface: actionSource(row),
  });
  const tx = await findExistingTransaction(admin, idempotencyKey);
  return {
    txHash: result.txHash,
    txSignature: result.signature ?? result.txHash,
    transactionId: tx?.id ?? null,
    raw: result,
  };
}

async function executeRobinhoodSell(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const profile = await loadProfile(admin, row.user_id);
  const wallet = await loadWallet(admin, row.user_id);
  if (!wallet) throw new Error("no_wallet");
  const idempotencyKey = scheduledTxKey(row);
  const existing = await findExistingTransaction(admin, idempotencyKey);
  if (existing?.tx_hash) return existingExecution(existing);

  const balances = await getErc20TokenBalances(wallet.address);
  const holding = balances.find((item: any) =>
    sameAddress(
      item.token_address ?? item.mint,
      action.input_mint ?? row.token_address,
    )
  );
  const rawBalance = holding?.raw_value == null
    ? 0n
    : BigInt(holding.raw_value);
  const sellAmount = action.amount_all === true
    ? rawBalance
    : amountFromPercent(rawBalance, Number(action.amount_pct ?? 0));
  if (sellAmount <= 0n) throw new Error("no_position");
  const maxSell = Number(profile?.max_auto_sell_percent ?? 0);
  if (
    action.amount_all !== true &&
    (maxSell <= 0 || Number(action.amount_pct ?? 0) > maxSell)
  ) {
    throw new Error("max_auto_sell_percent_exceeded");
  }

  const result = await executeSellSwap(admin, {
    side: "sell",
    userId: row.user_id,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputTokenAddress: action.input_mint ?? row.token_address,
    inputTokenAmountWei: sellAmount.toString(),
    slippageBps: Number(
      action.slippage_bps ?? profile?.default_slippage_bps ?? 0,
    ),
    idempotencyKey,
    sourceTweetId: row.source_tweet_id ?? `scheduled:${row.id}`,
    sourceSurface: actionSource(row),
  });
  const tx = await findExistingTransaction(admin, idempotencyKey);
  return {
    txHash: result.txHash,
    txSignature: result.txHash,
    transactionId: tx?.id ?? null,
    raw: {
      ...result,
      scheduled_input_amount: formatTokenAmount(
        sellAmount,
        result.inputToken.decimals,
      ),
    },
  };
}

async function executeSolanaSell(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const profile = await loadProfile(admin, row.user_id);
  const wallet = await loadSolanaWallet(admin, row.user_id);
  if (!wallet) throw new Error("no_solana_wallet");
  const idempotencyKey = scheduledTxKey(row);
  const existing = await findExistingTransaction(admin, idempotencyKey);
  if (existing?.tx_hash) return existingExecution(existing);

  const balance = await getSolanaTokenBalanceRaw({
    owner: wallet.address,
    mint: action.input_mint ?? row.token_address,
  });
  const sellAmount = action.amount_all === true
    ? balance.amount
    : solanaAmountFromPercent(balance.amount, Number(action.amount_pct ?? 0));
  if (sellAmount <= 0n) throw new Error("no_position");
  const maxSell = Number(profile?.max_auto_sell_percent ?? 0);
  if (
    action.amount_all !== true &&
    (maxSell <= 0 || Number(action.amount_pct ?? 0) > maxSell)
  ) {
    throw new Error("max_auto_sell_percent_exceeded");
  }

  const result = await executeSolanaSellSwap(admin, {
    side: "sell",
    userId: row.user_id,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputMint: action.input_mint ?? row.token_address,
    inputTokenAmount: sellAmount.toString(),
    slippageBps: Number(
      action.slippage_bps ?? profile?.default_slippage_bps ?? 0,
    ),
    idempotencyKey,
    sourceTweetId: row.source_tweet_id ?? `scheduled:${row.id}`,
    sourceSurface: actionSource(row),
  });
  const tx = await findExistingTransaction(admin, idempotencyKey);
  return {
    txHash: result.txHash,
    txSignature: result.signature ?? result.txHash,
    transactionId: tx?.id ?? null,
    raw: {
      ...result,
      scheduled_input_amount: formatSolanaTokenAmount(
        sellAmount,
        result.inputToken.decimals,
      ),
    },
  };
}

async function executeScheduledEthTransfer(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const profile = await loadProfile(admin, row.user_id);
  const wallet = await loadWallet(admin, row.user_id);
  if (!wallet) throw new Error("no_wallet");
  const idempotencyKey = scheduledTxKey(row);
  const existing = await findExistingTransaction(admin, idempotencyKey);
  if (existing?.tx_hash) return existingExecution(existing);

  const amount = await normalizeExecutionAmount(admin, action, "robinhood");
  const amountEth = amount.amount_eth ?? action.amount_eth;
  if (!Number.isFinite(Number(amountEth)) || Number(amountEth) <= 0) {
    throw new Error("missing_amount");
  }
  const maxTransfer = Number(profile?.max_auto_transfer_eth ?? 0);
  if (maxTransfer <= 0 || Number(amountEth) > maxTransfer) {
    throw new Error("max_auto_transfer_eth_exceeded");
  }
  const transferPreflight = await estimateEthTransferBalancePreflight({
    from_address: wallet.address,
    recipient: action.recipient,
    amount_eth: amountEth,
  });
  if (transferPreflight.balanceWei < transferPreflight.requiredBalanceWei) {
    throw new Error(
      insufficientNativeBalanceErrorMessage({
        symbol: "ETH",
        currentBalance: Number(
          ethers.formatEther(transferPreflight.balanceWei),
        ),
        requiredAmount: Number(
          ethers.formatEther(transferPreflight.requiredBalanceWei),
        ),
      }),
    );
  }

  const result = await transferEth({
    private_key_hex: wallet.private_key_hex,
    expected_from_address: wallet.address,
    recipient: action.recipient,
    amount_eth: Number(amountEth),
  });
  const explorerUrl = result.explorer_url ?? getTxExplorerUrl(result.tx_hash);
  const { data: inserted, error } = await admin
    .from("transactions")
    .insert({
      user_id: row.user_id,
      tweet_id: row.source_tweet_id,
      action: "transfer",
      chain: "robinhood",
      input_mint: ROBINHOOD_NATIVE_ASSET_ID,
      output_mint: action.recipient,
      amount_original: action.amount_original,
      amount_original_unit: action.amount_original_unit,
      amount_eth: Number(amountEth),
      amount_usd: amount.amount_usd ?? action.amount_usd ?? null,
      eth_price_usd: amount.eth_price_usd ?? action.eth_price_usd ?? null,
      chain_id: ROBINHOOD_CHAIN_ID,
      native_symbol: "ETH",
      wallet_id: wallet.id,
      wallet_address: wallet.address,
      tx_hash: result.tx_hash,
      tx_signature: result.tx_hash,
      explorer_url: explorerUrl,
      status: result.confirmed ? "confirmed" : "submitted",
      raw_request: {
        source: "scheduler",
        source_surface: actionSource(row),
        scheduled_action_id: row.id,
      },
      raw_result: result,
      source_surface: actionSource(row),
      confirmed_at: result.confirmed ? new Date().toISOString() : null,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();
  if (error) throw error;
  return {
    txHash: result.tx_hash,
    txSignature: result.tx_hash,
    transactionId: inserted?.id ?? null,
    raw: result,
  };
}

async function executeScheduledSolanaTransfer(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const profile = await loadProfile(admin, row.user_id);
  const wallet = await loadSolanaWallet(admin, row.user_id);
  if (!wallet) throw new Error("no_solana_wallet");
  const idempotencyKey = scheduledTxKey(row);
  const existing = await findExistingTransaction(admin, idempotencyKey);
  if (existing?.tx_hash) return existingExecution(existing);

  const amount = await normalizeExecutionAmount(admin, action, "solana");
  const amountSol = amount.amount_sol ?? action.amount_sol;
  if (!Number.isFinite(Number(amountSol)) || Number(amountSol) <= 0) {
    throw new Error("missing_amount");
  }
  const maxTransfer = Number(profile?.max_auto_transfer_sol ?? 0);
  if (maxTransfer <= 0 || Number(amountSol) > maxTransfer) {
    throw new Error("max_auto_transfer_sol_exceeded");
  }
  const transferPreflight = await estimateSolTransferBalancePreflight({
    from_address: wallet.address,
    recipient: action.recipient,
    amount_sol: amountSol,
  });
  if (transferPreflight.balanceLamports < transferPreflight.requiredLamports) {
    throw new Error(
      insufficientNativeBalanceErrorMessage({
        symbol: "SOL",
        currentBalance: Number(transferPreflight.balanceLamports) /
          1_000_000_000,
        requiredAmount: Number(transferPreflight.requiredLamports) /
          1_000_000_000,
      }),
    );
  }

  const result = await transferSol({
    secret_key: wallet.secret_key,
    expected_from_address: wallet.address,
    recipient: action.recipient,
    amount_sol: Number(amountSol),
  });
  const explorerUrl = result.explorer_url ??
    getSolanaTxExplorerUrl(result.tx_hash);
  const { data: inserted, error } = await admin
    .from("transactions")
    .insert({
      user_id: row.user_id,
      tweet_id: row.source_tweet_id,
      action: "transfer",
      chain: "solana",
      input_mint: SOLANA_NATIVE_ASSET_ID,
      output_mint: action.recipient,
      amount_original: action.amount_original,
      amount_original_unit: action.amount_original_unit,
      amount_sol: Number(amountSol),
      amount_usd: amount.amount_usd ?? action.amount_usd ?? null,
      sol_price_usd: amount.sol_price_usd ?? action.sol_price_usd ?? null,
      chain_id: null,
      native_symbol: SOLANA_NATIVE_SYMBOL,
      wallet_id: wallet.id,
      wallet_address: wallet.address,
      tx_hash: result.tx_hash,
      tx_signature: result.signature,
      explorer_url: explorerUrl,
      status: result.confirmed ? "confirmed" : "submitted",
      raw_request: {
        source: "scheduler",
        source_surface: actionSource(row),
        scheduled_action_id: row.id,
      },
      raw_result: result,
      source_surface: actionSource(row),
      confirmed_at: result.confirmed ? new Date().toISOString() : null,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();
  if (error) throw error;
  return {
    txHash: result.tx_hash,
    txSignature: result.signature ?? result.tx_hash,
    transactionId: inserted?.id ?? null,
    raw: result,
  };
}

async function executeScheduledLaunch(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const chain = row.chain === "solana" ? "solana" : "robinhood";
  const idempotencyKey = scheduledTxKey(row);
  const existing = await findExistingLaunch(admin, row, idempotencyKey);
  if (existing) {
    return {
      txHash: null,
      txSignature: null,
      transactionId: null,
      raw: { idempotent_replay: true, existing_launch: existing },
    };
  }

  const [subsidyModule, policyModule, mediaModule] = await Promise.all([
    import("../_shared/first_launch_subsidy.ts"),
    import("../_shared/launch_execution_policy.ts"),
    import("../_shared/bounded_media.ts"),
  ]);
  const wallet = chain === "solana"
    ? await loadSolanaWallet(admin, row.user_id)
    : await loadWallet(admin, row.user_id);
  if (!wallet) {
    throw new Error(chain === "solana" ? "no_solana_wallet" : "no_evm_wallet");
  }
  const firstLaunchSubsidyEligible = await subsidyModule
    .isFirstLaunchSubsidyEligible(admin, row.user_id, { chain });
  const effectiveAction = firstLaunchSubsidyEligible
    ? policyModule.zeroLaunchDevBuy(action ?? {}, chain)
    : action;
  const symbol = cleanLaunchSymbol(
    requiredScheduleString(effectiveAction.symbol, "symbol"),
  );
  const hostedImageUrl = await mediaModule.rehostLaunchImageUrl(
    admin,
    requiredScheduleString(effectiveAction.image_url, "image_url"),
  );
  const creatorRewardsConfig = chain === "solana"
    ? await (await import("../_shared/pump_creator_rewards.ts"))
      .resolvePumpCreatorRewardsConfig(admin, {
        body: effectiveAction,
        creatorWalletAddress: wallet.address,
        creatorWalletId: wallet.id,
        source: actionSource(row),
        text: effectiveAction.raw_user_text ?? null,
        userId: row.user_id,
      })
    : null;
  const launchPayload: Record<string, unknown> = {
    schema_version: 1,
    name: requiredScheduleString(effectiveAction.name, "name"),
    symbol,
    description: requiredScheduleString(
      effectiveAction.description,
      "description",
    ),
    image_url: hostedImageUrl,
    original_image_url: effectiveAction.original_image_url ??
      effectiveAction.image_url,
    chain,
    wallet_id: wallet.id,
    creator_rewards_config: creatorRewardsConfig,
    website_url: effectiveAction.website_url ?? null,
    twitter_url: effectiveAction.twitter_url ?? null,
    telegram_url: effectiveAction.telegram_url ?? null,
    source_url: effectiveAction.source_url ?? row.source_tweet_url ?? null,
    source_surface: actionSource(row),
    scheduled_action_id: row.id,
    schedule_occurrence_id: row.active_occurrence_id ?? null,
    first_launch_subsidy_eligible: firstLaunchSubsidyEligible,
    first_launch_dev_buy_forced_zero: firstLaunchSubsidyEligible,
  };
  if (chain === "solana") {
    launchPayload.initial_buy_sol = Number(
      effectiveAction.initial_buy_sol ?? 0,
    );
  } else {
    launchPayload.initial_buy_eth = Number(
      effectiveAction.initial_buy_eth ?? 0,
    );
  }
  const accepted = await admin.rpc("accept_linkr_launch_request_v1", {
    p_user_id: row.user_id,
    p_source_surface: actionSource(row),
    p_source_event_id: row.active_occurrence_id ?? row.id,
    p_idempotency_key: idempotencyKey,
    p_chain: chain,
    p_wallet_id: wallet.id,
    p_payload: launchPayload,
    p_pending_action_id: null,
  });
  if (accepted.error) throw accepted.error;
  return {
    txHash: null,
    txSignature: null,
    transactionId: null,
    raw: accepted.data,
  };
}

async function executeScheduledCreatorRewardsClaim(admin: any, row: any) {
  const action = row.action_payload ?? {};
  const { claimCreatorRewards } = await import(
    "../_shared/creator_rewards_claim.ts"
  );
  const result = await claimCreatorRewards(
    admin,
    row.user_id,
    {
      launch_id: action.launch_id ?? null,
      token_address: action.token_address ?? row.token_address ?? action.token,
      mint: action.mint ?? action.token_mint ?? null,
      symbol: action.symbol ?? row.token_symbol ?? null,
      latest: action.latest === true,
      chain: row.chain,
    },
    {
      idempotencyKey: scheduledTxKey(row),
      idempotencyPrefix: "scheduled-creator-rewards",
      source: actionSource(row),
      sourceTweetId: row.source_tweet_id ?? null,
    },
  );
  const tx = await findExistingTransaction(
    admin,
    `scheduled-creator-rewards:${row.user_id}:${scheduledTxKey(row)}`,
  );
  return {
    txHash: result.tx_hash,
    txSignature: result.signature ?? result.tx_hash,
    transactionId: tx?.id ?? null,
    raw: result,
  };
}

async function executeScheduledLiquidityAction(admin: any, row: any) {
  const actionType = String(row.action_type);
  const chain = row.chain === "solana" ? "solana" : "robinhood";
  if (chain === "solana" && actionType === "collect_liquidity_fees") {
    throw new Error("solana_collect_liquidity_fees_unsupported");
  }
  const idempotencyKey = scheduledTxKey(row);
  let actionRow = await findExistingLiquidityAction(admin, idempotencyKey);
  if (actionRow?.tx_hash) {
    return {
      txHash: actionRow.tx_hash,
      txSignature: actionRow.tx_hash,
      transactionId: null,
      raw: { idempotent_replay: true, existing_liquidity_action: actionRow },
    };
  }
  if (actionRow && String(actionRow.status ?? "") === "submitted") {
    throw new Error("scheduled_liquidity_reconciliation_required");
  }
  if (!actionRow) {
    const quote = await quoteScheduledLiquidity(admin, row, actionType, chain);
    actionRow = await insertScheduledLiquidityAction(
      admin,
      row,
      actionType,
      chain,
      quote,
      idempotencyKey,
    );
  }
  const { executeLiquidityAction } = await import(
    "../_shared/robinhood_liquidity/actions.ts"
  );
  const result = await executeLiquidityAction(admin, actionRow);
  const tx = await findTransactionByHash(admin, result.tx_hash);
  return {
    txHash: result.tx_hash,
    txSignature: (result as any).signature ?? result.tx_hash,
    transactionId: tx?.id ?? null,
    raw: result,
  };
}

async function normalizeExecutionAmount(
  admin: any,
  action: any,
  chain: "robinhood" | "solana",
) {
  const unit = String(action?.amount_original_unit ?? "").toLowerCase();
  if (unit === "usd") {
    const normalized = chain === "solana"
      ? await normalizeSolAmount(admin, {
        amount_original: Number(action.amount_original),
        amount_original_unit: "usd",
      })
      : await normalizeAmount(admin, {
        amount_original: Number(action.amount_original),
        amount_original_unit: "usd",
      });
    if ("error" in normalized) throw new Error(normalized.error);
    return normalized;
  }
  return action;
}

async function getSolBalanceLamports(address: string): Promise<bigint> {
  return BigInt(
    await solanaConnection().getBalance(new PublicKey(address), "confirmed"),
  );
}

async function readMarketCap(admin: any, row: any): Promise<number | null> {
  const token = String(row.token_address ?? "").trim();
  if (!token) return null;
  const bundle = await getMarketDataBundle(admin, {
    mint: token,
    chain: row.chain === "solana" ? "solana" : "robinhood",
    includeBlockscout: true,
    includeDexscreener: true,
    includeMoralis: true,
    includeAnalytics: false,
  });
  return marketCapFromBundle(bundle);
}

async function requeueMarketCheck(
  admin: any,
  row: any,
  observedValueUsd: number | null,
  error: string | null,
) {
  const intervalSeconds = readPositiveInt(
    "SCHEDULED_ACTION_MARKET_CHECK_SECONDS",
    SCHEDULER_MARKET_CHECK_INTERVAL_SECONDS,
  );
  await admin
    .from("scheduled_actions")
    .update({
      status: "pending",
      processing_started_at: null,
      worker_id: null,
      last_observed_value_usd: observedValueUsd,
      last_checked_at: new Date().toISOString(),
      next_check_at: new Date(Date.now() + intervalSeconds * 1000)
        .toISOString(),
      check_count: Number(row.check_count ?? 0) + 1,
      error,
    })
    .eq("id", row.id);
}

async function beginScheduleOccurrence(admin: any, row: any): Promise<boolean> {
  const dueAt = row.last_due_at ?? row.scheduled_for ?? row.next_check_at ??
    new Date().toISOString();
  const occurrenceKey = row.active_occurrence_key ??
    occurrenceKeyForDueAt(dueAt);
  const { data, error } = await admin.rpc(
    "begin_linkr_schedule_occurrence_v1",
    {
      p_schedule_id: row.id,
      p_occurrence_key: occurrenceKey,
      p_due_at: new Date(String(dueAt)).toISOString(),
      p_worker_id: row.worker_id ?? null,
    },
  );
  if (error) throw error;
  const envelope = Array.isArray(data) ? data[0] : data;
  const occurrence = envelope?.occurrence ?? null;
  if (
    !occurrence || envelope?.started !== true ||
    String(envelope.status ?? "") !== "running"
  ) {
    return false;
  }
  row.active_occurrence_id = occurrence.id;
  row.active_occurrence_key = occurrence.occurrence_key ?? occurrenceKey;
  row.last_due_at = occurrence.due_at ?? dueAt;
  return true;
}

async function completeScheduleOccurrence(
  admin: any,
  row: any,
  status: "succeeded" | "failed" | "retrying",
  outcome: Record<string, unknown>,
  error: string | null,
) {
  const occurrenceId = row.active_occurrence_id ?? null;
  if (!occurrenceId) return;
  const completed = await admin.rpc("complete_linkr_schedule_occurrence_v1", {
    p_schedule_id: row.id,
    p_occurrence_id: occurrenceId,
    p_status: status,
    p_transaction_id: outcome.transaction_id ?? null,
    p_transaction_hash: outcome.tx_hash ?? null,
    p_transaction_signature: outcome.tx_signature ?? null,
    p_observed_value_usd: row.last_observed_value_usd ?? null,
    p_result: outcome,
    p_error: error,
  });
  if (completed.error) throw completed.error;
}

async function handleScheduledFailure(
  admin: any,
  row: any,
  error: unknown,
): Promise<boolean> {
  const attempts = Number(row.attempt_count ?? 0) + 1;
  const maxAttempts = Math.max(1, Number(row.max_attempts ?? 3));
  const balanceReply = insufficientNativeBalanceReplyFromError(error);
  const final = Boolean(balanceReply) || attempts >= maxAttempts;
  const delaySeconds = Math.min(15 * 60, 60 * attempts);
  const update: Record<string, unknown> = {
    attempt_count: attempts,
    error: sanitizeError(error),
    processing_started_at: null,
    worker_id: null,
    active_occurrence_id: null,
    active_occurrence_key: null,
  };

  if (final) {
    Object.assign(update, {
      status: "failed",
      failed_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    });
  } else {
    Object.assign(update, {
      status: "pending",
      next_check_at: row.trigger_type === "market_cap"
        ? new Date(Date.now() + delaySeconds * 1000).toISOString()
        : row.next_check_at,
      scheduled_for: row.trigger_type === "time"
        ? new Date(Date.now() + delaySeconds * 1000).toISOString()
        : row.scheduled_for,
    });
  }

  await completeScheduleOccurrence(
    admin,
    row,
    final ? "failed" : "retrying",
    { attempt_count: attempts, final },
    sanitizeError(error),
  ).catch((completeError) => {
    console.error("scheduled_occurrence_complete_failed", {
      schedule_id: row.id,
      error: sanitizeError(completeError),
    });
  });

  await admin.from("scheduled_actions").update(update).eq("id", row.id);
  if (final) {
    await queueReply(
      admin,
      row,
      balanceReply ??
        formatScheduledFailedReply({
          actionType: row.action_type,
          chain: row.chain,
        }),
      "failed",
    ).catch((replyError) => {
      console.error("scheduled_failure_reply_enqueue_failed", {
        schedule_id: row.id,
        occurrence_id: row.active_occurrence_id ?? null,
        error: sanitizeError(replyError),
      });
    });
  }
  return final;
}

async function markExecuted(admin: any, row: any, execution: any) {
  await completeScheduleOccurrence(
    admin,
    row,
    "succeeded",
    {
      tx_hash: execution.txHash ?? null,
      tx_signature: execution.txSignature ?? execution.txHash ?? null,
      transaction_id: execution.transactionId ?? null,
    },
    null,
  );

  const completedAt = new Date().toISOString();
  const nextDueAt = isRecurringScheduleKind(row.schedule_kind)
    ? nextRecurringDueAt({
      ...row,
      occurrence_count: Number(row.occurrence_count ?? 0) + 1,
      last_due_at: row.last_due_at ?? row.scheduled_for ?? row.next_check_at ??
        completedAt,
    })
    : null;
  const nextUpdate = nextDueAt
    ? {
      status: "pending",
      scheduled_for: row.trigger_type === "time"
        ? nextDueAt
        : row.scheduled_for,
      next_check_at: row.trigger_type === "market_cap"
        ? nextDueAt
        : row.next_check_at,
    }
    : { status: "executed" };

  await admin
    .from("scheduled_actions")
    .update({
      ...nextUpdate,
      processed_at: completedAt,
      executed_at: completedAt,
      last_execution_at: completedAt,
      processing_started_at: null,
      worker_id: null,
      active_occurrence_id: null,
      active_occurrence_key: null,
      transaction_hash: execution.txHash ?? null,
      transaction_signature: execution.txSignature ?? execution.txHash ?? null,
      transaction_id: execution.transactionId ?? null,
      last_checked_at: row.trigger_type === "market_cap"
        ? completedAt
        : row.last_checked_at,
      last_observed_value_usd: row.last_observed_value_usd == null
        ? row.last_observed_value_usd
        : Number(row.last_observed_value_usd),
      execution_result: execution.raw ?? {},
      error: null,
    })
    .eq("id", row.id);
}

async function loadProfile(admin: any, userId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("profile_not_found");
  return data;
}

async function findExistingTransaction(admin: any, idempotencyKey: string) {
  const { data, error } = await admin
    .from("transactions")
    .select("id,status,tx_hash,tx_signature,raw_result")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function findTransactionByHash(
  admin: any,
  txHash: string | null | undefined,
) {
  const hash = String(txHash ?? "").trim();
  if (!hash) return null;
  const { data, error } = await admin
    .from("transactions")
    .select("id,status,tx_hash,tx_signature,raw_result")
    .eq("tx_hash", hash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function findExistingLaunch(
  admin: any,
  row: any,
  idempotencyKey: string,
) {
  const keys = [
    `launch:${actionSource(row)}:${idempotencyKey}`,
    `launch:${idempotencyKey}`,
    idempotencyKey,
  ];
  const { data, error } = await admin
    .from("coin_launches")
    .select("id,status,token_address,mint,raw_result,idempotency_key")
    .eq("user_id", row.user_id)
    .in("idempotency_key", keys)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function findExistingLiquidityAction(admin: any, idempotencyKey: string) {
  const { data, error } = await admin
    .from("liquidity_actions")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function quoteScheduledLiquidity(
  admin: any,
  row: any,
  actionType: string,
  chain: "robinhood" | "solana",
) {
  const action = row.action_payload ?? {};
  const request = {
    ...action,
    chain,
    token: action.token ?? action.token_address ?? row.token_address,
    token_address: action.token_address ?? action.token ?? row.token_address,
    mint: action.mint ?? action.token_mint ?? action.token_address ??
      row.token_address,
    position_id: action.position_id ?? action.positionId ?? null,
    position_token_id: action.position_token_id ?? action.lp_token_account ??
      null,
    amount_eth: action.amount_eth ?? row.amount_eth,
    amount_sol: action.amount_sol ?? row.amount_sol,
    amount: action.amount_original ?? row.amount_original,
    token_amount: action.token_amount ?? action.amount_original,
    token_amount_raw: action.token_amount_raw ?? null,
    percent: action.percent ?? action.amount_pct ?? row.amount_pct,
    requested_percent: action.requested_percent ?? action.percent ??
      action.amount_pct ?? row.amount_pct,
    slippage_bps: action.slippage_bps ?? row.slippage_bps,
  };
  if (chain === "solana") {
    const liquidity = await import("../_shared/pump_liquidity/actions.ts");
    if (actionType === "add_liquidity") {
      return await liquidity.quotePumpAddLiquidity(admin, row.user_id, request);
    }
    return await liquidity.quotePumpRemoveLiquidity(
      admin,
      row.user_id,
      request,
    );
  }
  const liquidity = await import("../_shared/robinhood_liquidity/quote.ts");
  if (actionType === "add_liquidity") {
    return await liquidity.quoteAddLiquidity(admin, row.user_id, request);
  }
  if (actionType === "collect_liquidity_fees") {
    return await liquidity.quoteCollectFees(admin, row.user_id, request);
  }
  return await liquidity.quoteRemoveLiquidity(admin, row.user_id, request);
}

async function insertScheduledLiquidityAction(
  admin: any,
  row: any,
  actionType: string,
  chain: "robinhood" | "solana",
  quote: any,
  idempotencyKey: string,
) {
  const insert = await admin
    .from("liquidity_actions")
    .insert({
      user_id: row.user_id,
      action: actionType,
      status: "queued",
      chain,
      platform: chain === "solana" ? "pump_swap" : "robinhood_uniswap_v3",
      wallet_id: quote.wallet_id ?? null,
      native_symbol: chain === "solana" ? "SOL" : "ETH",
      wallet_address: quote.wallet_address,
      token_address: quote.token_address ?? quote.token_mint,
      token_mint: quote.token_mint ?? null,
      token_symbol: quote.token_symbol ?? row.token_symbol ?? null,
      pool_address: quote.pool_address,
      pool_fee: quote.pool_fee,
      position_token_id: quote.position_token_id ?? quote.lp_token_account ??
        null,
      tick_lower: quote.tick_lower ?? 0,
      tick_upper: quote.tick_upper ?? 0,
      requested_eth_wei: quote.eth_amount_wei ?? quote.sol_amount_lamports ??
        null,
      requested_token_wei: quote.token_amount_wei ?? quote.token_amount_raw ??
        null,
      requested_native_raw: quote.sol_amount_lamports ?? null,
      requested_percent: quote.requested_percent ?? null,
      liquidity_delta: quote.liquidity_delta ?? quote.lp_token_amount ?? "0",
      simulation: quote,
      pending_action_id: null,
      idempotency_key: idempotencyKey,
      source_surface: actionSource(row),
    })
    .select("*")
    .single();
  if (!insert.error) return insert.data;
  if (!isUniqueViolation(insert.error)) throw insert.error;
  const existing = await findExistingLiquidityAction(admin, idempotencyKey);
  if (!existing) throw insert.error;
  return existing;
}

function existingExecution(tx: any) {
  return {
    txHash: tx.tx_hash,
    txSignature: tx.tx_signature ?? tx.tx_hash,
    transactionId: tx.id,
    raw: { idempotent_replay: true, existing_transaction: tx },
  };
}

async function queueReply(
  admin: any,
  row: any,
  text: string,
  kind: "executed" | "failed",
) {
  const tweetId = row.source_tweet_id;
  const sourceTweetId = String(tweetId ?? "").trim();
  if (!sourceTweetId) return;
  const idempotencyKey = `scheduled-reply:${
    row.active_occurrence_id ?? row.active_occurrence_key ?? row.id
  }:${kind}`;
  const { data } = await admin
    .from("tweets_inbox")
    .select("conversation_id,author_twitter_id")
    .eq("tweet_id", sourceTweetId)
    .maybeSingle();
  const inserted = await admin.from("twitter_replies").insert({
    tweet_id: sourceTweetId,
    reply_text: text,
    status: "pending",
    idempotency_key: idempotencyKey,
    conversation_id: data?.conversation_id ?? null,
    author_twitter_id: data?.author_twitter_id ?? null,
    reply_kind: "scheduled_action",
  });
  if (inserted.error && !isUniqueViolation(inserted.error)) {
    throw inserted.error;
  }
}

function scheduledTxKey(row: any): string {
  return `scheduled-${row.action_type}:${
    row.active_occurrence_id ?? row.active_occurrence_key ?? row.id
  }`;
}

function actionSource(row: any): string {
  const raw = String(
    row?.source_surface ?? row?.source ?? row?.action_payload?.source ?? "",
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!raw && row?.source_tweet_id) return "x";
  if (
    raw === "twitter" ||
    raw === "tweet" ||
    raw === "x_bot" ||
    raw.startsWith("x_") ||
    raw.startsWith("tweet_")
  ) {
    return "x";
  }
  if (raw === "website" || raw === "web" || raw === "in_app" || raw === "app") {
    return "dashboard";
  }
  if (raw === "agent" || raw === "api" || raw === "external_api") {
    return "agent_api";
  }
  if (raw === "scheduler" || raw === "pg_cron") return "cron";
  return raw || "unknown";
}

function sameAddress(left: unknown, right: unknown): boolean {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function requiredScheduleString(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`missing_${field}`);
  return text;
}

function cleanLaunchSymbol(value: string): string {
  const symbol = String(value ?? "")
    .replace(/^\$/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  if (!symbol) throw new Error("symbol_required");
  return symbol;
}

function isUniqueViolation(error: any): boolean {
  return (
    error?.code === "23505" ||
    /duplicate key|already exists|unique/i.test(
      String(error?.message ?? error ?? ""),
    )
  );
}

function sanitizeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 500);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
