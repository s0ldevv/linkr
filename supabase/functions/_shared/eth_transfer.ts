// deno-lint-ignore-file no-explicit-any
// Native ETH transfer on Robinhood Chain.

import { ethers } from "https://esm.sh/ethers@6";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  robinhoodProvider,
} from "./robinhood_chain.ts";
import { insufficientNativeBalanceErrorMessage } from "./wallet_balance_reply.ts";

export type EthTransferBalancePreflight = {
  balanceWei: bigint;
  valueWei: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint;
  estimatedGasCostWei: bigint;
  requiredBalanceWei: bigint;
};

export async function estimateEthTransferBalancePreflight(args: {
  from_address: string;
  recipient: string;
  amount_eth: number | string;
}): Promise<EthTransferBalancePreflight> {
  const provider = robinhoodProvider();
  const from = normalizeEvmAddress(args.from_address);
  const recipient = normalizeEvmAddress(args.recipient);
  const valueWei = ethers.parseEther(String(args.amount_eth));
  if (valueWei <= 0n) throw new Error("amount_must_be_positive");

  const [balanceWei, feeData] = await Promise.all([
    provider.getBalance(from),
    provider.getFeeData(),
  ]);
  const gasLimit = BigInt(
    await provider.estimateGas({ from, to: recipient, value: valueWei }).catch(
      () => 21_000n,
    ),
  );
  const gasPriceWei = BigInt(feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n);
  const estimatedGasCostWei = gasLimit * gasPriceWei;
  return {
    balanceWei: BigInt(balanceWei),
    valueWei,
    gasLimit,
    gasPriceWei,
    estimatedGasCostWei,
    requiredBalanceWei: valueWei + estimatedGasCostWei,
  };
}

export async function transferEth(args: {
  private_key_hex: string;
  expected_from_address: string;
  recipient: string;
  amount_eth: number | string;
}): Promise<{
  tx_hash: string;
  signature: string;
  confirmed: boolean;
  block_number: number | null;
  explorer_url: string;
}> {
  const provider = robinhoodProvider();
  const wallet = new ethers.Wallet(args.private_key_hex, provider);
  const expected = normalizeEvmAddress(args.expected_from_address);
  const recipient = normalizeEvmAddress(args.recipient);

  if (wallet.address.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("loaded_private_key_address_mismatch");
  }

  const preflight = await estimateEthTransferBalancePreflight({
    from_address: wallet.address,
    recipient,
    amount_eth: args.amount_eth,
  });
  if (preflight.balanceWei < preflight.requiredBalanceWei) {
    throw new Error(
      insufficientNativeBalanceErrorMessage({
        symbol: "ETH",
        currentBalance: Number(ethers.formatEther(preflight.balanceWei)),
        requiredAmount: Number(
          ethers.formatEther(preflight.requiredBalanceWei),
        ),
      }),
    );
  }

  const tx = await wallet.sendTransaction({
    to: recipient,
    value: preflight.valueWei,
    gasLimit: preflight.gasLimit,
  });
  const receipt = await tx.wait(1);
  const confirmed = receipt?.status === 1;

  return {
    tx_hash: tx.hash,
    signature: tx.hash,
    confirmed,
    block_number: receipt?.blockNumber ?? null,
    explorer_url: getTxExplorerUrl(tx.hash),
  };
}
