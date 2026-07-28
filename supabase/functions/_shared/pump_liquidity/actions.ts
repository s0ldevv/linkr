// deno-lint-ignore-file no-explicit-any
// @ts-ignore esm.sh bn.js exposes a CommonJS default at runtime.
import BN from "https://esm.sh/bn.js@5.2.2";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  OnlinePumpAmmSdk,
  PumpAmmSdk,
  canonicalPumpPoolPda,
} from "https://esm.sh/@pump-fun/pump-swap-sdk@1.19.0?bundle&target=deno";
import {
  LAMPORTS_PER_SOL,
  SOLANA_NATIVE_ASSET_ID,
  SOLANA_NATIVE_SYMBOL,
  getSolanaTxExplorerUrl,
  loadSolanaWallet,
  normalizeSolanaPublicKey,
  solanaConnection,
} from "../solana_chain.ts";
import { normalizeSolanaAddress } from "../market_data/chains.ts";
import { amountFromPercent, formatTokenAmount } from "../solana_swap/amount.ts";

export type PumpLiquidityQuote = {
  action: "add_liquidity" | "remove_liquidity";
  chain: "solana";
  platform: "pump_swap";
  token_address: string;
  token_symbol: string | null;
  token_name: string | null;
  pool_address: string;
  pool_fee: number;
  wallet_id: string;
  wallet_address: string;
  native_symbol: "SOL";
  token_decimals: number;
  native_decimals: 9;
  lp_mint: string;
  lp_token_account: string;
  token_amount_raw: string;
  sol_amount_lamports: string;
  lp_token_amount: string;
  requested_percent?: number | null;
  current_lp_token_amount?: string | null;
  slippage_bps: number;
  slippage_percent: number;
  pool_base_reserve: string;
  pool_quote_reserve: string;
  user_token_balance_raw: string;
  user_lp_balance_raw: string;
  wallet_sol_balance_lamports: string;
};

const DEFAULT_SLIPPAGE_BPS = 100;
const COMPUTE_UNITS = 1_400_000;

export async function quotePumpAddLiquidity(
  admin: any,
  userId: string,
  body: any,
): Promise<PumpLiquidityQuote> {
  const wallet = await loadSolanaWallet(admin, userId);
  if (!wallet) throw new Error("no_solana_wallet");
  const mint = normalizePumpMint(body);
  const tokenAmountRaw = await parseTokenAmountRaw(mint, body);
  const slippageBps = normalizeSlippageBps(body.slippage_bps ?? body.slippageBps);
  const state = await loadPumpLiquidityState(mint, wallet.address);
  const ammSdk = new PumpAmmSdk();
  const { quote: requiredSol, lpToken } = ammSdk.depositAutocompleteQuoteAndLpTokenFromBase(
    state.state,
    new BN(tokenAmountRaw.toString()),
    slippageBps / 100,
  );
  if (lpToken.lte(new BN(0))) throw new Error("pump_liquidity_deposit_too_small");

  const tokenBalance = await getTokenAccountBalanceRaw(state.state.userBaseTokenAccount.toBase58());
  if (tokenBalance < tokenAmountRaw) throw new Error("insufficient_token_for_pump_liquidity");
  const solBalance = BigInt(await solanaConnection().getBalance(new PublicKey(wallet.address)));
  const requiredLamports = BigInt(requiredSol.toString()) + 20_000_000n;
  if (solBalance < requiredLamports) throw new Error("insufficient_sol_for_pump_liquidity");

  const launch = await resolvePumpLaunchMeta(admin, mint);
  return {
    action: "add_liquidity",
    chain: "solana",
    platform: "pump_swap",
    token_address: mint,
    token_symbol: launch?.symbol ?? null,
    token_name: launch?.name ?? null,
    pool_address: state.pool.toBase58(),
    pool_fee: 0,
    wallet_id: wallet.id,
    wallet_address: wallet.address,
    native_symbol: SOLANA_NATIVE_SYMBOL,
    token_decimals: state.tokenDecimals,
    native_decimals: 9,
    lp_mint: state.state.pool.lpMint.toBase58(),
    lp_token_account: state.state.userPoolTokenAccount.toBase58(),
    token_amount_raw: tokenAmountRaw.toString(),
    sol_amount_lamports: requiredSol.toString(),
    lp_token_amount: lpToken.toString(),
    requested_percent: null,
    current_lp_token_amount: state.userLpBalance.toString(),
    slippage_bps: slippageBps,
    slippage_percent: slippageBps / 100,
    pool_base_reserve: state.poolBaseReserve.toString(),
    pool_quote_reserve: state.poolQuoteReserve.toString(),
    user_token_balance_raw: tokenBalance.toString(),
    user_lp_balance_raw: state.userLpBalance.toString(),
    wallet_sol_balance_lamports: solBalance.toString(),
  };
}

export async function quotePumpRemoveLiquidity(
  admin: any,
  userId: string,
  body: any,
): Promise<PumpLiquidityQuote> {
  const wallet = await loadSolanaWallet(admin, userId);
  if (!wallet) throw new Error("no_solana_wallet");
  const position = await resolvePumpPosition(admin, userId, body);
  if (normalizeSolanaPublicKey(position.wallet_address) !== wallet.address) {
    throw new Error("solana_wallet_changed_before_liquidity_execution");
  }
  const mint = normalizeSolanaPublicKey(position.token_address);
  const percent = normalizePercent(body.percent ?? body.remove_percent ?? body.requested_percent);
  const slippageBps = normalizeSlippageBps(body.slippage_bps ?? body.slippageBps);
  const state = await loadPumpLiquidityState(mint, wallet.address);
  const currentLp = state.userLpBalance;
  if (currentLp <= 0n) throw new Error("pump_liquidity_position_empty");
  const lpTokenAmount = amountFromPercent(currentLp, percent);
  if (lpTokenAmount <= 0n) throw new Error("remove_liquidity_too_small");
  const ammSdk = new PumpAmmSdk();
  const { base, quote } = ammSdk.withdrawAutoCompleteBaseAndQuoteFromLpToken(
    state.state,
    new BN(lpTokenAmount.toString()),
    slippageBps / 100,
  );
  return {
    action: "remove_liquidity",
    chain: "solana",
    platform: "pump_swap",
    token_address: mint,
    token_symbol: position.token_symbol ?? null,
    token_name: position.token_name ?? null,
    pool_address: state.pool.toBase58(),
    pool_fee: 0,
    wallet_id: wallet.id,
    wallet_address: wallet.address,
    native_symbol: SOLANA_NATIVE_SYMBOL,
    token_decimals: state.tokenDecimals,
    native_decimals: 9,
    lp_mint: state.state.pool.lpMint.toBase58(),
    lp_token_account: state.state.userPoolTokenAccount.toBase58(),
    token_amount_raw: base.toString(),
    sol_amount_lamports: quote.toString(),
    lp_token_amount: lpTokenAmount.toString(),
    requested_percent: percent,
    current_lp_token_amount: currentLp.toString(),
    slippage_bps: slippageBps,
    slippage_percent: slippageBps / 100,
    pool_base_reserve: state.poolBaseReserve.toString(),
    pool_quote_reserve: state.poolQuoteReserve.toString(),
    user_token_balance_raw: "0",
    user_lp_balance_raw: currentLp.toString(),
    wallet_sol_balance_lamports: String(
      await solanaConnection().getBalance(new PublicKey(wallet.address)),
    ),
  };
}

export async function executePumpAddLiquidity(admin: any, actionRow: any) {
  const quote = actionRow.simulation as PumpLiquidityQuote;
  const wallet = await loadSolanaWallet(admin, actionRow.user_id);
  if (!wallet) throw new Error("no_solana_wallet");
  assertWalletMatches(wallet, quote);
  await admin.from("liquidity_actions").update({ status: "submitted" }).eq("id", actionRow.id);
  const state = await loadPumpLiquidityState(quote.token_address, wallet.address);
  const instructions = await new PumpAmmSdk().depositInstructions(
    state.state,
    new BN(quote.lp_token_amount),
    quote.slippage_percent,
  );
  const signature = await signSendConfirm(wallet.secret_key, wallet.address, instructions);
  const lpBalance = await getTokenAccountBalanceRaw(state.state.userPoolTokenAccount.toBase58());
  await admin.from("liquidity_positions").upsert(
    {
      user_id: actionRow.user_id,
      wallet_id: wallet.id,
      wallet_address: wallet.address,
      chain: "solana",
      platform: "pump_swap",
      native_symbol: SOLANA_NATIVE_SYMBOL,
      token_address: quote.token_address,
      token_symbol: quote.token_symbol,
      token_name: quote.token_name,
      pool_address: quote.pool_address,
      pool_fee: 0,
      position_token_id: quote.lp_token_account,
      tick_lower: 0,
      tick_upper: 0,
      liquidity: lpBalance.toString(),
      status: "active",
      amount_token_wei: quote.token_amount_raw,
      amount_weth_wei: quote.sol_amount_lamports,
      amount_token_raw: quote.token_amount_raw,
      amount_native_raw: quote.sol_amount_lamports,
      owner_address: wallet.address,
      lp_mint: quote.lp_mint,
      token_decimals: quote.token_decimals,
      native_decimals: 9,
      last_chain_refresh_at: new Date().toISOString(),
      opened_tx_hash: signature,
      last_tx_hash: signature,
      metadata: {
        source: "pump_swap_user_lp",
        action_id: actionRow.id,
        lp_token_account: quote.lp_token_account,
        required_sol_lamports: quote.sol_amount_lamports,
      },
    },
    { onConflict: "position_token_id" },
  );
  await recordPumpLiquidityTransaction(admin, actionRow, signature, "confirmed", quote, {
    lp_balance: lpBalance.toString(),
  });
  const result = {
    tx_hash: signature,
    signature,
    explorer_url: getSolanaTxExplorerUrl(signature),
    position_token_id: quote.lp_token_account,
    liquidity: lpBalance.toString(),
    amount_token_raw: quote.token_amount_raw,
    amount_sol_lamports: quote.sol_amount_lamports,
  };
  await admin
    .from("liquidity_actions")
    .update({
      status: "confirmed",
      liquidity_delta: quote.lp_token_amount,
      amount_token_wei: quote.token_amount_raw,
      amount_weth_wei: quote.sol_amount_lamports,
      amount_native_raw: quote.sol_amount_lamports,
      tx_hash: signature,
      receipt: result,
    })
    .eq("id", actionRow.id);
  return result;
}

export async function executePumpRemoveLiquidity(admin: any, actionRow: any) {
  const quote = actionRow.simulation as PumpLiquidityQuote;
  const wallet = await loadSolanaWallet(admin, actionRow.user_id);
  if (!wallet) throw new Error("no_solana_wallet");
  assertWalletMatches(wallet, quote);
  await admin.from("liquidity_actions").update({ status: "submitted" }).eq("id", actionRow.id);
  const state = await loadPumpLiquidityState(quote.token_address, wallet.address);
  const lpAmount = new BN(quote.lp_token_amount);
  const currentLp = state.userLpBalance;
  if (currentLp < BigInt(quote.lp_token_amount)) throw new Error("insufficient_lp_tokens");
  const instructions = await new PumpAmmSdk().withdrawInstructions(
    state.state,
    lpAmount,
    quote.slippage_percent,
  );
  const signature = await signSendConfirm(wallet.secret_key, wallet.address, instructions);
  const remainingLp = await getTokenAccountBalanceRaw(state.state.userPoolTokenAccount.toBase58());
  const status = remainingLp > 0n ? "partially_removed" : "closed";
  await admin
    .from("liquidity_positions")
    .update({
      liquidity: remainingLp.toString(),
      status,
      closed_tx_hash: status === "closed" ? signature : null,
      last_tx_hash: signature,
      last_chain_refresh_at: new Date().toISOString(),
    })
    .eq("position_token_id", quote.lp_token_account)
    .eq("user_id", actionRow.user_id);
  await recordPumpLiquidityTransaction(admin, actionRow, signature, "confirmed", quote, {
    remaining_lp_balance: remainingLp.toString(),
  });
  const result = {
    tx_hash: signature,
    signature,
    explorer_url: getSolanaTxExplorerUrl(signature),
    position_token_id: quote.lp_token_account,
    remaining_liquidity: remainingLp.toString(),
    amount_token_raw: quote.token_amount_raw,
    amount_sol_lamports: quote.sol_amount_lamports,
  };
  await admin
    .from("liquidity_actions")
    .update({
      status: "confirmed",
      liquidity_delta: quote.lp_token_amount,
      amount_token_wei: quote.token_amount_raw,
      amount_weth_wei: quote.sol_amount_lamports,
      amount_native_raw: quote.sol_amount_lamports,
      tx_hash: signature,
      receipt: result,
    })
    .eq("id", actionRow.id);
  return result;
}

async function loadPumpLiquidityState(mintText: string, userText: string) {
  const connection = solanaConnection();
  const mint = new PublicKey(normalizeSolanaPublicKey(mintText));
  const user = new PublicKey(normalizeSolanaPublicKey(userText));
  const pool = canonicalPumpPoolPda(mint);
  const onlineSdk = new OnlinePumpAmmSdk(connection);
  const state = await onlineSdk.liquiditySolanaState(pool, user);
  if (!state.pool.baseMint.equals(mint)) throw new Error("pump_pool_base_mint_mismatch");
  const tokenDecimals = await readMintDecimals(mint.toBase58());
  const poolBaseReserve = BigInt(state.poolBaseTokenAccount.amount.toString());
  const poolQuoteReserve = BigInt(state.poolQuoteTokenAccount.amount.toString());
  const userLpBalance = await getTokenAccountBalanceRaw(state.userPoolTokenAccount.toBase58());
  return { pool, state, tokenDecimals, poolBaseReserve, poolQuoteReserve, userLpBalance };
}

async function signSendConfirm(
  secretKey: Uint8Array,
  expectedAddress: string,
  instructions: any[],
): Promise<string> {
  const connection = solanaConnection();
  const signer = Keypair.fromSecretKey(secretKey);
  if (signer.publicKey.toBase58() !== normalizeSolanaPublicKey(expectedAddress)) {
    throw new Error("loaded_solana_secret_key_address_mismatch");
  }
  const compute = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: readPositiveInt("PUMP_SWAP_PRIORITY_MICROLAMPORTS", 10_000),
    }),
  ];
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...compute, ...instructions],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);
  const simulation = await connection.simulateTransaction(tx, { sigVerify: false });
  if (simulation.value.err) {
    const logs = Array.isArray(simulation.value.logs) ? simulation.value.logs.slice(-20) : [];
    throw new Error(
      `pump_swap_liquidity_simulation_failed:${JSON.stringify(simulation.value.err)}:${logs.join(" | ")}`.slice(
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
  if (confirmed.value.err) throw new Error("pump_swap_liquidity_tx_failed");
  return signature;
}

async function parseTokenAmountRaw(mint: string, body: any): Promise<bigint> {
  const explicitRaw = body.token_amount_raw ?? body.amount_token_raw;
  if (explicitRaw != null && /^\d+$/.test(String(explicitRaw))) {
    const raw = BigInt(String(explicitRaw));
    if (raw <= 0n) throw new Error("token_amount_required");
    return raw;
  }
  const value = body.tokenAmount ?? body.token_amount ?? body.amount_token ?? body.amount;
  const decimals = await readMintDecimals(mint);
  return parseUnits(value, decimals, "invalid_token_amount");
}

async function readMintDecimals(mint: string): Promise<number> {
  const account = await solanaConnection().getParsedAccountInfo(new PublicKey(mint), "confirmed");
  const decimals = Number((account.value?.data as any)?.parsed?.info?.decimals ?? 0);
  if (!Number.isFinite(decimals) || decimals < 0) throw new Error("mint_decimals_unavailable");
  return decimals;
}

function parseUnits(value: unknown, decimals: number, errorCode: string): bigint {
  const text = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!text || !/^\d+(\.\d+)?$/.test(text)) throw new Error(errorCode);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(errorCode);
  const raw =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n) throw new Error("token_amount_required");
  return raw;
}

async function getTokenAccountBalanceRaw(account: string): Promise<bigint> {
  try {
    const balance = await solanaConnection().getTokenAccountBalance(
      new PublicKey(account),
      "confirmed",
    );
    return BigInt(balance.value.amount);
  } catch (_) {
    return 0n;
  }
}

function normalizePumpMint(body: any): string {
  const value =
    body.token_mint ?? body.mint ?? body.token_address ?? body.token ?? body.token_query;
  const mint = normalizeSolanaAddress(value);
  if (!mint) throw new Error("invalid_pump_token_mint");
  return mint;
}

async function resolvePumpLaunchMeta(admin: any, mint: string) {
  const { data, error } = await admin
    .from("coin_launches")
    .select("name,symbol")
    .eq("chain", "solana")
    .eq("launch_platform", "pump_fun")
    .eq("mint", mint)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function resolvePumpPosition(admin: any, userId: string, body: any) {
  const positionId = String(body.position_id ?? body.positionId ?? "").trim();
  const lpTokenAccount = String(body.position_token_id ?? body.lp_token_account ?? "").trim();
  const mint = normalizeSolanaAddress(
    body.token_mint ?? body.mint ?? body.token_address ?? body.token,
  );
  let query = admin
    .from("liquidity_positions")
    .select("*")
    .eq("user_id", userId)
    .eq("chain", "solana")
    .eq("platform", "pump_swap")
    .in("status", ["active", "partially_removed"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (positionId) query = query.eq("id", positionId);
  else if (lpTokenAccount)
    query = query.eq("position_token_id", normalizeSolanaPublicKey(lpTokenAccount));
  else if (mint) query = query.eq("token_address", mint);
  else throw new Error("missing_liquidity_position");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("liquidity_position_not_found");
  return data;
}

function normalizePercent(value: unknown): number {
  if (String(value ?? "").toLowerCase() === "all") return 100;
  const number = Number(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(number) || number <= 0) throw new Error("invalid_remove_percent");
  return Math.min(100, number);
}

function normalizeSlippageBps(value: unknown): number {
  const number = Number(value ?? DEFAULT_SLIPPAGE_BPS);
  if (!Number.isFinite(number) || number < 0 || number > 10_000) {
    throw new Error("invalid_slippage_bps");
  }
  return Math.floor(number);
}

function assertWalletMatches(wallet: any, quote: PumpLiquidityQuote) {
  if (wallet.id !== quote.wallet_id)
    throw new Error("solana_wallet_changed_before_liquidity_execution");
  if (wallet.address !== normalizeSolanaPublicKey(quote.wallet_address)) {
    throw new Error("solana_wallet_changed_before_liquidity_execution");
  }
}

async function recordPumpLiquidityTransaction(
  admin: any,
  actionRow: any,
  signature: string,
  status: string,
  quote: PumpLiquidityQuote,
  rawResult: any,
) {
  await admin.from("transactions").insert({
    user_id: actionRow.user_id,
    action: actionRow.action,
    chain: "solana",
    input_mint: quote.token_address,
    output_mint: SOLANA_NATIVE_ASSET_ID,
    amount_original: quote.requested_percent ?? null,
    amount_original_unit: actionRow.action === "remove_liquidity" ? "percent" : "liquidity",
    amount_sol: Number(quote.sol_amount_lamports) / LAMPORTS_PER_SOL,
    chain_id: null,
    native_symbol: SOLANA_NATIVE_SYMBOL,
    wallet_id: quote.wallet_id,
    wallet_address: quote.wallet_address,
    tx_hash: signature,
    tx_signature: signature,
    explorer_url: getSolanaTxExplorerUrl(signature),
    status,
    raw_request: quote,
    raw_result: rawResult,
    source_surface: actionRow.source_surface ?? null,
    terminal_conversation_id: actionRow.terminal_conversation_id ?? null,
    terminal_message_id: actionRow.terminal_message_id ?? null,
    confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
    idempotency_key: `pump-liquidity:${actionRow.id}`,
  });
}

export function formatPumpTokenAmount(raw: string, decimals: number): string {
  return formatTokenAmount(raw, decimals);
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
