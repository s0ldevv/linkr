// Robinhood launch-only signing boundary. The pinned bundle is isolated from
// legacy APIs and loaded only after a durable queue claim.
// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6.17.0?bundle&target=deno";
import { decryptSecret } from "../crypto.ts";
import { SINGLE_SIDED_LAUNCH_FACTORY_ABI } from "./abi.ts";
import {
  readLaunchFactoryAddress,
  SINGLE_SIDED_LAUNCH_DESCRIPTION_MAX_LENGTH,
  SINGLE_SIDED_LAUNCH_LOGO_URI_MAX_LENGTH,
  SINGLE_SIDED_LAUNCH_METADATA_URI_MAX_LENGTH,
  SINGLE_SIDED_LAUNCH_NAME_MAX_LENGTH,
  SINGLE_SIDED_LAUNCH_SOCIAL_URL_MAX_LENGTH,
  SINGLE_SIDED_LAUNCH_SYMBOL_MAX_LENGTH,
} from "./constants.ts";

const ROBINHOOD_CHAIN_ID = 4663;
const DEFAULT_LAUNCH_FUNDING_HEADROOM_BPS = 2_500n;
const MAX_LAUNCH_FUNDING_HEADROOM_BPS = 10_000n;

export interface LoadedLaunchWallet {
  id: string;
  user_id: string;
  address: string;
  private_key: Uint8Array;
  private_key_hex: string;
}

export type LaunchDraft = {
  launchId: string;
  name: string;
  symbol: string;
  metadataURI: string;
  logoURI: string;
  description?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  discord?: string | null;
  website?: string | null;
  farcaster?: string | null;
  initialBuyWei: bigint;
  saltSeed?: string | null;
};

export type LaunchPreflight = {
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

export type PreparedLaunch = LaunchPreflight & {
  signedBytes: Uint8Array;
  txHash: string;
  nonce: number;
  salt: string;
};

export async function loadWalletById(
  admin: any,
  walletId: string,
  expectedUserId?: string | null,
): Promise<LoadedLaunchWallet | null> {
  const query = admin.from("wallets").select(
    "id,user_id,public_key,address,wallet_type,chain_id,encrypted_private_key,encryption_iv",
  ).eq("id", walletId).eq("wallet_type", "evm").eq(
    "chain_id",
    ROBINHOOD_CHAIN_ID,
  ).limit(1);
  if (expectedUserId) query.eq("user_id", expectedUserId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const secret = Deno.env.get("WALLET_ENCRYPTION_SECRET");
  if (!secret) throw new Error("WALLET_ENCRYPTION_SECRET_missing");
  const raw = await decryptSecret(secret, {
    ciphertext: data.encrypted_private_key,
    iv: data.encryption_iv,
  });
  if (raw.length !== 32) {
    raw.fill(0);
    throw new Error(`unsupported_evm_private_key_length_${raw.length}`);
  }
  const privateKeyHex = ethers.hexlify(raw);
  const expected = normalizeAddress(data.address ?? data.public_key);
  if (normalizeAddress(ethers.computeAddress(privateKeyHex)) !== expected) {
    raw.fill(0);
    throw new Error("wallet_key_address_mismatch");
  }
  return {
    id: data.id,
    user_id: data.user_id,
    address: expected,
    private_key: raw,
    private_key_hex: privateKeyHex,
  };
}

export function walletFromLoadedWallet(
  wallet: LoadedLaunchWallet,
): ethers.Wallet {
  const signer = new ethers.Wallet(wallet.private_key_hex, provider());
  if (normalizeAddress(signer.address) !== wallet.address) {
    throw new Error("loaded_private_key_address_mismatch");
  }
  return signer;
}

export async function estimateSingleSidedLaunch(
  signer: ethers.Wallet,
  draft: LaunchDraft,
): Promise<LaunchPreflight> {
  if (!signer.provider) throw new Error("launch_provider_missing");
  const factoryAddress = normalizeAddress(readLaunchFactoryAddress());
  const factory = new ethers.Contract(
    factoryAddress,
    SINGLE_SIDED_LAUNCH_FACTORY_ABI,
    signer,
  );
  const launchFeeWei = BigInt(await factory.launchFee());
  const initialBuyWei = assertInitialBuyWithinCap(draft.initialBuyWei);
  const totalMsgValueWei = launchFeeWei + initialBuyWei;
  const params = buildLaunchParams(draft);
  const predictedToken = normalizeAddress(
    await factory.predictTokenAddress(params, signer.address),
  );
  const signerBalanceWei = BigInt(
    await signer.provider.getBalance(signer.address),
  );
  if (signerBalanceWei < totalMsgValueWei) {
    return {
      factoryAddress,
      signerAddress: normalizeAddress(signer.address),
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
  const gasLimit = (gasEstimate * 120n) / 100n;
  const feeData = await signer.provider.getFeeData();
  const gasPriceWei = BigInt(feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n);
  if (gasPriceWei <= 0n) throw new Error("gas_price_unavailable");
  const estimatedGasCostWei = gasLimit * gasPriceWei;
  return {
    factoryAddress,
    signerAddress: normalizeAddress(signer.address),
    predictedToken,
    launchFeeWei,
    initialBuyWei,
    totalMsgValueWei,
    gasEstimate,
    gasLimit,
    gasPriceWei,
    estimatedGasCostWei,
    requiredBalanceWei: totalMsgValueWei + estimatedGasCostWei,
    signerBalanceWei,
  };
}

export async function prepareSignedSingleSidedLaunch(
  signer: ethers.Wallet,
  draft: LaunchDraft,
  checked: LaunchPreflight,
): Promise<PreparedLaunch> {
  if (checked.signerBalanceWei < checked.requiredBalanceWei) {
    throw new Error("insufficient_launch_signer_balance");
  }
  if (!signer.provider) throw new Error("launch_provider_missing");
  const network = await signer.provider.getNetwork();
  if (Number(network.chainId) !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`unexpected_robinhood_chain_id_${network.chainId}`);
  }
  const factory = new ethers.Contract(
    checked.factoryAddress,
    SINGLE_SIDED_LAUNCH_FACTORY_ABI,
    signer,
  );
  const params = buildLaunchParams(draft);
  const nonce = await signer.getNonce("pending");
  const populated = await factory.launch.populateTransaction(params, {
    value: checked.totalMsgValueWei,
    gasLimit: checked.gasLimit,
  });
  const signedHex = await signer.signTransaction({
    ...populated,
    chainId: ROBINHOOD_CHAIN_ID,
    nonce,
    gasLimit: checked.gasLimit,
    gasPrice: checked.gasPriceWei,
    type: 0,
  });
  return {
    ...checked,
    signedBytes: ethers.getBytes(signedHex),
    txHash: ethers.keccak256(signedHex),
    nonce,
    salt: params.salt,
  };
}

export async function broadcastSignedSingleSidedLaunch(
  signerProvider: ethers.Provider,
  prepared: Pick<PreparedLaunch, "signedBytes" | "txHash">,
): Promise<string> {
  const response = await signerProvider.broadcastTransaction(
    ethers.hexlify(prepared.signedBytes),
  );
  if (response.hash.toLowerCase() !== prepared.txHash.toLowerCase()) {
    throw new Error("robinhood_broadcast_hash_mismatch");
  }
  return response.hash;
}

/**
 * The balance the platform tops a launch signer up to, not the bare minimum.
 *
 * `requiredBalanceWei` is a snapshot: `gasLimit * gasPrice` at preflight. After
 * funding, the worker retries and preflights *again*, and only then signs. The
 * gas estimate for `launch()` is deterministic (measured: 6,224,081 on every
 * sample), but the gas price moves every block — 8 distinct prices and a 2.04%
 * spread across 8 samples taken at the worker's own 3s retry cadence.
 *
 * Funding the exact deficit therefore loses a coin flip about half the time:
 * the second preflight sees a deficit again, and because the funding event is
 * already `confirmed`, `fundRobinhoodLaunchIfNeeded` reports `funded` without
 * sending anything more. The launch then retries every 3s until the 900s
 * watchdog cancels it, and the user is told only that something took too long.
 *
 * The headroom is what breaks that loop. Overshoot is not spent and not lost —
 * it stays in the user's own wallet and offsets their next action.
 */
export function launchFundingTargetWei(preflight: LaunchPreflight): bigint {
  const required = preflight.requiredBalanceWei;
  if (required <= 0n) return required;
  return required + (required * readFundingHeadroomBps()) / 10_000n;
}

function readFundingHeadroomBps(): bigint {
  const raw = Deno.env.get("ROBINHOOD_LAUNCH_FUNDING_HEADROOM_BPS")?.trim();
  if (!raw || !/^\d{1,5}$/.test(raw)) {
    return DEFAULT_LAUNCH_FUNDING_HEADROOM_BPS;
  }
  const bps = BigInt(raw);
  // A fat-fingered override must never become a dev-wallet drain.
  return bps > MAX_LAUNCH_FUNDING_HEADROOM_BPS
    ? DEFAULT_LAUNCH_FUNDING_HEADROOM_BPS
    : bps;
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

export function buildLaunchSalt(draft: LaunchDraft): string {
  const explicit = normalizeLaunchSaltSeed(draft.saltSeed);
  if (explicit) return explicit;
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

export function generateLaunchSaltSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ethers.hexlify(bytes);
}

export function normalizeLaunchSaltSeed(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^0x[a-fA-F0-9]{64}$/.test(text)) return null;
  if (/^0x0{64}$/i.test(text)) return null;
  return ethers.hexlify(ethers.getBytes(text));
}

function provider(): ethers.JsonRpcProvider {
  const rpcUrl = Deno.env.get("ROBINHOOD_RPC_URL")?.trim() ||
    "https://rpc.mainnet.chain.robinhood.com";
  if (!/^https:\/\//i.test(rpcUrl)) {
    throw new Error("ROBINHOOD_RPC_URL_insecure");
  }
  return new ethers.JsonRpcProvider(rpcUrl, {
    chainId: ROBINHOOD_CHAIN_ID,
    name: "robinhood",
  });
}

function normalizeAddress(value: string): string {
  const text = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) throw new Error("invalid_evm_address");
  return ethers.getAddress(text);
}

function buildLaunchParams(draft: LaunchDraft) {
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
    metadataURI: sanitizeRequired(
      draft.metadataURI,
      "metadata_uri",
      SINGLE_SIDED_LAUNCH_METADATA_URI_MAX_LENGTH,
    ),
    logo: sanitizeRequired(
      draft.logoURI,
      "logo_uri",
      SINGLE_SIDED_LAUNCH_LOGO_URI_MAX_LENGTH,
    ),
    description: sanitizeOptionalText(
      draft.description,
      "description",
      SINGLE_SIDED_LAUNCH_DESCRIPTION_MAX_LENGTH,
    ),
    socials: {
      twitter: sanitizeOptionalText(
        draft.twitter,
        "twitter",
        SINGLE_SIDED_LAUNCH_SOCIAL_URL_MAX_LENGTH,
      ),
      telegram: sanitizeOptionalText(
        draft.telegram,
        "telegram",
        SINGLE_SIDED_LAUNCH_SOCIAL_URL_MAX_LENGTH,
      ),
      discord: sanitizeOptionalText(
        draft.discord,
        "discord",
        SINGLE_SIDED_LAUNCH_SOCIAL_URL_MAX_LENGTH,
      ),
      website: sanitizeOptionalText(
        draft.website,
        "website",
        SINGLE_SIDED_LAUNCH_SOCIAL_URL_MAX_LENGTH,
      ),
      farcaster: sanitizeOptionalText(
        draft.farcaster,
        "farcaster",
        SINGLE_SIDED_LAUNCH_SOCIAL_URL_MAX_LENGTH,
      ),
    },
    initialBuyWeth: assertInitialBuyWithinCap(draft.initialBuyWei),
    salt: buildLaunchSalt(draft),
  };
}

function assertInitialBuyWithinCap(initialBuyWei: bigint): bigint {
  if (initialBuyWei < 0n) throw new Error("initial_buy_negative");
  const maxEth = Deno.env.get("MAX_INITIAL_BUY_ETH")?.trim() || "0.1";
  const maxWei = ethers.parseEther(maxEth);
  if (initialBuyWei > maxWei) {
    throw new Error(`initial_buy_too_large:max_${maxEth}_eth`);
  }
  return initialBuyWei;
}

function sanitizeRequired(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") throw new Error(`${field}_must_be_string`);
  const text = value.trim();
  if (!text) throw new Error(`${field}_required`);
  if (text.length > maxLength) throw new Error(`${field}_too_long`);
  return text;
}

function sanitizeOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw new Error(`${field}_too_long`);
  return text;
}
