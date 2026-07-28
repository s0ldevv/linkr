// deno-lint-ignore-file no-explicit-any
import { PublicKey } from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { normalizeSolanaPublicKey, solanaConnection } from "./solana_chain.ts";

const SPL_TOKEN_PROGRAM_IDS = [
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLCYhB5fQ5UiwALY8b"),
];

export type SolanaTokenBalance = {
  chain: "solana";
  chain_id: null;
  mint: string;
  token_address: string;
  amount: number;
  raw_value: string;
  decimals: number;
  account_count: number;
  token_program: string;
};

export async function getSolanaTokenBalances(ownerAddress: string): Promise<SolanaTokenBalance[]> {
  const connection = solanaConnection();
  const owner = new PublicKey(normalizeSolanaPublicKey(ownerAddress));
  const byMint = new Map<string, SolanaTokenBalance>();

  for (const programId of SPL_TOKEN_PROGRAM_IDS) {
    const accounts = await connection.getParsedTokenAccountsByOwner(
      owner,
      { programId },
      "confirmed",
    );

    for (const account of accounts.value) {
      const info = (account.account.data as any)?.parsed?.info;
      const mint = normalizeSolanaPublicKeyOrNull(info?.mint);
      if (!mint) continue;
      const tokenAmount = info?.tokenAmount;
      const raw = bigintOrZero(tokenAmount?.amount);
      if (raw <= 0n) continue;

      const decimals = Number(tokenAmount?.decimals ?? 0);
      const amount = parseUiAmount(tokenAmount, raw, decimals);
      const existing = byMint.get(mint);
      if (existing) {
        const nextRaw = BigInt(existing.raw_value) + raw;
        existing.raw_value = nextRaw.toString();
        existing.amount += amount;
        existing.account_count += 1;
        continue;
      }

      byMint.set(mint, {
        chain: "solana",
        chain_id: null,
        mint,
        token_address: mint,
        amount,
        raw_value: raw.toString(),
        decimals,
        account_count: 1,
        token_program: programId.toBase58(),
      });
    }
  }

  return [...byMint.values()].filter((balance) => balance.amount > 0);
}

function parseUiAmount(tokenAmount: any, raw: bigint, decimals: number): number {
  const direct = Number(tokenAmount?.uiAmount);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const text = String(tokenAmount?.uiAmountString ?? "").trim();
  const parsed = Number(text);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  const scale = 10 ** Math.max(0, decimals);
  const computed = Number(raw) / scale;
  return Number.isFinite(computed) ? computed : 0;
}

function normalizeSolanaPublicKeyOrNull(value: unknown): string | null {
  try {
    return normalizeSolanaPublicKey(String(value ?? ""));
  } catch (_) {
    return null;
  }
}

function bigintOrZero(value: unknown): bigint {
  try {
    const text = String(value ?? "0").trim();
    return /^\d+$/.test(text) ? BigInt(text) : 0n;
  } catch (_) {
    return 0n;
  }
}
