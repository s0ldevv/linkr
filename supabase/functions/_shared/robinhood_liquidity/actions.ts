// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import { ERC20_ABI, POSITION_MANAGER_ABI, WETH_ABI } from "./abi.ts";
import { readPositionManagerAddress, readWethAddress } from "./constants.ts";
import { AddLiquidityQuote, RemoveLiquidityQuote } from "./types.ts";
import { liquidityProvider, readTokenMeta } from "./positions.ts";
import { getTxExplorerUrl, normalizeEvmAddress, ROBINHOOD_CHAIN_ID } from "../robinhood_chain.ts";
import { loadWallet } from "../wallet.ts";
import { executePumpAddLiquidity, executePumpRemoveLiquidity } from "../pump_liquidity/actions.ts";

const MAX_UINT128 = 2n ** 128n - 1n;

export async function executeLiquidityAction(admin: any, actionRow: any) {
  if (actionRow.chain === "solana" || actionRow.simulation?.platform === "pump_swap") {
    if (actionRow.action === "add_liquidity") return executePumpAddLiquidity(admin, actionRow);
    if (actionRow.action === "remove_liquidity")
      return executePumpRemoveLiquidity(admin, actionRow);
    throw new Error("unsupported_pump_liquidity_action");
  }
  if (actionRow.action === "add_liquidity") return executeAddLiquidity(admin, actionRow);
  if (actionRow.action === "remove_liquidity") return executeRemoveLiquidity(admin, actionRow);
  if (actionRow.action === "collect_liquidity_fees") return executeCollectFees(admin, actionRow);
  throw new Error("unsupported_liquidity_action");
}

export async function executeAddLiquidity(admin: any, actionRow: any) {
  const quote = actionRow.simulation as AddLiquidityQuote;
  const wallet = await loadWallet(admin, actionRow.user_id);
  if (!wallet) throw new Error("no_wallet");
  if (
    normalizeEvmAddress(wallet.address).toLowerCase() !==
    normalizeEvmAddress(quote.wallet_address).toLowerCase()
  ) {
    throw new Error("wallet_changed_before_liquidity_execution");
  }

  const provider = liquidityProvider();
  const signer = new ethers.Wallet(wallet.private_key_hex, provider);
  const token = new ethers.Contract(quote.token_address, ERC20_ABI, signer);
  const weth = new ethers.Contract(readWethAddress(), WETH_ABI, signer);
  const manager = new ethers.Contract(readPositionManagerAddress(), POSITION_MANAGER_ABI, signer);
  const managerAddress = normalizeEvmAddress(readPositionManagerAddress());

  await admin.from("liquidity_actions").update({ status: "submitted" }).eq("id", actionRow.id);

  const ethAmount = BigInt(quote.eth_amount_wei);
  const tokenAmount = BigInt(quote.token_amount_wei);
  const wethBalance = BigInt(await weth.balanceOf(wallet.address));
  if (wethBalance < ethAmount) {
    const depositTx = await weth.deposit({ value: ethAmount - wethBalance });
    await depositTx.wait(1);
  }

  await approveIfNeeded(token, wallet.address, managerAddress, tokenAmount);
  await approveIfNeeded(weth, wallet.address, managerAddress, ethAmount);

  const params = {
    token0: quote.token0,
    token1: quote.token1,
    fee: quote.pool_fee,
    tickLower: quote.tick_lower,
    tickUpper: quote.tick_upper,
    amount0Desired: BigInt(quote.amount0_desired),
    amount1Desired: BigInt(quote.amount1_desired),
    amount0Min: BigInt(quote.amount0_min),
    amount1Min: BigInt(quote.amount1_min),
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + Number(quote.deadline_seconds),
  };

  const predicted = await manager.mint.staticCall(params);
  const tx = await manager.mint(params);
  const receipt = await tx.wait(1);
  if (receipt?.status !== 1) throw new Error("add_liquidity_tx_failed");

  const tokenId = BigInt(predicted[0]).toString();
  const liquidity = BigInt(predicted[1]).toString();
  const amount0 = BigInt(predicted[2]).toString();
  const amount1 = BigInt(predicted[3]).toString();
  const tokenMeta = await readTokenMeta(quote.token_address, provider).catch(() => ({
    symbol: quote.token_symbol,
    name: quote.token_name,
  }));
  const tokenAmountUsed = quote.token_is_token0 ? amount0 : amount1;
  const wethAmountUsed = quote.token_is_token0 ? amount1 : amount0;

  await admin.from("liquidity_positions").upsert(
    {
      user_id: actionRow.user_id,
      wallet_address: wallet.address,
      token_address: quote.token_address,
      token_symbol: quote.token_symbol ?? tokenMeta.symbol ?? actionRow.token_symbol,
      token_name: quote.token_name ?? tokenMeta.name ?? null,
      pool_address: quote.pool_address,
      pool_fee: quote.pool_fee,
      position_token_id: tokenId,
      tick_lower: quote.tick_lower,
      tick_upper: quote.tick_upper,
      liquidity,
      status: "active",
      amount_token_wei: tokenAmountUsed,
      amount_weth_wei: wethAmountUsed,
      owner_address: wallet.address,
      last_chain_refresh_at: new Date().toISOString(),
      opened_tx_hash: tx.hash,
      last_tx_hash: tx.hash,
      metadata: {
        source: "linkr_user_lp",
        action_id: actionRow.id,
        token0: quote.token0,
        token1: quote.token1,
        amount0,
        amount1,
      },
    },
    { onConflict: "position_token_id" },
  );

  await recordLiquidityTransaction(admin, actionRow, tx.hash, "confirmed", {
    position_token_id: tokenId,
    liquidity,
    amount0,
    amount1,
  });

  const result = {
    tx_hash: tx.hash,
    explorer_url: getTxExplorerUrl(tx.hash),
    position_token_id: tokenId,
    liquidity,
    amount0,
    amount1,
  };
  await admin
    .from("liquidity_actions")
    .update({
      status: "confirmed",
      position_token_id: tokenId,
      liquidity_delta: liquidity,
      amount_token_wei: tokenAmountUsed,
      amount_weth_wei: wethAmountUsed,
      tx_hash: tx.hash,
      receipt: result,
    })
    .eq("id", actionRow.id);
  return result;
}

export async function executeRemoveLiquidity(admin: any, actionRow: any) {
  const quote = actionRow.simulation as RemoveLiquidityQuote;
  const wallet = await loadWallet(admin, actionRow.user_id);
  if (!wallet) throw new Error("no_wallet");
  const provider = liquidityProvider();
  const signer = new ethers.Wallet(wallet.private_key_hex, provider);
  const manager = new ethers.Contract(readPositionManagerAddress(), POSITION_MANAGER_ABI, signer);

  const owner = normalizeEvmAddress(String(await manager.ownerOf(BigInt(quote.position_token_id))));
  if (owner.toLowerCase() !== normalizeEvmAddress(wallet.address).toLowerCase())
    throw new Error("liquidity_position_not_owned_by_wallet");

  await admin.from("liquidity_actions").update({ status: "submitted" }).eq("id", actionRow.id);
  const params = {
    tokenId: BigInt(quote.position_token_id),
    liquidity: BigInt(quote.liquidity_delta),
    amount0Min: BigInt(quote.amount0_min),
    amount1Min: BigInt(quote.amount1_min),
    deadline: Math.floor(Date.now() / 1000) + Number(quote.deadline_seconds),
  };
  const predicted = await manager.decreaseLiquidity.staticCall(params);
  const decreaseTx = await manager.decreaseLiquidity(params);
  const decreaseReceipt = await decreaseTx.wait(1);
  if (decreaseReceipt?.status !== 1) throw new Error("remove_liquidity_tx_failed");

  const collectParams = {
    tokenId: BigInt(quote.position_token_id),
    recipient: wallet.address,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  };
  const collected = await manager.collect.staticCall(collectParams);
  const collectTx = await manager.collect(collectParams);
  await collectTx.wait(1);

  const remainingPosition = await manager.positions(BigInt(quote.position_token_id));
  const remainingLiquidity = BigInt(remainingPosition[7]);
  const status = remainingLiquidity > 0n ? "partially_removed" : "closed";
  await admin
    .from("liquidity_positions")
    .update({
      liquidity: remainingLiquidity.toString(),
      status,
      closed_tx_hash: status === "closed" ? decreaseTx.hash : null,
      last_tx_hash: collectTx.hash,
      last_chain_refresh_at: new Date().toISOString(),
      uncollected_token_fees_wei: "0",
      uncollected_weth_fees_wei: "0",
    })
    .eq("id", quote.position_id);

  const amount0 = BigInt(predicted[0]).toString();
  const amount1 = BigInt(predicted[1]).toString();
  const fees0 = BigInt(collected[0]).toString();
  const fees1 = BigInt(collected[1]).toString();
  await recordLiquidityTransaction(admin, actionRow, decreaseTx.hash, "confirmed", {
    position_token_id: quote.position_token_id,
    removed_liquidity: quote.liquidity_delta,
    amount0,
    amount1,
    collect_tx_hash: collectTx.hash,
    fees0,
    fees1,
  });
  const result = {
    tx_hash: decreaseTx.hash,
    collect_tx_hash: collectTx.hash,
    explorer_url: getTxExplorerUrl(decreaseTx.hash),
    position_token_id: quote.position_token_id,
    remaining_liquidity: remainingLiquidity.toString(),
    amount0,
    amount1,
    fees0,
    fees1,
  };
  await admin
    .from("liquidity_actions")
    .update({
      status: "confirmed",
      liquidity_delta: quote.liquidity_delta,
      amount_token_wei:
        quote.token_address.toLowerCase() === String(remainingPosition[2]).toLowerCase()
          ? amount0
          : amount1,
      amount_weth_wei:
        quote.token_address.toLowerCase() === String(remainingPosition[2]).toLowerCase()
          ? amount1
          : amount0,
      fees_token_wei:
        quote.token_address.toLowerCase() === String(remainingPosition[2]).toLowerCase()
          ? fees0
          : fees1,
      fees_weth_wei:
        quote.token_address.toLowerCase() === String(remainingPosition[2]).toLowerCase()
          ? fees1
          : fees0,
      tx_hash: decreaseTx.hash,
      receipt: result,
    })
    .eq("id", actionRow.id);
  return result;
}

export async function executeCollectFees(admin: any, actionRow: any) {
  const quote = actionRow.simulation as RemoveLiquidityQuote;
  const wallet = await loadWallet(admin, actionRow.user_id);
  if (!wallet) throw new Error("no_wallet");
  const signer = new ethers.Wallet(wallet.private_key_hex, liquidityProvider());
  const manager = new ethers.Contract(readPositionManagerAddress(), POSITION_MANAGER_ABI, signer);
  const owner = normalizeEvmAddress(String(await manager.ownerOf(BigInt(quote.position_token_id))));
  if (owner.toLowerCase() !== normalizeEvmAddress(wallet.address).toLowerCase())
    throw new Error("liquidity_position_not_owned_by_wallet");

  await admin.from("liquidity_actions").update({ status: "submitted" }).eq("id", actionRow.id);
  const collectParams = {
    tokenId: BigInt(quote.position_token_id),
    recipient: wallet.address,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  };
  const collected = await manager.collect.staticCall(collectParams);
  const tx = await manager.collect(collectParams);
  const receipt = await tx.wait(1);
  if (receipt?.status !== 1) throw new Error("collect_liquidity_fees_tx_failed");

  const position = await manager.positions(BigInt(quote.position_token_id));
  const tokenIsToken0 = quote.token_address.toLowerCase() === String(position[2]).toLowerCase();
  const amount0 = BigInt(collected[0]).toString();
  const amount1 = BigInt(collected[1]).toString();
  const result = {
    tx_hash: tx.hash,
    explorer_url: getTxExplorerUrl(tx.hash),
    position_token_id: quote.position_token_id,
    amount0,
    amount1,
  };
  await admin
    .from("liquidity_positions")
    .update({
      uncollected_token_fees_wei: "0",
      uncollected_weth_fees_wei: "0",
      last_tx_hash: tx.hash,
      last_chain_refresh_at: new Date().toISOString(),
    })
    .eq("id", quote.position_id);
  await admin
    .from("liquidity_actions")
    .update({
      status: "confirmed",
      fees_token_wei: tokenIsToken0 ? amount0 : amount1,
      fees_weth_wei: tokenIsToken0 ? amount1 : amount0,
      tx_hash: tx.hash,
      receipt: result,
    })
    .eq("id", actionRow.id);
  await recordLiquidityTransaction(admin, actionRow, tx.hash, "confirmed", result);
  return result;
}

async function approveIfNeeded(
  token: ethers.Contract,
  owner: string,
  spender: string,
  amount: bigint,
) {
  const allowance = BigInt(await token.allowance(owner, spender));
  if (allowance >= amount) return;
  const tx = await token.approve(spender, amount);
  const receipt = await tx.wait(1);
  if (receipt?.status !== 1) throw new Error("token_approval_failed");
}

async function recordLiquidityTransaction(
  admin: any,
  actionRow: any,
  txHash: string,
  status: string,
  rawResult: any,
) {
  await admin.from("transactions").insert({
    user_id: actionRow.user_id,
    action: actionRow.action,
    chain: "robinhood",
    input_mint: actionRow.token_address,
    output_mint: "native:eth",
    amount_original: actionRow.requested_percent ?? null,
    amount_original_unit: actionRow.action === "remove_liquidity" ? "percent" : "liquidity",
    amount_eth: actionRow.requested_eth_wei
      ? Number(ethers.formatEther(BigInt(actionRow.requested_eth_wei)))
      : null,
    chain_id: ROBINHOOD_CHAIN_ID,
    native_symbol: "ETH",
    tx_hash: txHash,
    tx_signature: txHash,
    explorer_url: getTxExplorerUrl(txHash),
    status,
    raw_request: actionRow.simulation,
    raw_result: rawResult,
    source_surface: actionRow.source_surface ?? null,
    terminal_conversation_id: actionRow.terminal_conversation_id ?? null,
    terminal_message_id: actionRow.terminal_message_id ?? null,
    confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
    idempotency_key: `robinhood-liquidity:${actionRow.id}`,
  });
}
