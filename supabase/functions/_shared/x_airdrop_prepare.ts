// AI-driven X holder-airdrop preparation and confirmation handoff.
// deno-lint-ignore-file no-explicit-any
import { prepareHolderAirdropSnapshot } from "./holder_airdrop_snapshot.ts";
import { classifyXAirdropIntent, type XAirdropIntent } from "./x_airdrop.ts";

const LAUNCH_SELECT =
  "id,user_id,name,symbol,mint,token_address,status,chain,solana_launch_wallet_id,launch_signer_wallet_id";

export type XAirdropPrepareOutcome = {
  replyKind: string;
  replyText: string;
  state: string;
  resultRef: string;
};

export async function prepareXAirdropXFlow(args: {
  admin: any;
  userId: string;
  workItem: any;
  tweet: {
    tweet_id: string;
    conversation_id?: string | null;
    text?: string | null;
  };
  pendingActions: any[];
  classifyIntent?: (text: string) => Promise<XAirdropIntent>;
  prepareSnapshot?: typeof prepareHolderAirdropSnapshot;
  checkAdmission?: (
    admin: any,
    userId: string,
    workItemId: string,
  ) => Promise<boolean>;
}): Promise<XAirdropPrepareOutcome | null> {
  const intent = await (args.classifyIntent ?? classifyXAirdropIntent)(
    String(args.tweet.text ?? ""),
  );
  const pending = args.pendingActions.filter((item) =>
    item?.action_type === "holder_airdrop"
  );

  if (intent.kind === "confirm") {
    if (
      !(await (args.checkAdmission ?? isHolderAirdropStageAdmitted)(
        args.admin,
        args.userId,
        args.workItem.id,
      ))
    ) {
      return {
        replyKind: "airdrop_not_enabled",
        replyText:
          "Holder airdrops are not enabled for your account yet. Nothing was signed or submitted.",
        state: "succeeded",
        resultRef: "holder-airdrop-disabled",
      };
    }
    if (pending.length !== 1) {
      return clarification(
        "airdrop-confirmation-missing",
        "Which pending holder airdrop should I confirm?",
      );
    }
    const confirmed = await args.admin.rpc("confirm_linkr_holder_airdrop_v1", {
      p_pending_action_id: pending[0].id,
      p_confirmation_work_item_id: args.workItem.id,
    });
    if (confirmed.error) throw confirmed.error;
    return {
      replyKind: confirmed.data?.expired
        ? "airdrop_confirmation_expired"
        : "airdrop_confirmation_ack",
      replyText: confirmed.data?.expired
        ? "That holder-airdrop approval expired. Nothing was signed or submitted."
        : "Holder airdrop approved and queued for the dedicated Solana worker.",
      state: "succeeded",
      resultRef: `holder-airdrop-confirmation:${pending[0].id}`,
    };
  }
  if (intent.kind === "cancel") {
    if (pending.length !== 1) {
      return clarification(
        "airdrop-cancellation-missing",
        "Which pending holder airdrop should I cancel?",
      );
    }
    const cancelled = await args.admin.rpc("cancel_linkr_holder_airdrop_v1", {
      p_pending_action_id: pending[0].id,
      p_cancellation_work_item_id: args.workItem.id,
    });
    if (cancelled.error) throw cancelled.error;
    return {
      replyKind: "airdrop_cancelled",
      replyText: "Holder airdrop cancelled. Nothing was signed or submitted.",
      state: "succeeded",
      resultRef: `holder-airdrop-cancelled:${pending[0].id}`,
    };
  }
  if (intent.kind !== "airdrop") return null;
  if (intent.clarification || !intent.token || !intent.amount) {
    return clarification(
      "airdrop_clarification",
      intent.clarification ??
        "Which Linkr token and exact amount or percentage should I prepare for the holder airdrop?",
    );
  }
  if (
    !(await (args.checkAdmission ?? isHolderAirdropStageAdmitted)(
      args.admin,
      args.userId,
      args.workItem.id,
    ))
  ) {
    return {
      replyKind: "airdrop_not_enabled",
      replyText:
        "Holder airdrops are not enabled for your account yet. Nothing was prepared or queued.",
      state: "succeeded",
      resultRef: "holder-airdrop-disabled",
    };
  }
  const existing = await loadExistingHolderAirdropForTweet(
    args.admin,
    args.userId,
    args.tweet.tweet_id,
  );
  if (existing) return preparedReply(existing);

  const launch = await resolveOwnedCompletedSolanaLaunch(
    args.admin,
    args.userId,
    intent.token,
  );
  if (launch.kind !== "resolved") {
    return clarification(
      "airdrop_token_clarification",
      launch.kind === "ambiguous"
        ? `I found multiple completed Linkr launches matching ${intent.token}. Reply with the canonical mint.`
        : "I can only prepare a holder airdrop for a completed Solana token you launched through Linkr. Which canonical mint did you mean?",
    );
  }
  const walletId = String(
    launch.value.solana_launch_wallet_id ??
      launch.value.launch_signer_wallet_id ?? "",
  );
  if (!walletId) {
    return clarification(
      "airdrop_wallet_missing",
      "That launch has no canonical Solana launch wallet recorded.",
    );
  }
  const walletResult = await args.admin.from("wallets").select(
    "id,address,public_key,user_id,wallet_type",
  )
    .eq("id", walletId).eq("user_id", args.userId).eq("wallet_type", "solana")
    .maybeSingle();
  if (walletResult.error) throw walletResult.error;
  const walletAddress = String(
    walletResult.data?.address ?? walletResult.data?.public_key ?? "",
  ).trim();
  if (!walletAddress) {
    return clarification(
      "airdrop_wallet_missing",
      "That launch wallet is not available for holder-airdrop preparation.",
    );
  }

  let prepared;
  try {
    prepared = await (args.prepareSnapshot ?? prepareHolderAirdropSnapshot)({
      mint: launch.value.mint,
      developerWallet: walletAddress,
      requestedAmount: intent.amount,
    });
  } catch (error) {
    const code = String((error as Error)?.message ?? error);
    if (code === "holder_airdrop_insufficient_token_balance") {
      return clarification(
        "airdrop_insufficient_token_balance",
        "The launch wallet does not currently hold enough of that token. What smaller total should I prepare?",
      );
    }
    if (code === "holder_airdrop_source_account_consolidation_required") {
      return clarification(
        "airdrop_source_account_consolidation_required",
        "Your token balance is split across token accounts. Consolidate enough of that mint into one launch-wallet token account, then ask again.",
      );
    }
    if (code === "airdrop_eligible_holders_not_found") {
      return clarification(
        "airdrop_no_eligible_holders",
        "There are no eligible holders after excluding the launch wallet and largest remaining owner.",
      );
    }
    if (code === "airdrop_amount_too_small_for_all_holders") {
      return clarification(
        "airdrop_amount_too_small",
        "That total is too small to allocate any raw units across the eligible holder set. What larger total should I use?",
      );
    }
    if (/airdrop_amount/.test(code)) {
      return clarification(
        "airdrop_amount_invalid",
        "What exact token amount or percentage of your current token balance should I prepare?",
      );
    }
    throw error;
  }

  const persisted = await args.admin.rpc("prepare_linkr_holder_airdrop_v1", {
    p_input_work_item_id: args.workItem.id,
    p_user_id: args.userId,
    p_tweet_id: args.tweet.tweet_id,
    p_surface_conversation_id: args.tweet.conversation_id ?? null,
    p_launch_id: launch.value.id,
    p_mint: prepared.mint,
    p_wallet_id: walletId,
    p_wallet_address: walletAddress,
    p_source_token_account: prepared.sourceTokenAccount,
    p_token_decimals: prepared.decimals,
    p_source_balance_raw: prepared.sourceBalanceRaw.toString(),
    p_requested_raw: prepared.requestedRaw.toString(),
    p_allocated_raw: prepared.allocatedRaw.toString(),
    p_dust_raw: prepared.dustRaw.toString(),
    p_holder_account_count: prepared.aggregatedHolderCount,
    p_snapshot_slot: prepared.snapshot.slot,
    p_snapshot_provider: prepared.snapshot.provider,
    p_snapshot_fetched_at: prepared.snapshot.fetchedAt,
    p_excluded_dev_wallet: walletAddress,
    p_excluded_largest_owner: prepared.excludedLargestOwner,
    p_snapshot_provenance: {
      provider: prepared.snapshot.provider,
      slot: prepared.snapshot.slot,
      fetched_at: prepared.snapshot.fetchedAt,
      page_count: prepared.snapshot.pageCount,
      page_cursors: prepared.snapshot.pageCursors,
      checksum: prepared.snapshot.checksum,
      raw_account_count: prepared.snapshot.accounts.length,
      aggregated_holder_count: prepared.aggregatedHolderCount,
    },
    p_recipients: prepared.allocations.map((row, index) => ({
      ordinal: index + 1,
      owner: row.owner,
      holder_balance_raw: row.amount.toString(),
      allocation_raw: row.allocation.toString(),
    })),
  });
  if (persisted.error) throw persisted.error;
  return preparedReply(
    persisted.data ?? {
      recipient_count: prepared.allocations.length,
      allocated_raw: prepared.allocatedRaw.toString(),
      dust_raw: prepared.dustRaw.toString(),
      airdrop_id: "prepared",
    },
  );
}

function preparedReply(persistedSummary: any): XAirdropPrepareOutcome {
  return {
    replyKind: "airdrop_confirmation_required",
    replyText: `Prepared an immutable snapshot for ${
      String(persistedSummary.recipient_count ?? "0")
    } eligible holders. Total allocated: ${
      String(persistedSummary.allocated_raw ?? "0")
    } raw units; retained dust: ${
      String(persistedSummary.dust_raw ?? "0")
    }. Reply to confirm the holder airdrop.`,
    state: "waiting_user_confirmation",
    resultRef: `holder-airdrop:${persistedSummary.airdrop_id ?? "prepared"}`,
  };
}

export async function isHolderAirdropStageAdmitted(
  admin: any,
  userId: string,
  workItemId: string,
): Promise<boolean> {
  const result = await admin.from("linkr_queue_runtime_config").select(
    "enabled,rollout_percent,canary_user_ids",
  ).eq("stage", "holder_airdrop_solana").maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (!row || row.enabled !== true) return false;
  const canaries = Array.isArray(row.canary_user_ids)
    ? row.canary_user_ids.map((value: unknown) => String(value))
    : [];
  if (canaries.includes(userId)) return true;
  const rollout = Number(row.rollout_percent ?? 0);
  if (!Number.isFinite(rollout) || rollout <= 0) return false;
  if (rollout >= 100) return true;
  return (await rolloutBucket(
    `${workItemId}:${userId}:holder_airdrop_solana`,
  )) <
    Math.floor(rollout);
}

async function loadExistingHolderAirdropForTweet(
  admin: any,
  userId: string,
  tweetId: string,
): Promise<any | null> {
  const result = await admin.from("linkr_holder_airdrops").select(
    "id,pending_action_id,recipient_count,allocated_raw,dust_raw,requested_raw,snapshot_slot,snapshot_provider,snapshot_fetched_at,snapshot_checksum,excluded_largest_owner",
  ).eq("idempotency_key", `x-holder-airdrop:${tweetId}`).eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (!row) return null;
  return {
    airdrop_id: row.id,
    pending_action_id: row.pending_action_id,
    duplicate: true,
    recipient_count: row.recipient_count,
    allocated_raw: String(row.allocated_raw),
    dust_raw: String(row.dust_raw),
    requested_raw: String(row.requested_raw),
    snapshot_slot: row.snapshot_slot,
    snapshot_provider: row.snapshot_provider,
    snapshot_fetched_at: row.snapshot_fetched_at,
    snapshot_checksum: row.snapshot_checksum,
    excluded_largest_owner: row.excluded_largest_owner,
  };
}

async function rolloutBucket(value: string): Promise<number> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new DataView(digest).getUint32(0, false) % 100;
}

export async function resolveOwnedCompletedSolanaLaunch(
  admin: any,
  userId: string,
  query: string,
): Promise<
  { kind: "resolved"; value: any } | { kind: "ambiguous" | "not_found" }
> {
  const needle = query.trim().replace(/^\$/, "");
  if (looksLikeSolanaMint(needle)) {
    const exact = await admin.from("coin_launches").select(LAUNCH_SELECT)
      .eq("user_id", userId).eq("chain", "solana").eq("status", "confirmed")
      .eq("mint", needle).maybeSingle();
    if (exact.error) throw exact.error;
    const row = exact.data;
    if (row && isCanonicalMintLaunch(row)) {
      return { kind: "resolved", value: row };
    }
    return { kind: "not_found" };
  }

  const result = await admin.from("coin_launches").select(LAUNCH_SELECT)
    .eq("user_id", userId).eq("chain", "solana").eq("status", "confirmed")
    .not("mint", "is", null).order("created_at", { ascending: false }).limit(
      100,
    );
  if (result.error) throw result.error;
  const normalizedNeedle = needle.toLowerCase();
  const matches = (result.data ?? []).filter((row: any) => {
    if (!isCanonicalMintLaunch(row)) return false;
    return [row.mint, row.symbol, row.name].some((value) =>
      String(value ?? "").trim().replace(/^\$/, "").toLowerCase() ===
        normalizedNeedle
    );
  });
  if (!matches.length) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "resolved", value: matches[0] };
}

function isCanonicalMintLaunch(row: any): boolean {
  const mint = String(row?.mint ?? "").trim();
  return !!mint && (!row?.token_address || String(row.token_address) === mint);
}

function looksLikeSolanaMint(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function clarification(
  replyKind: string,
  replyText: string,
): XAirdropPrepareOutcome {
  return {
    replyKind,
    replyText: replyText.slice(0, 260),
    state: "waiting_user_input",
    resultRef: replyKind,
  };
}
