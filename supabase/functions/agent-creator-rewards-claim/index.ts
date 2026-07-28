// deno-lint-ignore-file no-explicit-any
import { ethers } from "https://esm.sh/ethers@6";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import {
  feeSharingConfigPda,
  OnlinePumpSdk,
  PUMP_SDK,
} from "https://esm.sh/@pump-fun/pump-sdk@1.36.0?bundle&target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentApiError,
  agentErrorResponse,
  agentJsonResponse,
  methodNotAllowed,
} from "../_shared/agent_api_errors.ts";
import { requireAgentApiKey, recordAgentRequest } from "../_shared/agent_api_auth.ts";
import { stringField } from "../_shared/agent_api_schemas.ts";
import { normalizeMarketAddress } from "../_shared/market_data/chains.ts";
import {
  getTxExplorerUrl,
  normalizeEvmAddress,
  ROBINHOOD_CHAIN_ID,
} from "../_shared/robinhood_chain.ts";
import {
  LAUNCH_LOCKER_ABI,
  SINGLE_SIDED_LAUNCH_FACTORY_ABI,
} from "../_shared/robinhood_launch/abi.ts";
import {
  ROBINHOOD_WETH_ADDRESS,
  readLaunchFactoryAddress,
  readLaunchLockerAddress,
} from "../_shared/robinhood_launch/constants.ts";
import { robinhoodProvider } from "../_shared/robinhood_launch/launch.ts";
import {
  getSolanaTxExplorerUrl,
  loadSolanaWallet,
  loadSolanaWalletById,
  SOLANA_NATIVE_SYMBOL,
  solanaConnection,
} from "../_shared/solana_chain.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { loadWallet } from "../_shared/wallet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return agentErrorResponse(methodNotAllowed());
  const admin = serviceClient();
  let ctx: any = null;
  try {
    ctx = await requireAgentApiKey(req, admin, "rewards:claim", { requireIdempotency: true });
    const token = normalizeRewardsTokenField(ctx.body);
    if (token.chain === "solana") {
      return await claimSolanaCreatorRewards(admin, ctx, req, token.address);
    }

    const tokenAddress = token.address;
    if (ctx.wallet.wallet_type !== "evm" || Number(ctx.wallet.chain_id) !== ROBINHOOD_CHAIN_ID) {
      throw new AgentApiError(
        "wallet_chain_mismatch",
        403,
        "API key is not bound to a Robinhood Chain EVM wallet.",
      );
    }
    const walletAddress = normalizeEvmAddress(ctx.wallet.address ?? ctx.wallet.public_key);
    const provider = robinhoodProvider();
    const factory = new ethers.Contract(
      readLaunchFactoryAddress(),
      SINGLE_SIDED_LAUNCH_FACTORY_ABI,
      provider,
    );
    const lockerAddress = normalizeEvmAddress(readLaunchLockerAddress());
    const locker = new ethers.Contract(lockerAddress, LAUNCH_LOCKER_ABI, provider);
    const record = await factory.launchByToken(tokenAddress);
    if (
      !record?.token ||
      normalizeEvmAddress(String(record.token)).toLowerCase() !== tokenAddress.toLowerCase()
    ) {
      throw new Error("token_not_registered_launch");
    }
    const creator = normalizeEvmAddress(String(record.creator));
    if (creator.toLowerCase() !== walletAddress.toLowerCase())
      throw new Error("wallet_is_not_launch_creator");
    const positionId = BigInt(record.positionId);
    const weth = normalizeEvmAddress(ROBINHOOD_WETH_ADDRESS);
    const [claimableWeth, claimableToken] = await Promise.all([
      locker.claimable(walletAddress, weth),
      locker.claimable(walletAddress, tokenAddress),
    ]);
    if (ctx.body.dry_run === true) {
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({
        dry_run: true,
        token_address: tokenAddress,
        position_id: positionId.toString(),
        claimable_weth_wei: BigInt(claimableWeth).toString(),
        claimable_token_wei: BigInt(claimableToken).toString(),
      });
    }

    const idempotencyKey = `agent-rewards:${ctx.apiKeyId}:${ctx.idempotencyKey}`;
    const { data: existing, error: existingError } = await admin
      .from("transactions")
      .select("status,tx_hash,raw_result")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.tx_hash) {
      await recordAgentRequest(admin, ctx, req, 200);
      return agentJsonResponse({ ...existing.raw_result, idempotent_replay: true });
    }

    const loaded = await loadWallet(admin, ctx.userId);
    if (!loaded || loaded.id !== ctx.wallet.id)
      throw new Error("wallet_changed_before_rewards_claim");
    const signer = new ethers.Wallet(loaded.private_key_hex, provider);
    const writableLocker = new ethers.Contract(lockerAddress, LAUNCH_LOCKER_ABI, signer);
    const txHashes: string[] = [];
    const collectTx = await writableLocker.collect(positionId);
    await collectTx.wait(1);
    txHashes.push(collectTx.hash);

    const [postCollectWeth, postCollectToken] = await Promise.all([
      writableLocker.claimable(walletAddress, weth),
      writableLocker.claimable(walletAddress, tokenAddress),
    ]);
    if (BigInt(postCollectWeth) > 0n) {
      const tx = await writableLocker.claim(weth);
      await tx.wait(1);
      txHashes.push(tx.hash);
    }
    if (BigInt(postCollectToken) > 0n) {
      const tx = await writableLocker.claim(tokenAddress);
      await tx.wait(1);
      txHashes.push(tx.hash);
    }
    const result = {
      status: "confirmed",
      tx_hashes: txHashes,
      tx_hash: txHashes.at(-1) ?? collectTx.hash,
      token_address: tokenAddress,
      claimed: {
        weth_wei: BigInt(postCollectWeth).toString(),
        token_wei: BigInt(postCollectToken).toString(),
      },
    };
    await admin.from("transactions").insert({
      user_id: ctx.userId,
      action: "claim_creator_rewards",
      chain: "robinhood",
      input_mint: tokenAddress,
      output_mint: "native:eth",
      chain_id: ROBINHOOD_CHAIN_ID,
      native_symbol: "ETH",
      wallet_id: ctx.wallet.id,
      wallet_address: walletAddress,
      tx_hash: result.tx_hash,
      tx_signature: result.tx_hash,
      explorer_url: getTxExplorerUrl(result.tx_hash),
      status: "confirmed",
      raw_request: { token_address: tokenAddress, source: "agent_api" },
      raw_result: result,
      source_surface: "agent_api",
      confirmed_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
    });
    await recordAgentRequest(admin, ctx, req, 200);
    return agentJsonResponse(result);
  } catch (error) {
    await recordAgentRequest(admin, ctx ?? {}, req, (error as any)?.status ?? 500, error).catch(
      () => {},
    );
    return agentErrorResponse(error);
  }
});

function normalizeRewardsTokenField(body: any): { chain: "robinhood" | "solana"; address: string } {
  const value = stringField(body, ["token_address", "address", "mint"], {
    required: true,
    max: 80,
  });
  const normalized = normalizeMarketAddress(value);
  if (!normalized) {
    throw new AgentApiError(
      "invalid_token_address",
      400,
      "Expected a full Robinhood Chain contract address or Solana mint.",
      { field: "token_address" },
    );
  }
  return normalized;
}

async function claimSolanaCreatorRewards(admin: any, ctx: any, req: Request, mint: string) {
  const wallet = await loadAgentSolanaWallet(admin, ctx);
  const connection = solanaConnection();
  const sdk = new OnlinePumpSdk(connection);
  const mintKey = new PublicKey(mint);
  const signer = Keypair.fromSecretKey(wallet.secret_key);
  if (signer.publicKey.toBase58() !== wallet.address) {
    throw new Error("loaded_solana_secret_key_address_mismatch");
  }

  const sharingConfigAddress = feeSharingConfigPda(mintKey);
  const sharingConfigAccount = await connection.getAccountInfo(sharingConfigAddress, "confirmed");
  if (!sharingConfigAccount) {
    throw new AgentApiError(
      "pump_sharing_config_not_found",
      404,
      "Pump fee-sharing config was not found for this mint.",
      { mint },
    );
  }
  const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigAccount);
  const shareholders = Array.isArray(sharingConfig.shareholders) ? sharingConfig.shareholders : [];
  const isEligible =
    sharingConfig.admin?.equals?.(signer.publicKey) ||
    shareholders.some((shareholder: any) => shareholder?.address?.equals?.(signer.publicKey));
  if (!isEligible) {
    throw new AgentApiError(
      "wallet_not_reward_recipient",
      403,
      "Solana wallet is not the Pump fee-sharing admin or recipient for this mint.",
      { mint, wallet_address: wallet.address },
    );
  }

  const minimum = await sdk.getMinimumDistributableFee(mintKey, signer.publicKey);
  const distributableLamports = bnToDecimalString((minimum as any).distributableFees) ?? "0";
  const minimumRequiredLamports = bnToDecimalString((minimum as any).minimumRequired) ?? "0";
  if (ctx.body.dry_run === true) {
    await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
    return agentJsonResponse({
      dry_run: true,
      chain: "solana",
      mint,
      wallet_address: wallet.address,
      sharing_config_address: sharingConfigAddress.toBase58(),
      can_distribute: Boolean((minimum as any).canDistribute),
      is_graduated: Boolean((minimum as any).isGraduated),
      distributable_lamports: distributableLamports,
      distributable_sol: lamportsToSolDecimal(distributableLamports),
      minimum_required_lamports: minimumRequiredLamports,
      minimum_required_sol: lamportsToSolDecimal(minimumRequiredLamports),
    });
  }

  if (!Boolean((minimum as any).canDistribute)) {
    throw new AgentApiError(
      "no_rewards_claimable",
      409,
      "No Pump.fun creator rewards are distributable for this mint yet.",
      {
        mint,
        distributable_lamports: distributableLamports,
        minimum_required_lamports: minimumRequiredLamports,
      },
    );
  }

  const idempotencyKey = `agent-rewards:${ctx.apiKeyId}:${ctx.idempotencyKey}`;
  const { data: existing, error: existingError } = await admin
    .from("transactions")
    .select("status,tx_hash,raw_result")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.tx_hash) {
    await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
    return agentJsonResponse({ ...existing.raw_result, idempotent_replay: true });
  }

  const built = await sdk.buildDistributeCreatorFeesInstructions(mintKey);
  const computeInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: readPositiveInt("PUMP_FUN_REWARDS_COMPUTE_UNITS", 600_000),
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: readPositiveInt("PUMP_FUN_REWARDS_PRIORITY_MICROLAMPORTS", 10_000),
    }),
  ];
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...computeInstructions, ...built.instructions],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);

  const simulation = await connection.simulateTransaction(tx, { sigVerify: false });
  if (simulation.value.err) {
    const logs = Array.isArray(simulation.value.logs) ? simulation.value.logs.slice(-20) : [];
    throw new Error(
      `pump_rewards_claim_simulation_failed:${JSON.stringify(simulation.value.err)}:${logs.join(" | ")}`.slice(
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
  if (confirmed.value.err) throw new Error("pump_rewards_claim_tx_failed");

  const postMinimum = await sdk.getMinimumDistributableFee(mintKey, signer.publicKey).catch(
    () => null,
  );
  const result = {
    status: "confirmed",
    chain: "solana",
    tx_hash: signature,
    signature,
    mint,
    wallet_address: wallet.address,
    sharing_config_address: sharingConfigAddress.toBase58(),
    is_graduated: Boolean(built.isGraduated),
    claimed: {
      distributable_lamports_before: distributableLamports,
      distributable_sol_before: lamportsToSolDecimal(distributableLamports),
      distributable_lamports_after: bnToDecimalString((postMinimum as any)?.distributableFees),
    },
  };

  await admin.from("transactions").insert({
    user_id: ctx.userId,
    action: "claim_creator_rewards",
    chain: "solana",
    input_mint: mint,
    output_mint: "native:sol",
    chain_id: null,
    native_symbol: SOLANA_NATIVE_SYMBOL,
    wallet_id: wallet.id,
    wallet_address: wallet.address,
    tx_hash: signature,
    tx_signature: signature,
    explorer_url: getSolanaTxExplorerUrl(signature),
    status: "confirmed",
    raw_request: { mint, token_address: mint, source: "agent_api", chain: "solana" },
    raw_result: result,
    source_surface: "agent_api",
    confirmed_at: new Date().toISOString(),
    idempotency_key: idempotencyKey,
  });
  await recordAgentRequest(admin, { ...ctx, walletId: wallet.id }, req, 200);
  return agentJsonResponse(result);
}

async function loadAgentSolanaWallet(admin: any, ctx: any) {
  if (ctx.walletId) {
    const wallet = await loadSolanaWalletById(admin, ctx.walletId, ctx.userId);
    if (!wallet) {
      throw new AgentApiError(
        "wallet_chain_mismatch",
        403,
        "API key is not bound to a Solana wallet.",
      );
    }
    return wallet;
  }

  const wallet = await loadSolanaWallet(admin, ctx.userId);
  if (!wallet) {
    throw new AgentApiError("wallet_not_found", 403, "No Solana wallet is available.");
  }
  return wallet;
}

function bnToDecimalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value).toString();
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof (value as any)?.toString === "function") {
    const text = (value as any).toString();
    return /^\d+$/.test(text) ? text : null;
  }
  return null;
}

function lamportsToSolDecimal(lamportsText: string | null): string | null {
  if (!lamportsText) return null;
  const lamports = BigInt(lamportsText);
  const base = 1_000_000_000n;
  const whole = lamports / base;
  const fraction = lamports % base;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

function readPositiveInt(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
