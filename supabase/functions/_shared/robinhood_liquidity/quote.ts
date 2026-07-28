// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { ERC20_ABI, V3_FACTORY_ABI } from "./abi.ts";
import {
  readDefaultPoolFee,
  readDefaultRangeMultiplier,
  readDefaultRangeWidth,
  readLiquidityDeadlineSeconds,
  readMaxAddEth,
  readMaxRemovePercent,
  readPositionManagerAddress,
  readV3FactoryAddress,
  readWethAddress,
} from "./constants.ts";
import { AddLiquidityQuote, RemoveLiquidityQuote } from "./types.ts";
import {
  assertNotLockedLaunchPosition,
  assertUserOwnsPosition,
  isWeth,
  liquidityProvider,
  positionManagerContract,
  readPoolState,
  readTokenMeta,
  resolveLaunchedPool,
} from "./positions.ts";
import {
  applySlippage,
  defaultWideRange,
  estimateCounterpartAmount,
  parseEthUnits,
  parseTokenUnits,
} from "./math.ts";
import { normalizeEvmAddress } from "../robinhood_chain.ts";

export async function quoteAddLiquidity(
  admin: any,
  userId: string,
  body: any,
): Promise<AddLiquidityQuote> {
  const tokenQuery = String(
    body.token ?? body.token_query ?? body.tokenAddress ?? body.token_address ?? "",
  ).trim();
  const ethAmountWei = parseEthUnits(body.ethAmount ?? body.eth_amount ?? body.amount_eth);
  const maxAddEth = readMaxAddEth();
  if (Number(ethers.formatEther(ethAmountWei)) > maxAddEth)
    throw new Error("liquidity_eth_amount_too_large");

  const slippageBps = numberOrDefault(body.slippageBps ?? body.slippage_bps, 100);
  const launch = await resolveLaunchedPool(admin, tokenQuery);
  const provider = liquidityProvider();
  const weth = normalizeEvmAddress(readWethAddress());
  const manager = normalizeEvmAddress(readPositionManagerAddress());
  const pool = await readPoolState(launch.poolAddress, provider);
  if (pool.fee !== (launch.poolFee || readDefaultPoolFee())) throw new Error("pool_fee_mismatch");
  if (
    pool.token0.toLowerCase() !== launch.tokenAddress.toLowerCase() &&
    pool.token1.toLowerCase() !== launch.tokenAddress.toLowerCase()
  ) {
    throw new Error("pool_token_mismatch");
  }
  if (!isWeth(pool.token0) && !isWeth(pool.token1)) throw new Error("pool_missing_weth");

  const factory = new ethers.Contract(readV3FactoryAddress(), V3_FACTORY_ABI, provider);
  const spacing = Number(await factory.feeAmountTickSpacing(pool.fee));
  const range = defaultWideRange({
    currentTick: pool.tick,
    spacing,
    width: readDefaultRangeWidth(),
    multiplier: readDefaultRangeMultiplier(),
    fallbackLower: launch.launchTickLower,
    fallbackUpper: launch.launchTickUpper,
  });

  const tokenMeta = await readTokenMeta(launch.tokenAddress, provider);
  const tokenIsToken0 = pool.token0.toLowerCase() === launch.tokenAddress.toLowerCase();
  const requestedTokenWei =
    parseTokenUnits(
      body.tokenAmount ?? body.token_amount ?? body.amount_token,
      tokenMeta.decimals,
    ) ??
    estimateCounterpartAmount({
      wethAmountWei: ethAmountWei,
      sqrtPriceX96: pool.sqrtPriceX96,
      tokenIsToken0,
      tokenDecimals: tokenMeta.decimals,
    });
  if (requestedTokenWei <= 0n) throw new Error("token_amount_required");

  const { data: walletRow, error: walletError } = await admin
    .from("wallets")
    .select("address,public_key")
    .eq("user_id", userId)
    .eq("wallet_type", "evm")
    .eq("chain_id", 4663)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (walletError) throw walletError;
  if (!walletRow) throw new Error("no_wallet");
  const walletAddress = normalizeEvmAddress(walletRow.address ?? walletRow.public_key);

  const token = new ethers.Contract(launch.tokenAddress, ERC20_ABI, provider);
  const wethContract = new ethers.Contract(weth, ERC20_ABI, provider);
  const [ethBalance, tokenBalance, wethBalance, tokenAllowance, wethAllowance] = await Promise.all([
    provider.getBalance(walletAddress),
    token.balanceOf(walletAddress),
    wethContract.balanceOf(walletAddress),
    token.allowance(walletAddress, manager),
    wethContract.allowance(walletAddress, manager),
  ]);

  if (ethBalance < ethAmountWei) throw new Error("insufficient_eth_for_liquidity");
  if (BigInt(tokenBalance) < requestedTokenWei) throw new Error("insufficient_token_for_liquidity");

  const amount0Desired = tokenIsToken0 ? requestedTokenWei : ethAmountWei;
  const amount1Desired = tokenIsToken0 ? ethAmountWei : requestedTokenWei;
  return {
    action: "add_liquidity",
    token_address: launch.tokenAddress,
    token_symbol: launch.tokenSymbol ?? tokenMeta.symbol,
    token_name: launch.tokenName ?? tokenMeta.name,
    pool_address: launch.poolAddress,
    pool_fee: pool.fee,
    wallet_address: walletAddress,
    weth_address: weth,
    token0: pool.token0,
    token1: pool.token1,
    token_is_token0: tokenIsToken0,
    current_tick: pool.tick,
    tick_lower: range.tickLower,
    tick_upper: range.tickUpper,
    eth_amount_wei: ethAmountWei.toString(),
    token_amount_wei: requestedTokenWei.toString(),
    amount0_desired: amount0Desired.toString(),
    amount1_desired: amount1Desired.toString(),
    amount0_min: applySlippage(amount0Desired, slippageBps).toString(),
    amount1_min: applySlippage(amount1Desired, slippageBps).toString(),
    slippage_bps: slippageBps,
    deadline_seconds: readLiquidityDeadlineSeconds(),
    needs_token_approval: BigInt(tokenAllowance) < requestedTokenWei,
    needs_weth_approval: BigInt(wethAllowance) < ethAmountWei,
    wallet_eth_balance_wei: ethBalance.toString(),
    wallet_token_balance_wei: BigInt(tokenBalance).toString(),
    wallet_weth_balance_wei: BigInt(wethBalance).toString(),
  };
}

export async function quoteRemoveLiquidity(
  admin: any,
  userId: string,
  body: any,
): Promise<RemoveLiquidityQuote> {
  const percent = normalizePercent(body.percent ?? body.remove_percent ?? body.requested_percent);
  const position = await resolveUserPosition(admin, userId, body);
  const walletAddress = normalizeEvmAddress(position.wallet_address);
  await assertUserOwnsPosition(position.position_token_id, walletAddress);
  const launch = await resolveLaunchedPool(admin, position.token_address).catch(() => null);
  assertNotLockedLaunchPosition(launch, position.position_token_id);

  const manager = positionManagerContract();
  const chainPosition = await manager.positions(BigInt(position.position_token_id));
  const currentLiquidity = BigInt(chainPosition[7]);
  if (currentLiquidity <= 0n) throw new Error("liquidity_position_empty");
  const liquidityDelta = (currentLiquidity * BigInt(Math.floor(percent * 10_000))) / 1_000_000n;
  if (liquidityDelta <= 0n) throw new Error("remove_liquidity_too_small");
  return {
    action: "remove_liquidity",
    position_id: position.id,
    position_token_id: String(position.position_token_id),
    token_address: normalizeEvmAddress(position.token_address),
    token_symbol: position.token_symbol ?? null,
    pool_address: normalizeEvmAddress(position.pool_address),
    pool_fee: Number(position.pool_fee),
    wallet_address: walletAddress,
    tick_lower: Number(chainPosition[5]),
    tick_upper: Number(chainPosition[6]),
    current_liquidity: currentLiquidity.toString(),
    liquidity_delta: liquidityDelta.toString(),
    requested_percent: percent,
    tokens_owed0: BigInt(chainPosition[10]).toString(),
    tokens_owed1: BigInt(chainPosition[11]).toString(),
    amount0_min: "0",
    amount1_min: "0",
    deadline_seconds: readLiquidityDeadlineSeconds(),
  };
}

export async function quoteCollectFees(
  admin: any,
  userId: string,
  body: any,
): Promise<RemoveLiquidityQuote> {
  const position = await resolveUserPosition(admin, userId, body);
  const walletAddress = normalizeEvmAddress(position.wallet_address);
  await assertUserOwnsPosition(position.position_token_id, walletAddress);
  const launch = await resolveLaunchedPool(admin, position.token_address).catch(() => null);
  assertNotLockedLaunchPosition(launch, position.position_token_id);
  const manager = positionManagerContract();
  const chainPosition = await manager.positions(BigInt(position.position_token_id));
  return {
    action: "collect_liquidity_fees",
    position_id: position.id,
    position_token_id: String(position.position_token_id),
    token_address: normalizeEvmAddress(position.token_address),
    token_symbol: position.token_symbol ?? null,
    pool_address: normalizeEvmAddress(position.pool_address),
    pool_fee: Number(position.pool_fee),
    wallet_address: walletAddress,
    tick_lower: Number(chainPosition[5]),
    tick_upper: Number(chainPosition[6]),
    current_liquidity: BigInt(chainPosition[7]).toString(),
    liquidity_delta: "0",
    requested_percent: null,
    tokens_owed0: BigInt(chainPosition[10]).toString(),
    tokens_owed1: BigInt(chainPosition[11]).toString(),
    amount0_min: "0",
    amount1_min: "0",
    deadline_seconds: readLiquidityDeadlineSeconds(),
  };
}

async function resolveUserPosition(admin: any, userId: string, body: any) {
  const positionId = String(body.position_id ?? body.positionId ?? "").trim();
  const positionTokenId = String(body.position_token_id ?? body.positionTokenId ?? "").trim();
  const tokenQuery = String(body.token ?? body.token_query ?? body.token_address ?? "").trim();
  let query = admin
    .from("liquidity_positions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "partially_removed"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (positionId) query = query.eq("id", positionId);
  else if (positionTokenId) query = query.eq("position_token_id", positionTokenId);
  else if (/^0x[a-fA-F0-9]{40}$/.test(tokenQuery))
    query = query.eq("token_address", normalizeEvmAddress(tokenQuery));
  else if (tokenQuery) query = query.ilike("token_symbol", tokenQuery.replace(/^\$/, ""));
  else throw new Error("missing_liquidity_position");

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("liquidity_position_not_found");
  return data;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10_000, Math.floor(number))) : fallback;
}

function normalizePercent(value: unknown): number {
  if (String(value ?? "").toLowerCase() === "all") return 100;
  const number = Number(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(number) || number <= 0) throw new Error("invalid_remove_percent");
  const max = readMaxRemovePercent();
  return Math.min(max, Math.min(100, number));
}
