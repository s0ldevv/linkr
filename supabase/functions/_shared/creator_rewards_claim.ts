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
import {
  getSolanaTxExplorerUrl,
  loadSolanaWalletById,
  solanaConnection,
} from "./solana_chain.ts";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
} from "./robinhood_chain.ts";
import {
  LAUNCH_LOCKER_ABI,
  SINGLE_SIDED_LAUNCH_FACTORY_ABI,
} from "./robinhood_launch/abi.ts";
import {
  readLaunchFactoryAddress,
  readLaunchLockerAddress,
  ROBINHOOD_WETH_ADDRESS,
} from "./robinhood_launch/constants.ts";
import { robinhoodProvider } from "./robinhood_launch/launch.ts";
import { loadWallet, loadWalletById } from "./wallet.ts";

export type CreatorRewardsChain = "robinhood" | "solana";

type RewardAmount = {
  base_units: string;
  amount: string;
  symbol: string;
};

export type CreatorRewardsClaimOptions = {
  idempotencyKey?: string | null;
  idempotencyPrefix?: string;
  source?: string;
  pendingActionId?: string | null;
  terminalConversationId?: string | null;
  terminalMessageId?: string | null;
  sourceTweetId?: string | null;
};

export async function previewCreatorRewardsClaim(
  admin: any,
  userId: string,
  body: any,
) {
  const launch = await loadUserLaunch(admin, userId, body);
  const chain = launchChain(launch);
  const address = launchAddress(launch, chain);
  const snapshot = chain === "solana"
    ? await solanaSnapshot(launch, launch.reward_recipient?.wallet_address)
    : await robinhoodSnapshot(launch);
  return {
    launch,
    chain,
    address,
    snapshot,
    summary: creatorRewardsPreviewSummary({ launch, chain, snapshot }),
  };
}

export async function claimCreatorRewards(
  admin: any,
  userId: string,
  body: any,
  options: CreatorRewardsClaimOptions = {},
) {
  const launch = await loadUserLaunch(admin, userId, body);
  const chain = launchChain(launch);
  const idempotencyKey = normalizeClaimIdempotencyKey(
    options.idempotencyKey ?? body.idempotency_key ?? body.idempotencyKey,
    options.idempotencyPrefix ?? "creator-rewards",
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
    ? await claimSolanaLaunchRewards(
      admin,
      userId,
      launch,
      idempotencyKey,
      options,
    )
    : await claimRobinhoodLaunchRewards(
      admin,
      userId,
      launch,
      idempotencyKey,
      options,
    );
}

export function creatorRewardsClaimReply(result: any): string {
  const symbol = cleanString(result?.symbol) || "your launch";
  if (result?.chain === "solana") {
    const sol = displayAmount(result?.claimed?.distributable_sol_before ?? "0");
    return `Claimed ${sol} SOL from $${symbol} creator rewards.\n\nView full history in Linkr.\n\nTX: ${result.tx_hash}`;
  }

  const eth = displayAmount(result?.claimed?.weth_eth ?? "0");
  const tokenRaw = Number(result?.claimed?.token_amount ?? 0);
  const token = displayAmount(result?.claimed?.token_amount ?? "0");
  const tokenLine = Number.isFinite(tokenRaw) && tokenRaw > 0
    ? ` and ${token} $${symbol}`
    : "";
  return `Claimed ${eth} ETH${tokenLine} from $${symbol} creator rewards.\n\nView full history in Linkr.\n\nTX: ${result.tx_hash}`;
}

export function creatorRewardsConfirmationReply(preview: any): string {
  const launch = preview.launch ?? {};
  const symbol = cleanString(launch.symbol) || "launch";
  const chainLabel = preview.chain === "solana"
    ? "Solana/Pump.fun"
    : "Robinhood Chain";
  const native = preview.snapshot?.available_native;
  const token = preview.snapshot?.available_token;
  const nativeAmount = native
    ? `${displayAmount(native.amount)} ${native.symbol}`
    : "0";
  const tokenAmount = token && Number(token.amount) > 0
    ? ` plus ${displayAmount(token.amount)} $${symbol}`
    : "";
  return `I found this action:\n\nClaim ${nativeAmount}${tokenAmount} creator rewards from $${symbol} on ${chainLabel}.\n\nReply "confirm claim" within 15 minutes to execute.\n\nNo TX created yet.`;
}

export function creatorRewardsPreviewSummary(args: {
  launch: any;
  chain: CreatorRewardsChain;
  snapshot: any;
}): string {
  const symbol = cleanString(args.launch?.symbol) || "launch";
  const native = args.snapshot?.available_native;
  const amount = native
    ? `${displayAmount(native.amount)} ${native.symbol}`
    : "0";
  return `$${symbol} has ${amount} claimable creator rewards on ${
    args.chain === "solana" ? "Solana/Pump.fun" : "Robinhood Chain"
  }.`;
}

export function creatorRewardsErrorReply(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/missing_launch_id/.test(message)) {
    return "Which launch should I claim creator rewards from? Send the contract address, Solana mint, cashtag, or say your latest launch.";
  }
  if (/multiple_matching_launches/.test(message)) {
    return "I found multiple matching launches. Reply with the exact contract address or Solana mint.";
  }
  if (/launch_not_found/.test(message)) {
    return "I could not find that launch in your Linkr account. Send the exact contract address or mint from your launch.";
  }
  if (/launch_token_not_confirmed/.test(message)) {
    return "That launch does not have a confirmed token address or mint yet, so I cannot claim rewards for it.";
  }
  if (
    /no_rewards_claimable|Pump fee-sharing config was not found|not a Pump fee-sharing recipient/
      .test(
        message,
      )
  ) {
    return "I do not see claimable creator rewards for that launch yet.";
  }
  if (/wallet|creator/.test(message)) {
    return "I could not safely match the launch creator wallet needed for that claim.";
  }
  return "The creator rewards claim failed before confirmation. No rewards claim was completed.";
}

export function creatorRewardsErrorStatus(message: string): number {
  if (/not_found/.test(message)) return 404;
  if (
    /missing|invalid|multiple|no_rewards|wallet|not_confirmed|not_registered|not_launch_creator|not a Pump fee-sharing recipient/
      .test(
        message,
      )
  ) {
    return 400;
  }
  return 500;
}

async function claimRobinhoodLaunchRewards(
  admin: any,
  userId: string,
  launch: any,
  idempotencyKey: string,
  options: CreatorRewardsClaimOptions,
) {
  const tokenAddress = normalizeEvmAddress(launchAddress(launch, "robinhood"));
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
    symbol: launch.symbol ?? null,
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
    rawRequest: rawRequest(options, {
      launch_id: launch.id,
      token_address: tokenAddress,
    }),
    rawResult: result,
    options,
  });

  return result;
}

async function claimSolanaLaunchRewards(
  admin: any,
  userId: string,
  launch: any,
  idempotencyKey: string,
  options: CreatorRewardsClaimOptions,
) {
  const mint = launchAddress(launch, "solana");
  const recipient = launch.reward_recipient ?? null;
  const recipientAddress = cleanString(recipient?.wallet_address) || null;
  const snapshot = await solanaSnapshot(launch, recipientAddress);
  if (!snapshot.can_claim) {
    throw new Error(snapshot.error ?? "no_rewards_claimable");
  }

  const walletId = cleanString(
    recipient?.wallet_id ?? launch.solana_launch_wallet_id ??
      launch.launch_signer_wallet_id,
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
    symbol: launch.symbol ?? null,
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
    rawRequest: rawRequest(options, {
      launch_id: launch.id,
      mint,
      token_address: mint,
    }),
    rawResult: result,
    options,
  });

  return result;
}

async function loadUserLaunch(admin: any, userId: string, body: any) {
  const launchId = cleanString(body.launch_id ?? body.launchId);
  const token = cleanString(
    body.token_address ?? body.tokenAddress ?? body.mint ?? body.token,
  );
  const symbol = cleanSymbol(
    body.symbol ?? body.token_symbol ?? body.coin_symbol,
  );
  const latest = body.latest === true || body.launch_reference === "latest";
  const chainHint = normalizeChainHint(
    body.chain ?? body.token_chain ?? body.launch_chain,
  );

  const { data: shares, error: sharesError } = await admin
    .from("coin_launch_reward_recipients")
    .select("launch_id,wallet_id,wallet_address,share_bps,source")
    .eq("user_id", userId)
    .limit(100);
  if (sharesError) throw sharesError;
  const shareByLaunch = new Map(
    (shares ?? []).map((share: any) => [share.launch_id, share]),
  );
  const sharedLaunchIds = [...shareByLaunch.keys()];
  if (!launchId && !token && !symbol && !latest) {
    throw new Error("missing_launch_id");
  }

  const [ownedResult, sharedResult] = await Promise.all([
    admin
      .from("coin_launches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    sharedLaunchIds.length > 0
      ? admin.from("coin_launches").select("*").in("id", sharedLaunchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ownedResult.error) throw ownedResult.error;
  if (sharedResult.error) throw sharedResult.error;

  const launchById = new Map<string, any>();
  for (const launch of [...(ownedResult.data ?? []), ...(sharedResult.data ?? [])]) {
    launchById.set(launch.id, launch);
  }
  let launches = [...launchById.values()].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
  if (launchId) launches = launches.filter((launch) => launch.id === launchId);
  if (token) {
    launches = launches.filter((launch) =>
      sameLaunchAddress(launch.token_address, token) || sameLaunchAddress(launch.mint, token)
    );
  }
  if (symbol) {
    launches = launches.filter((launch) => cleanSymbol(launch.symbol) === symbol);
  }
  if (latest) {
    launches = launches.filter((launch) => ["confirmed", "completed"].includes(launch.status));
  }

  const filtered = chainHint
    ? launches.filter((launch) => launchChain(launch) === chainHint)
    : launches;
  if (filtered.length > 1 && !latest) {
    throw new Error("multiple_matching_launches");
  }
  const launch = filtered[0] ?? null;
  if (!launch) throw new Error("launch_not_found");
  const address = launchAddress(launch, launchChain(launch));
  if (!address) throw new Error("launch_token_not_confirmed");
  const recipient = shareByLaunch.get(launch.id) ?? null;
  if (launch.user_id !== userId && launchChain(launch) !== "solana") {
    throw new Error("launch_not_found");
  }
  return recipient ? { ...launch, reward_recipient: recipient } : launch;
}

function sameLaunchAddress(value: unknown, expected: string): boolean {
  const actual = cleanString(value);
  return actual === expected || actual.toLowerCase() === expected.toLowerCase();
}

async function robinhoodSnapshot(launch: any) {
  const tokenAddress = normalizeEvmAddress(launchAddress(launch, "robinhood"));
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

function insertClaimTransaction(admin: any, args: any) {
  return admin
    .from("transactions")
    .insert({
      user_id: args.userId,
      tweet_id: args.options?.sourceTweetId ?? null,
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
      confirmed_at: new Date().toISOString(),
      idempotency_key: args.idempotencyKey,
      source_surface: args.options?.source ?? null,
      terminal_conversation_id: args.options?.terminalConversationId ?? null,
      terminal_message_id: args.options?.terminalMessageId ?? null,
    })
    .then(({ error }: any) => {
      if (error) throw error;
    });
}

function rawRequest(
  options: CreatorRewardsClaimOptions,
  fields: Record<string, unknown>,
) {
  return {
    ...fields,
    source: options.source ?? "unknown",
    pending_action_id: options.pendingActionId ?? null,
  };
}

function launchChain(launch: any): CreatorRewardsChain {
  if (launch.chain === "solana" || launch.launch_platform === "pump_fun") {
    return "solana";
  }
  return "robinhood";
}

function launchAddress(launch: any, chain: CreatorRewardsChain): string {
  const raw = chain === "solana"
    ? (launch.mint ?? launch.token_address)
    : (launch.token_address ?? launch.mint);
  const text = cleanString(raw);
  if (!text) throw new Error("launch_token_not_confirmed");
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

function normalizeClaimIdempotencyKey(
  value: unknown,
  prefix: string,
  userId: string,
  launchId: string,
): string {
  const raw = cleanString(value);
  const safePrefix = prefix.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 60) ||
    "creator-rewards";
  if (!raw) return `${safePrefix}:${userId}:${launchId}:${crypto.randomUUID()}`;
  if (!/^[a-zA-Z0-9:_-]{8,180}$/.test(raw)) {
    throw new Error("invalid_idempotency_key");
  }
  return raw.startsWith(`${safePrefix}:`)
    ? raw
    : `${safePrefix}:${userId}:${raw}`;
}

function normalizeChainHint(value: unknown): CreatorRewardsChain | null {
  const raw = cleanString(value).toLowerCase();
  if (["sol", "solana", "pump", "pump.fun", "pumpfun"].includes(raw)) {
    return "solana";
  }
  if (["eth", "evm", "robinhood", "robinhood_chain", "rhood"].includes(raw)) {
    return "robinhood";
  }
  return null;
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanSymbol(value: unknown): string {
  return cleanString(value)
    .replace(/^\$/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

function displayAmount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
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

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
