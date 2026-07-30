/**
 * Public-reply composition for a user's own Linkr wallet balances.
 *
 * Deliberately deterministic. A balance is the user's money, and a public reply
 * is permanent — so these numbers are rendered from the real values and never
 * paraphrased by a model. The rules that matter:
 *
 *   * A balance we could not read is reported as unavailable, never as zero.
 *     `readWalletContext` collapses every failure into an empty result, so
 *     "no data" and "no money" are indistinguishable at the call site and must
 *     be disambiguated here.
 *   * The bot never asks the user for a wallet address. It already knows them.
 */

export interface WalletBalanceView {
  evmWallet: { address: string } | null;
  solWallet: { address: string } | null;
  eth?: number | null;
  sol?: number | null;
}

export const WALLET_UNLINKED_REPLY =
  "You do not have a Linkr wallet yet. Sign up at linkr.cash and I can read your balances here.";

export const WALLET_UNREADABLE_REPLY =
  "I could not read your Linkr wallet just now. Try again in a moment.";

/**
 * Compose the reply, or return the honest failure text.
 *
 * A provisioned user always has at least one wallet, so an empty result means
 * the read failed rather than that the user is broke.
 */
export function composeWalletBalanceReply(wallet: WalletBalanceView): string {
  const { evmWallet, solWallet } = wallet;
  if (!evmWallet && !solWallet) return WALLET_UNREADABLE_REPLY;

  const parts: string[] = [];
  if (solWallet) parts.push(`Solana: ${formatWalletBalance(wallet.sol, "SOL")}`);
  if (evmWallet) {
    parts.push(`Robinhood Chain: ${formatWalletBalance(wallet.eth, "ETH")}`);
  }

  // A deposit address is only worth the characters when there is nothing to
  // spend on that chain.
  const emptyAddress = solWallet && isZeroBalance(wallet.sol)
    ? solWallet.address
    : evmWallet && isZeroBalance(wallet.eth)
    ? evmWallet.address
    : null;
  const suffix = emptyAddress
    ? ` Deposit to ${shortWalletAddress(emptyAddress)}.`
    : "";

  return `Your Linkr wallet — ${parts.join(", ")}.${suffix}`;
}

/** Render a balance, or say it is unavailable. Never silently render zero. */
export function formatWalletBalance(
  value: unknown,
  unit: "SOL" | "ETH",
): string {
  if (value === null || value === undefined) return "balance unavailable";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "balance unavailable";
  if (amount === 0) return `0 ${unit}`;
  // Dust would otherwise round to "0" and read as an empty wallet.
  const text = Math.abs(amount) < 0.000001
    ? amount.toExponential(2)
    : String(Number(amount.toFixed(6)));
  return `${text} ${unit}`;
}

export function isZeroBalance(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const amount = Number(value);
  return Number.isFinite(amount) && amount === 0;
}

export function shortWalletAddress(address: string): string {
  const value = String(address ?? "");
  return value.length > 14 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}
