// Reply text generators. No links, ever. TX replies end with `TX: signature`.

export const ReplyTemplates = {
  unknownUser: "I could not set up your Linkr profile yet. Try again in a minute.",
  noWallet: "I could not create your Linkr wallet yet. Try again in a minute.",
  missingSettings: "Set your trading limits in Linkr settings first, then try again.",
  missingSlippage: "Set your default slippage in Linkr settings first, then try again.",
  missingMaxBuy: "Set your max auto buy in Linkr settings first, then try again.",
  missingMaxSell: "Set your max auto sell in Linkr settings first, then try again.",
  missingMaxDevBuy: "Set your max dev buy in Linkr settings first, then try again.",
  missingAmount: "I need an amount. Example: buy $50 of this, buy 0.2 ETH, or buy 0.5 SOL.",
  missingToken: "I need the token ticker, contract address, mint, or chart.",
  multipleTokens:
    "I found multiple tokens in that thread. Reply with the exact contract address or mint you want me to use.",
  contractAddressRequired:
    "I need the full token contract address for swaps. For now, use: buy 0.01 ETH of 0x...",
  solanaMintRequired:
    "I need the full Solana mint address for Solana swaps. For now, use: buy 0.1 SOL of <mint>.",
  transferDisabled: "Transfers are disabled by your rules. Set a transfer cap in Linkr first.",
  transferCapExceeded: "That transfer is above your Linkr transfer cap.",
  missingImage: "Coin launches need an image attached. Reply again with the image and ticker.",
  launchNameTooLong:
    "Robinhood Chain launch names can be at most 60 characters. Shorten the name and try again.",
  usdConvertFailed:
    "I could not fetch the live ETH price safely. Try again in a minute or use an ETH amount.",
  solUsdConvertFailed:
    "I could not fetch the live SOL price safely. Try again in a minute or use a SOL amount.",
  insufficient: "Not enough balance for that action. Deposit funds in Linkr and try again.",
  txFailed: "The transaction failed before confirmation. No confirmed TX was created.",
  unsupportedSwap:
    "Robinhood Chain swaps are not enabled yet. Native ETH wallet actions are live in Linkr.",
  unsupportedSolanaSwap:
    "Solana swaps are not enabled yet. Native SOL wallet actions are live in Linkr.",
  swapFailed: "The swap failed before confirmation. No confirmed TX was created.",
  unsupportedLaunch:
    "Robinhood Chain launches are not enabled yet. Native ETH wallet actions are live in Linkr.",
  jsonFail: "I could not safely understand that request. Try again with a clearer command.",
  generic: "Something went wrong on my end. No transaction was created.",
};

export function buyReply(label: string, sig: string) {
  return `Bought ${label}.\n\nView full history in Linkr.\n\nTX: ${sig}`;
}

export function sellReply(label: string, sig: string) {
  return `Sold ${label}.\n\nView full history in Linkr.\n\nTX: ${sig}`;
}

export function transferReply(sig: string) {
  return `Transfer complete.\n\nView full history in Linkr.\n\nTX: ${sig}`;
}

export function launchReply(symbol: string, sig: string) {
  return `Launched $${symbol}.\n\nView the coin and history in Linkr.\n\nTX: ${sig}`;
}

export function confirmBuyReply(args: { label: string; eth: number | null; usd: number | null }) {
  const est =
    args.usd != null && args.eth != null
      ? `$${args.usd.toFixed(2)} estimated ${args.eth.toFixed(4)} ETH`
      : args.eth != null
        ? `${args.eth.toFixed(4)} ETH`
        : `${args.usd ?? "?"} USD`;
  return `I found this action:\n\nBuy ${est} of ${args.label}\n\nReply "confirm buy" within 15 minutes to execute.\n\nNo TX created yet.`;
}

export function confirmSolBuyReply(args: {
  label: string;
  sol: number | null;
  usd: number | null;
}) {
  const est =
    args.usd != null && args.sol != null
      ? `$${args.usd.toFixed(2)} estimated ${args.sol.toFixed(4)} SOL`
      : args.sol != null
        ? `${args.sol.toFixed(4)} SOL`
        : `${args.usd ?? "?"} USD`;
  return `I found this action:\n\nBuy ${est} of ${args.label}\n\nReply "confirm buy" within 15 minutes to execute.\n\nNo TX created yet.`;
}

export function confirmSellReply(args: { label: string; pct: number | null; all: boolean }) {
  const what = args.all ? "all" : args.pct != null ? `${args.pct}%` : "some";
  return `I found this action:\n\nSell ${what} of ${args.label}\n\nReply "confirm sell" within 15 minutes to execute.\n\nNo TX created yet.`;
}

export function confirmTransferReply(args: { eth: number | null; recipient: string }) {
  const amt = args.eth != null ? `${args.eth.toFixed(4)} ETH` : "the amount";
  return `I found this action:\n\nSend ${amt} to ${args.recipient.slice(0, 6)}...\n\nReply "confirm transfer" within 15 minutes to execute.\n\nNo TX created yet.`;
}

export function confirmSolTransferReply(args: { sol: number | null; recipient: string }) {
  const amt = args.sol != null ? `${args.sol.toFixed(4)} SOL` : "the amount";
  return `I found this action:\n\nSend ${amt} to ${args.recipient.slice(0, 6)}...\n\nReply "confirm transfer" within 15 minutes to execute.\n\nNo TX created yet.`;
}

export function confirmLaunchReply(args: {
  symbol: string;
  name: string;
  devEth?: number;
  devSol?: number;
  chain?: "robinhood" | "solana";
  creatorRewards?: string | null;
}) {
  const isSolana = args.chain === "solana";
  const devText = isSolana
    ? `${Number(args.devSol ?? 0).toFixed(4)} SOL`
    : `${Number(args.devEth ?? 0).toFixed(4)} ETH`;
  const platform = isSolana ? "Pump.fun on Solana" : "Robinhood Chain";
  const rewards = args.creatorRewards ? `\n${args.creatorRewards}` : "";
  return `I found this launch:\n\n$${args.symbol} - ${args.name}\nPlatform: ${platform}\nDev buy: ${devText}${rewards}\n\nReply "confirm launch" within 15 minutes to deploy.\n\nNo TX created yet.`;
}
