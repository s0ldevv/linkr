// deno-lint-ignore-file no-explicit-any
// @ts-ignore esm.sh bn.js exposes a CommonJS default at runtime.
import BN from "https://esm.sh/bn.js@5.2.1";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
} from "https://esm.sh/@pump-fun/pump-sdk@1.36.0?bundle&target=deno";
import {
  getSolanaTxExplorerUrl,
  normalizeSolanaPublicKey,
  solanaConnection,
  type LoadedSolanaWallet,
} from "../solana_chain.ts";
import { defaultCoinWebsiteUrl } from "../launch_metadata.ts";
import {
  pumpCreatorRewardsShareholders,
  shouldUpdatePumpCreatorRewards,
  type PumpCreatorRewardsConfig,
} from "../pump_creator_rewards.ts";

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

export async function launchTokenOnPumpFun(
  wallet: LoadedSolanaWallet,
  input: PumpLaunchInput,
): Promise<PumpLaunchResult> {
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
  const effectiveInitialBuySol = clampInitialBuy(input.initialBuySol);
  const effectiveInitialBuyLamports = solToLamports(effectiveInitialBuySol);

  const sdk = new OnlinePumpSdk(connection as any);
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig().catch(() => null);
  const mayhemMode = Boolean((global as any)?.mayhemModeEnabled);
  const cashbackEnabled = input.cashback !== false;
  const launchInstructions =
    effectiveInitialBuyLamports > 0n
      ? await buildCreateAndBuyInstructions({
          global,
          feeConfig,
          mint: mint.publicKey,
          name: input.name,
          symbol: input.symbol,
          uri: metadataUri,
          signer: signer.publicKey,
          solAmountLamports: effectiveInitialBuyLamports,
          mayhemMode,
          cashback: cashbackEnabled,
        })
      : [
          await (PUMP_SDK as any).createV2Instruction({
            mint: mint.publicKey,
            name: input.name,
            symbol: input.symbol,
            uri: metadataUri,
            creator: signer.publicKey,
            user: signer.publicKey,
            mayhemMode,
            cashback: cashbackEnabled,
          }),
        ];
  const creatorRewards = await buildCreatorRewardsInstructions({
    connection,
    mint: mint.publicKey,
    creator: signer.publicKey,
    config: input.creatorRewardsConfig ?? null,
  });

  const computeInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: readPositiveInt("PUMP_FUN_LAUNCH_COMPUTE_UNITS", 1_400_000),
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: readPositiveInt("PUMP_FUN_LAUNCH_PRIORITY_MICROLAMPORTS", 10_000),
    }),
  ];

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const launchAndRewardInstructions = composeLaunchAndCreatorRewardInstructions(
    launchInstructions,
    creatorRewards,
  );
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...computeInstructions, ...launchAndRewardInstructions],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([signer, mint]);

  const simulation = await connection.simulateTransaction(tx, { sigVerify: false });
  if (simulation.value.err) {
    const logs = Array.isArray(simulation.value.logs) ? simulation.value.logs.slice(-20) : [];
    throw new Error(
      `pump_fun_launch_simulation_failed:${JSON.stringify(simulation.value.err)}:${logs.join(" | ")}`.slice(
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
  if (confirmed.value.err) throw new Error("pump_fun_launch_tx_failed");

  return {
    mint: mintAddress,
    signature,
    explorerUrl: getSolanaTxExplorerUrl(signature),
    pumpUrl: `https://pump.fun/${mintAddress}`,
    solscanUrl: `https://solscan.io/token/${mintAddress}`,
    metadataUri,
    requestedInitialBuySol: Math.max(0, Number(input.initialBuySol || 0)),
    effectiveInitialBuySol,
    effectiveInitialBuyLamports: effectiveInitialBuyLamports.toString(),
    receipt: {
      source: "pump-sdk",
      sdk_version: "1.36.0",
      launch_id: input.launchId,
      mint: mintAddress,
      signature,
      creator: signer.publicKey.toBase58(),
      metadata_uri: metadataUri,
      cashback_enabled: cashbackEnabled,
      creator_rewards_config: input.creatorRewardsConfig ?? null,
      creator_rewards_fee_sharing_applied: creatorRewards.applied,
      creator_rewards_shareholders: creatorRewards.shareholders,
      creator_rewards_initialized_recipients: creatorRewards.initializedRecipients,
      initial_buy_sol: effectiveInitialBuySol,
      initial_buy_lamports: effectiveInitialBuyLamports.toString(),
      simulation_units_consumed: simulation.value.unitsConsumed ?? null,
      pump_url: `https://pump.fun/${mintAddress}`,
      solscan_url: `https://solscan.io/token/${mintAddress}`,
    },
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
  if (launchInstructions.length <= 1) return [...launchInstructions, ...rewardInstructions];
  return [launchInstructions[0], ...rewardInstructions, ...launchInstructions.slice(1)];
}

async function buildCreatorRewardsInstructions(args: {
  connection: ReturnType<typeof solanaConnection>;
  mint: PublicKey;
  creator: PublicKey;
  config: PumpCreatorRewardsConfig | null;
}) {
  const creatorAddress = args.creator.toBase58();
  const shareholders = pumpCreatorRewardsShareholders(args.config, creatorAddress);
  if (!args.config || !shouldUpdatePumpCreatorRewards(args.config, creatorAddress)) {
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
  const accountInfos = await Promise.all(
    nonCreatorRecipients.map((address) =>
      args.connection.getAccountInfo(address, "confirmed").catch(() => null),
    ),
  );
  const initializedRecipients: string[] = [];
  const recipientInitInstructions = nonCreatorRecipients.flatMap((address, index) => {
    if (accountInfos[index]) return [];
    initializedRecipients.push(address.toBase58());
    return [
      SystemProgram.transfer({
        fromPubkey: args.creator,
        toPubkey: address,
        lamports: readPositiveInt("PUMP_FUN_REWARD_RECIPIENT_INIT_LAMPORTS", 1),
      }),
    ];
  });

  const createFeeSharingInstruction = await (PUMP_SDK as any).createFeeSharingConfig({
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

async function uploadPumpMetadata(input: PumpLaunchInput & { mintAddress: string }) {
  const imageResponse = await fetch(input.imageUrl);
  if (!imageResponse.ok) throw new Error(`pump_fun_image_fetch_failed:${imageResponse.status}`);
  const imageBlob = await imageResponse.blob();

  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const formData = new FormData();
    formData.append("file", imageBlob, "token-image.png");
    formData.append("name", input.name);
    formData.append("symbol", input.symbol);
    formData.append("description", String(input.description ?? ""));
    formData.append("website", input.websiteUrl || defaultCoinWebsiteUrl(input.mintAddress));
    if (input.twitterUrl) formData.append("twitter", input.twitterUrl);
    if (input.telegramUrl) formData.append("telegram", input.telegramUrl);
    formData.append("showName", "true");

    const response = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: formData });
    if (response.ok) {
      const json = await response.json();
      const metadataUri = String(json?.metadataUri ?? "").trim();
      if (metadataUri) return metadataUri;
      lastError = "missing_metadata_uri";
    } else {
      lastError = `${response.status}:${(await response.text()).slice(0, 300)}`;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  throw new Error(`pump_fun_metadata_upload_failed:${lastError}`.slice(0, 500));
}

function clampInitialBuy(value: unknown): number {
  const max = readNumber("PUMP_FUN_MAX_INITIAL_BUY_SOL", 5);
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(amount, Math.max(0, max));
}

function solToLamports(value: number): bigint {
  const text = value.toFixed(9);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt((fraction + "0".repeat(9)).slice(0, 9));
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readNumber(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
