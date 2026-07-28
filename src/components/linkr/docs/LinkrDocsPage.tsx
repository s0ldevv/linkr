import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  ExternalLink,
  FileText,
  KeyRound,
  Layers3,
  Lock,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { MarketingHeader } from "@/components/linkr/MarketingHeader";
import "./linkr-docs.css";

type TocItem = {
  id: string;
  label: string;
};

type TocGroup = {
  label: string;
  items: TocItem[];
};

type CommandDoc = {
  id: string;
  title: string;
  tag: string;
  tone: "lime" | "lavender" | "mint" | "red" | "paper" | "cyan";
  confirmation: string;
  purpose: string;
  examples: string[];
  checks: string[];
  happens: string[];
  edgeCases: string[];
};

type EdgeCase = {
  case: string;
  affects: string;
  behavior: string;
  userFix: string;
};

const tocGroups: TocGroup[] = [
  {
    label: "Start",
    items: [
      { id: "overview", label: "Overview" },
      { id: "quick-start", label: "Quick start" },
      { id: "bot-flow", label: "End-to-end flow" },
    ],
  },
  {
    label: "Reference",
    items: [
      { id: "commands", label: "Command reference" },
      { id: "safety", label: "Safety and confirmations" },
      { id: "wallets", label: "Wallets and funding" },
      { id: "app-api", label: "App pages" },
      { id: "terminal", label: "Terminal" },
      { id: "telegram", label: "Telegram bot" },
      { id: "market-data", label: "Market data" },
      { id: "scheduler", label: "Scheduler" },
      { id: "launches", label: "Launches" },
      { id: "creator-rewards", label: "Creator rewards" },
      { id: "liquidity-pools", label: "Liquidity pools" },
      { id: "history", label: "History and memory" },
    ],
  },
  {
    label: "Support",
    items: [
      { id: "edge-cases", label: "Edge cases" },
      { id: "security", label: "Security" },
      { id: "known-gaps", label: "Known gaps" },
      { id: "troubleshooting", label: "Troubleshooting" },
    ],
  },
];

const flowSteps = [
  {
    label: "01",
    title: "Send a request",
    text: "Mention @linkrcash on X, message @LinkrCashBot privately on Telegram, use the private terminal, or open a supported dashboard flow.",
  },
  {
    label: "02",
    title: "Understand the ask",
    text: "Linkr separates useful questions and commands from unrelated remarks, then identifies the requested chain, token, amount, recipient, or topic.",
  },
  {
    label: "03",
    title: "Load the right account",
    text: "Private surfaces use the connected Linkr account, its selected EVM and Solana wallets, saved rules, and conversation context.",
  },
  {
    label: "04",
    title: "Use clear context",
    text: "Linkr can use the active conversation, X thread, quoted post, token links, addresses, mints, and attached launch media when the reference is unambiguous.",
  },
  {
    label: "05",
    title: "Choose the feature",
    text: "The request is matched to a supported feature such as research, portfolio, buy, sell, transfer, burn, launch, liquidity, rewards, scheduling, confirmation, or cancellation.",
  },
  {
    label: "06",
    title: "Check the details",
    text: "Linkr identifies the exact token, amount, recipient, launch metadata, timeframe, trigger, position, or confirmation the request needs.",
  },
  {
    label: "07",
    title: "Apply safeguards",
    text: "Deterministic validators check balances, user limits, token ambiguity, slippage, required media, recipients, missing fields, and the frozen details for irreversible burns.",
  },
  {
    label: "08",
    title: "Confirm when required",
    text: "Risky or incomplete value-moving requests show an inspectable pending action with a 15-minute expiry. Irreversible burns always require a separate confirmation.",
  },
  {
    label: "09",
    title: "Run the request",
    text: "After every required check, Linkr uses the wallet and chain selected for the action. Each transaction is protected against duplicate execution, and multi-chain launches are tracked independently per chain.",
  },
  {
    label: "10",
    title: "Return the result",
    text: "Linkr returns the answer or receipt on the original surface and keeps the result available in the authenticated app when it belongs to the user's account.",
  },
];

const commandDocs: CommandDoc[] = [
  {
    id: "buy",
    title: "Buy Token",
    tag: "Full address",
    tone: "lime",
    confirmation:
      "Auto-executes inside rules when the command includes a full EVM contract address or Solana mint. Confirms when over limit, confirm-all is on, or the token came from thread context.",
    purpose:
      "Buy a Robinhood Chain token from the primary EVM wallet or a Solana token from the primary Solana wallet.",
    examples: [
      "@linkrcash buy 0.05 ETH of 0x1234...abcd",
      "@linkrcash buy 0.25 SOL of <Solana mint>",
      "@linkrcash buy 100 dollars of <contract address or Solana mint>",
    ],
    checks: [
      "The selected chain swap path is available for X execution.",
      "The matching primary wallet exists and has enough ETH or SOL.",
      "Default slippage is greater than zero.",
      "Max auto buy is configured for the selected chain.",
      "The output token is a full EVM contract address or Solana mint.",
      "Amount is present and USD amounts can convert to ETH or SOL.",
    ],
    happens: [
      "Linkr uses only the supplied full contract address or mint for execution. Cashtags, symbols, names, registry aliases, and fuzzy search are not executable swap inputs yet.",
      "In-rules buys execute an ETH-to-token or SOL-to-token swap, and buys that need confirmation create a pending action using confirm buy.",
      "A public receipt reply and transaction history entry are created after execution.",
    ],
    edgeCases: [
      "Missing amount, missing full address or mint, cashtag-only request, bad address, insufficient ETH or SOL, stale native price, quote failure, missing slippage, missing max buy, expired confirmation.",
    ],
  },
  {
    id: "sell",
    title: "Sell Token",
    tag: "Always confirms",
    tone: "lavender",
    confirmation:
      "Sells always create a pending confirmation and require a full EVM contract address or Solana mint.",
    purpose:
      "Sell part or all of a full-address token currently held by the user's matching Linkr wallet.",
    examples: [
      "@linkrcash sell 25% of 0x1234...abcd",
      "@linkrcash sell all of <Solana mint>",
      "@linkrcash dump 10% of <contract address or Solana mint>",
    ],
    checks: [
      "The selected chain swap path is available for X execution.",
      "Default slippage is greater than zero.",
      "Max auto sell percent is greater than zero.",
      "The token is supplied as a full EVM contract address or Solana mint.",
      "The wallet currently holds the token.",
      "Sell percentage is valid and greater than zero.",
    ],
    happens: [
      "Linkr uses only the supplied full address or mint for execution. Cashtags and symbols are not executable swap inputs yet.",
      "Linkr creates a pending action with confirm sell.",
      "On confirmation, token balances are reloaded so the latest holding is used before the token-to-ETH or token-to-SOL swap.",
      "Receipt and transaction status are stored after execution.",
    ],
    edgeCases: [
      "Holdings changed before confirmation, token no longer held, cashtag-only request, missing full address or mint, missing percentage, slippage missing, expired confirmation, quote or approval failure.",
    ],
  },
  {
    id: "transfer",
    title: "Transfer ETH, SOL, or USDC",
    tag: "Always confirms",
    tone: "lavender",
    confirmation: "Always requires confirmation in the current X bot flow.",
    purpose:
      "Send native ETH from the primary EVM wallet, or native SOL and native Solana USDC from the primary Solana wallet.",
    examples: [
      "@linkrcash send 0.1 ETH to <recipient address>",
      "@linkrcash transfer .05 SOL to <Solana recipient>",
      "@linkrcash send 25 USDC to @recipient",
      "@linkrcash send 25 USDC to <Solana recipient>",
      "@linkrcash pay 1 ETH to <EVM recipient>",
    ],
    checks: [
      "Amount is present. USDC is parsed exactly to six decimal places; USD amounts for native transfers can convert to ETH or SOL.",
      "Recipient is a valid EVM 0x address, Solana public key, or an explicit X @handle for Solana USDC.",
      "Recipient appears in the current post, not only a parent tweet.",
      "The matching wallet has enough ETH, SOL, or USDC. USDC sends also require enough SOL for network fees and optional recipient token-account rent.",
      "The amount fits the matching ETH, SOL, or USDC transfer cap in Rules.",
    ],
    happens: [
      "Linkr creates a pending action with confirm transfer.",
      "For an X @handle, Linkr resolves the current recipient wallet. If the X user has no Linkr profile, Linkr provisions the profile plus both Solana and EVM wallets using the standard onboarding path.",
      "On confirmation, Linkr reloads the recipient snapshot and builds a native ETH, SOL, or TransferChecked USDC transfer.",
      "The transaction is sent to the selected chain and waits for confirmation.",
      "Linkr saves the transfer with the correct chain explorer link and returns a receipt.",
    ],
    edgeCases: [
      "Missing recipient, unresolved X user, changed recipient wallet, invalid address, recipient only in a previous tweet, excess USDC precision, missing amount, transfer cap disabled or exceeded, insufficient USDC, insufficient SOL for fees or token-account rent, uncertain network result, expired confirmation.",
    ],
  },
  {
    id: "swap-sol-usdc",
    title: "Swap SOL and USDC",
    tag: "Exact input",
    tone: "lime",
    confirmation:
      "X and terminal requests prepare a confirmation. The authenticated wallet page can submit the selected exact-input swap directly within Rules.",
    purpose:
      "Swap native SOL for native Solana USDC, or native Solana USDC for SOL, from the primary Solana wallet through Jupiter.",
    examples: [
      "@linkrcash swap 0.25 SOL for USDC",
      "@linkrcash swap 25 USDC for SOL",
      "Open /app/wallet and select SOL → USDC or USDC → SOL",
    ],
    checks: [
      "The direction and exact input amount are explicit; no token mint is required for this fixed native pair.",
      "The Solana swap path is enabled and the primary Solana wallet is unchanged.",
      "Current Rules provide positive slippage, the appropriate SOL buy or USDC sell-percentage limit, and a bounded Solana priority-fee cap.",
      "The wallet has enough input asset and a conservative SOL reserve for base fees, priority fees, and possible USDC token-account creation.",
      "The Jupiter quote stays inside the configured slippage and platform price-impact policy.",
    ],
    happens: [
      "Linkr requests an exact-input Jupiter quote for the canonical Solana USDC mint.",
      "SOL → USDC uses the SOL buy cap; USDC → SOL calculates the requested share of the live USDC balance and enforces max sell percent.",
      "The user's saved priority-fee cap is passed to Jupiter as a maximum, while slippage is taken from current Rules.",
      "Linkr reserves the idempotency key before quoting, stores the deterministic signed transaction signature before broadcast, and refuses concurrent duplicate execution.",
      "The confirmed swap, route, quote, minimum output, signature, and Solscan receipt are saved in transaction history.",
    ],
    edgeCases: [
      "Missing direction or amount, excess SOL/USDC precision, swap disabled, zero slippage, buy or sell rule disabled, cap exceeded, insufficient SOL or USDC, insufficient SOL fee reserve, price impact too high, quote unavailable, duplicate request already preparing or submitted, confirmation expired.",
    ],
  },
  {
    id: "burn",
    title: "Burn Fungible Tokens",
    tag: "Irreversible",
    tone: "red",
    confirmation:
      "Always requires a separate confirmation after Linkr validates and freezes the exact chain, full CA/mint, wallet, decimals, and base-unit amount.",
    purpose:
      "Permanently destroy an exact amount of a fungible token held by the user's matching Linkr wallet on Solana or Robinhood Chain.",
    examples: [
      "@linkrcash burn 100 tokens on Solana, mint <full Solana mint>",
      "@linkrcash burn 25.5 tokens on Robinhood Chain, CA 0x1234...abcd",
      "@linkrcash burn all tokens on Solana, mint <full Solana mint>",
    ],
    checks: [
      "The user explicitly names Solana or Robinhood Chain; Linkr never infers the chain for a burn.",
      "The current command contains exactly one full contract address or mint. Tickers, names, links, prior context, and multiple addresses are rejected.",
      "The amount is an exact positive token-unit amount or the explicit word all, and fits the token's decimal precision.",
      "The matching Linkr wallet owns enough of the token at preparation and again at confirmation.",
      "Solana mints must use the SPL Token Program or Token-2022; only wallet-owned, unfrozen token accounts are used.",
      "Robinhood Chain tokens need a verified ABI with the exact nonpayable holder burn(uint256) function and must successfully simulate it.",
    ],
    happens: [
      "Linkr performs a read-only preflight and simulation, freezes the exact base-unit amount, and creates a 15-minute pending action.",
      "Linkr shows the chain, full CA/mint, exact amount, and a direct warning that the action is irreversible and the tokens cannot be recovered.",
      "Only a later CONFIRM executes the frozen action. Confirmation cannot replace or edit any burn detail.",
      "Solana uses BurnChecked and reduces mint supply. Robinhood Chain calls only the verified standard holder burn function, then verifies the exact wallet-balance and total-supply decrease.",
      "The signed transaction is persisted before broadcast so a retry can only rebroadcast the same transaction, never create a second burn.",
      "The receipt and transaction history store the burn, selected chain, exact amount, and transaction hash.",
    ],
    edgeCases: [
      "Missing or conflicting chain, missing/multiple/wrong-family address, ticker-only token, invalid precision, insufficient holdings, frozen Solana account, unsupported token program, EVM token without burn(uint256), failed simulation, expired confirmation, or balance changed before confirmation.",
    ],
  },
  {
    id: "scheduler",
    title: "Schedule Actions",
    tag: "Timed or market cap",
    tone: "cyan",
    confirmation:
      "Always creates a confirm schedule prompt first. After confirmation, Linkr queues the action and executes it later when the time or market-cap trigger is reached.",
    purpose:
      "Schedule future wallet actions, token launches, creator-reward claims, and liquidity actions, or create market-cap-triggered buys and sells for Robinhood Chain and Solana tokens.",
    examples: [
      "@linkrcash buy 0.05 ETH of 0x1234...abcd in 2 hours",
      "@linkrcash sell 100% of <Solana mint> in 2 hours",
      "@linkrcash buy 0.2 SOL of <Solana mint> if market cap gets below 50k",
      "@linkrcash sell 100% of 0x1234...abcd if market cap goes above 170k",
      "@linkrcash send 0.1 SOL to <recipient> in 2 hours",
      "@linkrcash launch a coin called XYZ ticker XYZ in 2 hours",
      "@linkrcash claim my Pump.fun creator rewards every day",
      "@linkrcash add liquidity to <Solana mint> every hour",
    ],
    checks: [
      "The command must include the full EVM contract address or Solana mint for scheduled buys and sells.",
      "Buy commands still require an amount; Linkr does not invent a default spend.",
      "Timed launches, buys, sells, transfers, rewards, and liquidity actions use the same validators and caps as immediate actions.",
      "Market-cap triggers are supported for buys and sells only.",
      "The matching wallet, slippage, max buy, max sell, or transfer cap must still be valid when the action executes.",
    ],
    happens: [
      "Linkr creates a pending action with confirm schedule.",
      "After confirmation, the Scheduler page shows the queued timed action or market-cap trigger.",
      "Timed actions run when their scheduled time is due.",
      "Market-cap triggers are checked on a schedule using public market data and can repeat when explicitly configured as recurring.",
      "When the trigger fires, Linkr executes through the same Robinhood Chain or Solana action path used by normal commands.",
      "Linkr posts an X receipt after execution or a failure reply if the action cannot complete after retries.",
    ],
    edgeCases: [
      "Cashtag-only scheduled swaps, missing buy amount, no full address or mint in the scheduling post, expired confirmation, market data unavailable, wallet changed, balance changed, slippage or cap removed before execution.",
    ],
  },
  {
    id: "launch",
    title: "Launch Coin",
    tag: "Dual-chain",
    tone: "lime",
    confirmation:
      "A direct launch command with a token name and one explicit chain is authorization to launch with a zero dev buy. Linkr asks which chain to use when it is missing; it never chooses one. A second confirmation is used only when your account requires it or advanced irreversible options need approval.",
    purpose:
      "Prepare and launch a Robinhood Chain ERC-20 token or a Solana Pump.fun token from X, a Telegram DM, the terminal, or the guided website form.",
    examples: [
      "@linkrcash launch a coin called GREEN on Solana",
      "@linkrcash launch coin called Linkr on Robinhood Chain with this image",
      "@linkrcash launch on pump.fun coin called CASHCAT ticker CASH dev buy 0.1 SOL",
      "@linkrcash launch Solana coin called Cash Cat ticker CASH with this image",
    ],
    checks: [
      "The user explicitly selects exactly one chain: Robinhood Chain or Solana. Linkr never generates, infers, or defaults it.",
      "Launch deployment is available for the selected chain.",
      "The matching primary EVM or Solana wallet exists and has enough ETH or SOL.",
      "A supplied image is validated and preserved; otherwise Linkr generates a bounded square token logo.",
      "A supplied symbol and description are preserved; otherwise Linkr generates and validates them.",
      "A missing dev buy defaults to exactly zero on the selected chain.",
      "A positive dev buy must be inside the selected wallet's available native balance.",
      "Custom launch metadata is accepted only when the request explicitly names a website, X/Twitter URL, or Telegram handle/link.",
    ],
    happens: [
      "When the name and explicit chain are present, Linkr fills missing creative metadata and queues the launch without another question.",
      "When the chain is missing or ambiguous, Linkr saves the draft and asks Solana or Robinhood before doing any launch preparation.",
      "The launch details keep the selected chain, platform, wallet, media, dev buy, request source, and public metadata.",
      "Robinhood Chain launches copy the image, create public metadata, submit the launch, and wait for the launch receipt.",
      "Robinhood Chain tokens have a fixed 1 billion supply and a permanently locked single-sided Uniswap V3 LP position against Robinhood WETH.",
      "Solana launches publish Pump.fun metadata, create the token from the user's primary Solana wallet, and save the Pump.fun mint and receipt.",
      "Optional dev buy ETH or SOL is included in the matching launch transaction when approved.",
    ],
    edgeCases: [
      "Launches not enabled for that chain, missing or ambiguous chain, chain/unit mismatch, bounded image generation failure, metadata upload failure, insufficient ETH or SOL, failed launch simulation, or a temporary chain issue that needs a safe retry.",
    ],
  },
  {
    id: "liquidity",
    title: "Manage Liquidity",
    tag: "User LP",
    tone: "cyan",
    confirmation: "Add, remove, and collect actions always require confirmation.",
    purpose:
      "Add, remove, collect fees from, or list user-owned Robinhood Chain Uniswap V3 LP positions and Pump.fun PumpSwap LP positions.",
    examples: [
      "@linkrcash add 0.2 ETH liquidity to CASH",
      "@linkrcash add 100000 PumpSwap liquidity to <Pump.fun mint>",
      "@linkrcash add 100000 tokens liquidity on pump.fun to <Pump.fun mint>",
      "@linkrcash remove 50% liquidity from CASH",
      "@linkrcash remove 50% PumpSwap liquidity from <Pump.fun mint>",
      "@linkrcash collect fees from my CASH LP",
      "@linkrcash show my LP positions",
    ],
    checks: [
      "Robinhood Chain liquidity uses an existing Linkr-launched token and its token/WETH V3 pool.",
      "Pump.fun liquidity uses a full Solana mint that already has a canonical PumpSwap token/SOL pool, normally after graduation.",
      "The user's matching Linkr wallet owns the LP position for remove or collect actions.",
      "The locked launch LP position is never removable.",
      "Wallet balances, approvals or token accounts, range, slippage, ownership, and deadline are checked before execution.",
    ],
    happens: [
      "Add liquidity mints a new user-owned LP NFT from the user's Linkr wallet.",
      "PumpSwap add liquidity takes the Pump token amount from the user, calculates the matching SOL amount at the current pool ratio, prepares any required token accounts, deposits both assets, and mints PumpSwap LP tokens to the user's Solana wallet.",
      "Remove liquidity decreases only the user's own LP NFT and collects available fees to the user's Linkr wallet.",
      "PumpSwap remove liquidity burns the selected LP token amount and returns token/SOL assets to the user's Solana wallet.",
      "Collect fees transfers earned fees from the user's own LP NFT to the user's Linkr wallet.",
      "List and detail commands show active LP positions, ranges, status, liquidity, fees, and pool links.",
    ],
    edgeCases: [
      "Liquidity disabled, token not launched through Linkr for Robinhood pools, Pump.fun mint has not graduated to PumpSwap, insufficient ETH/SOL or token balance, position not owned by wallet, locked launch LP requested, expired confirmation, pool data unavailable.",
    ],
  },
  {
    id: "claim-creator-rewards",
    title: "Claim Creator Rewards",
    tag: "Always confirms",
    tone: "mint",
    confirmation:
      "Always prepares an inspectable claim first and requires confirm claim before a transaction is sent.",
    purpose:
      "Check and claim supported creator rewards from eligible Linkr launches on Robinhood Chain or eligible Pump.fun fee-sharing launches on Solana.",
    examples: [
      "@linkrcash claim creator rewards for 0x1234...abcd",
      "@linkrcash claim my rewards for <Solana mint>",
      "@linkrcash claim rewards from my latest launch",
    ],
    checks: [
      "The launch can be identified by a full contract address, full Solana mint, cashtag, or clear latest-launch reference.",
      "The selected Linkr wallet is an eligible creator or configured reward recipient.",
      "The chain reports rewards that are currently available to claim.",
      "The wallet has enough ETH or SOL for any required transaction fee.",
    ],
    happens: [
      "Linkr checks the selected launch and shows the available reward details before execution.",
      "After confirm claim, Robinhood Chain can collect eligible creator ETH/WETH and launch-token fees.",
      "Eligible Solana launches can distribute available Pump.fun fee-sharing rewards to the configured wallet.",
      "The result includes the claimed amount, status, and transaction reference when available.",
      "The Earnings page shows available and claimed creator rewards across both chains.",
    ],
    edgeCases: [
      "Launch not found, wallet is not an eligible recipient, no rewards are currently claimable, Pump.fun sharing is unavailable for the mint, insufficient fee balance, expired confirmation, or transaction failure.",
    ],
  },
  {
    id: "confirm",
    title: "Confirm Action",
    tag: "Executes pending",
    tone: "mint",
    confirmation: "Not applicable. This command confirms an existing pending action.",
    purpose: "Execute the latest unexpired pending action within its 15-minute window.",
    examples: [
      "@linkrcash confirm",
      "@linkrcash yes",
      "@linkrcash do it",
      "@linkrcash confirm buy",
    ],
    checks: [
      "A pending action exists.",
      "The pending action has not expired (15-minute window).",
      "Wallet and settings still satisfy the execution rules.",
      "Balances or holdings still make the action possible.",
    ],
    happens: [
      "Linkr reloads state and revalidates key settings.",
      "If still valid, Linkr executes the swap or transfer, queues the launch, or completes the confirmed liquidity action.",
      "If invalid, Linkr cancels or fails safely and replies with the reason.",
    ],
    edgeCases: [
      "Nothing pending, pending action expired, settings changed, balance changed, token no longer held, execution failure.",
    ],
  },
  {
    id: "cancel",
    title: "Cancel Action",
    tag: "No transaction",
    tone: "paper",
    confirmation: "Not applicable. This cancels an existing pending action.",
    purpose: "Cancel the latest unexpired pending action before execution.",
    examples: [
      "@linkrcash cancel",
      "@linkrcash stop",
      "@linkrcash never mind",
      "@linkrcash don't do it",
    ],
    checks: ["A pending action exists for the user."],
    happens: [
      "Linkr marks the action as cancelled.",
      "No transaction is created.",
      "Linkr replies that the action was cancelled.",
    ],
    edgeCases: [
      "No pending action, action already expired, cancellation arrives after execution started.",
    ],
  },
  {
    id: "balance",
    title: "Wallet Balance",
    tag: "Read only",
    tone: "mint",
    confirmation: "Never confirms because no transaction is created.",
    purpose: "Show the user's native ETH and SOL balances.",
    examples: [
      "@linkrcash balance",
      "@linkrcash how much ETH do I have?",
      "@linkrcash how much SOL do I have?",
      "@linkrcash wallet balance",
    ],
    checks: [
      "Primary EVM wallet exists.",
      "Primary Solana wallet is loaded when available.",
      "The current post can name SOL/Solana, EVM/ETH, or Robinhood Chain for a chain-specific balance.",
      "Robinhood Chain and Solana can return current native balances.",
    ],
    happens: [
      "SOL/Solana balance asks get the primary Solana wallet's SOL balance.",
      "EVM, ETH, or Robinhood wallet balance asks get the primary EVM wallet's ETH balance on Robinhood Chain.",
      "Generic balance asks show both ETH on Robinhood Chain and SOL when the Solana wallet is available.",
      "Linkr replies with the balance and points users to the app for full portfolio.",
    ],
    edgeCases: [
      "No wallet exists, one chain is unavailable, primary Solana wallet is not ready, balance call fails.",
    ],
  },
  {
    id: "deposit",
    title: "Deposit Address",
    tag: "Read only",
    tone: "mint",
    confirmation: "Never confirms because no transaction is created.",
    purpose: "Tell the user where to deposit ETH or SOL.",
    examples: [
      "@linkrcash deposit address",
      "@linkrcash what's my wallet address?",
      "@linkrcash where do I send ETH?",
      "@linkrcash where do I send SOL?",
    ],
    checks: ["Primary EVM wallet exists.", "Primary Solana wallet exists for SOL requests."],
    happens: [
      "Linkr replies with a shortened ETH or SOL public wallet address based on the request.",
      "The app shows the full copyable address.",
      "Private keys are never posted on X.",
    ],
    edgeCases: [
      "No wallet exists, SOL address requested before the Solana wallet is ready, user needs the app for full address display.",
    ],
  },
  {
    id: "portfolio",
    title: "Portfolio",
    tag: "Read only",
    tone: "paper",
    confirmation: "Never confirms because no transaction is created.",
    purpose:
      "Show Robinhood Chain ETH/ERC-20 holdings and Solana SOL/SPL holdings, either broadly or for a specific token.",
    examples: [
      "@linkrcash portfolio",
      "@linkrcash what tokens do I hold?",
      "@linkrcash how much CASHCAT do I have?",
      "@linkrcash show my bags",
      "@linkrcash show my sol portfolio",
    ],
    checks: [
      "The matching primary EVM or Solana wallet exists.",
      "Current ERC-20 and SPL token balances are available for the matching primary wallets.",
      "Specific token questions resolve to one token.",
    ],
    happens: [
      "Linkr reads the ETH balance and Robinhood Chain ERC-20 token balances for EVM portfolios.",
      "Linkr reads SOL and SPL token balances for Solana portfolios.",
      "For broad requests, Linkr shows native balance plus top holdings ranked by available USD value.",
      "For specific requests, Linkr reports the matching holding or says the wallet does not hold it.",
    ],
    edgeCases: [
      "No token holdings, ticker matches multiple tokens, token has no market price, token balance lookup fails.",
    ],
  },
  {
    id: "research",
    title: "Token Research",
    tag: "Market data",
    tone: "lavender",
    confirmation: "Never confirms because no transaction is created.",
    purpose:
      "Answer Robinhood Chain and Solana token, chart, liquidity, market cap, volume, buyer, seller, and pair questions.",
    examples: [
      "@linkrcash what is this token?",
      "@linkrcash price of CASHCAT",
      "@linkrcash liquidity for <Robinhood contract address>",
      "@linkrcash analytics for <Solana mint address>",
      "@linkrcash compare <Robinhood contract address> and <Solana mint address>",
      "@linkrcash buyers and sellers on this pair?",
    ],
    checks: [
      "Market data is enabled.",
      "A token can be resolved from the post, URL, ticker, Robinhood contract address, Solana mint, or thread.",
      "Read-only address questions can include up to five mixed Robinhood Chain and Solana token addresses.",
      "Current public market sources return useful facts.",
    ],
    happens: [
      "Linkr resolves the token and chain with deterministic priority: EVM 0x addresses map to Robinhood Chain, while valid base58 mints map to Solana.",
      "When a read-only question includes multiple token addresses, Linkr fans out market-data reads and returns one compact mixed-chain answer instead of treating the addresses as ambiguous.",
      "Dexscreener data powers both Robinhood and Solana research; Blockscout is merged for Robinhood Chain when available.",
      "Solana coin detail pages can show Pump fee-sharing creator reward status when a sharing config exists for the mint.",
      "The reply summarizes price, liquidity, volume, market cap, or analytics in a short public-safe format.",
    ],
    edgeCases: [
      "Market data temporarily unavailable, token not found, ticker ambiguous, or a new token not indexed yet.",
    ],
  },
  {
    id: "discovery",
    title: "Trending, Boosted, Search",
    tag: "Discovery",
    tone: "lavender",
    confirmation: "Never confirms because no transaction is created.",
    purpose: "Find trending, boosted, or searched Robinhood Chain and Solana tokens.",
    examples: [
      "@linkrcash what's trending on Robinhood Chain?",
      "@linkrcash what's trending on Solana?",
      "@linkrcash show boosted tokens",
      "@linkrcash find tokens named green",
      "@linkrcash top tokens by liquidity",
    ],
    checks: [
      "Discovery provider is enabled.",
      "Search query is not empty.",
      "Results can be deduped cleanly.",
    ],
    happens: [
      "Robinhood Chain trending merges Blockscout token lists and Dexscreener results.",
      "Solana discovery uses Solana-scoped Dexscreener data when the chain is named.",
      "Boosted tokens use Dexscreener boosted endpoints.",
      "Search merges available providers and sorts by available facts.",
    ],
    edgeCases: [
      "No discovery results, provider rate limit, empty query, query too broad, stale results.",
    ],
  },
  {
    id: "x-search",
    title: "X Search and Sentiment",
    tag: "Social research",
    tone: "cyan",
    confirmation: "Never confirms because no transaction is created.",
    purpose:
      "Search public X posts for a cashtag, token, project, profile, or follow-up question and summarize what people appear to be saying.",
    examples: [
      "@linkrcash what are people on X saying about $CASHCAT?",
      "@linkrcash check recent posts about this token",
      "@linkrcash what is the sentiment around <Solana mint>?",
      "@linkrcash look at @project's recent posts",
    ],
    checks: [
      "The request clearly asks for X posts, public social context, a profile, or sentiment.",
      "Linkr can resolve a useful search query from the cashtag, token, mint, address, profile, or active thread context.",
      "Top and recent public results are sampled when available.",
    ],
    happens: [
      "Linkr searches public X context and keeps the answer focused on visible posts, not private account data.",
      "The reply summarizes broad tone, repeated claims, caution flags, and whether activity looks thin, mixed, or one-sided.",
      "If X search is unavailable or returns nothing useful, Linkr says that directly instead of inventing live post details.",
    ],
    edgeCases: [
      "X search unavailable, no useful posts, query too vague, token name shared by multiple projects, spam-heavy results.",
    ],
  },
  {
    id: "post-insights",
    title: "Post Explanations And Risk Reads",
    tag: "Read only",
    tone: "cyan",
    confirmation: "Never confirms because no transaction is created.",
    purpose:
      "Explain an X post or thread, or give a balanced token risk read using the public context and market facts Linkr can verify.",
    examples: [
      "@linkrcash what does this post mean?",
      "@linkrcash explain the thread above",
      "Is this token risky?",
      "What should I check before buying <full contract or mint>?",
    ],
    checks: [
      "The referenced post, thread, token, or address is clear enough to inspect.",
      "Any market or social facts used in the answer are available from public sources.",
      "The answer stays balanced and does not promise returns or pretend certainty.",
    ],
    happens: [
      "Linkr summarizes the visible post or thread in plain language and calls out missing context.",
      "Risk reads can discuss liquidity, volume, concentration, price movement, social activity, and unknowns when those facts are available.",
      "Linkr explains what to verify next instead of issuing guaranteed buy, sell, or profit instructions.",
    ],
    edgeCases: [
      "Deleted or private post, thin context, unavailable market data, shared token names, unverifiable claims, or a request for guaranteed returns.",
    ],
  },
  {
    id: "history",
    title: "History Queries",
    tag: "Memory",
    tone: "paper",
    confirmation: "Never confirms because no transaction is created.",
    purpose:
      "Answer what Linkr has done for the user across transactions, launches, settings, replies, and recent activity.",
    examples: [
      "@linkrcash show my transactions today",
      "@linkrcash what did I buy last week?",
      "@linkrcash show my launches",
      "@linkrcash what did you do for me yesterday?",
    ],
    checks: [
      "History scope can be inferred.",
      "Requested time range can be parsed.",
      "Matching history exists.",
    ],
    happens: [
      "Linkr narrows the search to the requested topic and timeframe.",
      "Only history relevant to the question is used.",
      "The reply summarizes the result in a short public-safe format.",
    ],
    edgeCases: [
      "No history, vague search, token not found in history, empty time range, summarization failure.",
    ],
  },
  {
    id: "settings-note",
    title: "Coin Settings Notes",
    tag: "Saved in app",
    tone: "paper",
    confirmation: "Does not currently require transaction confirmation.",
    purpose: "Save off-chain Linkr notes or settings-like updates for launched coins.",
    examples: [
      "@linkrcash remember my GREEN launch used a 0.2 ETH dev buy",
      "@linkrcash note that my latest launch used the green mascot art",
    ],
    checks: [
      "Referenced launch can be found when needed.",
      "The note is about app-level launch context, not an on-chain action.",
    ],
    happens: [
      "Linkr saves the app-level note.",
      "The note can be found again in later history or launch-context questions.",
      "These are app-level saved settings. They do not change anything on-chain.",
    ],
    edgeCases: ["No referenced launch, no launch history, unsupported launch setting."],
  },
  {
    id: "help",
    title: "Help And Conversation",
    tag: "Conversation",
    tone: "paper",
    confirmation: "Never confirms because no transaction is created.",
    purpose:
      "Handle help, greetings, thanks, and general conversation without triggering wallet actions.",
    examples: [
      "@linkrcash help",
      "@linkrcash what can you do?",
      "@linkrcash gm",
      "@linkrcash thanks",
    ],
    checks: [
      "Message is not a wallet action.",
      "Conversation shortcuts or model replies are enabled.",
    ],
    happens: [
      "Deterministic shortcuts handle common greetings and capability questions.",
      "Model replies can answer broader follow-ups when enabled.",
      "Reply lint keeps public replies short and safe.",
    ],
    edgeCases: [
      "Conversation model disabled, unknown follow-up parent, unsupported request, private material requested on X.",
    ],
  },
  {
    id: "unsupported",
    title: "Unsupported Or App-Only",
    tag: "Availability",
    tone: "red",
    confirmation: "Not supported as public X execution.",
    purpose: "Clearly identify commands that do not work through X yet.",
    examples: [
      "@linkrcash change my slippage to 10%",
      "@linkrcash export my private key",
      "@linkrcash buy $TOKEN without a contract address",
    ],
    checks: [
      "Whether the action is supported.",
      "Whether the action is safe for public X replies.",
    ],
    happens: [
      "Changing slippage through X is not available yet, so slippage changes happen in the app.",
      "Private key export is app-only and authenticated.",
      "Live swaps require full token contract addresses. Cashtags, symbols, names, and fuzzy token lookup are not executable swap inputs yet.",
    ],
    edgeCases: [
      "Users may ask for unsupported settings changes, secrets, financial advice, or deploy guarantees.",
    ],
  },
];

const edgeCases: EdgeCase[] = [
  {
    case: "Missing wallet",
    affects: "All wallet actions",
    behavior: "Linkr provisions when possible or refuses execution safely.",
    userFix: "Open the app or retry after wallet creation.",
  },
  {
    case: "Insufficient ETH, SOL, or USDC",
    affects: "Buy, transfer, SOL/USDC swap, launch dev buy",
    behavior: "Linkr refuses or asks the user to fund the wallet.",
    userFix:
      "Deposit ETH to the EVM wallet or SOL/USDC to the Solana wallet. Keep some SOL available for Solana fees.",
  },
  {
    case: "Missing amount",
    affects: "Buy, sell, transfer, SOL/USDC swap",
    behavior: "Linkr asks for the missing amount.",
    userFix: "Include an ETH, SOL, USDC, USD, percent, half, or all amount.",
  },
  {
    case: "Cashtag-only swap",
    affects: "Buy, sell",
    behavior: "Linkr asks for the full token address or mint and creates no transaction.",
    userFix: "Use buy 0.01 ETH of 0x..., buy 0.1 SOL of <mint>, or sell 25% of <address>.",
  },
  {
    case: "Ambiguous token",
    affects: "Buy, sell, research",
    behavior: "Linkr asks for clarification instead of guessing.",
    userFix: "Use the exact token contract address, Solana mint, or chart URL.",
  },
  {
    case: "Incomplete burn identity",
    affects: "Token burn",
    behavior:
      "Linkr refuses to infer a chain, resolve a ticker, reuse prior context, or choose among multiple addresses.",
    userFix:
      "Name Solana or Robinhood Chain, include exactly one full CA/mint in the current command, and state an exact token amount or all.",
  },
  {
    case: "Token cannot burn",
    affects: "Token burn",
    behavior:
      "Linkr creates no confirmation when a Solana burn simulation fails or an EVM token lacks the standard holder burn function.",
    userFix:
      "Check the token contract. Linkr will not substitute an EVM dead-address transfer or attempt a different destructive method.",
  },
  {
    case: "Multiple pending confirmations",
    affects: "X confirmation",
    behavior:
      "Linkr refuses a generic confirmation instead of guessing which pending action to execute.",
    userFix:
      "Cancel extra pending actions or let them expire, then prepare the intended action again.",
  },
  {
    case: "Recipient not in current post",
    affects: "Transfer",
    behavior: "Linkr refuses to pull a recipient only from parent context.",
    userFix:
      "Put the recipient address in the current post, or use an explicit to @handle for a USDC transfer.",
  },
  {
    case: "No image attached",
    affects: "Launch",
    behavior: "Linkr cannot validate launch media.",
    userFix:
      "Attach the launch image to the X post or Telegram message, or upload it in the launch form.",
  },
  {
    case: "Chain or unit mismatch",
    affects: "Buy, transfer, SOL/USDC swap, launch",
    behavior:
      "Linkr blocks the action when the requested chain, address type, or native unit does not match.",
    userFix:
      "Use ETH with Robinhood Chain EVM addresses, and SOL or native Solana USDC with Solana actions.",
  },
  {
    case: "Settings missing or zero",
    affects: "Buy, sell, transfer, SOL/USDC swap, launch",
    behavior: "Validators block execution or confirmation revalidation fails.",
    userFix: "Set slippage and max limits in the app.",
  },
  {
    case: "USD conversion unavailable",
    affects: "USD buy amounts",
    behavior: "Linkr cannot normalize the amount to the selected chain's native asset.",
    userFix: "Use an ETH or SOL amount directly, or retry later.",
  },
  {
    case: "Market data unavailable",
    affects: "Token research",
    behavior: "Linkr gives a limited answer or asks for a clearer token.",
    userFix: "Provide a mint or retry later.",
  },
  {
    case: "Pending action expired",
    affects: "Confirm flows",
    behavior: "Linkr does not execute the expired pending action.",
    userFix: "Start the action again.",
  },
  {
    case: "No pending action",
    affects: "Confirm and cancel",
    behavior: "Linkr says there is nothing to confirm.",
    userFix:
      "Create an actionable request first, such as buy, sell, transfer, burn, launch, liquidity, rewards, or schedule.",
  },
  {
    case: "Private key requested on X",
    affects: "Wallet security",
    behavior: "Linkr must not expose private keys or account secrets in a public reply.",
    userFix: "Use the authenticated app export flow.",
  },
];

export function LinkrDocsPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const filteredCommands = commandDocs;

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-doc-section]"));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) {
          setActiveSection(visible.target.id);
        }
      },
      {
        rootMargin: "-120px 0px -55% 0px",
        threshold: [0.1, 0.25, 0.5, 0.75],
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="lkd-page">
      <MarketingHeader />

      <div className="lkd-shell" role="main">
        <section className="lkd-masthead" aria-labelledby="docs-title">
          <div className="lkd-masthead-main">
            <h1 id="docs-title">
              Everything <span>@linkrcash</span> can do
            </h1>
            <p>
              Learn what you can ask Linkr to do on X, Telegram, the private terminal, and the web
              app—and what to expect before money or tokens move.
            </p>
          </div>
          <div className="lkd-command-preview" aria-label="Command examples">
            <span>Live command style</span>
            <CodeBlock
              id="masthead-examples"
              lines={[
                "@linkrcash buy 0.05 ETH of 0x...",
                "@linkrcash buy 0.2 SOL of <Solana mint>",
                "@linkrcash launch MOON on both Solana and Robinhood with this image",
                "@linkrcash show my transactions today",
              ]}
              compact
            />
          </div>
        </section>

        <MobileTopIndex activeSection={activeSection} />

        <div className="lkd-layout">
          <aside className="lkd-sidebar" aria-label="Docs navigation">
            <SidebarNav activeSection={activeSection} onNavigate={() => undefined} />
          </aside>

          <article className="lkd-content">
            <DocsSection
              id="overview"
              eyebrow="Start here"
              title="What Linkr is"
              intro="Linkr is a Robinhood Chain and Solana wallet agent available through X, Telegram, a private terminal, and guided web flows. It answers questions, researches tokens and posts, manages wallets, and prepares or executes supported actions with clear checks and confirmations."
            >
              <div className="lkd-feature-grid">
                <FeatureCard
                  icon={<Terminal />}
                  title="X commands"
                  text="Mention @linkrcash in a post or reply. Linkr can use clear thread context and attached launch media while keeping public answers concise."
                />
                <FeatureCard
                  icon={<MessageCircle />}
                  title="Telegram bot"
                  text="Message @LinkrCashBot privately for conversational account help and commands. In groups, Linkr keeps private and value-moving requests in DMs."
                />
                <FeatureCard
                  icon={<Sparkles />}
                  title="Terminal chat"
                  text="Authenticated users can use /app/terminal for a private natural-language Linkr chat with richer account context and confirmation cards."
                />
                <FeatureCard
                  icon={<ShieldCheck />}
                  title="Rules before execution"
                  text="The AI understands the user goal and relevant details. Validators check wallet state, balances, settings, token identity, and confirmation rules."
                />
                <FeatureCard
                  icon={<FileText />}
                  title="Receipts and history"
                  text="Replies, transactions, launches, pending actions, and receipts remain available so users can review or ask what happened later."
                />
                <FeatureCard
                  icon={<ExternalLink />}
                  title="App surfaces"
                  text="The web app covers wallets, settings, pools, actions, history, website launches, public activity, public profiles, and coin pages."
                />
                <FeatureCard
                  icon={<Sparkles />}
                  title="Natural reply selection"
                  text="Linkr answers real asks and useful direct replies while skipping unrelated remarks or ambient tags."
                />
              </div>
              <Callout tone="safety" title="Public X replies stay short and safe">
                Linkr does not expose private keys, account-sensitive data, or account security
                details in public replies.
              </Callout>
            </DocsSection>

            <DocsSection
              id="quick-start"
              eyebrow="Quick start"
              title="How to use Linkr"
              intro="Most users only need a connected account, a funded wallet, a clear request on X, Telegram, the terminal, or a guided app page, and a confirmation when Linkr asks for one."
            >
              <div className="lkd-steps">
                {[
                  "Connect or log in with X from the app.",
                  "Fund the Linkr EVM wallet with ETH and the Solana wallet with SOL and native Solana USDC as needed.",
                  "Set slippage and max auto rules if needed.",
                  "Mention @linkrcash, message @LinkrCashBot privately, open /app/terminal, or use a guided dashboard flow such as Launch or Scheduler.",
                  "Reply with the requested confirmation only after reviewing every detail. Token burns always require a later CONFIRM and cannot be recovered.",
                  "Check the X receipt or the app history after execution.",
                ].map((step, index) => (
                  <div className="lkd-step" key={step}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>{step}</p>
                  </div>
                ))}
              </div>
              <CodeBlock
                id="quick-start-examples"
                lines={[
                  "@linkrcash what's my wallet address?",
                  "@linkrcash balance",
                  "@linkrcash buy 0.05 ETH of 0x...",
                  "@linkrcash buy 0.2 SOL of <Solana mint>",
                  "@linkrcash sell 25% of <contract or mint>",
                  "@linkrcash compare <Robinhood contract> and <Solana mint>",
                  "@linkrcash send 0.1 ETH to <recipient address>",
                  "@linkrcash send 0.05 SOL to <Solana recipient>",
                  "@linkrcash send 25 USDC to @recipient",
                  "@linkrcash swap 0.25 SOL for USDC",
                  "@linkrcash swap 25 USDC for SOL",
                  "@linkrcash buy 0.2 SOL of <Solana mint> in 2 hours",
                  "@linkrcash sell 100% of <contract or mint> if market cap goes above 170k",
                  "@linkrcash what is this token?",
                  "@linkrcash what are people on X saying about $CASHCAT?",
                  "Message @LinkrCashBot: show my Solana portfolio",
                  "Open /app/terminal and ask: buy 0.1 SOL of <mint>",
                  "Open /launch to launch from the website form",
                ]}
              />
              <Callout tone="info" title="Current execution status">
                Native ETH, SOL, and Solana USDC transfers, SOL/USDC swaps, full-address
                Robinhood/Solana token swaps, separately confirmed fungible-token burns, balances,
                portfolio, research, public X search, post explanations, creator reward claims,
                scheduling, liquidity management, history, X launches, website launches, Telegram
                DMs, and terminal confirmations are live. General token swap commands must use the
                full EVM contract address or Solana mint; the fixed SOL/USDC pair does not require a
                mint. Cashtags and symbols are research inputs only. Launch requests can target
                Robinhood Chain or Solana/Pump.fun when launching is available for that chain. A
                request must select exactly one chain; ambiguous or missing-chain requests pause for
                clarification before preparation starts.
              </Callout>
              <Callout tone="technical" title="Natural reply selection">
                Linkr processes questions, requests, commands, small talk like how are you, and
                useful direct replies under known Linkr bot comments. Ambient remarks such as nice,
                lol, or cool are skipped. A simple thanks gets a reply only when it is clearly tied
                to a known Linkr reply.
              </Callout>
            </DocsSection>

            <DocsSection
              id="bot-flow"
              eyebrow="Pipeline"
              title="How Linkr handles a request"
              intro="Whether the request arrives from X, Telegram, the private terminal, or a guided app flow, Linkr follows the same understandable path from the user's words to an answer or receipt."
            >
              <div className="lkd-flow-grid">
                {flowSteps.map((step) => (
                  <div className="lkd-flow-card" key={step.label}>
                    <span>{step.label}</span>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                ))}
              </div>
            </DocsSection>

            <DocsSection
              id="commands"
              eyebrow="Reference"
              title="Command reference"
              intro="Every command category below maps to the current platform behavior, including confirmations, validation, supported actions, and edge cases."
            >
              <CommandMatrix />
              <div className="lkd-command-count">
                Showing {filteredCommands.length} of {commandDocs.length} command categories
              </div>
              <div className="lkd-command-grid">
                {filteredCommands.map((command) => (
                  <CommandCard key={command.id} command={command} />
                ))}
              </div>
            </DocsSection>

            <DocsSection
              id="safety"
              eyebrow="Safety"
              title="Confirmations and rules"
              intro="Linkr's model can understand natural language, but execution is gated by deterministic settings and validators."
            >
              <div className="lkd-split">
                <InfoPanel title="Safety settings">
                  <CheckList
                    items={[
                      "Default slippage controls swap tolerance.",
                      "ETH buy caps control buy size without extra confirmation.",
                      "SOL buy caps control Solana buy size without extra confirmation.",
                      "Sells currently ask for confirmation on X.",
                      "ETH launch dev-buy caps limit launch exposure.",
                      "SOL launch dev-buy caps limit Solana launch exposure.",
                      "ETH transfer caps apply to native transfers from the app wallet page.",
                      "SOL transfer caps apply to native transfers from the app wallet page.",
                      "USDC transfer caps apply to native Solana USDC transfers and are disabled when set to 0.",
                      "The Solana priority-fee setting caps the fee Jupiter may add to a SOL/USDC swap.",
                      "Users can turn on confirm-all for transaction actions.",
                      "Token burns ignore auto-execution settings: they always require a separate confirmation and freeze the exact base-unit amount first.",
                      "If more than one X action is pending, Linkr refuses to guess which action a generic confirmation refers to.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Confirmation phrases">
                  <CodeBlock
                    id="confirmation-phrases"
                    lines={[
                      "confirm buy",
                      "confirm sell",
                      "confirm transfer",
                      "confirm swap",
                      "confirm burn",
                      "confirm launch",
                      "cancel",
                    ]}
                    compact
                  />
                </InfoPanel>
              </div>
            </DocsSection>

            <DocsSection
              id="wallets"
              eyebrow="Wallets"
              title="Wallets, funding, and private keys"
              intro="Linkr manages separate encrypted EVM and Solana wallet sets. A new account receives both wallet types automatically, while the app can add wallets, set one primary wallet per chain, configure ETH, SOL, and USDC rule caps, send native currency and Solana USDC, swap SOL and USDC, show balances, and export private keys through a protected flow."
            >
              <div className="lkd-feature-grid">
                <FeatureCard
                  icon={<Wallet />}
                  title="Primary per chain"
                  text="Multiple EVM and Solana wallets can exist in the app. Each chain keeps its own selected primary wallet."
                />
                <FeatureCard
                  icon={<Zap />}
                  title="Chain funding"
                  text="Robinhood Chain actions and launches need ETH in the primary EVM wallet. Solana actions use SOL for transaction fees; USDC sends and USDC → SOL swaps also need native Solana USDC in that same wallet."
                />
                <FeatureCard
                  icon={<KeyRound />}
                  title="Private key export"
                  text="EVM private keys and Solana base58 secret keys are exportable only from the authenticated app flow."
                />
              </div>
              <Callout tone="warning" title="Never ask for private keys on X">
                Linkr can show a public deposit address on X. Secret keys are handled only in the
                app export flow.
              </Callout>
            </DocsSection>

            <DocsSection
              id="app-api"
              eyebrow="App"
              title="Dashboard and public pages"
              intro="X and Telegram are only two ways to use Linkr. The app provides authenticated wallet controls, guided launches and scheduling, terminal chat, rewards, agents, Explore discovery, public activity, and coin pages."
            >
              <div className="lkd-split">
                <InfoPanel title="Authenticated app">
                  <CheckList
                    items={[
                      "Dashboard: overview cards, recent activity, wallet shortcuts, Explore, actions, and account state.",
                      "Wallet: EVM and Solana addresses, ETH/SOL/USDC balances, deposits, primary-wallet selection, ETH/SOL/USDC sends, SOL ↔ USDC swaps, and authenticated private-key export.",
                      "Settings: slippage, ETH/SOL buy caps, ETH/SOL/USDC transfer caps, Solana swap priority-fee cap, ETH/SOL launch dev-buy caps, confirm-all, profile, terms, and display preferences.",
                      "Terminal: private natural-language chat with Linkr, richer account context, streamed replies, and confirmation cards for supported actions.",
                      "Launch: a guided website form for Robinhood Chain and Solana/Pump.fun launches with selected wallet, balances, metadata, image upload, dev buy, and creator rewards settings.",
                      "Scheduler: timed buys, sells, transfers, and market-cap-triggered buys and sells, separated by trigger type and status.",
                      "Earnings: view and claim eligible Robinhood Chain creator rewards and Solana Pump.fun fee-sharing rewards.",
                      "History and Actions: transaction receipts, launches, pending or completed actions, failures, and status checks.",
                      "Pools and Explore: Robinhood Chain LP management plus the user's launch history across supported chains.",
                      "Agents: register and manage compatible automated agents connected to the user's account.",
                      "API Keys: scoped keys and request monitoring for users who use the separate Agent API.",
                      "Onboarding: connect X, review generated wallets, and reach the dashboard with the required account setup in place.",
                      "Mobile install: add Linkr to an iPhone or Android home screen for app-like access to the web experience.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Public pages">
                  <CheckList
                    items={[
                      "Home and Explore show public launch cards for Robinhood Chain and Solana/Pump.fun launches.",
                      "Website-launched coins can be distinguished from X-launched coins in public launch surfaces.",
                      "Activity shows public actions and receipts that are safe to display.",
                      "Coin pages show token identity, market data, launch context, chain links, and supported reward status.",
                      "User profiles show public launch and activity context for that user.",
                      "Public leaderboards, top-wallet views, and launch milestones highlight activity without exposing private account data.",
                    ]}
                  />
                </InfoPanel>
              </div>
              <Callout tone="technical" title="Agent API has a separate reference">
                This page focuses on user-facing app and bot features. Use the dedicated{" "}
                <Link to="/agent-api">Agent API docs</Link> for API-specific signing, scopes,
                endpoints, duplicate protection, burn confirmation requirements, and examples.
              </Callout>
            </DocsSection>

            <DocsSection
              id="terminal"
              eyebrow="Terminal"
              title="Private Linkr chat"
              intro="The /app/terminal page is the authenticated chat version of Linkr. Users can ask naturally, keep context across a conversation, and confirm supported actions without exposing private account context in a public X reply."
            >
              <div className="lkd-feature-grid">
                <FeatureCard
                  icon={<Terminal />}
                  title="Natural language"
                  text="Users can ask about wallets, holdings, launches, tokens, posts, pools, history, and actions in conversational language."
                />
                <FeatureCard
                  icon={<ShieldCheck />}
                  title="Confirmation cards"
                  text="Value-moving actions still prepare first, show the important details, and require a confirm or cancel step."
                />
                <FeatureCard
                  icon={<Lock />}
                  title="Private context"
                  text="Terminal can use authenticated account context that should not be placed in public X replies."
                />
              </div>
              <div className="lkd-split">
                <InfoPanel title="What users can ask">
                  <CheckList
                    items={[
                      "Wallet balances, deposit addresses, portfolio holdings, and specific token holdings.",
                      "Token research, market data, X/social sentiment, and recent public post context.",
                      "Launch history, transaction history, pending actions, receipts, and recent Linkr activity.",
                      "Prepare buys, sells, transfers, irreversible token burns, launches, liquidity actions, and supported confirmations.",
                      "Continue a conversation with references like this token, that launch, the second one, confirm it, or cancel that when the context is clear.",
                      "Create, search, rename, archive, or delete conversations while keeping each chat's context separate.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Example terminal prompts">
                  <CodeBlock
                    id="terminal-examples"
                    lines={[
                      "What do I hold on Solana?",
                      "Check what people on X are saying about $CASHCAT",
                      "Buy 0.05 ETH of 0x1234...abcd",
                      "Burn 100 tokens on Solana, mint <full Solana mint>",
                      "Prepare a Solana launch for a coin called Moon ticker MOON",
                      "Show my active LP positions",
                      "Cancel that pending action",
                    ]}
                    compact
                  />
                </InfoPanel>
              </div>
              <Callout tone="safety" title="Terminal is still guarded">
                The chat surface may feel more natural, but Linkr still uses wallet checks,
                balances, limits, slippage, ownership, and confirmation requirements before any
                value-moving action can run.
              </Callout>
            </DocsSection>

            <DocsSection
              id="telegram"
              eyebrow="Telegram"
              title="@LinkrCashBot"
              intro="Linkr works as a private account assistant in Telegram DMs and as a privacy-aware helper in Telegram groups. Private wallet details and value-moving actions stay out of group chat."
            >
              <div className="lkd-feature-grid">
                <FeatureCard
                  icon={<MessageCircle />}
                  title="Private Linkr chat"
                  text="Start @LinkrCashBot, connect the same X identity used by Linkr, then ask account questions or send natural-language commands in a private conversation."
                />
                <FeatureCard
                  icon={<ShieldCheck />}
                  title="Private confirmations"
                  text="Prepared actions show confirm and cancel controls in DM. Irreversible token burns retain their separate, explicit confirmation requirement."
                />
                <FeatureCard
                  icon={<Sparkles />}
                  title="Launch media"
                  text="Users can attach an image in DM and describe a Robinhood Chain or Solana launch in the same message."
                />
                <FeatureCard
                  icon={<Lock />}
                  title="Group privacy"
                  text="In groups, Linkr responds only when addressed and keeps account-specific or value-moving requests in private chat."
                />
              </div>

              <div className="lkd-split">
                <InfoPanel title="Getting started in DM">
                  <CheckList
                    items={[
                      "/start opens the bot and starts a private Linkr conversation.",
                      "/login connects the Telegram user to the correct Linkr account through a protected sign-in flow.",
                      "/status shows whether the account connection is ready.",
                      "/help summarizes the available private-chat commands and account setup.",
                      "After connection, the DM can answer wallet, portfolio, token, post, launch, liquidity, rewards, history, and action questions with the same private context as the terminal.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Groups and verification">
                  <CheckList
                    items={[
                      "Group answers are limited to public, non-account-specific questions when @LinkrCashBot is directly addressed.",
                      "Verification links are sent privately, not posted into the group.",
                      "A new member remains restricted, or a join request remains pending, until the private verification check succeeds.",
                      "After verification, Linkr restores or approves access, sends a private Open group button, and posts: Welcome @username to the group!",
                      "When permitted, Linkr removes Telegram's automatic joined-group service message so it does not appear before verification.",
                    ]}
                  />
                </InfoPanel>
              </div>

              <Callout tone="info" title="The most reliable private verification path">
                Telegram normally prevents a bot from starting a DM with someone who has never
                opened it. Join-request invite links give @LinkrCashBot a temporary private channel
                for verification before the person enters the group. Group owners should also give
                the bot the permissions needed to approve members, restrict access, and remove join
                service messages.
              </Callout>
            </DocsSection>

            <DocsSection
              id="market-data"
              eyebrow="Research"
              title="Token research and market data"
              intro="Coin inquiries use deterministic token resolution, market data providers, and public X search when requested to answer token, chart, liquidity, volume, search, trending, boosted, sentiment, and analytics questions."
            >
              <div className="lkd-split">
                <InfoPanel title="Resolution priority">
                  <CheckList
                    items={[
                      "Address in the current post: EVM 0x for Robinhood Chain, base58 mint for Solana.",
                      "Explicitly extracted contract address or mint.",
                      "Single thread address when the user says this or above.",
                      "Dexscreener URL, plus Blockscout URL for Robinhood Chain.",
                      "Token registry symbol.",
                      "Alias cache.",
                      "Chain-scoped Blockscout and Dexscreener search.",
                      "Ask for clarification when ambiguous.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Query types">
                  <div className="lkd-chip-cloud">
                    {[
                      "token lookup",
                      "token analytics",
                      "trending tokens",
                      "boosted tokens",
                      "token search",
                      "pair stats",
                      "comparison",
                      "X sentiment",
                      "profile posts",
                      "post and thread explanations",
                      "balanced trade-risk reads",
                    ].map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </InfoPanel>
              </div>
              <InfoPanel title="Public X and sentiment questions">
                <CheckList
                  items={[
                    "Users can ask what people on X are saying about a cashtag, token, mint, contract address, project, or profile.",
                    "Users can ask Linkr to explain an X post or thread, summarize its claims, and separate stated facts from interpretation.",
                    "Users can ask whether a post presents a strong or risky trade idea; Linkr returns a balanced evidence-and-risk read rather than a promise or personalized financial instruction.",
                    "Linkr can sample top and recent public posts when X search is available, then summarize tone, repeated claims, hype, caution flags, and uncertainty.",
                    "Follow-up questions can use recent thread context, such as it or this token, when the prior conversation clearly named the coin.",
                    "Public social summaries are not endorsements and can be noisy for new or spam-heavy tokens.",
                  ]}
                />
              </InfoPanel>
              <InfoPanel title="Coin pages and public data">
                <CheckList
                  items={[
                    "Robinhood Chain coin pages combine launch records, token identity, market data, pool links, and Blockscout links when available.",
                    "Solana coin pages use Solana token analytics, Pump.fun launch context, Pump.fun links, Solscan links, and Pump fee-sharing status when available.",
                    "Public market answers are informational only and can be incomplete for very new or thinly traded pairs.",
                  ]}
                />
              </InfoPanel>
              <Callout tone="technical" title="Market data is recent, not tick-by-tick">
                Linkr uses current Robinhood Chain and Solana market data when available. New tokens
                or thin pairs can be missing or partial until more public data exists.
              </Callout>
            </DocsSection>

            <DocsSection
              id="scheduler"
              eyebrow="Automation"
              title="Scheduler"
              intro="Scheduler lets users ask Linkr on X or use the dashboard to run a wallet action later or when a token crosses a market-cap threshold. It supports Robinhood Chain and Solana while keeping the same confirmation, wallet, slippage, balance, and limit checks as normal actions."
            >
              <div className="lkd-feature-grid">
                <FeatureCard
                  icon={<CalendarClock />}
                  title="Timed actions"
                  text="Buy, sell, or transfer later with phrases like in 2 hours. The action queues only after confirm schedule."
                />
                <FeatureCard
                  icon={<CalendarClock />}
                  title="Market-cap triggers"
                  text="Buy or sell a full-address token when public market data goes below or above a threshold."
                />
                <FeatureCard
                  icon={<ShieldCheck />}
                  title="Same execution path"
                  text="When the trigger fires, Linkr uses the same Robinhood Chain or Solana swap and transfer helpers as immediate commands."
                />
              </div>
              <div className="lkd-split">
                <InfoPanel title="Timed command examples">
                  <CodeBlock
                    id="scheduler-timed-examples"
                    lines={[
                      "@linkrcash buy 0.05 ETH of 0x1234...abcd in 2 hours",
                      "@linkrcash buy 0.2 SOL of <Solana mint> in 2 hours",
                      "@linkrcash sell 100% of <contract or mint> in 2 hours",
                      "@linkrcash send 0.1 ETH to <recipient> in 2 hours",
                      "@linkrcash send 0.05 SOL to <Solana recipient> in 2 hours",
                    ]}
                    compact
                  />
                </InfoPanel>
                <InfoPanel title="Market-cap trigger examples">
                  <CodeBlock
                    id="scheduler-market-examples"
                    lines={[
                      "@linkrcash buy 0.05 ETH of 0x1234...abcd if market cap gets below 50k",
                      "@linkrcash buy 0.2 SOL of <Solana mint> if market cap drops below 50k",
                      "@linkrcash sell 100% of 0x1234...abcd if market cap goes above 170k",
                      "@linkrcash sell 50% of <Solana mint> if mcap goes over 1.2m",
                    ]}
                    compact
                  />
                </InfoPanel>
              </div>
              <div className="lkd-split">
                <InfoPanel title="What users must include">
                  <CheckList
                    items={[
                      "Scheduled buys and sells must include the full EVM contract address or full Solana mint in the scheduling post.",
                      "Buy schedules still need an explicit spend amount in ETH, SOL, or USD.",
                      "Sell schedules need all/100% or a percentage.",
                      "Timed transfers need a native ETH or SOL amount and the recipient in the same post.",
                      "Market-cap triggers apply to buys and sells only, not transfers.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="What happens after confirmation">
                  <CheckList
                    items={[
                      "Linkr replies with a schedule summary and asks for confirm schedule.",
                      "After confirmation, the scheduled action and its exact trigger appear in the Scheduler page.",
                      "The Scheduler page in the app separates timed actions from market-cap triggers and shows status, amount, chain, target, checks, errors, and transaction hashes.",
                      "Linkr checks each action when it is ready or due.",
                      "A successful execution adds its receipt and changes the scheduled action to executed.",
                    ]}
                  />
                </InfoPanel>
              </div>
              <InfoPanel title="Reliability and retries">
                <CheckList
                  items={[
                    "Duplicate protection prevents a retry from creating a second swap for the same confirmed scheduled action.",
                    "If a market-cap threshold has not crossed, the trigger remains active and checks again at its next eligible time.",
                    "Execution uses the current wallet and current safety settings, so removing a cap, changing a wallet, or losing balance can cause a scheduled action to fail safely.",
                    "Linkr posts a receipt reply when a scheduled action executes and a failure reply if retries are exhausted.",
                    "Very new tokens can have missing public market data; those triggers stay pending and check again later instead of retrying too aggressively.",
                  ]}
                />
              </InfoPanel>
              <Callout tone="safety" title="Scheduler is not ticker-based">
                Scheduler swaps do not execute from symbols, cashtags, or token names. Users must
                provide the full EVM contract address or full Solana mint in the scheduled command.
              </Callout>
            </DocsSection>

            <DocsSection
              id="launches"
              eyebrow="Launches"
              title="Launches"
              intro="X launch requests need a token name and one explicit chain. Linkr can generate a ticker, description, and image when they are omitted, defaults the dev buy to zero, and then deploys through the durable Robinhood Chain or Solana/Pump.fun pipeline."
            >
              <div className="lkd-split">
                <InfoPanel title="Robinhood Chain launches">
                  <CheckList
                    items={[
                      "Linkr deploys tokens through the supported Robinhood Chain launch flow.",
                      "Each launch deploys a fixed 1 billion supply ERC-20 with immutable metadata URI.",
                      "The full launch supply is seeded as single-sided Uniswap V3 liquidity against Robinhood WETH.",
                      "The initial LP is created automatically during launch and locked in LaunchLocker forever.",
                      "Creator and protocol LP fees split through LaunchLocker claim accounting.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Solana Pump.fun launches">
                  <CheckList
                    items={[
                      "Linkr uploads Pump.fun-compatible metadata and deploys through Pump.fun using the user's primary Solana wallet.",
                      "Solana launches save the Pump.fun mint, Pump.fun URL, Solscan link, and launch receipt when available.",
                      "A requested initial buy uses SOL and is included only when the user approves it and the wallet plus max-dev-buy rule allow it.",
                      "Solana coin pages can show Pump fee-sharing creator reward status when Linkr can read the sharing config for that mint.",
                    ]}
                  />
                </InfoPanel>
              </div>
              <div className="lkd-split">
                <InfoPanel title="Website launch page">
                  <CheckList
                    items={[
                      "The public /launch page shows Robinhood Chain and Solana/Pump.fun tabs to guests, but launching requires login.",
                      "Logged-in users can select an eligible wallet, see balances and truncated addresses, and identify the primary wallet for the selected chain.",
                      "The form accepts name, ticker, description, image, website, X/Twitter, Telegram, dev buy, and creator rewards settings where the chain supports them.",
                      "Robinhood launches can set a creator reward receiver. Eligible Solana launches can keep the creator share or split it with another wallet or connected X user.",
                      "Website launches are marked as website-origin launches so public launch cards and coin pages can distinguish them from X-launched coins.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="X launch posts">
                  <CheckList
                    items={[
                      "X launches use the post, thread, attached media, and explicit website/X/Telegram metadata when present.",
                      "A post must explicitly select exactly one chain: Robinhood Chain or Solana/Pump.fun.",
                      "If the chain is missing or ambiguous, Linkr saves the draft and asks which chain to use without generating or defaulting one.",
                      "An explicit launch command with a name and chain proceeds with a zero dev buy unless the user supplied an allowed amount.",
                      "Ticker, description, and image are generated only when the user did not provide them.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Creator rewards claims from X">
                  <CheckList
                    items={[
                      "Users can tag @linkrcash to claim creator rewards from a Linkr launch by providing the launch contract address, Solana mint, cashtag, or latest-launch reference.",
                      "Robinhood Chain claims collect the launch locker position and claim available creator WETH/ETH plus launch-token fees when present.",
                      "Solana claims distribute Pump.fun fee-sharing creator rewards for eligible Pump.fun launches and report the SOL amount available at claim time.",
                      "Linkr prepares an inspectable pending action first. The user must reply confirm claim before any claim transaction is submitted.",
                      "After execution, Linkr replies with the claimed ETH or SOL amount, any Robinhood launch-token fees, and the transaction hash.",
                    ]}
                  />
                </InfoPanel>
              </div>
              <InfoPanel title="Launch metadata">
                <CheckList
                  items={[
                    "If the user does not specify a website, Linkr can use the public Linkr coin page after the Robinhood token address or Pump.fun mint is known.",
                    "If the user does not specify a Twitter/X link from an X launch, Linkr uses the launch post URL that tagged @linkrcash.",
                    "Telegram metadata is optional for both Robinhood Chain and Pump.fun launches and defaults to empty.",
                    "Users can explicitly request a custom website, an x.com or twitter.com URL, and a Telegram @handle or t.me link in the launch post.",
                    "Telegram handles are normalized to https://t.me/<handle> before they are stored or sent to Pump.fun metadata.",
                  ]}
                />
              </InfoPanel>
              <div className="lkd-split">
                <InfoPanel title="Launch validation">
                  <CheckList
                    items={[
                      "A token name and one explicit supported chain are required user decisions.",
                      "Attached media is validated and preserved; if none is attached, Linkr generates a bounded square logo.",
                      "A missing symbol and description are generated, normalized, and recorded with provenance.",
                      "The launch chain is accepted only from the same verified user's explicit current-request or same-draft thread selection.",
                      "Both-chain wording is ambiguous and pauses until the user selects exactly one chain.",
                      "An omitted dev buy defaults to exactly zero in the selected chain's native unit.",
                      "ETH dev buys use the EVM wallet and ETH max-dev-buy setting; SOL dev buys use the Solana wallet and SOL max-dev-buy setting.",
                      "Robinhood Chain launches simulate the transaction, predict the token, estimate gas, and reject wrong-price existing pools.",
                      "Solana launches validate wallet funding, metadata upload, Pump.fun availability, and a launch simulation before submission.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Launch progress and receipts">
                  <CheckList
                    items={[
                      "Linkr records an accepted launch before submitting a deployment transaction, so the request remains traceable if a chain or service is temporarily unavailable.",
                      "Idempotent work items, wallet fencing, and transaction fingerprints protect retries from creating duplicate launches.",
                      "Robinhood Chain results include the token, pool, locked launch liquidity, dev buy, and Blockscout receipt details.",
                      "Solana results include the Pump.fun mint, Pump.fun and Solscan links, launch wallet, and initial-buy details.",
                      "Temporary failures can be retried safely; final success or failure remains visible in the user's launch history.",
                    ]}
                  />
                </InfoPanel>
              </div>
              <InfoPanel title="Robinhood launch liquidity">
                <CheckList
                  items={[
                    "At launch, the token supply is paired as single-sided Uniswap V3 liquidity against Robinhood WETH.",
                    "The launch transaction creates the initial LP position automatically, so the token starts with baseline liquidity.",
                    "The initial LP NFT is held by the locker contract permanently and cannot be removed by anyone, including Linkr or the token creator.",
                    "This locked LP provides permanent baseline liquidity for the market.",
                  ]}
                />
              </InfoPanel>
              <Callout tone="technical" title="Robinhood launch economics are contract constants">
                Robinhood Chain launches use a fixed 1 billion token supply, a 1% V3 fee tier, fixed
                launch-liquidity range, 80% creator fee share, at least 99% launch-token use, and a
                23 WETH graduation marker. Users do not choose supply, exchange, pair token, fee
                split, max wallet, or protection-window settings in the launch flow. These settings
                do not describe Solana/Pump.fun launches.
              </Callout>
              <Callout tone="info" title="Explore shows the important details first">
                A launch command that names the token and exactly one supported chain can proceed
                immediately with a zero dev buy. Linkr fills only missing creative fields. If the
                chain is absent or ambiguous, it asks Solana or Robinhood and creates no economic
                action until the same verified user answers in that launch thread.
              </Callout>
            </DocsSection>

            <DocsSection
              id="creator-rewards"
              eyebrow="Earnings"
              title="Creator rewards"
              intro="Eligible token creators can inspect and claim rewards from Robinhood Chain Linkr launches and Solana Pump.fun fee-sharing launches. Claims always show what will be collected before a transaction is submitted."
            >
              <div className="lkd-split">
                <InfoPanel title="Robinhood Chain rewards">
                  <CheckList
                    items={[
                      "Linkr checks the launch and the connected creator wallet before preparing a claim.",
                      "A claim can collect the creator share of available WETH/ETH fees and launch-token fees from the launch liquidity position.",
                      "The confirmation shows the token, wallet, available reward amounts, and destination before execution.",
                      "The final receipt reports claimed ETH, any claimed launch tokens, and the transaction link.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Solana Pump.fun rewards">
                  <CheckList
                    items={[
                      "Eligible Pump.fun mints can expose fee-sharing creator rewards to the connected Solana wallet.",
                      "Linkr checks the mint's fee-sharing setup and current claimable SOL before preparing a claim.",
                      "After confirmation, Linkr submits the reward distribution and reports the claimed SOL and Solscan receipt.",
                      "A mint without supported fee sharing, no claimable balance, or the wrong creator wallet is rejected clearly.",
                    ]}
                  />
                </InfoPanel>
              </div>
              <div className="lkd-split">
                <InfoPanel title="Where to claim">
                  <CheckList
                    items={[
                      "Use the Earnings page to review supported rewards and start a claim.",
                      "The Earnings page can filter by chain and chart cumulative claimed ETH and SOL over time.",
                      "Tag @linkrcash, message @LinkrCashBot privately, or use the terminal with a launch contract, Solana mint, clear launch reference, or latest-launch request.",
                      "Every claim is prepared first and requires an explicit confirmation before funds move.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Examples">
                  <CodeBlock
                    id="creator-reward-examples"
                    lines={[
                      "@linkrcash claim creator rewards for 0x1234...abcd",
                      "@linkrcash claim Pump.fun rewards for <Solana mint>",
                      "Claim rewards from my latest launch",
                    ]}
                    compact
                  />
                </InfoPanel>
              </div>
              <Callout tone="safety" title="Claims never run from a vague token guess">
                Linkr must resolve the launch and creator wallet unambiguously. If a symbol or
                latest launch reference could point to more than one token, Linkr asks for the full
                Robinhood contract address or Solana mint.
              </Callout>
            </DocsSection>

            <DocsSection
              id="liquidity-pools"
              eyebrow="Liquidity Pools"
              title="Liquidity pools"
              intro="Users can manage optional Robinhood Chain ETH LP positions and Pump.fun PumpSwap token/SOL LP positions from either the app dashboard or X commands."
            >
              <div className="lkd-feature-grid">
                <FeatureCard
                  icon={<Lock />}
                  title="Permanent baseline LP"
                  text="Every Robinhood Chain Linkr launch starts with an automatic single-sided Uniswap V3 LP position locked forever in the locker contract."
                />
                <FeatureCard
                  icon={<Layers3 />}
                  title="Separate user LP"
                  text="Additional liquidity is optional and separate from locked launch liquidity. Robinhood positions are LP NFTs; PumpSwap positions are LP tokens."
                />
                <FeatureCard
                  icon={<Wallet />}
                  title="Wallet-owned positions"
                  text="Only the matching Linkr wallet that owns the LP NFT or PumpSwap LP tokens can remove liquidity from that position."
                />
              </div>

              <div className="lkd-liquidity-rail" aria-label="Liquidity pool lifecycle">
                <div>
                  <span>01</span>
                  <strong>Launch creates baseline liquidity</strong>
                  <p>
                    The initial Robinhood Chain LP is created during launch, locked permanently, and
                    remains in the pool as baseline liquidity.
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <strong>User adds optional liquidity</strong>
                  <p>
                    A user can add ETH/token liquidity on Robinhood Chain or token/SOL liquidity on
                    PumpSwap and receive a separate user-owned LP position.
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <strong>Position earns pool fees</strong>
                  <p>
                    Robinhood Chain fees accrue to the LP NFT and can be collected. PumpSwap value
                    is represented by the user's LP token balance.
                  </p>
                </div>
                <div>
                  <span>04</span>
                  <strong>User can remove their own LP</strong>
                  <p>
                    User-added liquidity is removable by that user. The locked launch LP remains in
                    the locker contract.
                  </p>
                </div>
              </div>

              <div className="lkd-split">
                <InfoPanel title="Adding liquidity">
                  <CheckList
                    items={[
                      "Robinhood Chain liquidity requires an existing Linkr-launched token pool.",
                      "PumpSwap liquidity requires a full Pump.fun token mint with an existing canonical PumpSwap pool, normally after graduation.",
                      "The default flow uses the launched pool's 1% fee tier and a wide range around the current price.",
                      "PumpSwap users enter the Pump token amount; Linkr calculates the matching SOL amount at the current pool ratio.",
                      "The quote checks wallet balance, token balance, token accounts, allowance needs, slippage, range, and deadline.",
                      "After confirmation, Linkr wraps ETH or SOL when needed, creates required token accounts, and mints the LP position to the user's wallet.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Removing and collecting">
                  <CheckList
                    items={[
                      "Users can remove 25%, 50%, 75%, 100%, or a custom percentage from their own LP position.",
                      "Remove actions decrease liquidity from the selected LP NFT and collect available fees to the user's Linkr wallet.",
                      "PumpSwap remove actions redeem the selected LP token amount and return the underlying token and SOL assets to the Solana wallet.",
                      "Users can collect fees without removing liquidity when fees are available.",
                      "The locked launch LP is not selectable for removal and remains permanent.",
                      "Receipts, explorer links, status, and position updates are saved after execution.",
                    ]}
                  />
                </InfoPanel>
              </div>

              <div className="lkd-split">
                <InfoPanel title="Pools dashboard">
                  <CheckList
                    items={[
                      "The Pools section separates Robinhood Chain ETH pools from Pump.fun PumpSwap pools.",
                      "Robinhood cards include token, pool, fee tier, LP NFT id, range, status, liquidity, uncollected fees, and Blockscout links.",
                      "PumpSwap cards include token mint, pool, LP token account, status, liquidity, and Solscan links.",
                      "Users can start add, remove, and Robinhood collect-fee flows from the dashboard with a required risk acknowledgment.",
                      "Refreshing positions checks current ownership and updates transferred, closed, and active states.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="X commands">
                  <CodeBlock
                    id="liquidity-pool-commands"
                    lines={[
                      "@linkrcash add 0.2 ETH liquidity to CASH",
                      "@linkrcash add 100000 PumpSwap liquidity to <Pump.fun mint>",
                      "@linkrcash remove 50% liquidity from CASH",
                      "@linkrcash remove 50% PumpSwap liquidity from <Pump.fun mint>",
                      "@linkrcash collect fees from my CASH LP",
                      "@linkrcash show my LP positions",
                    ]}
                    compact
                  />
                </InfoPanel>
              </div>

              <Callout tone="safety" title="Confirmations show the important details">
                Add, remove, and collect actions require confirmation. The pending action shows the
                token, pool, ETH/SOL and token amounts, range or LP token account, fee tier where
                applicable, slippage, LP position, and risk note before Linkr signs anything.
              </Callout>
              <Callout tone="warning" title="Liquidity provider risks">
                LP positions can lose value compared with simply holding the tokens. DeFi smart
                contracts can contain bugs or unexpected behavior, and providing liquidity to
                low-quality or thinly traded tokens can result in losses. Only provide liquidity you
                can afford to lose.
              </Callout>
            </DocsSection>

            <DocsSection
              id="history"
              eyebrow="Memory"
              title="History, memory, and receipts"
              intro="Users can ask for transactions, launches, settings history, agent activity, recent activity, and thread context. Linkr retrieves only the scopes needed for the question."
            >
              <div className="lkd-split">
                <InfoPanel title="Time phrases">
                  <CheckList
                    items={[
                      "today",
                      "yesterday",
                      "last 7 days",
                      "last 30 days",
                      "this week or last week",
                      "this month or last month",
                      "specific month and year",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="Retrieval scopes">
                  <div className="lkd-chip-cloud">
                    {[
                      "recent transactions",
                      "transaction search",
                      "recent launches",
                      "launch notes",
                      "agent activity",
                      "recent replies",
                      "saved memory",
                      "thread context",
                    ].map((scope) => (
                      <span key={scope}>{scope}</span>
                    ))}
                  </div>
                </InfoPanel>
              </div>
              <Callout tone="info" title="The app keeps richer receipts">
                X replies stay short. The authenticated app history and actions pages show richer
                transaction, launch, pending action, liquidity action, failure, and receipt status.
                Agent API clients can also poll supported action IDs from the signed API.
              </Callout>
            </DocsSection>

            <DocsSection
              id="edge-cases"
              eyebrow="Support"
              title="Edge cases and failure modes"
              intro="The most important support paths are documented here so users know what Linkr does when a command is incomplete, unsafe, ambiguous, or temporarily blocked."
            >
              <EdgeCaseTable />
            </DocsSection>

            <DocsSection
              id="security"
              eyebrow="Security"
              title="Security and privacy"
              intro="The bot is public-facing, but wallet secrets, account data, and private keys are protected behind authenticated app flows."
            >
              <div className="lkd-feature-grid">
                <FeatureCard
                  icon={<Lock />}
                  title="Encrypted wallet material"
                  text="Wallet private keys are encrypted at rest and are never posted through X."
                />
                <FeatureCard
                  icon={<ShieldCheck />}
                  title="Account protection"
                  text="Authentication, X connection flows, wallet actions, settings changes, and key-management pages use protected app checks."
                />
                <FeatureCard
                  icon={<ShieldCheck />}
                  title="Data minimization"
                  text="Public replies are kept short and avoid exposing private app data."
                />
                <FeatureCard
                  icon={<KeyRound />}
                  title="Scoped API keys"
                  text="Agent API keys are scoped, revocable, optionally HMAC-signed, and checked before mutating actions run. The destructive burn:write scope is opt-in and still cannot bypass separate burn confirmation."
                />
              </div>
            </DocsSection>

            <DocsSection
              id="known-gaps"
              eyebrow="Availability"
              title="Current availability"
              intro="A clear view of where Linkr is strict today across X, Telegram, the website launcher, terminal, and app pages."
            >
              <div className="lkd-gap-list">
                <Callout tone="warning" title="Contract addresses required for swaps">
                  Live X swaps require a full Robinhood Chain token contract address or a full
                  Solana mint address. Cashtags, symbols, token names, and fuzzy token lookup are
                  not executable swap inputs yet. The fixed native SOL/USDC pair is the exception:
                  use an exact command such as swap 0.25 SOL for USDC or swap 25 USDC for SOL.
                </Callout>
                <Callout tone="technical" title="Native Solana USDC only">
                  USDC sends and SOL/USDC swaps use Circle's canonical native USDC mint on Solana.
                  Bridged or similarly named tokens are not substituted. An X-handle transfer may
                  create the recipient's Linkr profile and standard EVM plus Solana wallets when no
                  profile exists.
                </Callout>
                <Callout tone="technical" title="Launch and reward availability">
                  Robinhood launches depend on the supported launch contracts, metadata storage,
                  wallet funding, and launch processing being available. Solana launches depend on
                  Pump.fun launch support, Solana connectivity, metadata upload, and the user's
                  funded primary Solana wallet. Supported reward claims include Robinhood Chain
                  launch rewards and Pump fee-sharing distribution for eligible Solana mints.
                </Callout>
                <Callout tone="technical" title="PumpSwap pool required">
                  Pump.fun liquidity commands require a full Solana mint with an existing canonical
                  PumpSwap token/SOL pool. Tokens that are still on the Pump.fun bonding curve
                  cannot receive PumpSwap LP deposits yet.
                </Callout>
                <Callout tone="warning" title="Terminal actions still confirm">
                  Terminal can understand natural follow-ups and private account context, but
                  value-moving actions still need a clear prepared action and a confirm or cancel
                  step.
                </Callout>
                <Callout tone="warning" title="Burn support is deliberately strict">
                  Fungible-token burns require an explicit chain, one full CA or mint in the current
                  command, and an exact amount. Solana supports SPL Token and Token-2022 burns from
                  wallet-owned accounts. Robinhood Chain supports only contracts that successfully
                  simulate the standard holder burn function; Linkr does not substitute a
                  dead-address transfer. Native ETH/SOL, NFTs, and liquidity removal are separate
                  actions.
                </Callout>
                <Callout tone="warning" title="Slippage changes are app-only">
                  Changing slippage through X is not available yet. Slippage changes happen in the
                  app.
                </Callout>
                <Callout tone="technical" title="X search availability">
                  Public X search and profile/post summaries depend on the search provider being
                  available and returning useful public posts. When results are thin or unavailable,
                  Linkr should say so instead of pretending it verified live posts.
                </Callout>
                <Callout tone="technical" title="Market data availability">
                  Token research depends on live Robinhood Chain and Solana market data. When fresh
                  data is unavailable, Linkr gives the clearest available result instead of
                  guessing. Solana creator reward display and claims depend on the Pump fee-sharing
                  config being present for that mint.
                </Callout>
              </div>
            </DocsSection>

            <DocsSection
              id="troubleshooting"
              eyebrow="Troubleshooting"
              title="What to do when Linkr does not act"
              intro="Most failed commands are caused by missing information, insufficient balance, expired confirmations, ambiguity, or provider outages."
            >
              <div className="lkd-troubleshoot">
                <InfoPanel title="Try this first">
                  <CheckList
                    items={[
                      "Use the exact token contract address if Linkr seems unsure.",
                      "Put transfer recipients in the current X post.",
                      "For USDC, use an exact amount and either a Solana address or to @handle in the current post.",
                      "Use ETH or SOL amounts if USD conversion fails.",
                      "Restart the command when the 15-minute confirmation window expires.",
                      "Fund the wallet before transfers and launch dev buys; USDC actions still need a small SOL fee reserve.",
                    ]}
                  />
                </InfoPanel>
                <InfoPanel title="If it still fails">
                  <CheckList
                    items={[
                      "Try again after a few minutes if providers are slow.",
                      "Check the app for wallet funding, limits, and pending confirmations.",
                      "Use exact token addresses when symbols are ambiguous.",
                      "For launches, confirm the image and dev-buy amount are valid.",
                      "Contact support with the X post link if the issue keeps happening.",
                    ]}
                  />
                </InfoPanel>
              </div>
            </DocsSection>
          </article>
        </div>
      </div>
    </div>
  );
}

function MobileTopIndex({ activeSection }: { activeSection: string }) {
  return (
    <nav className="lkd-mobile-index" aria-label="Mobile docs index">
      <div className="lkd-mobile-index-head">
        <span>
          <BookOpen aria-hidden="true" size={15} strokeWidth={2.5} />
          Docs index
        </span>
        <small>{tocGroups.reduce((count, group) => count + group.items.length, 0)} sections</small>
      </div>
      <div className="lkd-mobile-index-groups">
        {tocGroups.map((group) => (
          <section className="lkd-mobile-index-group" key={group.label}>
            <h2>{group.label}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <a
                    href={"#" + item.id}
                    data-active={activeSection === item.id}
                    aria-current={activeSection === item.id ? "location" : undefined}
                  >
                    <span>
                      <i aria-hidden="true" />
                      {item.label}
                    </span>
                    <ChevronRight aria-hidden="true" size={16} strokeWidth={2.4} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}

function SidebarNav({
  activeSection,
  onNavigate,
}: {
  activeSection: string;
  onNavigate: () => void;
}) {
  return (
    <div className="lkd-sidebar-inner">
      <div className="lkd-sidebar-title">
        <span>Docs index</span>
      </div>
      <nav>
        {tocGroups.map((group) => (
          <div className="lkd-nav-group" key={group.label}>
            <span>{group.label}</span>
            {group.items.map((item) => (
              <a
                key={item.id}
                href={"#" + item.id}
                data-active={activeSection === item.id}
                onClick={onNavigate}
              >
                <ChevronRight aria-hidden="true" size={14} />
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

function DocsSection({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="lkd-section" data-doc-section>
      <div className="lkd-section-head">
        <span>
          <Sparkles aria-hidden="true" size={16} />
          {eyebrow}
        </span>
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
      {children}
    </section>
  );
}

function FeatureCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="lkd-feature-card">
      <div aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function InfoPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="lkd-info-panel">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="lkd-check-list">
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" size={16} strokeWidth={2.8} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "safety" | "technical" | "warning" | "info";
  title: string;
  children: ReactNode;
}) {
  const Icon =
    tone === "warning"
      ? AlertTriangle
      : tone === "technical"
        ? Code2
        : tone === "safety"
          ? ShieldCheck
          : BookOpen;
  return (
    <div className={"lkd-callout lkd-callout-" + tone}>
      <div>
        <Icon aria-hidden="true" size={18} strokeWidth={2.5} />
        <strong>{title}</strong>
      </div>
      <p>{children}</p>
    </div>
  );
}

function CommandMatrix() {
  return (
    <div className="lkd-table-wrap" aria-label="Command overview">
      <table>
        <thead>
          <tr>
            <th>User goal</th>
            <th>Executes</th>
            <th>Confirmation</th>
          </tr>
        </thead>
        <tbody>
          {commandDocs.map((command) => (
            <tr key={command.id}>
              <td>{command.title}</td>
              <td>{command.tag}</td>
              <td>{command.confirmation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommandCard({ command }: { command: CommandDoc }) {
  return (
    <section className="lkd-command-card" id={"command-" + command.id}>
      <span className={"lkd-card-tag lkd-card-tag-" + command.tone}>{command.tag}</span>
      <div className="lkd-command-card-head">
        <h3>{command.title}</h3>
        <p>{command.purpose}</p>
      </div>
      <CodeBlock id={"examples-" + command.id} lines={command.examples} compact />
      <div className="lkd-command-card-body">
        <div>
          <h4>What Linkr checks</h4>
          <CheckList items={command.checks} />
        </div>
        <div>
          <h4>What happens next</h4>
          <CheckList items={command.happens} />
        </div>
      </div>
      <div className="lkd-command-footer">
        <span>{command.confirmation}</span>
      </div>
      <p className="lkd-edge-note">
        <strong>Edge cases:</strong> {command.edgeCases.join(" ")}
      </p>
    </section>
  );
}

function CodeBlock({
  id,
  lines,
  compact = false,
}: {
  id: string;
  lines: string[];
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const value = lines.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={compact ? "lkd-code-block lkd-code-block-compact" : "lkd-code-block"}>
      <button type="button" onClick={copy} aria-label={"Copy " + id}>
        {copied ? (
          <Check aria-hidden="true" size={15} />
        ) : (
          <Clipboard aria-hidden="true" size={15} />
        )}
      </button>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}

function EdgeCaseTable() {
  return (
    <div className="lkd-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Edge case</th>
            <th>Affects</th>
            <th>Linkr behavior</th>
            <th>User fix</th>
          </tr>
        </thead>
        <tbody>
          {edgeCases.map((item) => (
            <tr key={item.case}>
              <td>{item.case}</td>
              <td>{item.affects}</td>
              <td>{item.behavior}</td>
              <td>{item.userFix}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
