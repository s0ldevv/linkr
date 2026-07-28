export interface LinkrCapability {
  key: string;
  public_summary: string;
  confirmation_note?: string;
}

export const LINKR_CAPABILITIES: LinkrCapability[] = [
  {
    key: "chains",
    public_summary:
      "operate on Robinhood Chain EVM/ETH and Solana SOL/Pump.fun/PumpSwap flows",
  },
  {
    key: "wallet",
    public_summary:
      "show ETH/SOL deposit addresses, balances, and portfolio context",
  },
  {
    key: "market",
    public_summary:
      "answer token price, liquidity, volume, chart, activity, discovery, and comparison questions",
  },
  {
    key: "social",
    public_summary:
      "search public X posts, explain posts or threads, and give balanced trade-risk reads",
  },
  {
    key: "swap",
    public_summary:
      "prepare buys and sells when you provide a supported token address or mint",
    confirmation_note:
      "sells require confirmation; buys can execute inside the user's configured rules",
  },
  {
    key: "schedule",
    public_summary:
      "prepare supported buys, sells, transfers, launches, rewards claims, and liquidity actions for a later time or supported market-cap trigger",
    confirmation_note:
      "scheduled actions require exact details and confirmation before execution",
  },
  {
    key: "transfer",
    public_summary:
      "prepare ETH or SOL transfers to valid EVM or Solana addresses",
    confirmation_note:
      "transfers require a confirmation reply before execution",
  },
  {
    key: "burn",
    public_summary:
      "prepare irreversible token burns with an explicit chain, full contract address or mint, and exact amount",
    confirmation_note:
      "burns always require a separate confirmation and burned tokens cannot be recovered",
  },
  {
    key: "launch",
    public_summary:
      "launch on an explicitly selected Robinhood Chain or Solana/Pump.fun chain while generating omitted creative metadata",
    confirmation_note:
      "a missing or ambiguous chain requires clarification; a second confirmation is reserved for configured safety exceptions",
  },
  {
    key: "rewards",
    public_summary:
      "inspect and claim eligible Robinhood Chain creator rewards and Solana Pump.fun fee-sharing rewards",
    confirmation_note:
      "creator reward claims require confirmation before execution",
  },
  {
    key: "liquidity",
    public_summary:
      "show your LP positions and prepare supported add/remove liquidity actions",
    confirmation_note:
      "liquidity changes require a confirmation reply before execution",
  },
  {
    key: "history",
    public_summary:
      "summarize your Linkr launches, transactions, pending actions, and recent activity",
  },
];

export function capabilityPromptSummary(): string {
  return "I work on Robinhood Chain (EVM/ETH) and Solana (SOL/Pump.fun/PumpSwap). I can help with wallets, token research, public X search and post explanations, buys, sells, scheduled actions, transfers, irreversible token burns, launches, creator rewards, LP positions, liquidity actions, pending actions, and Linkr history. Risky or incomplete value-moving actions need confirmation; burns always require a separate confirmation.";
}

export function chainCapabilityReply(): string {
  return "I operate on Robinhood Chain (EVM/ETH) and Solana (SOL). That includes Robinhood token actions plus Solana swaps, transfers, Pump.fun launches, and PumpSwap liquidity.";
}

export function capabilityPromptFacts(): string {
  return LINKR_CAPABILITIES.map((capability) => {
    const note = capability.confirmation_note
      ? ` ${capability.confirmation_note}.`
      : "";
    return `- ${capability.key}: ${capability.public_summary}.${note}`;
  }).join("\n");
}
