// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  feeSharingConfigPda,
  OnlinePumpSdk,
  PUMP_SDK,
} from "https://esm.sh/@pump-fun/pump-sdk@1.36.0?bundle&target=deno";
import { internalErrorResponse, readJsonBody } from "../_shared/http.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  getSolanaTxExplorerUrl,
  loadSolanaWalletById,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
} from "../_shared/robinhood_chain.ts";
import {
  LAUNCH_LOCKER_ABI,
  SINGLE_SIDED_LAUNCH_FACTORY_ABI,
} from "../_shared/robinhood_launch/abi.ts";
import {
  readLaunchFactoryAddress,
  readLaunchLockerAddress,
  ROBINHOOD_WETH_ADDRESS,
} from "../_shared/robinhood_launch/constants.ts";
import { robinhoodProvider } from "../_shared/robinhood_launch/launch.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { loadWallet, loadWalletById } from "../_shared/wallet.ts";
import {
  claimCreatorRewards,
  creatorRewardsErrorStatus,
} from "../_shared/creator_rewards_claim.ts";

type Chain = "robinhood" | "solana";

type RewardAmount = {
  base_units: string;
  amount: string;
  symbol: string;
};

const MAX_EARNINGS_LAUNCHES = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const userId = await getCallerUserId(req);
    if (!userId) {
      return jsonResponse({ error: "unauthorized" }, { status: 401 });
    }

    const admin = serviceClient();
    if (req.method === "GET") {
      return jsonResponse(await listEarnings(admin, userId), {
        headers: { "Cache-Control": "private, max-age=10" },
      });
    }

    const body = await readJsonBody(req, 32 * 1024) as any;
    return jsonResponse(
      await claimCreatorRewards(admin, userId, body, {
        source: "dashboard",
        idempotencyPrefix: "web-creator-rewards",
        idempotencyKey: body.idempotency_key ??
          req.headers.get("idempotency-key"),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = creatorRewardsErrorStatus(message);
    if (status >= 500) {
      return internalErrorResponse(error, {
        function: "creator-rewards-earnings",
      });
    }
    return jsonResponse({ error: message }, { status });
  }
});

async function listEarnings(admin: any, userId: string) {
  const [
    { data: owned, error: launchError },
    { data: shares, error: shareError },
  ] = await Promise.all([
    admin
      .from("coin_launches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_EARNINGS_LAUNCHES),
    admin
      .from("coin_launch_reward_recipients")
      .select("launch_id,wallet_id,wallet_address,share_bps,source")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_EARNINGS_LAUNCHES),
  ]);
  if (launchError) throw launchError;
  if (shareError) throw shareError;

  const shareByLaunch = new Map<string, any>(
    (shares ?? []).map((share: any) => [share.launch_id, share]),
  );
  const sharedIds = [...shareByLaunch.keys()];
  let shared: any[] = [];
  if (sharedIds.length > 0) {
    const { data, error } = await admin
      .from("coin_launches")
      .select("*")
      .in("id", sharedIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    shared = data ?? [];
  }

  const launchById = new Map<string, any>();
  for (const launch of [...(owned ?? []), ...shared]) {
    launchById.set(launch.id, launch);
  }
  const launches = [...launchById.values()]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, MAX_EARNINGS_LAUNCHES);

  const claimRows = await loadClaimTransactions(admin, userId);
  const items = await Promise.all(
    (launches ?? []).map(async (launch: any) => {
      const chain = launchChain(launch);
      const address = launchAddress(launch, chain);
      const share = launch.user_id === userId
        ? null
        : shareByLaunch.get(launch.id) ?? null;
      const claimed = claimedForLaunch(claimRows, chain, address);
      const snapshot = address
        ? await safe<any>(
          () =>
            chain === "solana"
              ? solanaSnapshot(launch, share?.wallet_address)
              : robinhoodSnapshot(launch),
          null,
        )
        : null;
      return earningItem(launch, chain, address, snapshot, claimed, share);
    }),
  );

  const filteredItems = items.filter((item) => item.token_address || item.mint);
  return {
    items: filteredItems,
    summary: buildSummary(filteredItems),
    timeline: buildTimeline(claimRows),
  };
}

async function claimLaunchRewards(
  admin: any,
  userId: string,
  req: Request,
  body: any,
) {
  const launch = await loadUserLaunch(admin, userId, body);
  const chain = launchChain(launch);
  const idempotencyKey = normalizeIdempotencyKey(
    body.idempotency_key ?? req.headers.get("idempotency-key"),
    userId,
    launch.id,
  );

  const { data: existing, error: existingError } = await admin
    .from("transactions")
    .select("status,tx_hash,tx_signature,raw_result")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.raw_result) {
    return { ...existing.raw_result, idempotent_replay: true };
  }

  return chain === "solana"
    ? await claimSolanaLaunchRewards(admin, userId, launch, idempotencyKey)
    : await claimRobinhoodLaunchRewards(admin, userId, launch, idempotencyKey);
}

async function loadUserLaunch(admin: any, userId: string, body: any) {
  const launchId = cleanString(body.launch_id ?? body.launchId);
  const token = cleanString(
    body.token_address ?? body.tokenAddress ?? body.mint,
  );
  let query = admin.from("coin_launches").select("*").eq("user_id", userId)
    .limit(1);
  if (launchId) {
    query = query.eq("id", launchId);
  } else if (token) {
    query = query.or(`token_address.ilike.${token},mint.ilike.${token}`);
  } else {
    throw new Error("missing_launch_id");
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("launch_not_found");
  const address = launchAddress(data, launchChain(data));
  if (!address) throw new Error("launch_token_not_confirmed");
  return data;
}

async function claimRobinhoodLaunchRewards(
  admin: any,
  userId: string,
  launch: any,
  idempotencyKey: string,
) {
  const rawTokenAddress = launchAddress(launch, "robinhood");
  if (!rawTokenAddress) throw new Error("launch_token_not_confirmed");
  const tokenAddress = normalizeEvmAddress(rawTokenAddress);
  const snapshot = await robinhoodSnapshot(launch);
  if (!snapshot.can_claim) throw new Error("no_rewards_claimable");

  const wallet = launch.launch_signer_wallet_id
    ? await loadWalletById(admin, launch.launch_signer_wallet_id, userId)
    : await loadWallet(admin, userId);
  if (!wallet) throw new Error("launch_wallet_not_found");
  if (wallet.address.toLowerCase() !== snapshot.creator_address.toLowerCase()) {
    throw new Error("wallet_is_not_launch_creator");
  }

  const provider = robinhoodProvider();
  const signer = new ethers.Wallet(wallet.private_key_hex, provider);
  const lockerAddress = normalizeEvmAddress(readLaunchLockerAddress());
  const locker = new ethers.Contract(lockerAddress, LAUNCH_LOCKER_ABI, signer);
  const weth = normalizeEvmAddress(ROBINHOOD_WETH_ADDRESS);
  const txHashes: string[] = [];

  const collectTx = await locker.collect(BigInt(snapshot.position_id));
  await collectTx.wait(1);
  txHashes.push(collectTx.hash);

  const [postCollectWeth, postCollectToken] = await Promise.all([
    locker.claimable(wallet.address, weth),
    locker.claimable(wallet.address, tokenAddress),
  ]);
  if (BigInt(postCollectWeth) > 0n) {
    const tx = await locker.claim(weth);
    await tx.wait(1);
    txHashes.push(tx.hash);
  }
  if (BigInt(postCollectToken) > 0n) {
    const tx = await locker.claim(tokenAddress);
    await tx.wait(1);
    txHashes.push(tx.hash);
  }

  const result = {
    status: "confirmed",
    chain: "robinhood",
    launch_id: launch.id,
    token_address: tokenAddress,
    tx_hashes: txHashes,
    tx_hash: txHashes.at(-1) ?? collectTx.hash,
    explorer_url: getTxExplorerUrl(txHashes.at(-1) ?? collectTx.hash),
    claimed: {
      weth_wei: BigInt(postCollectWeth).toString(),
      weth_eth: ethers.formatEther(postCollectWeth),
      token_wei: BigInt(postCollectToken).toString(),
      token_amount: ethers.formatUnits(postCollectToken, 18),
    },
  };

  await insertClaimTransaction(admin, {
    userId,
    action: "claim_creator_rewards",
    chain: "robinhood",
    chainId: ROBINHOOD_CHAIN_ID,
    inputMint: tokenAddress,
    outputMint: "native:eth",
    nativeSymbol: "ETH",
    walletId: wallet.id,
    walletAddress: wallet.address,
    txHash: result.tx_hash,
    explorerUrl: result.explorer_url,
    idempotencyKey,
    rawRequest: {
      launch_id: launch.id,
      token_address: tokenAddress,
      source: "dashboard",
    },
    rawResult: result,
  });

  return result;
}

async function claimSolanaLaunchRewards(
  admin: any,
  userId: string,
  launch: any,
  idempotencyKey: string,
) {
  const mint = launchAddress(launch, "solana");
  if (!mint) throw new Error("launch_token_not_confirmed");
  const snapshot = await solanaSnapshot(launch);
  if (!snapshot.can_claim) {
    throw new Error(snapshot.error ?? "no_rewards_claimable");
  }

  const walletId = cleanString(
    launch.solana_launch_wallet_id ?? launch.launch_signer_wallet_id,
  );
  if (!walletId) throw new Error("missing_solana_launch_wallet_id");
  const wallet = await loadSolanaWalletById(admin, walletId, userId);
  if (!wallet) throw new Error("launch_wallet_not_found");
  const signer = Keypair.fromSecretKey(wallet.secret_key);
  if (signer.publicKey.toBase58() !== wallet.address) {
    throw new Error("loaded_solana_secret_key_address_mismatch");
  }

  const connection = solanaConnection();
  const sdk = new OnlinePumpSdk(connection);
  const mintKey = new PublicKey(mint);
  const built = await sdk.buildDistributeCreatorFeesInstructions(mintKey);
  const computeInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: readPositiveInt("PUMP_FUN_REWARDS_COMPUTE_UNITS", 600_000),
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: readPositiveInt(
        "PUMP_FUN_REWARDS_PRIORITY_MICROLAMPORTS",
        10_000,
      ),
    }),
  ];
  const { blockhash, lastValidBlockHeight } = await connection
    .getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...computeInstructions, ...built.instructions],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);

  const simulation = await connection.simulateTransaction(tx, {
    sigVerify: false,
  });
  if (simulation.value.err) {
    const logs = Array.isArray(simulation.value.logs)
      ? simulation.value.logs.slice(-20)
      : [];
    throw new Error(
      `pump_rewards_claim_simulation_failed:${
        JSON.stringify(simulation.value.err)
      }:${logs.join(" | ")}`.slice(
        0,
        500,
      ),
    );
  }

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const confirmed = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmed.value.err) throw new Error("pump_rewards_claim_tx_failed");

  const result = {
    status: "confirmed",
    chain: "solana",
    launch_id: launch.id,
    mint,
    tx_hash: signature,
    signature,
    explorer_url: getSolanaTxExplorerUrl(signature),
    sharing_config_address: snapshot.sharing_config_address,
    is_graduated: Boolean(built.isGraduated),
    claimed: {
      distributable_lamports_before: snapshot.available_native.base_units,
      distributable_sol_before: snapshot.available_native.amount,
    },
  };

  await insertClaimTransaction(admin, {
    userId,
    action: "claim_creator_rewards",
    chain: "solana",
    chainId: null,
    inputMint: mint,
    outputMint: "native:sol",
    nativeSymbol: "SOL",
    walletId: wallet.id,
    walletAddress: wallet.address,
    txHash: signature,
    explorerUrl: result.explorer_url,
    idempotencyKey,
    rawRequest: {
      launch_id: launch.id,
      mint,
      token_address: mint,
      source: "dashboard",
    },
    rawResult: result,
  });

  return result;
}

async function robinhoodSnapshot(launch: any) {
  const rawTokenAddress = launchAddress(launch, "robinhood");
  if (!rawTokenAddress) throw new Error("launch_token_not_confirmed");
  const tokenAddress = normalizeEvmAddress(rawTokenAddress);
  const provider = robinhoodProvider();
  const factoryAddress = normalizeEvmAddress(readLaunchFactoryAddress());
  const lockerAddress = normalizeEvmAddress(readLaunchLockerAddress());
  const weth = normalizeEvmAddress(ROBINHOOD_WETH_ADDRESS);
  const factory = new ethers.Contract(
    factoryAddress,
    SINGLE_SIDED_LAUNCH_FACTORY_ABI,
    provider,
  );
  const locker = new ethers.Contract(
    lockerAddress,
    LAUNCH_LOCKER_ABI,
    provider,
  );
  const record = await factory.launchByToken(tokenAddress);
  if (
    !record?.token ||
    normalizeEvmAddress(String(record.token)).toLowerCase() !==
      tokenAddress.toLowerCase()
  ) {
    throw new Error("token_not_registered_launch");
  }

  const creator = normalizeEvmAddress(String(record.creator));
  const positionId = BigInt(record.positionId);
  const position = await locker.positions(positionId);
  const token0 = normalizeEvmAddress(String(position.token0));
  const token1 = normalizeEvmAddress(String(position.token1));
  const creatorShareBps = Number(position.creatorShareBps);
  const [collectPreviewResult, claimableWethResult, claimableTokenResult] =
    await Promise.allSettled([
      locker.collect.staticCall(positionId, { from: creator }),
      locker.claimable(creator, weth),
      locker.claimable(creator, tokenAddress),
    ]);
  const preview = collectPreviewResult.status === "fulfilled"
    ? splitPreview(
      collectPreviewResult.value,
      token0,
      token1,
      tokenAddress,
      weth,
      creatorShareBps,
    )
    : { creatorWeth: 0n, creatorToken: 0n };
  const claimableWeth = fulfilledBigIntOrZero(claimableWethResult);
  const claimableToken = fulfilledBigIntOrZero(claimableTokenResult);
  const totalWeth = claimableWeth + preview.creatorWeth;
  const totalToken = claimableToken + preview.creatorToken;

  return {
    chain: "robinhood" as const,
    creator_address: creator,
    position_id: positionId.toString(),
    sharing_config_address: lockerAddress,
    available_native: rewardAmount(totalWeth, 18, "ETH"),
    available_token: rewardAmount(totalToken, 18, launch.symbol ?? "TOKEN"),
    can_claim: totalWeth > 0n || totalToken > 0n,
    error: null,
  };
}

async function solanaSnapshot(
  launch: any,
  walletAddressOverride?: string | null,
) {
  const mint = launchAddress(launch, "solana");
  if (!mint) throw new Error("launch_token_not_confirmed");
  const connection = solanaConnection();
  const sdk = new OnlinePumpSdk(connection);
  const mintKey = new PublicKey(mint);
  const sharingConfigAddress = feeSharingConfigPda(mintKey);
  const sharingConfigAccount = await connection.getAccountInfo(
    sharingConfigAddress,
    "confirmed",
  );
  if (!sharingConfigAccount) {
    return {
      chain: "solana" as const,
      sharing_config_address: sharingConfigAddress.toBase58(),
      available_native: rewardAmount(0n, 9, "SOL"),
      available_token: null,
      can_claim: false,
      error: "Pump fee-sharing config was not found for this mint.",
    };
  }

  const walletAddress = cleanString(
    walletAddressOverride ?? launch.solana_launch_wallet_address ??
      launch.launch_signer_address,
  );
  const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigAccount);
  const shareholders = Array.isArray(sharingConfig.shareholders)
    ? sharingConfig.shareholders
    : [];
  const walletKey = walletAddress ? new PublicKey(walletAddress) : null;
  const eligible = walletKey &&
    (sharingConfig.admin?.equals?.(walletKey) ||
      shareholders.some((shareholder: any) =>
        shareholder?.address?.equals?.(walletKey)
      ));
  const minimum = await sdk
    .getMinimumDistributableFee(mintKey, walletKey ?? undefined)
    .catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  const distributableLamports = BigInt(
    bnToDecimalString((minimum as any).distributableFees) ?? "0",
  );
  const canDistribute = Boolean((minimum as any).canDistribute) &&
    Boolean(eligible);

  return {
    chain: "solana" as const,
    sharing_config_address: sharingConfigAddress.toBase58(),
    available_native: rewardAmount(distributableLamports, 9, "SOL"),
    available_token: null,
    can_claim: canDistribute && distributableLamports > 0n,
    error: !eligible
      ? "Launch wallet is not a Pump fee-sharing recipient."
      : "error" in minimum
      ? String((minimum as any).error)
      : null,
  };
}

function earningItem(
  launch: any,
  chain: Chain,
  address: string | null,
  snapshot: any,
  claimed: any,
  share: any = null,
) {
  const availableNative = snapshot?.available_native ??
    rewardAmount(
      0n,
      chain === "solana" ? 9 : 18,
      chain === "solana" ? "SOL" : "ETH",
    );
  const claimedToken = claimed.token
    ? { ...claimed.token, symbol: launch.symbol ?? claimed.token.symbol }
    : null;
  return {
    id: launch.id,
    name: launch.name,
    symbol: launch.symbol,
    image_url: launch.image_url ?? launch.stable_logo_url ??
      launch.original_image_url ?? null,
    chain,
    chain_label: chain === "solana" ? "Solana" : "Robinhood Chain",
    launch_platform: launch.launch_platform ?? null,
    launch_source: launch.launch_source ?? null,
    status: launch.status ?? null,
    created_at: launch.created_at,
    token_address: chain === "robinhood" ? address : null,
    mint: chain === "solana" ? address : null,
    wallet_address: share?.wallet_address ??
      launch.solana_launch_wallet_address ??
      launch.launch_signer_address ??
      launch.fee_wallet ??
      null,
    wallet_id: share?.wallet_id ?? launch.solana_launch_wallet_id ??
      launch.launch_signer_wallet_id ?? null,
    earning_role: share ? "shared_recipient" : "owner",
    reward_share_bps: share?.share_bps ?? null,
    reward_share_percent: share ? Number(share.share_bps) / 100 : null,
    available_native: availableNative,
    available_token: snapshot?.available_token ?? null,
    claimed_native: claimed.native,
    claimed_token: claimedToken,
    can_claim: Boolean(snapshot?.can_claim),
    claim_error: snapshot?.error ?? null,
    sharing_config_address: snapshot?.sharing_config_address ?? null,
  };
}

function buildSummary(items: any[]) {
  const solAvailable = sumBaseUnits(items, "available_native", "SOL");
  const ethAvailable = sumBaseUnits(items, "available_native", "ETH");
  const solClaimed = sumBaseUnits(items, "claimed_native", "SOL");
  const ethClaimed = sumBaseUnits(items, "claimed_native", "ETH");
  return {
    total_launches: items.length,
    owned_count: items.filter((item) => item.earning_role === "owner").length,
    shared_count:
      items.filter((item) => item.earning_role === "shared_recipient").length,
    claimable_count: items.filter((item) => item.can_claim).length,
    sol_available: rewardAmount(solAvailable, 9, "SOL"),
    eth_available: rewardAmount(ethAvailable, 18, "ETH"),
    sol_claimed: rewardAmount(solClaimed, 9, "SOL"),
    eth_claimed: rewardAmount(ethClaimed, 18, "ETH"),
  };
}

async function loadClaimTransactions(admin: any, userId: string) {
  const { data, error } = await admin
    .from("transactions")
    .select(
      "input_mint,chain_id,chain,native_symbol,raw_result,created_at,confirmed_at",
    )
    .eq("user_id", userId)
    .eq("action", "claim_creator_rewards")
    .eq("status", "confirmed")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

function buildTimeline(rows: any[]) {
  const daily = new Map<string, { date: string; eth: bigint; sol: bigint }>();
  for (const row of rows) {
    const day = claimDay(row);
    if (!day) continue;
    const entry = daily.get(day) ?? { date: day, eth: 0n, sol: 0n };
    const claimed = row.raw_result?.claimed ?? {};
    if (row.chain === "solana" || row.native_symbol === "SOL") {
      entry.sol += BigInt(
        readIntegerString(claimed.distributable_lamports_before) ?? "0",
      );
    } else {
      entry.eth += BigInt(readIntegerString(claimed.weth_wei) ?? "0");
    }
    daily.set(day, entry);
  }

  if (daily.size === 0) return [];

  const dates = [...daily.keys()].sort();
  const firstDate = parseDay(dates[0]);
  const lastClaimDate = parseDay(dates.at(-1)!);
  const today = startOfUtcDay(new Date());
  const lastDate = lastClaimDate.getTime() > today.getTime()
    ? lastClaimDate
    : today;
  let runningEth = 0n;
  let runningSol = 0n;
  const points = [];

  for (
    let date = firstDate;
    date.getTime() <= lastDate.getTime();
    date = addUtcDays(date, 1)
  ) {
    const day = isoDay(date);
    const entry = daily.get(day);
    if (entry) {
      runningEth += entry.eth;
      runningSol += entry.sol;
    }
    points.push({
      date: day,
      label: shortTimelineLabel(date),
      eth_claimed: Number(formatUnits(entry?.eth ?? 0n, 18)),
      sol_claimed: Number(formatUnits(entry?.sol ?? 0n, 9)),
      eth_cumulative: Number(formatUnits(runningEth, 18)),
      sol_cumulative: Number(formatUnits(runningSol, 9)),
    });
  }

  return points.slice(-90);
}

function claimDay(row: any): string | null {
  const raw = cleanString(row.confirmed_at ?? row.created_at);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return isoDay(date);
}

function claimedForLaunch(rows: any[], chain: Chain, address: string | null) {
  const nativeSymbol = chain === "solana" ? "SOL" : "ETH";
  const nativeDecimals = chain === "solana" ? 9 : 18;
  const tokenSymbol = "TOKEN";
  let native = 0n;
  let token = 0n;
  for (const row of rows) {
    if (!address || !sameAddress(row.input_mint, address, chain)) continue;
    const claimed = row.raw_result?.claimed ?? {};
    if (chain === "solana") {
      native += BigInt(
        readIntegerString(claimed.distributable_lamports_before) ?? "0",
      );
    } else {
      native += BigInt(readIntegerString(claimed.weth_wei) ?? "0");
      token += BigInt(readIntegerString(claimed.token_wei) ?? "0");
    }
  }
  return {
    native: rewardAmount(native, nativeDecimals, nativeSymbol),
    token: chain === "robinhood" ? rewardAmount(token, 18, tokenSymbol) : null,
  };
}

async function insertClaimTransaction(admin: any, args: any) {
  const { error } = await admin.from("transactions").insert({
    user_id: args.userId,
    action: args.action,
    chain: args.chain,
    input_mint: args.inputMint,
    output_mint: args.outputMint,
    chain_id: args.chainId,
    native_symbol: args.nativeSymbol,
    wallet_id: args.walletId,
    wallet_address: args.walletAddress,
    tx_hash: args.txHash,
    tx_signature: args.txHash,
    explorer_url: args.explorerUrl,
    status: "confirmed",
    raw_request: args.rawRequest,
    raw_result: args.rawResult,
    source_surface: "dashboard",
    confirmed_at: new Date().toISOString(),
    idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
}

function launchChain(launch: any): Chain {
  if (launch.chain === "solana" || launch.launch_platform === "pump_fun") {
    return "solana";
  }
  return "robinhood";
}

function launchAddress(launch: any, chain: Chain): string | null {
  const raw = chain === "solana"
    ? (launch.mint ?? launch.token_address)
    : (launch.token_address ?? launch.mint);
  const text = cleanString(raw);
  if (!text) return null;
  return chain === "robinhood"
    ? normalizeEvmAddress(text)
    : new PublicKey(text).toBase58();
}

function splitPreview(
  collectResult: any,
  token0: string,
  token1: string,
  launchToken: string,
  weth: string,
  creatorShareBps: number,
) {
  const amount0 = BigInt(collectResult[0] ?? 0n);
  const amount1 = BigInt(collectResult[1] ?? 0n);
  const launchFees = token0.toLowerCase() === launchToken.toLowerCase()
    ? amount0
    : amount1;
  const wethFees = token0.toLowerCase() === weth.toLowerCase()
    ? amount0
    : token1.toLowerCase() === weth.toLowerCase()
    ? amount1
    : 0n;
  return {
    creatorToken: (launchFees * BigInt(creatorShareBps)) / 10_000n,
    creatorWeth: (wethFees * BigInt(creatorShareBps)) / 10_000n,
  };
}

function rewardAmount(
  value: bigint,
  decimals: number,
  symbol: string,
): RewardAmount {
  return {
    base_units: value.toString(),
    amount: formatUnits(value, decimals),
    symbol,
  };
}

function formatUnits(value: bigint, decimals: number): string {
  if (value === 0n) return "0";
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${
    fraction.toString().padStart(decimals, "0").replace(/0+$/, "")
  }`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function startOfUtcDay(date: Date): Date {
  return parseDay(isoDay(date));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function shortTimelineLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function sumBaseUnits(items: any[], field: string, symbol: string): bigint {
  return items.reduce((sum, item) => {
    const amount = item?.[field];
    return amount?.symbol === symbol
      ? sum + BigInt(readIntegerString(amount.base_units) ?? "0")
      : sum;
  }, 0n);
}

function fulfilledBigIntOrZero(result: PromiseSettledResult<unknown>): bigint {
  if (result.status !== "fulfilled") return 0n;
  try {
    return BigInt(result.value as any);
  } catch (_) {
    return 0n;
  }
}

function bnToDecimalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value).toString();
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof (value as any)?.toString === "function") {
    const text = (value as any).toString();
    return /^\d+$/.test(text) ? text : null;
  }
  return null;
}

function readIntegerString(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value).toString();
  }
  return null;
}

function normalizeIdempotencyKey(
  value: unknown,
  userId: string,
  launchId: string,
): string {
  const raw = cleanString(value);
  if (!raw) {
    return `web-creator-rewards:${userId}:${launchId}:${crypto.randomUUID()}`;
  }
  if (!/^[a-zA-Z0-9:_-]{8,180}$/.test(raw)) {
    throw new Error("invalid_idempotency_key");
  }
  return raw.startsWith("web-creator-rewards:")
    ? raw
    : `web-creator-rewards:${userId}:${raw}`;
}

function sameAddress(a: unknown, b: string, chain: Chain): boolean {
  const text = cleanString(a);
  if (!text) return false;
  return chain === "robinhood"
    ? text.toLowerCase() === b.toLowerCase()
    : text === b;
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function errorStatus(message: string): number {
  if (message === "unauthorized") return 401;
  if (/not_found/.test(message)) return 404;
  if (
    /missing|invalid|no_rewards|wallet|not_confirmed|not_registered|not_launch_creator/
      .test(
        message,
      )
  ) {
    return 400;
  }
  return 500;
}
