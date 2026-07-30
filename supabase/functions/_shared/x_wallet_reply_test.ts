import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { routeLinkrTurnDeterministic } from "./conversation_router.ts";
import { getRouteResourceBundle } from "./linkr_route_resources.ts";
import { lintPublicReply, sanitizePublicReply } from "./reply_lint.ts";
import {
  composeWalletBalanceReply,
  formatWalletBalance,
  shortWalletAddress,
  WALLET_UNLINKED_REPLY,
  WALLET_UNREADABLE_REPLY,
} from "./x_wallet_reply.ts";

const route = (text: string) =>
  routeLinkrTurnDeterministic({ text, engagement_gate_enabled: false }).route;

// The production failure: asked on X how much SOL he had, the bot replied
// "Please provide your Solana wallet address (public key)..." because no route
// existed and the model invented a workflow.
Deno.test("a self wallet question routes to wallet_query", () => {
  for (
    const text of [
      "@linkrbot how much sol do I have on my wallet?",
      "@linkrbot what's my balance?",
      "@linkrbot my wallet balance please",
      "@linkrbot how much eth do i have",
      "@linkrbot do i have any sol?",
      "@linkrbot check my balance",
      "@linkrbot what's in my wallet",
      "@linkrbot what is my deposit address",
    ]
  ) {
    assertEquals(route(text), "wallet_query", text);
  }
});

// A public reply may disclose the asker's own balance and nobody else's.
Deno.test("wallet_query never answers for a third party or an address", () => {
  for (
    const text of [
      "@linkrbot how much sol does he have",
      "@linkrbot show me their wallet balance",
      "@linkrbot what is the balance of VkeXjqaTWyYs4dV6x9GNz8yzBhKwVvja1Pyvqwd1pnQ",
      "@linkrbot whats someone elses balance",
    ]
  ) {
    assertEquals(route(text) === "wallet_query", false, text);
  }
});

Deno.test("wallet_query does not steal other established routes", () => {
  assertEquals(route("@linkrbot who built you?"), "identity");
  assertEquals(route("@linkrbot export my private key"), "safe_refusal");
  assertEquals(route("@linkrbot what are people saying about $ANSEM"), "x_search");
  assertEquals(route("@linkrbot gm"), "small_talk");
  // A capability question stays a capability question.
  assertEquals(route("@linkrbot can you check wallet balances?") === "wallet_query", false);
});

Deno.test("the wallet_query bundle is self-private and declares its tool", () => {
  const bundle = getRouteResourceBundle("wallet_query");
  assertEquals(bundle.allowed_tools, ["wallet.balance_query"]);
  assertEquals(bundle.privacy_limits.includes("user_private"), true);
  // Composed deterministically — no model call is permitted for a balance.
  assertEquals(bundle.allowed_model_calls, []);
});

// A balance that could not be read must never be rendered as zero. Reporting
// "0 SOL" for a failed RPC read is a lie about the user's money.
Deno.test("an unreadable balance is never reported as zero", () => {
  assertEquals(formatWalletBalance(null, "SOL"), "balance unavailable");
  assertEquals(formatWalletBalance(undefined, "SOL"), "balance unavailable");
  assertEquals(formatWalletBalance("abc", "ETH"), "balance unavailable");
  assertEquals(formatWalletBalance(0, "SOL"), "0 SOL");
});

Deno.test("balances render at the precision they are held", () => {
  assertEquals(formatWalletBalance(0.00757248, "SOL"), "0.007572 SOL");
  assertEquals(formatWalletBalance(1, "ETH"), "1 ETH");
  assertEquals(formatWalletBalance(12.5, "SOL"), "12.5 SOL");
  // Dust must not round away to a bare "0" and read as an empty wallet.
  assertEquals(formatWalletBalance(0.0000001, "SOL"), "1.00e-7 SOL");
});

Deno.test("an empty wallet read is reported honestly, not as an empty wallet", () => {
  assertEquals(
    composeWalletBalanceReply({ evmWallet: null, solWallet: null }),
    WALLET_UNREADABLE_REPLY,
  );
});

Deno.test("the reply carries the real balances", () => {
  const text = composeWalletBalanceReply({
    solWallet: { address: "VkeXjqaTWyYs4dV6x9GNz8yzBhKwVvja1Pyvqwd1pnQ" },
    evmWallet: { address: "0x12B46Dc61407B4Ff8dCD0523B218C1cffF100c5F" },
    sol: 0.00757248,
    eth: 0,
  });
  assertEquals(text.includes("Solana: 0.007572 SOL"), true);
  assertEquals(text.includes("Robinhood Chain: 0 ETH"), true);
  // The zero-balance chain gets the deposit address, shortened.
  assertEquals(text.includes("Deposit to 0x12...0c5F."), true);
  assertEquals(text.length <= 260, true);
});

Deno.test("a single-chain wallet reports only that chain", () => {
  const text = composeWalletBalanceReply({
    solWallet: { address: "VkeXjqaTWyYs4dV6x9GNz8yzBhKwVvja1Pyvqwd1pnQ" },
    evmWallet: null,
    sol: 2.5,
  });
  assertEquals(text, "Your Linkr wallet — Solana: 2.5 SOL.");
});

Deno.test("shortened addresses stay recognizable", () => {
  assertEquals(
    shortWalletAddress("VkeXjqaTWyYs4dV6x9GNz8yzBhKwVvja1Pyvqwd1pnQ"),
    "VkeX...1pnQ",
  );
  assertEquals(shortWalletAddress("short"), "short");
});

// The bot already knows a signed-in user's wallets, so asking for one is always
// wrong — and it trains users to post wallet details in public.
Deno.test("the reply linter blocks soliciting wallet details", () => {
  const offending = lintPublicReply(
    "Please provide your Solana wallet address (public key) and I’ll show your SOL balance.",
    "conversation",
  );
  assertEquals(offending.ok, false);
  assertEquals(offending.blocked_phrases.includes("wallet-solicitation-language"), true);

  assertEquals(
    lintPublicReply("What's your wallet address?", "conversation").ok,
    false,
  );
});

// Asking for a *token contract* address is legitimate and core to the product.
// Only the user's own wallet is off-limits. An earlier draft of the rule caught
// both and would have broken coin replies.
Deno.test("asking for a contract address is still allowed", () => {
  for (
    const text of [
      "Trending tokens are moving fast. Pick one and send the contract address for a cleaner read. DYOR.",
      "Send the mint or contract address for an exact read. DYOR.",
      "Reply with the token contract address or mint for a cleaner read. DYOR.",
    ]
  ) {
    const result = lintPublicReply(text, "coin_inquiry");
    assertEquals(
      result.blocked_phrases.includes("wallet-solicitation-language"),
      false,
      text,
    );
    assertEquals(result.ok, true, `${text} -> ${result.blocked_phrases.join(",")}`);
  }
});

Deno.test("every wallet reply passes the public reply linter", () => {
  const replies = [
    composeWalletBalanceReply({
      solWallet: { address: "VkeXjqaTWyYs4dV6x9GNz8yzBhKwVvja1Pyvqwd1pnQ" },
      evmWallet: { address: "0x12B46Dc61407B4Ff8dCD0523B218C1cffF100c5F" },
      sol: 0.00757248,
      eth: 0,
    }),
    composeWalletBalanceReply({ evmWallet: null, solWallet: null }),
    WALLET_UNLINKED_REPLY,
    WALLET_UNREADABLE_REPLY,
  ];
  for (const reply of replies) {
    const sanitized = sanitizePublicReply(reply);
    const lint = lintPublicReply(sanitized, "wallet_query");
    assertEquals(lint.ok, true, `${reply} -> ${lint.blocked_phrases.join(",")}`);
    assertEquals(sanitized.length <= 260, true);
  }
});
