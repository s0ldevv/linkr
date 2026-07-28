// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { ERC20_ABI, POSITION_MANAGER_ABI, V3_POOL_ABI } from "./abi.ts";
import { readPositionManagerAddress, readWethAddress } from "./constants.ts";
import { ResolvedLaunchPool } from "./types.ts";
import { normalizeEvmAddress, robinhoodProvider } from "../robinhood_chain.ts";

export function liquidityProvider() {
  return robinhoodProvider();
}

export function positionManagerContract(runner?: ethers.ContractRunner) {
  return new ethers.Contract(
    readPositionManagerAddress(),
    POSITION_MANAGER_ABI,
    runner ?? liquidityProvider(),
  );
}

export async function resolveLaunchedPool(
  admin: any,
  tokenQuery: string,
): Promise<ResolvedLaunchPool> {
  const query = String(tokenQuery ?? "").trim();
  if (!query) throw new Error("missing_token");

  let launch: any | null = null;
  const select =
    "id,user_id,name,symbol,mint,token_address,pool,pool_fee,position_id,lp_tick_lower,lp_tick_upper,status";

  if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
    const address = normalizeEvmAddress(query);
    const { data, error } = await admin
      .from("coin_launches")
      .select(select)
      .or(`token_address.eq.${address},mint.eq.${address}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    launch = data;
  } else {
    const symbol = query.replace(/^\$/, "").toUpperCase();
    const { data, error } = await admin
      .from("coin_launches")
      .select(select)
      .ilike("symbol", symbol)
      .not("token_address", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    launch = data;
  }

  if (!launch) throw new Error("launched_token_not_found");
  const tokenAddress = normalizeEvmAddress(launch.token_address ?? launch.mint);
  const poolAddress = normalizeEvmAddress(launch.pool);
  return {
    launchId: launch.id,
    userId: launch.user_id ?? null,
    tokenAddress,
    tokenSymbol: launch.symbol ?? null,
    tokenName: launch.name ?? null,
    poolAddress,
    poolFee: Number(launch.pool_fee ?? 10_000),
    lockedPositionId: launch.position_id == null
      ? null
      : String(launch.position_id),
    launchTickLower: intOrNull(launch.lp_tick_lower),
    launchTickUpper: intOrNull(launch.lp_tick_upper),
  };
}

export async function readPoolState(
  poolAddress: string,
  runner?: ethers.ContractRunner,
) {
  const pool = new ethers.Contract(
    normalizeEvmAddress(poolAddress),
    V3_POOL_ABI,
    runner ?? liquidityProvider(),
  );
  const [slot0, token0, token1, fee, liquidity] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.token1(),
    pool.fee(),
    pool.liquidity(),
  ]);
  return {
    sqrtPriceX96: BigInt(slot0[0]),
    tick: Number(slot0[1]),
    token0: normalizeEvmAddress(String(token0)),
    token1: normalizeEvmAddress(String(token1)),
    fee: Number(fee),
    liquidity: BigInt(liquidity).toString(),
  };
}

export async function readTokenMeta(
  tokenAddress: string,
  runner?: ethers.ContractRunner,
) {
  const token = new ethers.Contract(
    normalizeEvmAddress(tokenAddress),
    ERC20_ABI,
    runner ?? liquidityProvider(),
  );
  const [symbol, name, decimals] = await Promise.all([
    token.symbol().catch(() => null),
    token.name().catch(() => null),
    token.decimals().catch(() => 18),
  ]);
  return {
    symbol: typeof symbol === "string" ? symbol : null,
    name: typeof name === "string" ? name : null,
    decimals: Number(decimals ?? 18),
  };
}

export async function assertUserOwnsPosition(
  positionTokenId: string,
  walletAddress: string,
  runner?: ethers.ContractRunner,
) {
  const manager = positionManagerContract(runner);
  const owner = normalizeEvmAddress(
    String(await manager.ownerOf(BigInt(positionTokenId))),
  );
  const expected = normalizeEvmAddress(walletAddress);
  if (owner.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("liquidity_position_not_owned_by_wallet");
  }
  return owner;
}

export async function refreshStoredPosition(
  admin: any,
  position: any,
  walletAddress: string,
) {
  const manager = positionManagerContract();
  const owner = await manager.ownerOf(BigInt(position.position_token_id)).catch(
    () => null,
  );
  const owned = owner &&
    normalizeEvmAddress(String(owner)).toLowerCase() ===
      normalizeEvmAddress(walletAddress).toLowerCase();
  const chainPosition = owned
    ? await manager.positions(BigInt(position.position_token_id))
    : null;
  const liquidity = chainPosition ? BigInt(chainPosition[7]).toString() : "0";
  const owed0 = chainPosition ? BigInt(chainPosition[10]).toString() : null;
  const owed1 = chainPosition ? BigInt(chainPosition[11]).toString() : null;
  const positionToken0 = chainPosition
    ? normalizeEvmAddress(String(chainPosition[2]))
    : null;
  const tokenIsToken0 = positionToken0?.toLowerCase() ===
    normalizeEvmAddress(position.token_address).toLowerCase();
  const status = !owned
    ? "transferred_out"
    : BigInt(liquidity) > 0n
    ? position.status === "closed" ? "active" : position.status
    : "closed";

  const update = {
    owner_address: owner ? normalizeEvmAddress(String(owner)) : null,
    liquidity,
    uncollected_token_fees_wei: chainPosition
      ? tokenIsToken0 ? owed0 : owed1
      : position.uncollected_token_fees_wei,
    uncollected_weth_fees_wei: chainPosition
      ? tokenIsToken0 ? owed1 : owed0
      : position.uncollected_weth_fees_wei,
    status,
    last_chain_refresh_at: new Date().toISOString(),
  };
  await admin.from("liquidity_positions").update(update).eq("id", position.id);
  return { ...position, ...update };
}

export function assertNotLockedLaunchPosition(
  launch: ResolvedLaunchPool | null,
  positionTokenId: string,
) {
  if (
    launch?.lockedPositionId &&
    String(launch.lockedPositionId) === String(positionTokenId)
  ) {
    throw new Error("locked_launch_lp_cannot_be_removed");
  }
}

export function isWeth(address: string): boolean {
  return (
    normalizeEvmAddress(address).toLowerCase() ===
      normalizeEvmAddress(readWethAddress()).toLowerCase()
  );
}

function intOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}
