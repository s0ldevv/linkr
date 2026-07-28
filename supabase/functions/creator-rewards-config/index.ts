// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import {
  Connection,
  PublicKey,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  feeSharingConfigPda,
  isSharingConfigEditable,
  OnlinePumpSdk,
  PUMP_SDK,
} from "https://esm.sh/@pump-fun/pump-sdk@1.36.0?bundle&target=deno";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { internalErrorResponse, readJsonBody } from "../_shared/http.ts";
import {
  normalizeMarketAddress,
  tokenExplorerUrl,
} from "../_shared/market_data/chains.ts";
import {
  getAddressExplorerUrl,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
  robinhoodProvider as createRobinhoodProvider,
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

const MAX_UINT128 = (1n << 128n) - 1n;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const rawTokenAddress = await readTokenAddress(req);
    if (!rawTokenAddress) {
      return jsonResponse({ error: "missing_token_address" }, { status: 400 });
    }

    const normalized = normalizeMarketAddress(rawTokenAddress);
    if (!normalized) {
      return jsonResponse({ error: "invalid_token_address" }, { status: 400 });
    }

    const snapshot = normalized.chain === "solana"
      ? await readSolanaCreatorRewards(normalized.address)
      : await readRobinhoodCreatorRewards(normalized.address);
    return jsonResponse(snapshot, {
      headers: {
        "Cache-Control": "public, max-age=20, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "invalid_evm_address" ||
        message === "invalid_solana_address" ||
        message === "invalid_token_address"
      ? 400
      : 500;
    if (status >= 500) {
      return internalErrorResponse(error, {
        function: "creator-rewards-config",
      });
    }
    return jsonResponse({ error: message }, { status });
  }
});

async function readTokenAddress(req: Request): Promise<string | null> {
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    return params.get("token_address") ?? params.get("address") ??
      params.get("mint");
  }

  const body = await readJsonBody(req, 16 * 1024) as any;
  const value = body?.token_address ?? body?.address ?? body?.mint;
  return typeof value === "string" ? value : null;
}

async function readRobinhoodCreatorRewards(tokenAddress: string) {
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
  const record = await factory.launchByToken(tokenAddress).catch(() => null);

  if (
    !record?.token || normalizeEvmAddress(String(record.token)) !== tokenAddress
  ) {
    return baseSnapshot(tokenAddress, {
      error:
        "Token is not registered in the Linkr single-sided launch factory.",
      source: "none",
    });
  }

  const launch = normalizeLaunchRecord(record);
  const position = await locker.positions(BigInt(launch.positionId));
  if (!Boolean(position.registered)) {
    return baseSnapshot(tokenAddress, {
      error: "Launch LP position is not registered in the locker.",
      factoryAddress,
      source: "partial",
    });
  }

  const creator = normalizeEvmAddress(String(position.creator));
  const token0 = normalizeEvmAddress(String(position.token0));
  const token1 = normalizeEvmAddress(String(position.token1));
  const creatorShareBps = Number(position.creatorShareBps);
  const treasury = normalizeEvmAddress(await locker.treasury());

  const [collectPreviewResult, creatorWethClaimable, creatorTokenClaimable] =
    await Promise.allSettled([
      locker.collect.staticCall(BigInt(launch.positionId), { from: creator }),
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
    : null;
  const claimableWeth = fulfilledBigIntOrZero(creatorWethClaimable);
  const claimableToken = fulfilledBigIntOrZero(creatorTokenClaimable);
  const totalCreatorWeth = claimableWeth + (preview?.creatorWeth ?? 0n);

  const recipients = [
    {
      address: creator,
      label: "Creator",
      shareBps: creatorShareBps,
      sharePercent: creatorShareBps / 100,
      source: "contract",
    },
    {
      address: treasury,
      label: "Protocol",
      shareBps: 10_000 - creatorShareBps,
      sharePercent: (10_000 - creatorShareBps) / 100,
      source: "contract",
    },
  ];

  return {
    ...baseSnapshot(tokenAddress, { source: "live" }),
    admin: creator,
    canDistribute: totalCreatorWeth > 0n || claimableToken > 0n,
    claimableFeesEth: ethers.formatEther(totalCreatorWeth),
    claimableFeesWei: totalCreatorWeth.toString(),
    distributableFeesEth: ethers.formatEther(totalCreatorWeth),
    distributableFeesWei: totalCreatorWeth.toString(),
    editable: false,
    error: null,
    factoryAddress,
    feeCollectorAddress: lockerAddress,
    isGraduated: null,
    launchConfig: {
      blockNumber: null,
      creator,
      name: null,
      positionId: launch.positionId,
      symbol: null,
      txHash: null,
    },
    minimumRequiredEth: null,
    singleSidedLaunch: {
      creatorShareBps,
      dustWei: launch.dust,
      graduationWethWei: launch.graduationWeth,
      initialBuyTokensOutWei: launch.initialBuyTokensOut,
      initialBuyWethWei: launch.initialBuyWeth,
      liquidity: launch.liquidity,
      locker: lockerAddress,
      pool: launch.pool,
      positionId: launch.positionId,
      previewCreatorTokenWei: preview?.creatorToken.toString() ?? null,
      previewCreatorWethWei: preview?.creatorWeth.toString() ?? null,
      token0,
      token1,
      usedLaunchWei: launch.usedLaunch,
    },
    recipients,
    sharingConfigAddress: lockerAddress,
    totalShareBps: 10_000,
    version: 2,
  };
}

function robinhoodProvider() {
  return createRobinhoodProvider();
}

async function readSolanaCreatorRewards(mint: string) {
  let mintKey: PublicKey;
  try {
    mintKey = new PublicKey(mint);
  } catch (_) {
    throw new Error("invalid_solana_address");
  }

  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const sdk = new OnlinePumpSdk(connection);
  const sharingConfigAddress = feeSharingConfigPda(mintKey);
  const sharingConfigAccount = await connection.getAccountInfo(
    sharingConfigAddress,
    "confirmed",
  );

  if (!sharingConfigAccount) {
    return solanaBaseSnapshot(mint, {
      error: "Pump fee sharing config was not found for this mint.",
      sharingConfigAddress: sharingConfigAddress.toBase58(),
      source: "none",
    });
  }

  const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigAccount);
  const minimumResult = await sdk.getMinimumDistributableFee(mintKey).catch((
    error,
  ) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const distributableFeesLamports = bnToDecimalString(
    (minimumResult as any).distributableFees,
  );
  const minimumRequiredLamports = bnToDecimalString(
    (minimumResult as any).minimumRequired,
  );
  const recipients = (sharingConfig.shareholders ?? []).map(
    (shareholder: any) => {
      const shareBps = Number(shareholder.shareBps ?? 0);
      return {
        address: shareholder.address.toBase58(),
        label: shareholder.address.equals(sharingConfig.admin)
          ? "Creator"
          : "Reward wallet",
        shareBps,
        sharePercent: shareBps / 100,
        source: "pump-sdk",
      };
    },
  );

  return {
    ...solanaBaseSnapshot(mint, { source: "live" }),
    admin: sharingConfig.admin.toBase58(),
    adminRevoked: Boolean(sharingConfig.adminRevoked),
    canDistribute: typeof (minimumResult as any).canDistribute === "boolean"
      ? Boolean((minimumResult as any).canDistribute)
      : null,
    claimableFeesLamports: distributableFeesLamports,
    claimableFeesSol: lamportsToSolDecimal(distributableFeesLamports),
    distributableFeesLamports,
    distributableFeesSol: lamportsToSolDecimal(distributableFeesLamports),
    editable: isSharingConfigEditable({ sharingConfig }),
    error: "error" in minimumResult
      ? String((minimumResult as any).error)
      : null,
    feeCollectorAddress: sharingConfigAddress.toBase58(),
    isGraduated: typeof (minimumResult as any).isGraduated === "boolean"
      ? Boolean((minimumResult as any).isGraduated)
      : null,
    minimumRequiredLamports,
    minimumRequiredSol: lamportsToSolDecimal(minimumRequiredLamports),
    recipients,
    sharingConfigAddress: sharingConfigAddress.toBase58(),
    totalShareBps:
      recipients.reduce((sum, recipient) => sum + recipient.shareBps, 0) ||
      null,
    version: Number(sharingConfig.version ?? 1),
  };
}

function baseSnapshot(
  tokenAddress: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    admin: null,
    adminRevoked: null,
    canDistribute: null,
    claimableFeesEth: null,
    claimableFeesWei: null,
    chain: "robinhood",
    chainId: ROBINHOOD_CHAIN_ID,
    distributableFeesEth: null,
    distributableFeesWei: null,
    editable: false,
    error: null,
    explorerUrl: getAddressExplorerUrl(tokenAddress),
    factoryAddress: null,
    feeCollectorAddress: null,
    isGraduated: null,
    launchConfig: null,
    minimumRequiredEth: null,
    recipients: [],
    sharingConfigAddress: null,
    singleSidedLaunch: null,
    source: "none",
    mint: tokenAddress,
    nativeSymbol: "ETH",
    tokenAddress,
    totalShareBps: null,
    version: null,
    ...overrides,
  };
}

function solanaBaseSnapshot(
  mint: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    admin: null,
    adminRevoked: null,
    canDistribute: null,
    chain: "solana",
    chainId: null,
    claimableFeesEth: null,
    claimableFeesLamports: null,
    claimableFeesSol: null,
    claimableFeesWei: null,
    distributableFeesEth: null,
    distributableFeesLamports: null,
    distributableFeesSol: null,
    distributableFeesWei: null,
    editable: null,
    error: null,
    explorerUrl: tokenExplorerUrl("solana", mint),
    factoryAddress: null,
    feeCollectorAddress: null,
    isGraduated: null,
    launchConfig: null,
    minimumRequiredEth: null,
    minimumRequiredLamports: null,
    minimumRequiredSol: null,
    nativeSymbol: "SOL",
    recipients: [],
    sharingConfigAddress: null,
    singleSidedLaunch: null,
    source: "none",
    mint,
    tokenAddress: mint,
    totalShareBps: null,
    version: null,
    ...overrides,
  };
}

function normalizeLaunchRecord(record: any) {
  return {
    token: normalizeEvmAddress(String(record.token)),
    creator: normalizeEvmAddress(String(record.creator)),
    pool: normalizeEvmAddress(String(record.pool)),
    positionId: BigInt(record.positionId).toString(),
    tickLower: BigInt(record.tickLower).toString(),
    tickUpper: BigInt(record.tickUpper).toString(),
    liquidity: BigInt(record.liquidity).toString(),
    usedLaunch: BigInt(record.usedLaunch).toString(),
    dust: BigInt(record.dust).toString(),
    initialBuyWeth: BigInt(record.initialBuyWeth).toString(),
    initialBuyTokensOut: BigInt(record.initialBuyTokensOut).toString(),
    graduationWeth: BigInt(record.graduationWeth).toString(),
  };
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

function fulfilledBigIntOrZero(result: PromiseSettledResult<unknown>): bigint {
  if (result.status !== "fulfilled") return 0n;
  try {
    return BigInt(result.value as any);
  } catch (_) {
    return 0n;
  }
}

function solanaRpcUrl(): string {
  const candidates = [
    Deno.env.get("SOLANA_RPC_URL"),
    Deno.env.get("HELIUS_RPC_URL"),
    Deno.env.get("QUICKNODE_SOLANA_RPC_URL"),
    "https://api.mainnet-beta.solana.com",
  ];
  return candidates
    .map((value) => value?.trim() ?? "")
    .find((value) => /^https?:\/\//.test(value))!;
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

function lamportsToSolDecimal(lamportsText: string | null): string | null {
  if (!lamportsText) return null;
  const lamports = BigInt(lamportsText);
  const base = 1_000_000_000n;
  const whole = lamports / base;
  const fraction = lamports % base;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}
