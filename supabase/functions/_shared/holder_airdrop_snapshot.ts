// Read-only holder snapshot and immutable allocation preparation.
// deno-lint-ignore-file no-explicit-any
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { solanaConnection } from "./solana_chain.ts";
import {
  type AirdropAllocation,
  type HolderBalance,
  isBalanceFractionAirdropAmount,
  parseAirdropAmountToRaw,
  planProRataAirdrop,
} from "./x_airdrop.ts";
import { sha256Hex } from "./transaction_outbox.ts";

export interface HeliusHolderSnapshot {
  slot: number;
  provider: "helius_getTokenAccounts";
  fetchedAt: string;
  pageCount: number;
  pageCursors: string[];
  checksum: string;
  accounts: HolderBalance[];
}

export async function fetchHeliusHolderSnapshot(args: {
  mint: string;
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
  maxAccounts?: number;
}): Promise<HeliusHolderSnapshot> {
  const rpcUrl = args.rpcUrl ?? heliusRpcUrl();
  const fetchImpl = args.fetchImpl ?? fetch;
  const maxPages = Math.max(1, Math.floor(args.maxPages ?? 50));
  const maxAccounts = Math.max(1, Math.floor(args.maxAccounts ?? 5_000));
  const accounts: HolderBalance[] = [];
  const pageCursors: string[] = [];
  const indexedSlots: number[] = [];
  let cursor: string | undefined;
  do {
    if (pageCursors.length >= maxPages) {
      throw new Error("helius_holder_snapshot_page_limit_exceeded");
    }
    pageCursors.push(cursor ?? "first");
    const params: Record<string, unknown> = { mint: args.mint, limit: 1000 };
    if (cursor) params.cursor = cursor;
    const result = await heliusRpc(
      fetchImpl,
      rpcUrl,
      "getTokenAccounts",
      params,
    ) as any;
    const indexedSlot = Number(
      result?.last_indexed_slot ?? result?.lastIndexedSlot,
    );
    if (Number.isSafeInteger(indexedSlot) && indexedSlot > 0) {
      indexedSlots.push(indexedSlot);
    }
    const page = Array.isArray(result?.token_accounts)
      ? result.token_accounts
      : [];
    for (const account of page) {
      const owner = String(account?.owner ?? "").trim();
      const amount = String(account?.amount ?? "0");
      if (owner && /^\d+$/.test(amount) && BigInt(amount) > 0n) {
        accounts.push({ owner, amount: BigInt(amount) });
        if (accounts.length > maxAccounts) {
          throw new Error("helius_holder_snapshot_account_limit_exceeded");
        }
      }
    }
    cursor = typeof result?.cursor === "string" && result.cursor
      ? result.cursor
      : undefined;
  } while (cursor);
  const slot = indexedSlots.length ? Math.min(...indexedSlots) : Number(
    await heliusRpc(fetchImpl, rpcUrl, "getSlot", [{
      commitment: "confirmed",
    }]),
  );
  if (!Number.isSafeInteger(slot) || slot <= 0) {
    throw new Error("helius_snapshot_slot_invalid");
  }
  return {
    slot,
    provider: "helius_getTokenAccounts",
    fetchedAt: new Date().toISOString(),
    pageCount: pageCursors.length,
    pageCursors,
    checksum: await holderSnapshotChecksum(accounts),
    accounts,
  };
}

export function aggregateHolderBalances(
  accounts: HolderBalance[],
): HolderBalance[] {
  const owners = new Map<string, bigint>();
  for (const account of accounts) {
    if (!account.owner || account.amount <= 0n) continue;
    owners.set(
      account.owner,
      (owners.get(account.owner) ?? 0n) + account.amount,
    );
  }
  return [...owners.entries()].map(([owner, amount]) => ({ owner, amount }));
}

export interface PreparedHolderAirdropSnapshot {
  mint: string;
  decimals: number;
  sourceTokenAccount: string;
  sourceBalanceRaw: bigint;
  requestedRaw: bigint;
  allocatedRaw: bigint;
  dustRaw: bigint;
  excludedLargestOwner: string;
  snapshot: HeliusHolderSnapshot;
  allocations: AirdropAllocation[];
  aggregatedHolderCount: number;
}

export interface HolderAirdropSourceAccount {
  address: string;
  amount: bigint;
}

export function walletTokenBalanceRaw(
  sources: HolderAirdropSourceAccount[],
): bigint {
  return sources.reduce((sum, source) => sum + source.amount, 0n);
}

export function requestedAirdropRawFromWalletBalance(args: {
  requestedAmount: string;
  decimals: number;
  sources: HolderAirdropSourceAccount[];
}): bigint {
  const walletBalanceRaw = walletTokenBalanceRaw(args.sources);
  return isBalanceFractionAirdropAmount(args.requestedAmount)
    ? parseAirdropAmountToRaw(
      args.requestedAmount,
      args.decimals,
      walletBalanceRaw,
    ).raw
    : parseAirdropAmountToRaw(args.requestedAmount, args.decimals, 0n).raw;
}

export function selectAirdropSourceAccount(args: {
  requestedRaw: bigint;
  sources: HolderAirdropSourceAccount[];
}): HolderAirdropSourceAccount {
  const source = args.sources.find((item) => item.amount >= args.requestedRaw);
  if (source) return source;
  if (walletTokenBalanceRaw(args.sources) >= args.requestedRaw) {
    throw new Error("holder_airdrop_source_account_consolidation_required");
  }
  throw new Error("holder_airdrop_insufficient_token_balance");
}

export async function prepareHolderAirdropSnapshot(args: {
  mint: string;
  developerWallet: string;
  requestedAmount: string;
  fetchSnapshot?: typeof fetchHeliusHolderSnapshot;
}): Promise<PreparedHolderAirdropSnapshot> {
  const connection = solanaConnection();
  const mint = new PublicKey(args.mint);
  const developer = new PublicKey(args.developerWallet);
  const supply = await connection.getTokenSupply(mint, "confirmed");
  const decimals = supply.value.decimals;
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    developer,
    { mint },
    "confirmed",
  );
  const sources = tokenAccounts.value.map((item) => ({
    address: item.pubkey.toBase58(),
    amount: BigInt(
      String(
        (item.account.data as any)?.parsed?.info?.tokenAmount?.amount ?? "0",
      ),
    ),
  })).filter((item) => item.amount > 0n).sort((a, b) =>
    a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1
  );
  const requestedRaw = requestedAirdropRawFromWalletBalance({
    requestedAmount: args.requestedAmount,
    decimals,
    sources,
  });
  const source = selectAirdropSourceAccount({ requestedRaw, sources });

  const snapshot = await (args.fetchSnapshot ?? fetchHeliusHolderSnapshot)({
    mint: mint.toBase58(),
  });
  const aggregated = aggregateHolderBalances(snapshot.accounts);
  const plan = planProRataAirdrop({
    holders: aggregated,
    total: requestedRaw,
    developerWallet: developer.toBase58(),
  });
  const allocatedRaw = plan.allocations.reduce(
    (sum, row) => sum + row.allocation,
    0n,
  );
  if (!plan.allocations.length) {
    throw new Error("airdrop_amount_too_small_for_all_holders");
  }
  return {
    mint: mint.toBase58(),
    decimals,
    sourceTokenAccount: source.address,
    sourceBalanceRaw: source.amount,
    requestedRaw,
    allocatedRaw,
    dustRaw: requestedRaw - allocatedRaw,
    excludedLargestOwner: plan.excludedTopHolder,
    snapshot,
    allocations: plan.allocations,
    aggregatedHolderCount: aggregated.length,
  };
}

async function heliusRpc(
  fetchImpl: typeof fetch,
  rpcUrl: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `linkr-airdrop-${method}`,
      method,
      params,
    }),
  });
  if (!response.ok) throw new Error(`helius_holder_http_${response.status}`);
  const body = await response.json() as any;
  if (body.error) {
    throw new Error(`helius_holder_rpc_${body.error.code ?? "error"}`);
  }
  return body.result;
}

function heliusRpcUrl(): string {
  const configured = Deno.env.get("HELIUS_RPC_URL")?.trim();
  if (configured && /^https?:\/\//i.test(configured)) return configured;
  const key = Deno.env.get("HELIUS_API_KEY")?.trim();
  if (!key) throw new Error("HELIUS_API_KEY missing");
  return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
}

async function holderSnapshotChecksum(
  accounts: HolderBalance[],
): Promise<string> {
  const canonical = accounts.map((account) => ({
    owner: account.owner,
    amount: account.amount.toString(),
  }));
  return await sha256Hex(new TextEncoder().encode(JSON.stringify(canonical)));
}
