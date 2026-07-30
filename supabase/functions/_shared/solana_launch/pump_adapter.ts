// deno-lint-ignore-file no-explicit-any
// @ts-ignore esm.sh bn.js exposes a CommonJS default at runtime.
import BN from "https://esm.sh/bn.js@5.2.1?bundle&target=deno";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?bundle&target=deno";
import {
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "https://esm.sh/@pump-fun/pump-sdk@1.36.0?bundle&target=deno";
import {
  base58Encode,
  getSolanaTxExplorerUrl,
  type LoadedSolanaWallet,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "./runtime.ts";
import { defaultCoinWebsiteUrl } from "../launch_metadata.ts";
import {
  type PumpCreatorRewardsConfig,
  pumpCreatorRewardsShareholders,
  shouldUpdatePumpCreatorRewards,
} from "./creator_rewards.ts";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const LAMPORTS_PER_SOL = 1_000_000_000n;
const ESTIMATOR_VERSION = "pump_fun_launch_cost_estimator_v1";

export type PumpLaunchInput = {
  launchId: string;
  name: string;
  symbol: string;
  description?: string | null;
  imageUrl: string;
  initialBuySol: number;
  cashback?: boolean;
  creatorRewardsConfig?: PumpCreatorRewardsConfig | null;
  twitterUrl?: string | null;
  websiteUrl?: string | null;
  telegramUrl?: string | null;
  mayhemMode?: boolean; // User-controlled, defaults to false
};

export type PumpLaunchResult = {
  mint: string;
  signature: string;
  explorerUrl: string;
  pumpUrl: string;
  solscanUrl: string;
  metadataUri: string;
  requestedInitialBuySol: number;
  effectiveInitialBuySol: number;
  effectiveInitialBuyLamports: string;
  receipt: Record<string, unknown>;
};

export type PreparedPumpLaunch = PumpLaunchResult & {
  signedBytes: Uint8Array;
  blockhash: string;
  lastValidBlockHeight: number;
};

export type PumpFunLaunchCostEstimate = {
  estimatorVersion: string;
  minimumLaunchLamports: bigint;
  bufferLamports: bigint;
  fundingTargetLamports: bigint;
  feeLamports: bigint;
  payerDebitLamports: bigint;
  simulationUnitsConsumed: number | null;
  source: "quote_wallet_simulation" | "fallback_reserve";
  raw: Record<string, unknown>;
};

type PumpBuildResult = {
  instructions: any[];
  creatorRewards: {
    applied: boolean;
    shareholders: Array<{ address: string; shareBps: number }>;
    initializedRecipients: string[];
  };
  effectiveInitialBuySol: number;
  effectiveInitialBuyLamports: bigint;
  cashbackEnabled: boolean;
};

type CompiledPumpTransaction = {
  tx: VersionedTransaction;
  signedBytes: Uint8Array;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  message: any;
  payerIndex: number;
};

export function estimatePumpFunLaunchRequiredSol(
  initialBuySol: unknown,
  options: { feeSharingEnabled?: boolean } = {},
): number {
  const initialBuy = Math.max(0, Number(initialBuySol || 0));
  const reserve = readNumber("PUMP_FUN_LAUNCH_RESERVE_SOL", 0.02);
  const feeSharingReserve = options.feeSharingEnabled
    ? readNumber("PUMP_FUN_FEE_SHARING_RESERVE_SOL", 0.01)
    : 0;
  return initialBuy + reserve + feeSharingReserve;
}

export async function estimatePumpFunLaunchFundingLamports(
  input: PumpLaunchInput,
  options: {
    creatorWalletAddress?: string | null;
    quoteWalletSecret?: Uint8Array | null;
    env?: (name: string) => string | undefined;
    connection?: ReturnType<typeof solanaConnection>;
  } = {},
): Promise<PumpFunLaunchCostEstimate> {
  const env = options.env ?? ((name) => Deno.env.get(name) ?? undefined);
  const fallback = fallbackPumpFunLaunchFundingEstimate(input, { env });
  const dynamicEnabled = readBooleanFromEnv(
    env,
    "SOLANA_DYNAMIC_LAUNCH_FUNDING_ENABLED",
    false,
  );
  if (!dynamicEnabled) {
    return withFallbackReason(fallback, "dynamic_disabled", {
      dynamic_enabled: false,
    });
  }

  let secretBytes: Uint8Array | null = null;
  let quoteWallet: Keypair | null = null;
  try {
    const selectedSecret = options.quoteWalletSecret?.length
      ? {
        bytes: options.quoteWalletSecret,
        source: "provided_quote_wallet_secret",
      }
      : estimateWalletSecretFromEnv(env);
    const rawSecret = selectedSecret.bytes;
    if (!rawSecret?.length) {
      return dynamicFallback(fallback, "estimate_wallet_missing", env);
    }
    secretBytes = Uint8Array.from(rawSecret);
    quoteWallet = secretBytes.length === 64
      ? Keypair.fromSecretKey(secretBytes)
      : secretBytes.length === 32
      ? Keypair.fromSeed(secretBytes)
      : null;
    if (!quoteWallet) {
      return dynamicFallback(
        fallback,
        `estimate_wallet_invalid_secret_length_${secretBytes.length}`,
        env,
      );
    }

    const connection = options.connection ?? solanaConnection();
    const quoteBalance = BigInt(
      await connection.getBalance(quoteWallet.publicKey, "confirmed"),
    );
    if (quoteBalance < fallback.fundingTargetLamports) {
      return dynamicFallback(
        fallback,
        "estimate_wallet_insufficient_balance",
        env,
        {
          quote_balance_lamports: quoteBalance.toString(),
        },
      );
    }

    const mint = Keypair.generate();
    const mintAddress = mint.publicKey.toBase58();
    const quoteCreator = quoteWallet.publicKey;
    const actualCreator = options.creatorWalletAddress
      ? normalizeSolanaPublicKey(options.creatorWalletAddress)
      : null;
    const estimateInput: PumpLaunchInput = {
      ...input,
      initialBuySol: 0,
      creatorRewardsConfig: creatorRewardsConfigForEstimate(
        input.creatorRewardsConfig ?? null,
        actualCreator,
        quoteCreator.toBase58(),
      ),
    };
    const built = await buildPumpFunLaunchInstructions({
      connection,
      creator: quoteCreator,
      mint: mint.publicKey,
      input: estimateInput,
      metadataUri: defaultCoinWebsiteUrl(mintAddress),
      initialBuySol: 0,
    });
    const compiled = await compilePumpFunLaunchTransaction({
      connection,
      payer: quoteCreator,
      mint,
      instructions: built.instructions,
      signers: [quoteWallet, mint],
    });
    const fee = await connection.getFeeForMessage(
      compiled.message,
      "confirmed",
    ).catch(() => ({ value: null }));
    const feeLamports = BigInt(fee.value ?? 5_000);
    const simulation = await connection.simulateTransaction(compiled.tx, {
      sigVerify: false,
    });
    if (simulation.value.err) {
      return dynamicFallback(fallback, "simulation_failed", env, {
        simulation_error: simulation.value.err,
        logs: Array.isArray(simulation.value.logs)
          ? simulation.value.logs.slice(-20)
          : [],
      });
    }

    return estimatePumpFunLaunchFundingFromSimulation({
      simulationValue: simulation.value,
      payerIndex: compiled.payerIndex,
      feeLamports,
      fallbackMinimumLamports: fallback.minimumLaunchLamports,
      bufferLamports: pumpFunLaunchFundingBufferLamports(env),
      raw: {
        dynamic_enabled: true,
        quote_wallet_secret_source: selectedSecret.source,
        quote_wallet: quoteCreator.toBase58(),
        quote_balance_lamports: quoteBalance.toString(),
        mint: mintAddress,
        initial_buy_lamports: "0",
        creator_rewards_fee_sharing_applied: built.creatorRewards.applied,
      },
    });
  } catch (error) {
    return dynamicFallback(fallback, sanitizeEstimateError(error), env);
  } finally {
    secretBytes?.fill(0);
    quoteWallet?.secretKey.fill(0);
  }
}

export function fallbackPumpFunLaunchFundingEstimate(
  input: Pick<PumpLaunchInput, "creatorRewardsConfig">,
  options: { env?: (name: string) => string | undefined } = {},
): PumpFunLaunchCostEstimate {
  const env = options.env ?? ((name) => Deno.env.get(name) ?? undefined);
  const reserveSol = readNumberFromEnv(
    env,
    "PUMP_FUN_LAUNCH_RESERVE_SOL",
    0.02,
  );
  const feeSharingReserveSol =
    input.creatorRewardsConfig?.should_update_on_chain
      ? readNumberFromEnv(env, "PUMP_FUN_FEE_SHARING_RESERVE_SOL", 0.01)
      : 0;
  const minimumLaunchLamports = solToLamports(
    reserveSol + feeSharingReserveSol,
  );
  return {
    estimatorVersion: ESTIMATOR_VERSION,
    minimumLaunchLamports,
    bufferLamports: 0n,
    // Same rent headroom as the simulated path, so a launch funded through the
    // fallback reserve cannot be left below the rent-exempt floor either.
    fundingTargetLamports: minimumLaunchLamports +
      PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS,
    feeLamports: 0n,
    payerDebitLamports: minimumLaunchLamports,
    simulationUnitsConsumed: null,
    source: "fallback_reserve",
    raw: {
      estimator_version: ESTIMATOR_VERSION,
      source: "fallback_reserve",
      reserve_sol: reserveSol,
      fee_sharing_reserve_sol: feeSharingReserveSol,
      rent_headroom_lamports: PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS.toString(),
    },
  };
}

/**
 * Extra SOL funded on top of the estimated launch cost. Hardcoded on purpose.
 *
 * Solana rejects any transaction that would leave a surviving account below the
 * rent-exempt minimum — 890,880 lamports for a basic account. The cost estimate
 * is measured by simulating against a well-funded quote wallet that never
 * approaches that floor, so a launch wallet funded to exactly the estimate is
 * left underneath it and the launch fails with:
 *
 *   InsufficientFundsForRent { account_index: 0 }   // account 0 is the payer
 *
 * Observed in production on 2026-07-30: the wallet was funded to 7,572,480
 * lamports and the launch needed to debit 7,422,480, leaving 150,000 — some
 * 740,880 short of the floor. The transaction never landed and the work item
 * retried on a permanently failing condition.
 *
 * This headroom is not consumed. It stays in the user's wallet keeping the
 * account rent-exempt, so it is capital parked per launch rather than spend.
 *
 * Note this cannot be expressed through PUMP_FUN_LAUNCH_FUNDING_BUFFER_LAMPORTS
 * below: that value is capped at 300_000, still well under the rent floor.
 */
export const PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS = 9_000_000n; // 0.009 SOL

export function pumpFunLaunchFundingBufferLamports(
  env: (name: string) => string | undefined = (name) =>
    Deno.env.get(name) ?? undefined,
): bigint {
  const raw = Number(env("PUMP_FUN_LAUNCH_FUNDING_BUFFER_LAMPORTS"));
  if (!Number.isFinite(raw) || raw < 0) return 150_000n;
  return BigInt(Math.min(300_000, Math.floor(raw)));
}

export function estimatePumpFunLaunchFundingFromSimulation(args: {
  simulationValue: any;
  payerIndex: number;
  feeLamports: bigint;
  fallbackMinimumLamports: bigint;
  bufferLamports: bigint;
  raw?: Record<string, unknown>;
}): PumpFunLaunchCostEstimate {
  const pre = Array.isArray(args.simulationValue?.preBalances)
    ? args.simulationValue.preBalances
    : [];
  const post = Array.isArray(args.simulationValue?.postBalances)
    ? args.simulationValue.postBalances
    : [];
  const preBalance = bigintAt(pre, args.payerIndex);
  const postBalance = bigintAt(post, args.payerIndex);
  const debit = preBalance != null && postBalance != null &&
      preBalance > postBalance
    ? preBalance - postBalance
    : 0n;
  const simulatedFee = bigintFromUnknown(args.simulationValue?.fee);
  const feeOnlyLamports = simulatedFee ?? args.feeLamports;
  const payerDebitLamports = debit > 0n ? debit : feeOnlyLamports;
  const minimumLaunchLamports = payerDebitLamports > 0n
    ? payerDebitLamports
    : args.fallbackMinimumLamports;
  const guardedMinimumLamports = debit > 0n
    ? minimumLaunchLamports
    : maxBigint(minimumLaunchLamports, args.fallbackMinimumLamports);
  const effectiveBufferLamports = debit > 0n ? args.bufferLamports : 0n;
  return {
    estimatorVersion: ESTIMATOR_VERSION,
    minimumLaunchLamports: guardedMinimumLamports,
    bufferLamports: effectiveBufferLamports,
    // The payer must still be rent-exempt once the launch debits it.
    fundingTargetLamports: guardedMinimumLamports + effectiveBufferLamports +
      PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS,
    feeLamports: simulatedFee ?? args.feeLamports,
    payerDebitLamports,
    simulationUnitsConsumed: Number.isFinite(
        Number(args.simulationValue?.unitsConsumed),
      )
      ? Number(args.simulationValue.unitsConsumed)
      : null,
    source: "quote_wallet_simulation",
    raw: {
      ...(args.raw ?? {}),
      estimator_version: ESTIMATOR_VERSION,
      source: "quote_wallet_simulation",
      minimum_launch_lamports: guardedMinimumLamports.toString(),
      buffer_lamports: effectiveBufferLamports.toString(),
      rent_headroom_lamports: PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS.toString(),
      funding_target_lamports: (guardedMinimumLamports +
        effectiveBufferLamports + PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS)
        .toString(),
      fee_lamports: (simulatedFee ?? args.feeLamports).toString(),
      payer_debit_lamports: payerDebitLamports.toString(),
      simulation_units_consumed: Number.isFinite(
          Number(args.simulationValue?.unitsConsumed),
        )
        ? Number(args.simulationValue.unitsConsumed)
        : null,
    },
  };
}

export async function launchTokenOnPumpFun(
  wallet: LoadedSolanaWallet,
  input: PumpLaunchInput,
): Promise<PumpLaunchResult> {
  const prepared = await preparePumpFunLaunch(wallet, input);
  await broadcastPreparedPumpLaunch(prepared);
  const connection = solanaConnection();
  const confirmed = await connection.confirmTransaction(
    {
      signature: prepared.signature,
      blockhash: prepared.blockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (confirmed.value.err) throw new Error("pump_fun_launch_tx_failed");
  const {
    signedBytes: _,
    blockhash: __,
    lastValidBlockHeight: ___,
    ...result
  } = prepared;
  return result;
}

export async function preparePumpFunLaunch(
  wallet: LoadedSolanaWallet,
  input: PumpLaunchInput,
): Promise<PreparedPumpLaunch> {
  const connection = solanaConnection();
  const signer = Keypair.fromSecretKey(wallet.secret_key);
  const expectedAddress = normalizeSolanaPublicKey(wallet.address);
  if (signer.publicKey.toBase58() !== expectedAddress) {
    throw new Error("loaded_solana_secret_key_address_mismatch");
  }

  const mint = Keypair.generate();
  const mintAddress = mint.publicKey.toBase58();
  const metadataUri = await uploadPumpMetadata({
    ...input,
    mintAddress,
  });

  const built = await buildPumpFunLaunchInstructions({
    connection,
    creator: signer.publicKey,
    mint: mint.publicKey,
    input,
    metadataUri,
  });
  const compiled = await compilePumpFunLaunchTransaction({
    connection,
    payer: signer.publicKey,
    mint,
    instructions: built.instructions,
    signers: [signer, mint],
  });

  const simulation = await connection.simulateTransaction(compiled.tx, {
    sigVerify: false,
  });
  if (simulation.value.err) {
    const logs = Array.isArray(simulation.value.logs)
      ? simulation.value.logs.slice(-20)
      : [];
    throw new Error(
      `pump_fun_launch_simulation_failed:${
        JSON.stringify(simulation.value.err)
      }:${logs.join(" | ")}`.slice(
        0,
        500,
      ),
    );
  }

  return {
    mint: mintAddress,
    signature: compiled.signature,
    explorerUrl: getSolanaTxExplorerUrl(compiled.signature),
    pumpUrl: `https://pump.fun/${mintAddress}`,
    solscanUrl: `https://solscan.io/token/${mintAddress}`,
    metadataUri,
    requestedInitialBuySol: Math.max(0, Number(input.initialBuySol || 0)),
    effectiveInitialBuySol: built.effectiveInitialBuySol,
    effectiveInitialBuyLamports: built.effectiveInitialBuyLamports.toString(),
    receipt: {
      source: "pump-sdk",
      sdk_version: "1.36.0",
      launch_id: input.launchId,
      mint: mintAddress,
      signature: compiled.signature,
      creator: signer.publicKey.toBase58(),
      metadata_uri: metadataUri,
      cashback_enabled: built.cashbackEnabled,
      creator_rewards_config: input.creatorRewardsConfig ?? null,
      creator_rewards_fee_sharing_applied: built.creatorRewards.applied,
      creator_rewards_shareholders: built.creatorRewards.shareholders,
      creator_rewards_initialized_recipients:
        built.creatorRewards.initializedRecipients,
      initial_buy_sol: built.effectiveInitialBuySol,
      initial_buy_lamports: built.effectiveInitialBuyLamports.toString(),
      simulation_units_consumed: simulation.value.unitsConsumed ?? null,
      pump_url: `https://pump.fun/${mintAddress}`,
      solscan_url: `https://solscan.io/token/${mintAddress}`,
    },
    signedBytes: compiled.signedBytes,
    blockhash: compiled.blockhash,
    lastValidBlockHeight: compiled.lastValidBlockHeight,
  };
}

export async function broadcastPreparedPumpLaunch(
  prepared: Pick<PreparedPumpLaunch, "signedBytes" | "signature">,
): Promise<string> {
  const signature = await solanaConnection().sendRawTransaction(
    prepared.signedBytes,
    { skipPreflight: false, maxRetries: 0 },
  );
  if (signature !== prepared.signature) {
    throw new Error("pump_fun_broadcast_signature_mismatch");
  }
  return signature;
}

async function buildPumpFunLaunchInstructions(args: {
  connection: ReturnType<typeof solanaConnection>;
  creator: PublicKey;
  mint: PublicKey;
  input: PumpLaunchInput;
  metadataUri: string;
  initialBuySol?: number;
}): Promise<PumpBuildResult> {
  const effectiveInitialBuySol = clampInitialBuy(
    args.initialBuySol ?? args.input.initialBuySol,
  );
  const effectiveInitialBuyLamports = solToLamports(effectiveInitialBuySol);
  const sdk = new OnlinePumpSdk(args.connection as any);
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig().catch(() => null);
  const mayhemMode = args.input.mayhemMode ?? false;
  const cashbackEnabled = args.input.cashback !== false;
  const launchInstructions = effectiveInitialBuyLamports > 0n
    ? await buildCreateAndBuyInstructions({
      global,
      feeConfig,
      mint: args.mint,
      name: args.input.name,
      symbol: args.input.symbol,
      uri: args.metadataUri,
      signer: args.creator,
      solAmountLamports: effectiveInitialBuyLamports,
      mayhemMode,
      cashback: cashbackEnabled,
    })
    : [
      await (PUMP_SDK as any).createV2Instruction({
        mint: args.mint,
        name: args.input.name,
        symbol: args.input.symbol,
        uri: args.metadataUri,
        creator: args.creator,
        user: args.creator,
        mayhemMode,
        cashback: cashbackEnabled,
      }),
    ];
  const creatorRewards = await buildCreatorRewardsInstructions({
    connection: args.connection,
    mint: args.mint,
    creator: args.creator,
    config: args.input.creatorRewardsConfig ?? null,
  });
  const launchAndRewardInstructions = composeLaunchAndCreatorRewardInstructions(
    launchInstructions,
    creatorRewards,
  );
  const computeInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: readPositiveInt("PUMP_FUN_LAUNCH_COMPUTE_UNITS", 1_400_000),
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: readPositiveInt(
        "PUMP_FUN_LAUNCH_PRIORITY_MICROLAMPORTS",
        10_000,
      ),
    }),
  ];
  return {
    instructions: [...computeInstructions, ...launchAndRewardInstructions],
    creatorRewards,
    effectiveInitialBuySol,
    effectiveInitialBuyLamports,
    cashbackEnabled,
  };
}

async function compilePumpFunLaunchTransaction(args: {
  connection: ReturnType<typeof solanaConnection>;
  payer: PublicKey;
  mint: Keypair;
  instructions: any[];
  signers: Keypair[];
}): Promise<CompiledPumpTransaction> {
  const { blockhash, lastValidBlockHeight } = await args.connection
    .getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: args.payer,
    recentBlockhash: blockhash,
    instructions: args.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign(args.signers);
  const signedBytes = tx.serialize();
  const signature = base58Encode(tx.signatures[0]);
  const payerIndex = message.staticAccountKeys.findIndex((key) =>
    key.equals(args.payer)
  );
  if (payerIndex < 0) throw new Error("pump_fun_payer_missing_from_message");
  return {
    tx,
    signedBytes,
    signature,
    blockhash,
    lastValidBlockHeight,
    message,
    payerIndex,
  };
}

async function buildCreateAndBuyInstructions(args: {
  global: any;
  feeConfig: any;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  signer: PublicKey;
  solAmountLamports: bigint;
  mayhemMode: boolean;
  cashback: boolean;
}) {
  const amount = new BN(args.solAmountLamports.toString());
  const tokenAmountOut = (getBuyTokenAmountFromSolAmount as any)({
    global: args.global,
    feeConfig: args.feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount,
    quoteMint: PublicKey.default,
  });

  return await (PUMP_SDK as any).createV2AndBuyInstructions({
    global: args.global,
    mint: args.mint,
    name: args.name,
    symbol: args.symbol,
    uri: args.uri,
    creator: args.signer,
    user: args.signer,
    amount: tokenAmountOut,
    solAmount: amount,
    mayhemMode: args.mayhemMode,
    cashback: args.cashback,
  });
}

function composeLaunchAndCreatorRewardInstructions(
  launchInstructions: any[],
  creatorRewards: {
    recipientInitInstructions: any[];
    feeShareInstructions: any[];
  },
): any[] {
  const rewardInstructions = [
    ...creatorRewards.recipientInitInstructions,
    ...creatorRewards.feeShareInstructions,
  ];
  if (rewardInstructions.length === 0) return launchInstructions;
  if (launchInstructions.length <= 1) {
    return [...launchInstructions, ...rewardInstructions];
  }
  return [
    launchInstructions[0],
    ...rewardInstructions,
    ...launchInstructions.slice(1),
  ];
}

async function buildCreatorRewardsInstructions(args: {
  connection: ReturnType<typeof solanaConnection>;
  mint: PublicKey;
  creator: PublicKey;
  config: PumpCreatorRewardsConfig | null;
}) {
  const creatorAddress = args.creator.toBase58();
  const shareholders = pumpCreatorRewardsShareholders(
    args.config,
    creatorAddress,
  );
  if (
    !args.config || !shouldUpdatePumpCreatorRewards(args.config, creatorAddress)
  ) {
    return {
      applied: false,
      shareholders,
      initializedRecipients: [] as string[],
      recipientInitInstructions: [] as any[],
      feeShareInstructions: [] as any[],
    };
  }

  const nonCreatorRecipients = shareholders
    .map((shareholder) => new PublicKey(shareholder.address))
    .filter((address) => !address.equals(args.creator));
  const accountInfos: Array<unknown> = [];
  for (const address of nonCreatorRecipients) {
    accountInfos.push(
      await args.connection.getAccountInfo(address, "confirmed").catch(() =>
        null
      ),
    );
  }
  const initializedRecipients: string[] = [];
  const recipientInitInstructions = nonCreatorRecipients.flatMap(
    (address, index) => {
      if (accountInfos[index]) return [];
      initializedRecipients.push(address.toBase58());
      return [
        SystemProgram.transfer({
          fromPubkey: args.creator,
          toPubkey: address,
          lamports: readPositiveInt(
            "PUMP_FUN_REWARD_RECIPIENT_INIT_LAMPORTS",
            1,
          ),
        }),
      ];
    },
  );

  const createFeeSharingInstruction = await (PUMP_SDK as any)
    .createFeeSharingConfig({
      creator: args.creator,
      mint: args.mint,
      pool: null,
    });
  const feeShareInstruction = await (PUMP_SDK as any).updateFeeShares({
    authority: args.creator,
    mint: args.mint,
    currentShareholders: [args.creator],
    newShareholders: shareholders.map((shareholder) => ({
      address: new PublicKey(shareholder.address),
      shareBps: shareholder.shareBps,
    })),
  });

  return {
    applied: true,
    shareholders,
    initializedRecipients,
    recipientInitInstructions,
    feeShareInstructions: [createFeeSharingInstruction, feeShareInstruction],
  };
}

async function uploadPumpMetadata(
  input: PumpLaunchInput & { mintAddress: string },
) {
  const imageResponse = await fetchWithTimeout(input.imageUrl, {
    method: "GET",
  }, 15_000);
  if (!imageResponse.ok) {
    throw new Error(`pump_fun_image_fetch_failed:${imageResponse.status}`);
  }
  const contentLength = Number(
    imageResponse.headers.get("content-length") ?? 0,
  );
  const maximumBytes = 4 * 1024 * 1024;
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error("pump_fun_image_too_large");
  }
  const imageBytes = await readBoundedBody(imageResponse, maximumBytes);
  const imageBlob = new Blob([Uint8Array.from(imageBytes).buffer], {
    type: imageResponse.headers.get("content-type") ?? "image/png",
  });

  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const formData = new FormData();
    formData.append("file", imageBlob, "token-image.png");
    formData.append("name", input.name);
    formData.append("symbol", input.symbol);
    formData.append("description", String(input.description ?? ""));
    formData.append(
      "website",
      resolvedWebsiteUrl(input.websiteUrl, input.mintAddress),
    );
    if (input.twitterUrl) formData.append("twitter", input.twitterUrl);
    if (input.telegramUrl) formData.append("telegram", input.telegramUrl);
    formData.append("showName", "true");

    const response = await fetchWithTimeout("https://pump.fun/api/ipfs", {
      method: "POST",
      body: formData,
    }, 20_000);
    if (response.ok) {
      const json = JSON.parse(
        new TextDecoder().decode(await readBoundedBody(response, 64 * 1024)),
      );
      const metadataUri = String(json?.metadataUri ?? "").trim();
      if (metadataUri) return metadataUri;
      lastError = "missing_metadata_uri";
    } else {
      const errorText = new TextDecoder().decode(
        await readBoundedBody(response, 8 * 1024),
      );
      lastError = `${response.status}:${errorText.slice(0, 300)}`;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`pump_fun_metadata_upload_failed:${lastError}`.slice(0, 500));
}

function resolvedWebsiteUrl(value: unknown, mintAddress: string): string {
  const website = String(value ?? "").trim();
  if (!website || unresolvedDefaultWebsite(website)) {
    return defaultCoinWebsiteUrl(mintAddress);
  }
  return website;
}

function unresolvedDefaultWebsite(value: string): boolean {
  return value.replace(/\/+$/, "") ===
    defaultCoinWebsiteUrl("").replace(/\/+$/, "");
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) throw new Error("pump_fun_image_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("pump_fun_image_too_large").catch(() => {});
        throw new Error("pump_fun_image_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (output.byteLength === 0) throw new Error("pump_fun_image_empty");
  return output;
}

function clampInitialBuy(value: unknown): number {
  const max = readNumber("PUMP_FUN_MAX_INITIAL_BUY_SOL", 5);
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(amount, Math.max(0, max));
}

function dynamicFallback(
  fallback: PumpFunLaunchCostEstimate,
  reason: string,
  env: (name: string) => string | undefined,
  extra: Record<string, unknown> = {},
): PumpFunLaunchCostEstimate {
  if (
    readBooleanFromEnv(
      env,
      "SOLANA_DYNAMIC_LAUNCH_FUNDING_FAIL_CLOSED",
      false,
    )
  ) {
    throw new Error(`solana_launch_cost_estimate_failed:${reason}`);
  }
  return withFallbackReason(fallback, reason, {
    dynamic_enabled: true,
    ...extra,
  });
}

function withFallbackReason(
  fallback: PumpFunLaunchCostEstimate,
  reason: string,
  extra: Record<string, unknown>,
): PumpFunLaunchCostEstimate {
  return {
    ...fallback,
    raw: {
      ...fallback.raw,
      ...extra,
      fallback_reason: reason,
    },
  };
}

function creatorRewardsConfigForEstimate(
  config: PumpCreatorRewardsConfig | null,
  actualCreatorAddress: string | null,
  quoteCreatorAddress: string,
): PumpCreatorRewardsConfig | null {
  if (!config) return null;
  const actual = actualCreatorAddress
    ? normalizeSolanaPublicKey(actualCreatorAddress)
    : null;
  return {
    ...config,
    selected_wallet_id: null,
    creator_address: quoteCreatorAddress,
    creator_wallet_id: null,
    recipients: Array.isArray(config.recipients)
      ? config.recipients.map((row) => {
        const address = String(row?.address ?? "").trim();
        if (
          row?.role === "creator" ||
          row?.source === "creator_wallet" ||
          (actual && address === actual)
        ) {
          return {
            ...row,
            address: quoteCreatorAddress,
            userId: null,
            walletId: null,
          };
        }
        return row;
      })
      : [],
  };
}

function solToLamports(value: number): bigint {
  const text = value.toFixed(9);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * LAMPORTS_PER_SOL +
    BigInt((fraction + "0".repeat(9)).slice(0, 9));
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readNumber(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readNumberFromEnv(
  env: (name: string) => string | undefined,
  name: string,
  fallback: number,
): number {
  const value = Number(env(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readBooleanFromEnv(
  env: (name: string) => string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  const value = env(name);
  if (value == null || value.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function secretBytesFromEnv(
  env: (name: string) => string | undefined,
  name: string,
): Uint8Array | null {
  const value = env(name)?.trim();
  if (!value) return null;
  if (value.startsWith("[")) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error(`${name}_invalid_json`);
    return bytesFromNumbers(
      parsed.map((item) => Number(item)),
      `${name}_invalid_json_byte`,
    );
  }
  if (/^\d+(,\s*\d+)+$/.test(value)) {
    return bytesFromNumbers(
      value.split(",").map((item) => Number(item.trim())),
      `${name}_invalid_csv_byte`,
    );
  }
  return base58Decode(value);
}

function estimateWalletSecretFromEnv(
  env: (name: string) => string | undefined,
): { bytes: Uint8Array | null; source: string | null } {
  const explicitEstimateWallet = secretBytesFromEnv(
    env,
    "SOL_LAUNCH_ESTIMATE_WALLET",
  );
  if (explicitEstimateWallet?.length) {
    return {
      bytes: explicitEstimateWallet,
      source: "SOL_LAUNCH_ESTIMATE_WALLET",
    };
  }
  const fundingWallet = secretBytesFromEnv(env, "SOL_FUNDING_WALLET");
  if (fundingWallet?.length) {
    return {
      bytes: fundingWallet,
      source: "SOL_FUNDING_WALLET",
    };
  }
  return { bytes: null, source: null };
}

function base58Decode(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  let leadingZeros = 0;
  while (
    leadingZeros < value.length &&
    value[leadingZeros] === BASE58_ALPHABET[0]
  ) {
    leadingZeros += 1;
  }
  if (leadingZeros === value.length) return new Uint8Array(leadingZeros);
  const bytes = [0];
  for (const char of value.slice(leadingZeros)) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid_base58_secret");
    let carry = index;
    for (let cursor = 0; cursor < bytes.length; cursor++) {
      const next = bytes[cursor] * 58 + carry;
      bytes[cursor] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Uint8Array.from([
    ...Array(leadingZeros).fill(0),
    ...bytes.reverse(),
  ]);
}

function bytesFromNumbers(values: number[], error: string): Uint8Array {
  if (
    values.some((item) => !Number.isInteger(item) || item < 0 || item > 255)
  ) {
    throw new Error(error);
  }
  return Uint8Array.from(values);
}

function bigintAt(values: unknown[], index: number): bigint | null {
  if (index < 0 || index >= values.length) return null;
  return bigintFromUnknown(values[index]);
}

function bigintFromUnknown(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? BigInt(Math.floor(value))
      : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
}

function maxBigint(left: bigint, right: bigint): bigint {
  return left >= right ? left : right;
}

function sanitizeEstimateError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/[1-9A-HJ-NP-Za-km-z]{64,100}/g, "[redacted]")
    .replace(/[^a-z0-9:_-]+/gi, "_")
    .slice(0, 160) || "unknown_estimate_error";
}
