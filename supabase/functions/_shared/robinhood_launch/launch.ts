// deno-lint-ignore-file no-explicit-any

import { ethers } from "https://esm.sh/ethers@6";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
  robinhoodProvider as createRobinhoodProvider,
} from "../robinhood_chain.ts";
import type { LoadedWallet } from "../wallet.ts";
import { SINGLE_SIDED_LAUNCH_FACTORY_ABI } from "./abi.ts";
import {
  readLaunchFactoryAddress,
  SINGLE_SIDED_LAUNCH_NAME_MAX_LENGTH,
  SINGLE_SIDED_LAUNCH_SYMBOL_MAX_LENGTH,
} from "./constants.ts";

export type SingleSidedLaunchDraft = {
  launchId: string;
  name: string;
  symbol: string;
  metadataURI: string;
  initialBuyWei: bigint;
};

export type SingleSidedLaunchPreflight = {
  factoryAddress: string;
  signerAddress: string;
  predictedToken: string;
  launchFeeWei: bigint;
  initialBuyWei: bigint;
  totalMsgValueWei: bigint;
  gasEstimate: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint;
  estimatedGasCostWei: bigint;
  requiredBalanceWei: bigint;
  signerBalanceWei: bigint;
};

export type SubmittedSingleSidedLaunch = SingleSidedLaunchPreflight & {
  txHash: string;
  explorerUrl: string;
  salt: string;
};

export type FinalizedSingleSidedLaunch = {
  chainId: number;
  factory: string;
  txHash: string;
  explorerUrl: string;
  signer: string;
  token: string;
  creator: string;
  pool: string;
  positionId: string;
  launchTokenIsToken0: boolean;
  tickLower: string;
  tickUpper: string;
  sqrtPriceX96: string;
  supply: string;
  metadataURI: string;
  graduationWeth: string;
  liquidity: string;
  usedLaunch: string;
  dust: string;
  initialBuyWeth: string;
  initialBuyTokensOut: string;
  launchFee: string | null;
  totalMsgValue: string | null;
  record: Record<string, unknown>;
  receipt: Record<string, unknown>;
};

export function robinhoodProvider(): ethers.AbstractProvider {
  return createRobinhoodProvider();
}

export function walletFromLoadedWallet(loaded: LoadedWallet): ethers.Wallet {
  const wallet = new ethers.Wallet(loaded.private_key_hex, robinhoodProvider());
  if (wallet.address.toLowerCase() !== loaded.address.toLowerCase()) {
    throw new Error("loaded_private_key_address_mismatch");
  }
  return wallet;
}

export async function estimateSingleSidedLaunch(
  signer: ethers.Wallet,
  draft: SingleSidedLaunchDraft,
): Promise<SingleSidedLaunchPreflight> {
  const factoryAddress = normalizeEvmAddress(readLaunchFactoryAddress());
  const factory = new ethers.Contract(
    factoryAddress,
    SINGLE_SIDED_LAUNCH_FACTORY_ABI,
    signer,
  );
  const launchFeeWei = BigInt(await factory.launchFee());
  const initialBuyWei = assertInitialBuyWithinCap(draft.initialBuyWei);
  const totalMsgValueWei = launchFeeWei + initialBuyWei;
  const params = buildLaunchParams(draft);
  const predictedToken = normalizeEvmAddress(
    await factory.predictTokenAddress(params, signer.address),
  );
  const signerBalanceWei = BigInt(
    await signer.provider!.getBalance(signer.address),
  );
  if (signerBalanceWei < totalMsgValueWei) {
    return {
      factoryAddress,
      signerAddress: normalizeEvmAddress(signer.address),
      predictedToken,
      launchFeeWei,
      initialBuyWei,
      totalMsgValueWei,
      gasEstimate: 0n,
      gasLimit: 0n,
      gasPriceWei: 0n,
      estimatedGasCostWei: 0n,
      requiredBalanceWei: totalMsgValueWei,
      signerBalanceWei,
    };
  }

  await factory.launch.staticCall(params, { value: totalMsgValueWei });
  const gasEstimate = BigInt(
    await factory.launch.estimateGas(params, { value: totalMsgValueWei }),
  );
  const gasLimit = withGasBuffer(gasEstimate);
  const gasPriceWei = await readGasPrice(signer.provider!);
  const estimatedGasCostWei = gasLimit * gasPriceWei;
  const requiredBalanceWei = totalMsgValueWei + estimatedGasCostWei;

  return {
    factoryAddress,
    signerAddress: normalizeEvmAddress(signer.address),
    predictedToken,
    launchFeeWei,
    initialBuyWei,
    totalMsgValueWei,
    gasEstimate,
    gasLimit,
    gasPriceWei,
    estimatedGasCostWei,
    requiredBalanceWei,
    signerBalanceWei,
  };
}

export async function predictSingleSidedLaunchToken(
  signer: ethers.Wallet,
  draft: SingleSidedLaunchDraft,
): Promise<string> {
  const factoryAddress = normalizeEvmAddress(readLaunchFactoryAddress());
  const factory = new ethers.Contract(
    factoryAddress,
    SINGLE_SIDED_LAUNCH_FACTORY_ABI,
    signer,
  );
  const params = buildLaunchParams(draft);
  return normalizeEvmAddress(
    await factory.predictTokenAddress(params, signer.address),
  );
}

export async function submitSingleSidedLaunch(
  signer: ethers.Wallet,
  draft: SingleSidedLaunchDraft,
  preflight?: SingleSidedLaunchPreflight,
): Promise<SubmittedSingleSidedLaunch> {
  const checked = preflight ?? (await estimateSingleSidedLaunch(signer, draft));
  if (checked.signerBalanceWei < checked.requiredBalanceWei) {
    throw new Error("insufficient_launch_signer_balance");
  }

  const factory = new ethers.Contract(
    checked.factoryAddress,
    SINGLE_SIDED_LAUNCH_FACTORY_ABI,
    signer,
  );
  const params = buildLaunchParams(draft);
  const tx = await factory.launch(params, {
    value: checked.totalMsgValueWei,
    gasLimit: checked.gasLimit,
  });

  return {
    ...checked,
    txHash: tx.hash,
    explorerUrl: getTxExplorerUrl(tx.hash),
    salt: params.salt,
  };
}

export async function finalizeSingleSidedLaunch(
  txHash: string,
  options: {
    factoryAddress?: string | null;
    launchFeeWei?: bigint | string | null;
    totalMsgValueWei?: bigint | string | null;
  } = {},
): Promise<FinalizedSingleSidedLaunch> {
  const provider = robinhoodProvider();
  const factoryAddress = normalizeEvmAddress(
    options.factoryAddress || readLaunchFactoryAddress(),
  );
  const receipt = await provider.waitForTransaction(txHash, 2, 180_000);
  if (!receipt) throw new Error("launch_receipt_timeout");
  if (receipt.status !== 1) {
    throw new Error(`launch_transaction_reverted:${txHash}`);
  }

  const iface = new ethers.Interface(SINGLE_SIDED_LAUNCH_FACTORY_ABI);
  const event = receipt.logs
    .filter((log) => log.address.toLowerCase() === factoryAddress.toLowerCase())
    .map((log) => {
      try {
        return iface.parseLog({ data: log.data, topics: [...log.topics] });
      } catch (_) {
        return null;
      }
    })
    .find((decoded) => decoded?.name === "TokenLaunched");

  if (!event) throw new Error("token_launched_event_missing");

  const token = normalizeEvmAddress(String(event.args.token));
  const factory = new ethers.Contract(
    factoryAddress,
    SINGLE_SIDED_LAUNCH_FACTORY_ABI,
    provider,
  );
  const record = await factory.launchByToken(token);
  if (
    normalizeEvmAddress(String(record.token)).toLowerCase() !==
      token.toLowerCase()
  ) {
    throw new Error("single_sided_launch_verification_failed");
  }

  const tx = await provider.getTransaction(txHash).catch(() => null);
  const signer = tx?.from
    ? normalizeEvmAddress(tx.from)
    : normalizeEvmAddress(String(event.args.creator));

  return {
    chainId: ROBINHOOD_CHAIN_ID,
    factory: factoryAddress,
    txHash,
    explorerUrl: getTxExplorerUrl(txHash),
    signer,
    token,
    creator: normalizeEvmAddress(String(event.args.creator)),
    pool: normalizeEvmAddress(String(event.args.pool)),
    positionId: BigInt(event.args.positionId).toString(),
    launchTokenIsToken0: Boolean(event.args.launchTokenIsToken0),
    tickLower: BigInt(event.args.tickLower).toString(),
    tickUpper: BigInt(event.args.tickUpper).toString(),
    sqrtPriceX96: BigInt(event.args.sqrtPriceX96).toString(),
    supply: BigInt(event.args.supply).toString(),
    metadataURI: String(event.args.metadataURI),
    graduationWeth: BigInt(event.args.graduationWeth).toString(),
    liquidity: BigInt(event.args.liquidity).toString(),
    usedLaunch: BigInt(event.args.usedLaunch).toString(),
    dust: BigInt(event.args.dust).toString(),
    initialBuyWeth: BigInt(event.args.initialBuyWeth).toString(),
    initialBuyTokensOut: BigInt(event.args.initialBuyTokensOut).toString(),
    launchFee: stringifyOptionalBigInt(options.launchFeeWei),
    totalMsgValue: stringifyOptionalBigInt(options.totalMsgValueWei),
    record: stringifyBigInts({
      token: record.token,
      creator: record.creator,
      pool: record.pool,
      positionId: record.positionId,
      tickLower: record.tickLower,
      tickUpper: record.tickUpper,
      liquidity: record.liquidity,
      usedLaunch: record.usedLaunch,
      dust: record.dust,
      initialBuyWeth: record.initialBuyWeth,
      initialBuyTokensOut: record.initialBuyTokensOut,
      graduationWeth: record.graduationWeth,
    }) as Record<string, unknown>,
    receipt: stringifyBigInts({
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      hash: receipt.hash,
      status: receipt.status,
    }) as Record<string, unknown>,
  };
}

export function parseInitialBuyWei(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  const text = String(value ?? "0").trim();
  if (!text) return 0n;
  if (/^\d+$/.test(text)) return BigInt(text);
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error("invalid_initial_buy_amount");
  }
  return ethers.parseEther(text);
}

export function formatEthDecimal(wei: bigint): string {
  return ethers.formatEther(wei);
}

export function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringifyBigInts);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (
      const [key, item] of Object.entries(value as Record<string, unknown>)
    ) {
      out[key] = stringifyBigInts(item);
    }
    return out;
  }
  return value;
}

function buildLaunchParams(draft: SingleSidedLaunchDraft) {
  return {
    name: sanitizeRequired(
      draft.name,
      "name",
      SINGLE_SIDED_LAUNCH_NAME_MAX_LENGTH,
    ),
    symbol: sanitizeRequired(
      draft.symbol,
      "symbol",
      SINGLE_SIDED_LAUNCH_SYMBOL_MAX_LENGTH,
    ).toUpperCase(),
    metadataURI: sanitizeRequired(draft.metadataURI, "metadata_uri", 2048),
    initialBuyWeth: assertInitialBuyWithinCap(draft.initialBuyWei),
    salt: buildLaunchSalt(draft),
  };
}

function buildLaunchSalt(draft: SingleSidedLaunchDraft): string {
  return ethers.id(
    [
      "linkr:single-sided-launch:v1",
      draft.launchId,
      sanitizeRequired(
        draft.symbol,
        "symbol",
        SINGLE_SIDED_LAUNCH_SYMBOL_MAX_LENGTH,
      ).toUpperCase(),
    ].join(":"),
  );
}

function withGasBuffer(gasEstimate: bigint): bigint {
  return (gasEstimate * 120n) / 100n;
}

async function readGasPrice(provider: ethers.Provider): Promise<bigint> {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) throw new Error("gas_price_unavailable");
  return BigInt(gasPrice);
}

function assertInitialBuyWithinCap(initialBuyWei: bigint): bigint {
  if (initialBuyWei < 0n) throw new Error("initial_buy_negative");
  const maxInitialBuyEth = Deno.env.get("MAX_INITIAL_BUY_ETH")?.trim() || "0.1";
  const maxInitialBuyWei = ethers.parseEther(maxInitialBuyEth);
  if (initialBuyWei > maxInitialBuyWei) {
    throw new Error(`initial_buy_too_large:max_${maxInitialBuyEth}_eth`);
  }
  return initialBuyWei;
}

function sanitizeRequired(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") throw new Error(`${field}_must_be_string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  if (trimmed.length > maxLength) throw new Error(`${field}_too_long`);
  return trimmed;
}

function stringifyOptionalBigInt(
  value: bigint | string | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  return typeof value === "bigint" ? value.toString() : String(value);
}
