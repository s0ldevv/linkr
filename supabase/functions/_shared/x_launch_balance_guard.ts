// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { getEthBalanceWei, ROBINHOOD_CHAIN_ID } from "./robinhood_chain.ts";
import {
  LAMPORTS_PER_SOL,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "./solana_chain.ts";
import { isFirstLaunchSubsidyEligible } from "./first_launch_subsidy.ts";
import type { LaunchFields } from "./x_launch_command.ts";

export type XLaunchBalanceChain = "robinhood" | "solana";
// Kept in step with SOL_LAUNCH_FUNDING_CAP_LAMPORTS in solana_launch/funding.ts.
// If the intake guard's ceiling is lower than what Linkr will actually fund, it
// turns away launches the platform is willing and able to cover.
const SOL_LAUNCH_FUNDING_CAP_LAMPORTS = 30_000_000n;
const DEFAULT_ROBINHOOD_LAUNCH_FUNDING_CAP_ETH = 0.005;
const DEFAULT_SOLANA_LAUNCH_INTAKE_MINIMUM_SOL = 0.008;

export type XLaunchBalanceGuardResult =
  | {
    ok: true;
    chain: XLaunchBalanceChain;
    balanceRaw: bigint;
    requiredRaw: bigint;
    walletAddress: string;
    fundingExpected?: boolean;
  }
  | {
    ok: false;
    chain: XLaunchBalanceChain;
    replyKind: string;
    replyText: string;
    balanceRaw: bigint | null;
    requiredRaw: bigint;
    walletAddress: string | null;
  };

export interface XLaunchBalanceGuardDeps {
  getEthBalanceWei?: (address: string) => Promise<bigint>;
  getSolBalanceLamports?: (address: string) => Promise<number>;
  isLaunchFundingEligible?: (
    admin: any,
    userId: string,
    options: { chain: XLaunchBalanceChain },
  ) => Promise<boolean>;
  env?: (name: string) => string | undefined;
}

export function resolveGuardedLaunchChain(args: {
  existingFields?: LaunchFields | null;
  incomingFields?: LaunchFields | null;
}): XLaunchBalanceChain | null {
  const incoming = args.incomingFields ?? {};
  if (incoming.chain_ambiguous) return null;
  const chain = incoming.chain ?? args.existingFields?.chain ?? null;
  return chain === "solana" || chain === "robinhood" ? chain : null;
}

export async function checkXLaunchNativeBalance(args: {
  admin: any;
  userId: string;
  chain: XLaunchBalanceChain;
  fields: LaunchFields;
  deps?: XLaunchBalanceGuardDeps;
}): Promise<XLaunchBalanceGuardResult> {
  const deps = args.deps ?? {};
  const env = deps.env ?? ((name) => Deno.env.get(name) ?? undefined);
  const wallet = await loadWalletAddress(args.admin, args.userId, args.chain);
  const requiredRaw = minimumLaunchNativeRequirement(
    args.chain,
    args.fields,
    env,
  );
  if (!wallet) {
    return {
      ok: false,
      chain: args.chain,
      replyKind: "launch_wallet_missing",
      replyText: missingWalletReply(args.chain),
      balanceRaw: null,
      requiredRaw,
      walletAddress: null,
    };
  }

  const balanceRaw = args.chain === "solana"
    ? BigInt(
      await (deps.getSolBalanceLamports ?? getDefaultSolBalanceLamports)(
        wallet.address,
      ),
    )
    : await (deps.getEthBalanceWei ?? getEthBalanceWei)(wallet.address);

  if (balanceRaw >= requiredRaw) {
    return {
      ok: true,
      chain: args.chain,
      balanceRaw,
      requiredRaw,
      walletAddress: wallet.address,
    };
  }

  if (
    await launchFundingCanCoverDeficit({
      ...args,
      balanceRaw,
      requiredRaw,
      deps,
      env,
    })
  ) {
    return {
      ok: true,
      chain: args.chain,
      balanceRaw,
      requiredRaw,
      walletAddress: wallet.address,
      fundingExpected: true,
    };
  }

  return {
    ok: false,
    chain: args.chain,
    replyKind: "launch_insufficient_intake_balance",
    replyText: insufficientBalanceReply(args.chain, balanceRaw, requiredRaw),
    balanceRaw,
    requiredRaw,
    walletAddress: wallet.address,
  };
}

async function launchFundingCanCoverDeficit(args: {
  admin: any;
  userId: string;
  chain: XLaunchBalanceChain;
  fields: LaunchFields;
  balanceRaw: bigint;
  requiredRaw: bigint;
  deps: XLaunchBalanceGuardDeps;
  env: (name: string) => string | undefined;
}): Promise<boolean> {
  const deficit = args.requiredRaw - args.balanceRaw;
  if (deficit <= 0n) return true;
  const unit = args.chain === "solana" ? "SOL" : "ETH";
  if (devBuyAmount(args.fields, unit) > 0) return false;
  if (deficit > maximumLaunchFundingDeficit(args.chain, args.env)) {
    return false;
  }
  try {
    return await (
      args.deps.isLaunchFundingEligible ?? isFirstLaunchSubsidyEligible
    )(args.admin, args.userId, { chain: args.chain });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "x_launch_funding_eligibility_error",
        chain: args.chain,
        message: String(error instanceof Error ? error.message : error)
          .slice(0, 300),
      }),
    );
    return false;
  }
}

export function minimumLaunchNativeRequirement(
  chain: XLaunchBalanceChain,
  fields: LaunchFields,
  env: (name: string) => string | undefined = (name) =>
    Deno.env.get(name) ?? undefined,
): bigint {
  if (chain === "solana") {
    const minimumSol = decimalOrFallback(
      env("X_LAUNCH_MIN_BALANCE_SOL") ??
        env("PUMP_FUN_LAUNCH_ESTIMATED_MINIMUM_SOL"),
      DEFAULT_SOLANA_LAUNCH_INTAKE_MINIMUM_SOL,
    );
    return solToLamports(minimumSol) +
      solToLamports(devBuyAmount(fields, "SOL"));
  }

  const minimumEth = decimalOrFallback(
    env("X_LAUNCH_MIN_BALANCE_ETH"),
    0.0005,
  );
  return ethers.parseEther(decimalString(minimumEth)) +
    ethers.parseEther(decimalString(devBuyAmount(fields, "ETH")));
}

export function insufficientBalanceReply(
  chain: XLaunchBalanceChain,
  balanceRaw: bigint,
  requiredRaw: bigint,
): string {
  const symbol = chain === "solana" ? "SOL" : "ETH";
  const chainLabel = chain === "solana" ? "Solana" : "Robinhood Chain";
  const balance = formatNative(chain, balanceRaw);
  const required = formatNative(chain, requiredRaw);
  const noBalance = balanceRaw <= 0n;
  return noBalance
    ? `Your Linkr wallet has no ${symbol} on ${chainLabel}, so I can't start that token launch yet. Fund it with at least ${required} ${symbol}, then send the launch again.`
    : `Your Linkr wallet only has ${balance} ${symbol} on ${chainLabel}. It needs at least ${required} ${symbol} before I can start that token launch. Fund it, then send the launch again.`;
}

function missingWalletReply(chain: XLaunchBalanceChain): string {
  const chainLabel = chain === "solana" ? "Solana" : "Robinhood Chain";
  return `I couldn't find a Linkr wallet for ${chainLabel} yet. Create or connect that wallet before starting a token launch.`;
}

async function loadWalletAddress(
  admin: any,
  userId: string,
  chain: XLaunchBalanceChain,
): Promise<{ id: string; address: string } | null> {
  const query = admin.from("wallets")
    .select("id,address,public_key,wallet_type,chain_id")
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (chain === "solana") {
    query.eq("wallet_type", "solana");
  } else {
    query.eq("wallet_type", "evm").eq("chain_id", ROBINHOOD_CHAIN_ID);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const rawAddress = String(data.address ?? data.public_key ?? "").trim();
  if (chain === "solana") {
    return { id: data.id, address: normalizeSolanaPublicKey(rawAddress) };
  }
  return { id: data.id, address: ethers.getAddress(rawAddress) };
}

function devBuyAmount(fields: LaunchFields, unit: "ETH" | "SOL"): number {
  const value = String(fields.dev_buy_amount ?? "").trim();
  if (!value) return 0;
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(ETH|SOL)$/i);
  if (!match || match[2].toUpperCase() !== unit) return 0;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

async function getDefaultSolBalanceLamports(address: string): Promise<number> {
  const publicKey = new PublicKey(normalizeSolanaPublicKey(address));
  return await solanaConnection().getBalance(publicKey, "confirmed");
}

function decimalOrFallback(
  value: string | undefined,
  fallback: number,
): number {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function solToLamports(value: number): bigint {
  return BigInt(Math.ceil(value * LAMPORTS_PER_SOL));
}

function maximumLaunchFundingDeficit(
  chain: XLaunchBalanceChain,
  env: (name: string) => string | undefined,
): bigint {
  if (chain === "solana") return SOL_LAUNCH_FUNDING_CAP_LAMPORTS;
  const maxEth = decimalOrFallback(
    env("MAX_FIRST_LAUNCH_SUBSIDY_ETH"),
    DEFAULT_ROBINHOOD_LAUNCH_FUNDING_CAP_ETH,
  );
  return ethers.parseEther(decimalString(maxEth));
}

function formatNative(chain: XLaunchBalanceChain, value: bigint): string {
  if (chain === "solana") {
    return trimDecimal((Number(value) / LAMPORTS_PER_SOL).toFixed(6));
  }
  return trimDecimal(Number(ethers.formatEther(value)).toFixed(6));
}

function decimalString(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return value.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

function trimDecimal(value: string): string {
  return value.replace(/0+$/, "").replace(/\.$/, "") || "0";
}
