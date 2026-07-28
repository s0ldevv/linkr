export function readSolanaSwapEnabled(): boolean {
  return readBoolean("SOLANA_SWAP_ENABLED", false);
}

export function readJupiterQuoteUrl(): string {
  return Deno.env.get("JUPITER_QUOTE_URL")?.trim() || "https://lite-api.jup.ag/swap/v1/quote";
}

export function readJupiterSwapUrl(): string {
  return Deno.env.get("JUPITER_SWAP_URL")?.trim() || "https://lite-api.jup.ag/swap/v1/swap";
}

export function readJupiterApiKey(): string | null {
  return Deno.env.get("JUPITER_API_KEY")?.trim() || null;
}

export function readSolanaSwapMaxPriceImpactBps(): number {
  return readNonNegativeNumber("SOLANA_SWAP_MAX_PRICE_IMPACT_BPS", 2500);
}

export function readSolanaSwapPriorityFeeLamports(): number {
  return readNonNegativeNumber("SOLANA_SWAP_PRIORITY_FEE_LAMPORTS", 1_000_000);
}

export function resolveSolanaSwapPriorityFeeLamports(value: unknown): number {
  const fallback = readSolanaSwapPriorityFeeLamports();
  const amount = value == null || value === "" ? fallback : Number(value);
  const hardMax = readNonNegativeNumber("SOLANA_SWAP_MAX_PRIORITY_FEE_LAMPORTS", 10_000_000);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > hardMax) {
    throw new Error("invalid_solana_priority_fee_lamports");
  }
  return amount;
}

export function solanaSwapFeeReserveLamports(
  priorityFeeLamports: unknown,
  mayCreateOutputTokenAccount: boolean,
): bigint {
  const priority = resolveSolanaSwapPriorityFeeLamports(priorityFeeLamports);
  // Includes a base-fee buffer and, for token output, conservative ATA rent.
  return BigInt(priority) + BigInt(mayCreateOutputTokenAccount ? 2_100_000 : 10_000);
}

export function readHeliusSenderUrl(): string | null {
  return (
    Deno.env.get("HELIUS_SENDER_URL")?.trim() ||
    Deno.env.get("HELIUS_SENDER_ENDPOINT")?.trim() ||
    null
  );
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function readNonNegativeNumber(name: string, fallback: number): number {
  const raw = Number(Deno.env.get(name));
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}
