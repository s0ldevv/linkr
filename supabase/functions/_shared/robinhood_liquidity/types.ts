export type LiquidityAction = "add_liquidity" | "remove_liquidity" | "collect_liquidity_fees";

export interface ResolvedLaunchPool {
  launchId: string;
  userId: string | null;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  poolAddress: string;
  poolFee: number;
  lockedPositionId: string | null;
  launchTickLower: number | null;
  launchTickUpper: number | null;
}

export interface AddLiquidityQuote {
  action: "add_liquidity";
  token_address: string;
  token_symbol: string | null;
  token_name: string | null;
  pool_address: string;
  pool_fee: number;
  wallet_address: string;
  weth_address: string;
  token0: string;
  token1: string;
  token_is_token0: boolean;
  current_tick: number;
  tick_lower: number;
  tick_upper: number;
  eth_amount_wei: string;
  token_amount_wei: string;
  amount0_desired: string;
  amount1_desired: string;
  amount0_min: string;
  amount1_min: string;
  slippage_bps: number;
  deadline_seconds: number;
  needs_token_approval: boolean;
  needs_weth_approval: boolean;
  wallet_eth_balance_wei: string;
  wallet_token_balance_wei: string;
  wallet_weth_balance_wei: string;
}

export interface RemoveLiquidityQuote {
  action: "remove_liquidity" | "collect_liquidity_fees";
  position_id: string;
  position_token_id: string;
  token_address: string;
  token_symbol: string | null;
  pool_address: string;
  pool_fee: number;
  wallet_address: string;
  tick_lower: number;
  tick_upper: number;
  current_liquidity: string;
  liquidity_delta: string;
  requested_percent: number | null;
  tokens_owed0: string;
  tokens_owed1: string;
  amount0_min: string;
  amount1_min: string;
  deadline_seconds: number;
}
