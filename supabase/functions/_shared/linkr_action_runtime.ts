// deno-lint-ignore-file no-explicit-any
// Deterministic confirmed action runtime for Linkr surfaces.

// Chain and signing modules are loaded lazily inside the action-specific
// execution branch. This keeps the confirmation worker below the Edge boot
// budget and avoids loading both chain SDKs for every action.
import { formatScheduledQueuedReply } from "./scheduler.ts";

export interface ConfirmActionArgs {
  admin: any;
  userId: string;
  pendingActionId: string;
  runId?: string | null;
}

export interface CancelActionArgs {
  admin: any;
  userId: string;
  pendingActionId: string;
}

export async function cancelLinkrPendingAction(args: CancelActionArgs) {
  const pending = await loadPending(
    args.admin,
    args.userId,
    args.pendingActionId,
  );
  if (!pending) throw new Error("pending_action_not_found");
  if (pending.status !== "pending") {
    return { pending, status: pending.status, cancelled: false };
  }
  const { data, error } = await args.admin
    .from("linkr_pending_actions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("user_id", args.userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const current = await loadPending(args.admin, args.userId, pending.id);
    return {
      pending: current ?? pending,
      status: String(current?.status ?? "unknown"),
      cancelled: false,
    };
  }
  return { pending: data, status: "cancelled", cancelled: true };
}

export async function confirmAndExecuteLinkrPendingAction(
  args: ConfirmActionArgs,
) {
  const loadedPending = await loadPending(
    args.admin,
    args.userId,
    args.pendingActionId,
  );
  if (!loadedPending) throw new Error("pending_action_not_found");

  if (loadedPending.status !== "pending") {
    return await existingActionResult(args.admin, loadedPending);
  }
  if (new Date(loadedPending.expires_at).getTime() < Date.now()) {
    const expired = await args.admin
      .from("linkr_pending_actions")
      .update({ status: "expired" })
      .eq("id", loadedPending.id)
      .eq("user_id", args.userId)
      .eq("status", "pending");
    if (expired.error) throw expired.error;
    throw new Error("pending_action_expired");
  }

  const now = new Date().toISOString();
  const claimed = await args.admin
    .from("linkr_pending_actions")
    .update({ status: "executing", confirmed_at: now })
    .eq("id", loadedPending.id)
    .eq("user_id", args.userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) {
    const current = await loadPending(
      args.admin,
      args.userId,
      args.pendingActionId,
    );
    if (!current) throw new Error("pending_action_not_found_after_claim");
    return await existingActionResult(args.admin, current);
  }

  const pending = claimed.data;
  const jobKey = `linkr-action:${pending.id}:${pending.idempotency_key}`;
  const job = await insertOrSelect(
    args.admin,
    "linkr_action_jobs",
    {
      user_id: args.userId,
      surface: pending.surface,
      source_surface: sourceSurface(pending),
      surface_conversation_id: pending.surface_conversation_id,
      terminal_conversation_id: pending.terminal_conversation_id,
      x_thread_id: pending.x_thread_id,
      cron_job_id: pending.cron_job_id,
      pending_action_id: pending.id,
      run_id: args.runId ?? null,
      action_type: pending.action_type,
      status: "running",
      attempt_count: 1,
      action_payload: pending.action_payload,
      idempotency_key: jobKey,
      started_at: now,
    },
    "idempotency_key",
    jobKey,
  );
  if (job.error || !job.data) {
    const failed = await args.admin
      .from("linkr_pending_actions")
      .update({ status: "failed" })
      .eq("id", pending.id)
      .eq("user_id", args.userId)
      .eq("status", "executing");
    if (failed.error) {
      logPersistenceFailure(
        "pending_job_create_failure",
        failed.error,
        pending,
      );
    }
    throw job.error ?? new Error("action_job_create_failed");
  }

  // A duplicate job means another executor already crossed the idempotency
  // boundary. Never execute the payload again; return its durable state.
  if (!job.inserted) {
    return await existingActionResult(args.admin, {
      ...pending,
      status: pending.status === "executing" ? "executing" : pending.status,
    }, job.data);
  }

  let result: any;
  try {
    result = await executePayload(
      args.admin,
      args.userId,
      pending,
      job.data,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = normalizeErrorCode(message);
    const safeMessage = userMessageForError(message);
    const uncertain = isExecutionOutcomeUncertain(message);
    console.error(JSON.stringify({
      event: uncertain
        ? "linkr_action_execution_outcome_uncertain"
        : "linkr_action_execution_failed",
      pending_action_id: pending.id,
      job_id: job.data.id,
      action_type: pending.action_type,
      error_code: errorCode,
      error_message: message.slice(0, 500),
    }));

    const jobUpdate = await args.admin
      .from("linkr_action_jobs")
      .update({
        status: uncertain ? "awaiting_receipt" : "failed",
        error_code: errorCode,
        error_message: safeMessage,
        completed_at: uncertain ? null : new Date().toISOString(),
      })
      .eq("id", job.data.id)
      .eq("status", "running");
    if (jobUpdate.error) {
      logPersistenceFailure("job_failure_state", jobUpdate.error, pending);
    }

    const pendingUpdate = await args.admin
      .from("linkr_pending_actions")
      .update({ status: uncertain ? "confirmed" : "failed" })
      .eq("id", pending.id)
      .eq("user_id", args.userId)
      .eq("status", "executing");
    if (pendingUpdate.error) {
      logPersistenceFailure(
        "pending_failure_state",
        pendingUpdate.error,
        pending,
      );
    }

    await writeReceipt(args.admin, pending, job.data, {
      status: uncertain ? "reconciliation_required" : "failed",
      summary: safeMessage,
      error_code: errorCode,
    }).catch((receiptError) => {
      logPersistenceFailure("failure_receipt", receiptError, pending);
    });
    throw error;
  }

  const pendingStatus = result.awaiting_receipt ? "confirmed" : "executed";
  const jobStatus = result.awaiting_receipt ? "awaiting_receipt" : "completed";
  const receipt = await writeReceipt(args.admin, pending, job.data, result)
    .catch((error) => {
      logPersistenceFailure("success_receipt", error, pending);
      return null;
    });

  const jobUpdate = await args.admin
    .from("linkr_action_jobs")
    .update({
      status: jobStatus,
      result,
      completed_at: result.awaiting_receipt ? null : new Date().toISOString(),
    })
    .eq("id", job.data.id)
    .eq("status", "running");
  if (jobUpdate.error) {
    logPersistenceFailure("job_success_state", jobUpdate.error, pending);
  }

  const pendingUpdate = await args.admin
    .from("linkr_pending_actions")
    .update({ status: pendingStatus })
    .eq("id", pending.id)
    .eq("user_id", args.userId)
    .eq("status", "executing");
  if (pendingUpdate.error) {
    logPersistenceFailure(
      "pending_success_state",
      pendingUpdate.error,
      pending,
    );
  }

  return {
    pending: { ...pending, status: pendingStatus },
    job: { ...job.data, status: jobStatus, result },
    receipt,
    status: pendingStatus,
    result,
  };
}

async function existingActionResult(admin: any, pending: any, knownJob?: any) {
  let job = knownJob ?? null;
  if (!job) {
    const loaded = await admin
      .from("linkr_action_jobs")
      .select("*")
      .eq("pending_action_id", pending.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (loaded.error) throw loaded.error;
    job = loaded.data ?? null;
  }
  const receiptResult = await admin
    .from("linkr_action_receipts")
    .select("*")
    .eq("pending_action_id", pending.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (receiptResult.error) throw receiptResult.error;
  return {
    pending,
    job,
    receipt: receiptResult.data ?? null,
    status: String(pending.status),
    result: job?.result ?? receiptResult.data?.payload ?? null,
  };
}

function isExecutionOutcomeUncertain(message: string): boolean {
  return /transfer_status_uncertain|submission_outcome_unknown|awaiting_confirmation|reconcil/i
    .test(message);
}

function logPersistenceFailure(phase: string, error: unknown, pending: any) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    event: "linkr_action_persistence_failed",
    phase,
    pending_action_id: pending?.id ?? null,
    action_type: pending?.action_type ?? null,
    error_code: normalizeErrorCode(message),
  }));
}

async function executePayload(
  admin: any,
  userId: string,
  pending: any,
  job: any,
) {
  const payload = pending.action_payload ?? {};
  switch (pending.action_type) {
    case "buy":
      return executeBuy(admin, userId, payload, pending, job);
    case "sell":
      return executeSell(admin, userId, payload, pending, job);
    case "transfer":
      return executeTransfer(admin, userId, payload, pending);
    case "swap":
      return executeStableSwap(admin, userId, payload, pending, job);
    case "burn_token":
      return executeBurn(admin, userId, payload, pending);
    case "add_liquidity":
      return executeLiquidity(admin, userId, payload, pending, "add_liquidity");
    case "remove_liquidity":
      return executeLiquidity(
        admin,
        userId,
        payload,
        pending,
        "remove_liquidity",
      );
    case "collect_liquidity_fees":
      return executeLiquidity(
        admin,
        userId,
        payload,
        pending,
        "collect_liquidity_fees",
      );
    case "claim_creator_rewards":
      return executeCreatorRewardsClaim(admin, userId, payload, pending);
    case "launch_coin":
      return queueLaunch(admin, userId, payload, pending);
    case "schedule_action":
      return queueScheduledAction(admin, userId, payload, pending);
    default:
      throw new Error("unsupported_action_type:" + pending.action_type);
  }
}

async function executeBurn(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
) {
  const { executeTokenBurn } = await import("./token_burn.ts");
  const preview = payload?.burn_preview;
  if (!preview || payload?.irreversible !== true) {
    throw new Error("invalid_burn_preview");
  }
  try {
    const result = await executeTokenBurn({
      admin,
      userId,
      preview,
      idempotencyKey: `linkr-burn:${pending.id}`,
      sourceSurface: sourceSurface(pending),
      pendingActionId: pending.id,
    });
    return {
      ...result,
      canonical_record_type: "token_burn_execution",
      canonical_record_id: result.burn_execution_id ?? null,
    };
  } catch (error) {
    const execution = await admin
      .from("token_burn_executions")
      .select("id,state,tx_hash")
      .eq("pending_action_id", pending.id)
      .maybeSingle();
    if (
      execution.data &&
      ["signed", "broadcast", "reconciling"].includes(execution.data.state)
    ) {
      return {
        status: "awaiting_confirmation",
        awaiting_receipt: true,
        tx_hash: execution.data.tx_hash,
        summary:
          `The burn transaction is awaiting chain confirmation. Linkr will reconcile the same signed transaction and will not create a second burn. TX: ${execution.data.tx_hash}`,
        canonical_record_type: "token_burn_execution",
        canonical_record_id: execution.data.id,
      };
    }
    throw error;
  }
}

async function executeBuy(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
  job: any,
) {
  const chain = normalizeChain(payload.chain, payload.token);
  const slippageBps = normalizeSlippage(payload.slippage_bps);
  if (chain === "solana") {
    const [web3, solanaChain, solanaTransfer, swapConstants, swapExecute] =
      await Promise.all([
        import("https://esm.sh/@solana/web3.js@1.98.4?target=deno"),
        import("./solana_chain.ts"),
        import("./solana_transfer.ts"),
        import("./solana_swap/constants.ts"),
        import("./solana_swap/execute.ts"),
      ]);
    const { PublicKey } = web3;
    const { loadSolanaWallet, normalizeSolanaPublicKey, solanaConnection } =
      solanaChain;
    const { parseSolToLamports } = solanaTransfer;
    const { readSolanaSwapEnabled } = swapConstants;
    const { executeSolanaBuySwap } = swapExecute;
    if (!readSolanaSwapEnabled()) throw new Error("solana_swap_not_enabled");
    const wallet = await loadSolanaWallet(admin, userId);
    if (!wallet) throw new Error("no_solana_wallet");
    const outputMint = normalizeSolanaPublicKey(
      required(payload.token, "token_mint"),
    );
    const inputLamports = parseSolToLamports(
      payload.amount_sol ?? payload.amount,
    ).toString();
    const balanceLamports = BigInt(
      await solanaConnection().getBalance(
        new PublicKey(wallet.address),
        "confirmed",
      ),
    );
    if (balanceLamports <= BigInt(inputLamports)) {
      throw new Error("insufficient_sol");
    }
    const result = await executeSolanaBuySwap(admin, {
      side: "buy",
      userId,
      walletId: wallet.id,
      walletAddress: wallet.address,
      inputLamports,
      outputMint,
      slippageBps,
      idempotencyKey: job.idempotency_key,
      sourceTweetId: `${sourceSurface(pending)}:${pending.id}`,
      sourceSurface: sourceSurface(pending),
    });
    await markSurfaceTransaction(admin, job.idempotency_key, pending);
    return {
      status: result.status,
      chain,
      tx_hash: result.txHash,
      explorer_url: result.explorerUrl,
      summary: `Bought token on Solana. TX ${shortHash(result.txHash)}.`,
      raw: result,
    };
  }

  const [ethersModule, swapConstants, walletModule, chainModule, swapExecute] =
    await Promise.all([
      import("https://esm.sh/ethers@6"),
      import("./robinhood_swap/constants.ts"),
      import("./wallet.ts"),
      import("./robinhood_chain.ts"),
      import("./robinhood_swap/execute.ts"),
    ]);
  const { ethers } = ethersModule;
  const { isSwapEnabled } = swapConstants;
  const { loadWallet } = walletModule;
  const { normalizeEvmAddress, getEthBalanceWei } = chainModule;
  const { executeBuySwap } = swapExecute;
  if (!isSwapEnabled()) throw new Error("swap_not_enabled");
  const wallet = await loadWallet(admin, userId);
  if (!wallet) throw new Error("no_evm_wallet");
  const outputTokenAddress = normalizeEvmAddress(
    required(payload.token, "token_address"),
  );
  const inputWei = ethers.parseEther(
    String(payload.amount_eth ?? payload.amount),
  );
  const balanceWei = await getEthBalanceWei(wallet.address);
  if (balanceWei <= inputWei) throw new Error("insufficient_eth");
  const result = await executeBuySwap(admin, {
    side: "buy",
    userId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputEthWei: inputWei.toString(),
    outputTokenAddress,
    slippageBps,
    idempotencyKey: job.idempotency_key,
    sourceTweetId: `${sourceSurface(pending)}:${pending.id}`,
    sourceSurface: sourceSurface(pending),
  });
  await markSurfaceTransaction(admin, job.idempotency_key, pending);
  return {
    status: result.status,
    chain,
    tx_hash: result.txHash,
    explorer_url: result.explorerUrl,
    summary: `Bought token on Robinhood Chain. TX ${shortHash(result.txHash)}.`,
    raw: result,
  };
}

async function executeSell(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
  job: any,
) {
  const chain = normalizeChain(payload.chain, payload.token);
  const percent = Math.max(0, Math.min(100, Number(payload.percent ?? 100)));
  if (!Number.isFinite(percent) || percent <= 0) {
    throw new Error("invalid_sell_percent");
  }
  const slippageBps = normalizeSlippage(payload.slippage_bps);
  if (chain === "solana") {
    const [solanaChain, swapConstants, swapExecute, swapAmount] = await Promise
      .all([
        import("./solana_chain.ts"),
        import("./solana_swap/constants.ts"),
        import("./solana_swap/execute.ts"),
        import("./solana_swap/amount.ts"),
      ]);
    const { loadSolanaWallet, normalizeSolanaPublicKey } = solanaChain;
    const { readSolanaSwapEnabled } = swapConstants;
    const { executeSolanaSellSwap, getSolanaTokenBalanceRaw } = swapExecute;
    const { amountFromPercent: solanaAmountFromPercent } = swapAmount;
    if (!readSolanaSwapEnabled()) throw new Error("solana_swap_not_enabled");
    const wallet = await loadSolanaWallet(admin, userId);
    if (!wallet) throw new Error("no_solana_wallet");
    const inputMint = normalizeSolanaPublicKey(
      required(payload.token, "token_mint"),
    );
    const balance = await getSolanaTokenBalanceRaw({
      owner: wallet.address,
      mint: inputMint,
    });
    const inputTokenAmount = solanaAmountFromPercent(balance.amount, percent)
      .toString();
    if (BigInt(inputTokenAmount) <= 0n) throw new Error("no_token_balance");
    const result = await executeSolanaSellSwap(admin, {
      side: "sell",
      userId,
      walletId: wallet.id,
      walletAddress: wallet.address,
      inputMint,
      inputTokenAmount,
      slippageBps,
      idempotencyKey: job.idempotency_key,
      sourceTweetId: `${sourceSurface(pending)}:${pending.id}`,
      sourceSurface: sourceSurface(pending),
    });
    await markSurfaceTransaction(admin, job.idempotency_key, pending);
    return {
      status: result.status,
      chain,
      tx_hash: result.txHash,
      explorer_url: result.explorerUrl,
      summary: `Sold ${percent}% on Solana. TX ${shortHash(result.txHash)}.`,
      raw: result,
    };
  }

  const [swapConstants, walletModule, chainModule, swapExecute, swapAmount] =
    await Promise.all([
      import("./robinhood_swap/constants.ts"),
      import("./wallet.ts"),
      import("./robinhood_chain.ts"),
      import("./robinhood_swap/execute.ts"),
      import("./robinhood_swap/amount.ts"),
    ]);
  const { isSwapEnabled } = swapConstants;
  const { loadWallet } = walletModule;
  const { normalizeEvmAddress, getErc20TokenBalances } = chainModule;
  const { executeSellSwap } = swapExecute;
  const { amountFromPercent: evmAmountFromPercent } = swapAmount;
  if (!isSwapEnabled()) throw new Error("swap_not_enabled");
  const wallet = await loadWallet(admin, userId);
  if (!wallet) throw new Error("no_evm_wallet");
  const inputTokenAddress = normalizeEvmAddress(
    required(payload.token, "token_address"),
  );
  const balances = await getErc20TokenBalances(wallet.address);
  const holding = balances.find(
    (item: any) =>
      String(item.token_address ?? item.mint ?? "").toLowerCase() ===
        inputTokenAddress.toLowerCase(),
  );
  const rawBalance = holding?.raw_value == null
    ? 0n
    : BigInt(holding.raw_value);
  const inputTokenAmountWei = evmAmountFromPercent(rawBalance, percent)
    .toString();
  if (BigInt(inputTokenAmountWei) <= 0n) throw new Error("no_token_balance");
  const result = await executeSellSwap(admin, {
    side: "sell",
    userId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    inputTokenAddress,
    inputTokenAmountWei,
    slippageBps,
    idempotencyKey: job.idempotency_key,
    sourceTweetId: `${sourceSurface(pending)}:${pending.id}`,
    sourceSurface: sourceSurface(pending),
  });
  await markSurfaceTransaction(admin, job.idempotency_key, pending);
  return {
    status: result.status,
    chain,
    tx_hash: result.txHash,
    explorer_url: result.explorerUrl,
    summary: `Sold ${percent}% on Robinhood Chain. TX ${
      shortHash(result.txHash)
    }.`,
    raw: result,
  };
}

async function executeTransfer(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
) {
  const chain = normalizeChain(payload.chain, payload.recipient);
  const source = sourceSurface(pending);
  const idempotencyKey = `${source}-transfer:${pending.id}`;

  if (chain === "solana") {
    const [solanaChain, recipientModule, usdcModule, transferModule] =
      await Promise.all([
        import("./solana_chain.ts"),
        import("./solana_recipient.ts"),
        import("./solana_usdc.ts"),
        import("./solana_transfer.ts"),
      ]);
    const {
      loadSolanaWallet,
      SOLANA_NATIVE_ASSET_ID,
      SOLANA_NATIVE_SYMBOL,
    } = solanaChain;
    const { resolveSolanaRecipient, verifySolanaRecipientSnapshot } =
      recipientModule;
    const {
      estimateUsdcTransferBalancePreflight,
      formatUsdcRaw,
      parseUsdcToRaw,
      SOLANA_USDC_MINT,
      SOLANA_USDC_SYMBOL,
      transferUsdc,
    } = usdcModule;
    const {
      estimateSolTransferBalancePreflight,
      parseSolToLamports,
      transferSol,
    } = transferModule;
    const wallet = await loadSolanaWallet(admin, userId);
    if (!wallet) throw new Error("no_solana_wallet");
    const profile = await currentSolanaRules(admin, userId);
    const resolvedRecipient = await resolveSolanaRecipient(
      admin,
      required(payload.recipient, "recipient"),
      source,
    );
    const recipient = await verifySolanaRecipientSnapshot(
      admin,
      resolvedRecipient,
    );
    if (recipient === wallet.address) {
      throw new Error("recipient_matches_sender");
    }

    const asset = String(payload.asset ?? payload.token_symbol ?? "sol")
      .toLowerCase();
    if (asset === "usdc" || payload.amount_usdc != null) {
      const amountRaw = parseUsdcToRaw(payload.amount_usdc ?? payload.amount);
      const amountText = formatUsdcRaw(amountRaw);
      const amountUsdc = Number(amountText);
      const cap = Number(profile.max_auto_transfer_usdc ?? 0);
      if (!Number.isFinite(cap) || cap <= 0) {
        throw new Error("usdc_transfer_disabled");
      }
      if (amountUsdc > cap) throw new Error("max_auto_transfer_usdc_exceeded");
      const preflight = await estimateUsdcTransferBalancePreflight({
        from_address: wallet.address,
        recipient,
        amount_usdc: amountText,
      });
      if (preflight.balanceRaw < amountRaw) {
        throw new Error("insufficient_usdc");
      }
      if (preflight.solBalanceLamports < preflight.requiredSolLamports) {
        throw new Error("insufficient_sol_for_usdc_transfer_fee");
      }

      const reservation = await reserveTransferTransaction(
        admin,
        idempotencyKey,
        {
          user_id: userId,
          action: "transfer",
          chain: "solana",
          input_mint: SOLANA_USDC_MINT,
          output_mint: recipient,
          amount_original: amountUsdc,
          amount_original_unit: "usdc",
          input_amount_wei: amountRaw.toString(),
          input_token_decimals: 6,
          input_token_symbol: SOLANA_USDC_SYMBOL,
          native_symbol: SOLANA_USDC_SYMBOL,
          wallet_id: wallet.id,
          wallet_address: wallet.address,
          source_surface: source,
          terminal_conversation_id: pending.terminal_conversation_id,
          terminal_message_id: pending.user_message_id,
          raw_request: {
            source,
            pending_action_id: pending.id,
            recipient: resolvedRecipient,
            amount_raw: amountRaw.toString(),
          },
        },
      );
      if (reservation.replay) {
        return transferReplayResult(
          reservation.transaction,
          chain,
          `Sent ${amountText} USDC.`,
        );
      }

      let result: any;
      try {
        result = await transferUsdc({
          secret_key: wallet.secret_key,
          expected_from_address: wallet.address,
          recipient,
          amount_usdc: amountText,
        });
      } catch (error) {
        await markTransferOutcomeUncertain(
          admin,
          idempotencyKey,
          pending,
          error,
        );
        throw new Error("transfer_status_uncertain");
      }
      await completeReservedTransfer(admin, idempotencyKey, {
        tx_hash: result.tx_hash,
        tx_signature: result.signature,
        explorer_url: result.explorer_url,
        status: result.confirmed ? "confirmed" : "submitted",
        raw_result: result,
        confirmed_at: result.confirmed ? new Date().toISOString() : null,
      });
      return {
        status: result.confirmed ? "confirmed" : "submitted",
        chain,
        tx_hash: result.tx_hash,
        explorer_url: result.explorer_url,
        canonical_record_type: "transaction",
        canonical_record_id: reservation.transaction.id,
        summary: `Sent ${amountText} USDC to ${resolvedRecipient.label}. TX ${
          shortHash(result.tx_hash)
        }.`,
        raw: result,
      };
    }

    const lamports = parseSolToLamports(payload.amount_sol ?? payload.amount);
    const amountSol = Number(lamports) / 1_000_000_000;
    const cap = Number(profile.max_auto_transfer_sol ?? 0);
    if (!Number.isFinite(cap) || cap <= 0) throw new Error("transfer_disabled");
    if (amountSol > cap) throw new Error("max_auto_transfer_sol_exceeded");
    const preflight = await estimateSolTransferBalancePreflight({
      from_address: wallet.address,
      recipient,
      amount_sol: amountSol,
    });
    if (preflight.balanceLamports < preflight.requiredLamports) {
      throw new Error("insufficient_sol");
    }

    const reservation = await reserveTransferTransaction(
      admin,
      idempotencyKey,
      {
        user_id: userId,
        action: "transfer",
        chain: "solana",
        input_mint: SOLANA_NATIVE_ASSET_ID,
        output_mint: recipient,
        amount_original: amountSol,
        amount_original_unit: "sol",
        amount_sol: amountSol,
        native_symbol: SOLANA_NATIVE_SYMBOL,
        wallet_id: wallet.id,
        wallet_address: wallet.address,
        source_surface: source,
        terminal_conversation_id: pending.terminal_conversation_id,
        terminal_message_id: pending.user_message_id,
        raw_request: {
          source,
          pending_action_id: pending.id,
          recipient,
          amount_lamports: lamports.toString(),
        },
      },
    );
    if (reservation.replay) {
      return transferReplayResult(
        reservation.transaction,
        chain,
        `Sent ${amountSol} SOL.`,
      );
    }

    let result: any;
    try {
      result = await transferSol({
        secret_key: wallet.secret_key,
        expected_from_address: wallet.address,
        recipient,
        amount_sol: amountSol,
      });
    } catch (error) {
      await markTransferOutcomeUncertain(admin, idempotencyKey, pending, error);
      throw new Error("transfer_status_uncertain");
    }
    await completeReservedTransfer(admin, idempotencyKey, {
      tx_hash: result.tx_hash,
      tx_signature: result.signature,
      explorer_url: result.explorer_url,
      status: result.confirmed ? "confirmed" : "submitted",
      raw_result: result,
      confirmed_at: result.confirmed ? new Date().toISOString() : null,
    });
    return {
      status: result.confirmed ? "confirmed" : "submitted",
      chain,
      tx_hash: result.tx_hash,
      explorer_url: result.explorer_url,
      canonical_record_type: "transaction",
      canonical_record_id: reservation.transaction.id,
      summary: `Sent ${amountSol} SOL. TX ${shortHash(result.tx_hash)}.`,
      raw: result,
    };
  }

  const [walletModule, chainModule, transferModule] = await Promise.all([
    import("./wallet.ts"),
    import("./robinhood_chain.ts"),
    import("./eth_transfer.ts"),
  ]);
  const { loadWallet } = walletModule;
  const { normalizeEvmAddress } = chainModule;
  const { estimateEthTransferBalancePreflight, transferEth } = transferModule;
  const wallet = await loadWallet(admin, userId);
  if (!wallet) throw new Error("no_evm_wallet");
  const recipient = normalizeEvmAddress(
    required(payload.recipient, "recipient"),
  );
  const amountEth = String(payload.amount_eth ?? payload.amount);
  const preflight = await estimateEthTransferBalancePreflight({
    from_address: wallet.address,
    recipient,
    amount_eth: amountEth,
  });
  if (preflight.balanceWei < preflight.requiredBalanceWei) {
    throw new Error("insufficient_eth");
  }

  const reservation = await reserveTransferTransaction(
    admin,
    idempotencyKey,
    {
      user_id: userId,
      action: "transfer",
      chain: "robinhood",
      input_mint: "native:eth",
      output_mint: recipient,
      amount_original: Number(amountEth),
      amount_original_unit: "eth",
      amount_eth: Number(amountEth),
      native_symbol: "ETH",
      wallet_id: wallet.id,
      wallet_address: wallet.address,
      source_surface: source,
      terminal_conversation_id: pending.terminal_conversation_id,
      terminal_message_id: pending.user_message_id,
      raw_request: {
        source,
        pending_action_id: pending.id,
        recipient,
        amount_eth: amountEth,
      },
    },
  );
  if (reservation.replay) {
    return transferReplayResult(
      reservation.transaction,
      chain,
      `Sent ${amountEth} ETH.`,
    );
  }

  let result: any;
  try {
    result = await transferEth({
      private_key_hex: wallet.private_key_hex,
      expected_from_address: wallet.address,
      recipient,
      amount_eth: amountEth,
    });
  } catch (error) {
    await markTransferOutcomeUncertain(admin, idempotencyKey, pending, error);
    throw new Error("transfer_status_uncertain");
  }
  await completeReservedTransfer(admin, idempotencyKey, {
    tx_hash: result.tx_hash,
    tx_signature: result.tx_hash,
    explorer_url: result.explorer_url,
    status: result.confirmed ? "confirmed" : "submitted",
    raw_result: result,
    confirmed_at: result.confirmed ? new Date().toISOString() : null,
  });
  return {
    status: result.confirmed ? "confirmed" : "submitted",
    chain,
    tx_hash: result.tx_hash,
    explorer_url: result.explorer_url,
    canonical_record_type: "transaction",
    canonical_record_id: reservation.transaction.id,
    summary: `Sent ${amountEth} ETH. TX ${shortHash(result.tx_hash)}.`,
    raw: result,
  };
}

async function reserveTransferTransaction(
  admin: any,
  idempotencyKey: string,
  row: Record<string, unknown>,
): Promise<{ transaction: any; replay: boolean }> {
  const existing = await admin
    .from("transactions")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (existing.data.tx_hash || existing.data.tx_signature) {
      return { transaction: existing.data, replay: true };
    }
    throw new Error("transfer_status_uncertain");
  }

  const inserted = await admin
    .from("transactions")
    .insert({
      ...row,
      status: "preparing",
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .maybeSingle();
  if (!inserted.error && inserted.data) {
    return { transaction: inserted.data, replay: false };
  }
  if (String(inserted.error?.code ?? "") === "23505") {
    const raced = await admin
      .from("transactions")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (raced.error) throw raced.error;
    if (raced.data?.tx_hash || raced.data?.tx_signature) {
      return { transaction: raced.data, replay: true };
    }
    throw new Error("transfer_status_uncertain");
  }
  throw inserted.error ?? new Error("transfer_reservation_failed");
}

async function completeReservedTransfer(
  admin: any,
  idempotencyKey: string,
  updates: Record<string, unknown>,
) {
  const result = await admin
    .from("transactions")
    .update(updates)
    .eq("idempotency_key", idempotencyKey);
  if (result.error) {
    console.error(JSON.stringify({
      event: "linkr_transfer_persistence_failed",
      idempotency_key: idempotencyKey,
      error: normalizeErrorCode(result.error?.message ?? "persistence_failed"),
    }));
  }
}

async function markTransferOutcomeUncertain(
  admin: any,
  idempotencyKey: string,
  pending: any,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    event: "linkr_transfer_outcome_uncertain",
    pending_action_id: pending.id,
    idempotency_key: idempotencyKey,
    error_code: normalizeErrorCode(message),
  }));
  await admin
    .from("transactions")
    .update({
      status: "reconciliation_required",
      error: "submission_outcome_unknown",
      raw_result: { submission_outcome: "uncertain" },
    })
    .eq("idempotency_key", idempotencyKey);
}

function transferReplayResult(transaction: any, chain: string, prefix: string) {
  const txHash = transaction.tx_hash ?? transaction.tx_signature;
  return {
    status: transaction.status ?? "submitted",
    chain,
    tx_hash: txHash,
    explorer_url: transaction.explorer_url ?? null,
    canonical_record_type: "transaction",
    canonical_record_id: transaction.id,
    summary: `${prefix} TX ${shortHash(txHash)}.`,
    raw: { ...transaction, idempotent_replay: true },
  };
}

async function executeStableSwap(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
  job: any,
) {
  const [
    web3,
    solanaChain,
    transferModule,
    usdcModule,
    swapConstants,
    swapExecute,
  ] = await Promise.all([
    import("https://esm.sh/@solana/web3.js@1.98.4?target=deno"),
    import("./solana_chain.ts"),
    import("./solana_transfer.ts"),
    import("./solana_usdc.ts"),
    import("./solana_swap/constants.ts"),
    import("./solana_swap/execute.ts"),
  ]);
  const { PublicKey } = web3;
  const { loadSolanaWallet, solanaConnection } = solanaChain;
  const { parseSolToLamports } = transferModule;
  const { getUsdcBalanceRaw, parseUsdcToRaw, SOLANA_USDC_MINT } = usdcModule;
  const { readSolanaSwapEnabled, solanaSwapFeeReserveLamports } = swapConstants;
  const { executeSolanaBuySwap, executeSolanaSellSwap } = swapExecute;
  if (!readSolanaSwapEnabled()) throw new Error("solana_swap_not_enabled");
  const profile = await currentSolanaRules(admin, userId);
  const slippageBps = Number(profile.default_slippage_bps ?? 0);
  if (
    !Number.isInteger(slippageBps) || slippageBps <= 0 || slippageBps > 3000
  ) {
    throw new Error("solana_swap_disabled_by_slippage_rule");
  }
  const priorityFeeLamports = Number(
    profile.solana_priority_fee_lamports ?? 1_000_000,
  );
  const wallet = await loadSolanaWallet(admin, userId);
  if (!wallet) throw new Error("no_solana_wallet");
  const direction = String(payload.direction ?? "").toLowerCase();
  const common = {
    userId,
    walletId: wallet.id,
    walletAddress: wallet.address,
    slippageBps,
    priorityFeeLamports,
    idempotencyKey: job.idempotency_key,
    sourceTweetId: `${sourceSurface(pending)}:${pending.id}`,
    sourceSurface: sourceSurface(pending),
  };
  let result: any;
  if (direction === "sol_to_usdc") {
    const inputLamports = parseSolToLamports(
      payload.amount_sol ?? payload.amount,
    );
    const amountSol = Number(inputLamports) / 1_000_000_000;
    const cap = Number(profile.max_auto_buy_sol ?? 0);
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new Error("solana_swap_disabled_by_buy_rule");
    }
    if (amountSol > cap) throw new Error("max_auto_buy_sol_exceeded");
    const balance = BigInt(
      await solanaConnection().getBalance(
        new PublicKey(wallet.address),
        "confirmed",
      ),
    );
    if (
      balance <
        inputLamports + solanaSwapFeeReserveLamports(priorityFeeLamports, true)
    ) {
      throw new Error("insufficient_sol");
    }
    result = await executeSolanaBuySwap(admin, {
      ...common,
      side: "buy",
      inputLamports: inputLamports.toString(),
      outputMint: SOLANA_USDC_MINT,
    });
  } else if (direction === "usdc_to_sol") {
    const inputRaw = parseUsdcToRaw(payload.amount_usdc ?? payload.amount);
    const balanceRaw = await getUsdcBalanceRaw(wallet.address);
    if (inputRaw > balanceRaw) throw new Error("insufficient_usdc");
    const percent = balanceRaw > 0n
      ? Number((inputRaw * 1_000_000n) / balanceRaw) / 10_000
      : 0;
    const cap = Number(profile.max_auto_sell_percent ?? 0);
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new Error("solana_swap_disabled_by_sell_rule");
    }
    if (percent > cap) throw new Error("max_auto_sell_percent_exceeded");
    const solBalance = BigInt(
      await solanaConnection().getBalance(
        new PublicKey(wallet.address),
        "confirmed",
      ),
    );
    if (
      solBalance < solanaSwapFeeReserveLamports(priorityFeeLamports, false)
    ) {
      throw new Error("insufficient_sol_for_swap_fee");
    }
    result = await executeSolanaSellSwap(admin, {
      ...common,
      side: "sell",
      inputMint: SOLANA_USDC_MINT,
      inputTokenAmount: inputRaw.toString(),
    });
  } else {
    throw new Error("invalid_swap_direction");
  }
  await markSurfaceTransaction(admin, job.idempotency_key, pending);
  return {
    status: result.status,
    chain: "solana",
    tx_hash: result.txHash,
    explorer_url: result.explorerUrl,
    summary: `Swapped ${
      direction === "sol_to_usdc" ? "SOL to USDC" : "USDC to SOL"
    }. TX ${shortHash(result.txHash)}.`,
    raw: result,
  };
}

async function currentSolanaRules(admin: any, userId: string): Promise<any> {
  const { data, error } = await admin
    .from("profiles")
    .select(
      "default_slippage_bps,max_auto_buy_sol,max_auto_sell_percent,max_auto_transfer_sol,max_auto_transfer_usdc,solana_priority_fee_lamports",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("profile_not_found");
  return data;
}

async function executeLiquidity(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
  actionType: string,
) {
  const { isLiquidityEnabled } = await import(
    "./robinhood_liquidity/constants.ts"
  );
  if (!isLiquidityEnabled()) throw new Error("liquidity_not_enabled");
  const chain = normalizeChain(
    payload.chain,
    payload.token ?? payload.token_mint ?? payload.position_id,
  );
  const body = { ...payload, risk_acknowledged: true, dry_run: false };
  let quote: any;
  if (chain === "solana") {
    const pump = await import("./pump_liquidity/actions.ts");
    if (actionType === "add_liquidity") {
      quote = await pump.quotePumpAddLiquidity(admin, userId, body);
    } else if (actionType === "remove_liquidity") {
      quote = await pump.quotePumpRemoveLiquidity(admin, userId, body);
    } else {
      throw new Error("collect_liquidity_fees_not_supported_on_solana");
    }
  } else {
    const quotes = await import("./robinhood_liquidity/quote.ts");
    quote = actionType === "add_liquidity"
      ? await quotes.quoteAddLiquidity(admin, userId, body)
      : actionType === "remove_liquidity"
      ? await quotes.quoteRemoveLiquidity(admin, userId, body)
      : await quotes.quoteCollectFees(admin, userId, body);
  }
  const idempotencyKey = `${sourceSurface(pending)}-liquidity:${pending.id}`;
  const existing = await admin
    .from("liquidity_actions")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const action = existing.data ??
    (await insertLiquidityAction(
      admin,
      userId,
      pending,
      actionType,
      chain,
      quote,
      idempotencyKey,
    ));
  const { executeLiquidityAction } = await import(
    "./robinhood_liquidity/actions.ts"
  );
  const result: any = await executeLiquidityAction(admin, action);
  return {
    status: "completed",
    chain,
    tx_hash: result?.tx_hash ?? result?.txHash ?? action?.tx_hash ?? null,
    explorer_url: result?.explorer_url ?? null,
    canonical_record_type: "liquidity_action",
    canonical_record_id: action.id,
    summary: `${labelAction(actionType)} completed${
      result?.tx_hash ? `: ${shortHash(result.tx_hash)}` : "."
    }`,
    raw: result,
  };
}

async function executeCreatorRewardsClaim(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
) {
  const { claimCreatorRewards, creatorRewardsClaimReply } = await import(
    "./creator_rewards_claim.ts"
  );
  const result = await claimCreatorRewards(admin, userId, payload, {
    source: pending.surface ?? "terminal",
    pendingActionId: pending.id,
    terminalConversationId: pending.terminal_conversation_id ?? null,
    terminalMessageId: pending.user_message_id ?? null,
    idempotencyPrefix: `${sourceSurface(pending)}-creator-rewards`,
    idempotencyKey: `pending:${pending.id}`,
  });
  return {
    status: result.status ?? "confirmed",
    chain: result.chain,
    tx_hash: result.tx_hash,
    explorer_url: result.explorer_url,
    canonical_record_type: "transaction",
    canonical_record_id: null,
    summary: creatorRewardsClaimReply(result).replace(
      /\n\nView full history in Linkr\.\n\nTX: /,
      " TX ",
    ),
    raw: result,
  };
}

async function insertLiquidityAction(
  admin: any,
  userId: string,
  pending: any,
  actionType: string,
  chain: string,
  quote: any,
  idempotencyKey: string,
) {
  const { data, error } = await admin
    .from("liquidity_actions")
    .insert({
      user_id: userId,
      action: actionType,
      status: "queued",
      chain,
      platform: chain === "solana" ? "pump_swap" : "robinhood_uniswap_v3",
      wallet_id: quote.wallet_id ?? null,
      native_symbol: chain === "solana" ? "SOL" : "ETH",
      wallet_address: quote.wallet_address,
      token_address: quote.token_address ?? quote.token_mint,
      token_mint: quote.token_mint ?? null,
      token_symbol: quote.token_symbol,
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
      requested_percent: quote.requested_percent ?? null,
      liquidity_delta: quote.liquidity_delta ?? quote.lp_token_amount ?? "0",
      simulation: quote,
      pending_action_id: pending.id,
      idempotency_key: idempotencyKey,
      source_surface: sourceSurface(pending),
      terminal_conversation_id: pending.terminal_conversation_id,
      terminal_message_id: pending.user_message_id,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function queueLaunch(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
) {
  const [subsidyModule, policyModule, mediaModule] = await Promise.all([
    import("./first_launch_subsidy.ts"),
    import("./launch_execution_policy.ts"),
    import("./bounded_media.ts"),
  ]);
  const { isFirstLaunchSubsidyEligible } = subsidyModule;
  const { zeroLaunchDevBuy } = policyModule;
  const { rehostLaunchImageUrl } = mediaModule;
  const chain = normalizeChain(payload.chain, payload.token);
  const firstLaunchSubsidyEligible = await isFirstLaunchSubsidyEligible(
    admin,
    userId,
    { chain },
  );
  const effectivePayload = firstLaunchSubsidyEligible
    ? zeroLaunchDevBuy(payload ?? {}, chain)
    : payload;
  const source = sourceSurface(pending);
  const wallet = chain === "solana"
    ? await (await import("./solana_chain.ts")).loadSolanaWallet(admin, userId)
    : await (await import("./wallet.ts")).loadWallet(admin, userId);
  if (!wallet) {
    throw new Error(chain === "solana" ? "no_solana_wallet" : "no_evm_wallet");
  }
  const launchId = crypto.randomUUID();
  const creatorRewardsConfig = chain === "solana"
    ? await (await import("./pump_creator_rewards.ts"))
      .resolvePumpCreatorRewardsConfig(
        admin,
        {
          body: effectivePayload,
          creatorWalletAddress: wallet.address,
          creatorWalletId: wallet.id,
          source,
          text: effectivePayload.raw_user_text ?? null,
          userId,
        },
      )
    : null;
  const symbol = String(required(effectivePayload.symbol, "symbol"))
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  if (!symbol) throw new Error("symbol_required");
  // External image URLs are re-hosted into trusted storage so the
  // media-capture worker's strict host allowlist can always fetch them.
  const hostedImageUrl = await rehostLaunchImageUrl(
    admin,
    String(required(effectivePayload.image_url, "image_url")),
  );
  const launchPayload: Record<string, unknown> = {
    name: required(effectivePayload.name, "name"),
    symbol,
    description: required(effectivePayload.description, "description"),
    image_url: hostedImageUrl,
    original_image_url: effectivePayload.image_url,
    chain,
    creator_rewards_config: creatorRewardsConfig,
    source_surface: source,
    source_tweet_url: effectivePayload.source_url ?? null,
    first_launch_subsidy_eligible: firstLaunchSubsidyEligible,
    first_launch_dev_buy_forced_zero: firstLaunchSubsidyEligible,
  };
  if (chain === "solana") {
    launchPayload.initial_buy_sol = Number(
      effectivePayload.initial_buy_sol ?? 0,
    );
  } else {
    const { ethers } = await import("https://esm.sh/ethers@6");
    const initialWei = ethers.parseEther(
      String(effectivePayload.initial_buy_eth ?? 0),
    );
    launchPayload.initial_buy_eth = Number(ethers.formatEther(initialWei));
  }
  const accepted = await admin.rpc("accept_linkr_launch_request_v1", {
    p_user_id: userId,
    p_source_surface: source,
    p_source_event_id: pending.id,
    p_idempotency_key: pending.id,
    p_chain: chain,
    p_wallet_id: wallet.id,
    p_payload: launchPayload,
    p_pending_action_id: pending.id,
  });
  if (accepted.error) throw accepted.error;
  return {
    status: "queued",
    awaiting_receipt: true,
    chain,
    canonical_record_type: "work_item",
    canonical_record_id: accepted.data?.work_item_id ?? launchId,
    summary: [
      `Launch queued for $${symbol}. I will track it from here.`,
      creatorRewardsConfig
        ? (await import("./pump_creator_rewards.ts")).pumpCreatorRewardsSummary(
          creatorRewardsConfig,
        )
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    raw: accepted.data,
  };
}

async function queueScheduledAction(
  admin: any,
  userId: string,
  payload: any,
  pending: any,
) {
  const actionType = String(payload?.action_type ?? "").trim();
  const trigger = payload?.trigger ?? payload?.trigger_payload ?? null;
  const chain = payload?.chain === "solana" ? "solana" : "robinhood";
  if (!actionType || !trigger?.trigger_type) {
    throw new Error("scheduled_action_payload_incomplete");
  }
  if (
    trigger.trigger_type === "market_cap" &&
    actionType !== "buy" &&
    actionType !== "sell"
  ) {
    throw new Error("market_cap_action_unsupported");
  }
  const source = sourceSurface(pending);
  const sourceTweetId = source === "x"
    ? String(pending.surface_conversation_id ?? "").trim() || null
    : null;
  const idempotencyKey = `pending-schedule:${pending.id}`;
  const row = {
    user_id: userId,
    source,
    source_surface: source,
    source_tweet_id: sourceTweetId,
    source_tweet_url: sourceTweetId
      ? `https://x.com/i/web/status/${sourceTweetId}`
      : null,
    pending_action_id: pending.id,
    action_type: actionType,
    trigger_type: trigger.trigger_type,
    chain,
    status: "pending",
    token_address: payload.token_address ?? payload.token ?? null,
    token_symbol: payload.symbol ?? null,
    recipient: payload.recipient ?? null,
    amount_original: payload.amount_original ?? payload.amount ?? null,
    amount_original_unit: payload.amount_original_unit ?? null,
    amount_eth: payload.amount_eth ?? payload.initial_buy_eth ?? null,
    amount_sol: payload.amount_sol ?? payload.initial_buy_sol ?? null,
    amount_usd: payload.amount_usd ?? null,
    amount_pct: payload.amount_pct ?? payload.percent ?? null,
    amount_all: payload.amount_all === true,
    slippage_bps: payload.slippage_bps ?? null,
    scheduled_for: trigger.trigger_type === "time"
      ? trigger.scheduled_for
      : null,
    trigger_metric: trigger.trigger_type === "market_cap"
      ? trigger.trigger_metric
      : null,
    trigger_direction: trigger.trigger_type === "market_cap"
      ? trigger.trigger_direction
      : null,
    trigger_value_usd: trigger.trigger_type === "market_cap"
      ? trigger.trigger_value_usd
      : null,
    next_check_at: trigger.trigger_type === "market_cap"
      ? trigger.next_check_at
      : null,
    schedule_kind: payload.schedule_kind ?? "one_time",
    interval_seconds: payload.interval_seconds ?? null,
    idempotency_key: idempotencyKey,
    action_payload: {
      ...payload,
      trigger: undefined,
      trigger_payload: undefined,
    },
    trigger_payload: {
      ...trigger,
      schedule_kind: payload.schedule_kind ?? "one_time",
      interval_seconds: payload.interval_seconds ?? null,
    },
  };
  const inserted = await admin.from("scheduled_actions").insert(row).select("*")
    .maybeSingle();
  let schedule = inserted.data;
  if (inserted.error) {
    if (!isUniqueViolation(inserted.error)) throw inserted.error;
    const existing = await admin
      .from("scheduled_actions")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    schedule = existing.data;
  }
  if (!schedule) throw new Error("scheduled_action_create_failed");
  return {
    status: "scheduled",
    summary: formatScheduledQueuedReply({
      actionType: actionType as any,
      chain,
      trigger,
    }),
    chain,
    canonical_record_type: "scheduled_actions",
    canonical_record_id: schedule.id,
    schedule_id: schedule.id,
    scheduled_action: schedule,
  };
}

async function writeReceipt(admin: any, pending: any, job: any, result: any) {
  const row = {
    user_id: pending.user_id,
    surface: pending.surface,
    source_surface: sourceSurface(pending),
    surface_conversation_id: pending.surface_conversation_id,
    terminal_conversation_id: pending.terminal_conversation_id,
    x_thread_id: pending.x_thread_id,
    cron_job_id: pending.cron_job_id,
    job_id: job.id,
    pending_action_id: pending.id,
    receipt_type: pending.action_type,
    status: result.status ?? "completed",
    summary: result.summary ?? "Action completed.",
    chain: result.chain ?? pending.action_payload?.chain ?? null,
    tx_hash: result.tx_hash ?? null,
    explorer_url: result.explorer_url ?? null,
    canonical_record_type: result.canonical_record_type ?? null,
    canonical_record_id: result.canonical_record_id ?? null,
    payload: result,
  };
  const { data, error } = await admin
    .from("linkr_action_receipts")
    .insert(row)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function markSurfaceTransaction(
  admin: any,
  idempotencyKey: string,
  pending: any,
) {
  await admin
    .from("transactions")
    .update({
      source_surface: sourceSurface(pending),
      terminal_conversation_id: pending.terminal_conversation_id,
      terminal_message_id: pending.user_message_id,
    })
    .eq("idempotency_key", idempotencyKey)
    .eq("user_id", pending.user_id);
}

function sourceSurface(pending: any): string {
  const value = String(pending?.surface ?? "")
    .trim()
    .toLowerCase();
  return value || "terminal";
}

function isUniqueViolation(error: any): boolean {
  return (
    error?.code === "23505" ||
    /duplicate key|already exists|unique/i.test(
      String(error?.message ?? error ?? ""),
    )
  );
}

async function loadPending(admin: any, userId: string, id: string) {
  const { data, error } = await admin
    .from("linkr_pending_actions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function insertOrSelect(
  admin: any,
  table: string,
  row: Record<string, unknown>,
  keyColumn: string,
  keyValue: string,
) {
  const inserted = await admin.from(table).insert(row).select("*")
    .maybeSingle();
  if (!inserted.error) return { ...inserted, inserted: true };
  const code = String(inserted.error?.code ?? "");
  const message = String(inserted.error?.message ?? "");
  if (code !== "23505" && !/duplicate key|unique/i.test(message)) {
    return { ...inserted, inserted: false };
  }
  const existing = await admin.from(table).select("*").eq(keyColumn, keyValue)
    .maybeSingle();
  return { ...existing, inserted: false };
}

function normalizeChain(
  value: unknown,
  tokenHint?: unknown,
): "robinhood" | "solana" {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["sol", "solana", "pump", "pump.fun", "pump_swap"].includes(raw)) {
    return "solana";
  }
  if (["eth", "evm", "robinhood", "robinhood_chain", "rhood"].includes(raw)) {
    return "robinhood";
  }
  const token = String(tokenHint ?? "");
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) && !/^0x/i.test(token)) {
    return "solana";
  }
  return "robinhood";
}

function normalizeSlippage(value: unknown): number {
  const n = Math.floor(Number(value ?? 100));
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : 100;
}

function required(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("missing_" + field);
  return text;
}

function normalizeErrorCode(message: string) {
  return (
    message
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "action_failed"
  );
}

function userMessageForError(message: string) {
  if (
    /transfer_status_uncertain|submission_outcome_unknown|reconcil/i.test(
      message,
    )
  ) {
    return "The transaction outcome is not confirmed yet. Linkr has blocked duplicate execution and marked it for reconciliation.";
  }
  if (/evm_token_burn_not_supported/i.test(message)) {
    return "That token does not support the standard holder burn function. No substitute transaction was sent.";
  }
  if (/burn_.*simulation|token_burn_tx/i.test(message)) {
    return "The burn failed its final chain check or transaction confirmation. No second burn will be attempted from this confirmation.";
  }
  if (/insufficient/i.test(message)) {
    return "The action could not run because the wallet balance is too low.";
  }
  if (/missing_/i.test(message)) {
    return "The action is missing a required field.";
  }
  if (/not_enabled|disabled/i.test(message)) {
    return "That action is not enabled right now.";
  }
  if (/no_.*wallet/i.test(message)) {
    return "I could not find the required Linkr wallet for this action.";
  }
  return "The action failed before completion. Nothing else will be attempted from this confirmation.";
}

function shortHash(value: string | null | undefined) {
  if (!value) return "";
  return value.length > 12
    ? `${value.slice(0, 6)}...${value.slice(-4)}`
    : value;
}

function labelAction(value: string) {
  return value.replace(/_/g, " ");
}
