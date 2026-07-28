import { AddLiquidityQuote, RemoveLiquidityQuote } from "./types.ts";
import { formatUnitsSafe } from "./math.ts";
import { getTxExplorerUrl } from "../robinhood_chain.ts";

export function addLiquidityConfirmationText(quote: AddLiquidityQuote): string {
  if ((quote as any).platform === "pump_swap") return pumpAddLiquidityConfirmationText(quote);
  const symbol = quote.token_symbol ?? "token";
  return [
    `Add liquidity to ${symbol}?`,
    "",
    `Input: ${formatUnitsSafe(quote.eth_amount_wei, 18, 6)} ETH + about ${formatUnitsSafe(quote.token_amount_wei, 18, 4)} ${symbol}`,
    "Range: wide",
    `Pool: ${(quote.pool_fee / 10_000).toFixed(2).replace(/\.?0+$/, "")}% V3`,
    "Risk: LP value can fall vs holding.",
    "",
    "Reply: confirm add liquidity",
  ].join("\n");
}

export function removeLiquidityConfirmationText(quote: RemoveLiquidityQuote): string {
  if ((quote as any).platform === "pump_swap") return pumpRemoveLiquidityConfirmationText(quote);
  const symbol = quote.token_symbol ?? "token";
  const percent = quote.requested_percent == null ? "" : `${quote.requested_percent}% `;
  return [
    `Remove ${percent}of your ${symbol} LP?`,
    "",
    `Position: #${quote.position_token_id}`,
    "Fees are collected to your Linkr wallet too.",
    "",
    "Reply: confirm remove liquidity",
  ].join("\n");
}

export function collectFeesConfirmationText(quote: RemoveLiquidityQuote): string {
  const symbol = quote.token_symbol ?? "token";
  return [
    `Collect fees from your ${symbol} LP?`,
    "",
    `Position: #${quote.position_token_id}`,
    "Fees will be sent to your Linkr wallet.",
    "",
    "Reply: confirm collect fees",
  ].join("\n");
}

export function liquiditySuccessText(action: string, symbol: string | null, result: any): string {
  const token = symbol ?? "LP";
  const link = result?.explorer_url ?? (result?.tx_hash ? getTxExplorerUrl(result.tx_hash) : null);
  const isPump = result?.signature || result?.amount_sol_lamports;
  if (action === "add_liquidity") {
    return [
      `${token} ${isPump ? "PumpSwap " : ""}LP added.`,
      "",
      `Position: #${result.position_token_id}`,
      "Liquidity: active",
      link ? `Tx: ${link}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (action === "remove_liquidity") {
    return [
      `${token} ${isPump ? "PumpSwap " : ""}LP removed.`,
      "",
      `Position: #${result.position_token_id}`,
      link ? `Tx: ${link}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${token} LP fees collected.`,
    "",
    `Position: #${result.position_token_id}`,
    link ? `Tx: ${link}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPositionList(positions: any[]): string {
  if (positions.length === 0) return "You do not have any active LP positions yet.";
  const lines = ["Your LP positions:", ""];
  positions.slice(0, 5).forEach((position, index) => {
    const symbol = position.token_symbol ?? "LP";
    const venue = position.chain === "solana" ? "PumpSwap/SOL" : "Robinhood/ETH";
    const range = position.in_range === false ? "out of range" : "active";
    lines.push(
      `${index + 1}. ${symbol} ${venue} #${shortId(position.position_token_id)} - ${range} - liquidity ${position.liquidity ?? "0"}`,
    );
  });
  lines.push("", "Use: @linkrcash show my CASH LP");
  return lines.join("\n");
}

function pumpAddLiquidityConfirmationText(quote: any): string {
  const symbol = quote.token_symbol ?? "Pump token";
  return [
    `Add PumpSwap liquidity to ${symbol}?`,
    "",
    `Input: ${formatRaw(quote.token_amount_raw, quote.token_decimals, 6)} ${symbol} + ${formatRaw(quote.sol_amount_lamports, 9, 6)} SOL`,
    "Pool: PumpSwap TOKEN/SOL",
    `LP tokens: about ${formatRaw(quote.lp_token_amount, 9, 6)}`,
    "Risk: LP value can fall vs holding.",
    "",
    "Reply: confirm add liquidity",
  ].join("\n");
}

function pumpRemoveLiquidityConfirmationText(quote: any): string {
  const symbol = quote.token_symbol ?? "Pump token";
  const percent = quote.requested_percent == null ? "" : `${quote.requested_percent}% `;
  return [
    `Remove ${percent}of your ${symbol} PumpSwap LP?`,
    "",
    `Expected: ${formatRaw(quote.token_amount_raw, quote.token_decimals, 6)} ${symbol} + ${formatRaw(quote.sol_amount_lamports, 9, 6)} SOL`,
    `LP account: ${shortId(quote.lp_token_account)}`,
    "",
    "Reply: confirm remove liquidity",
  ].join("\n");
}

function formatRaw(raw: string, decimals: number, max = 6): string {
  const value = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}

function shortId(value: string): string {
  const text = String(value ?? "");
  if (text.length <= 12) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}
