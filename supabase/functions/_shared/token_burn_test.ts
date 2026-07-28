import {
  encodeBurnCheckedInstructionData,
  formatTokenAmount,
  normalizeTokenBurnChain,
  parseTokenAmountToRaw,
  parseTokenBurnCommand,
  tokenBurnConfirmationText,
  tokenBurnXConfirmationText,
} from "./token_burn.ts";

Deno.test("Solana BurnChecked data uses opcode 15 and u64 little endian", () => {
  const data = encodeBurnCheckedInstructionData(0x0102030405060708n, 9);
  const expected = [15, 8, 7, 6, 5, 4, 3, 2, 1, 9];
  if (
    data.length !== expected.length ||
    data.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`invalid BurnChecked data: ${[...data]}`);
  }
});

Deno.test("token burn chain must be explicit and supported", () => {
  if (normalizeTokenBurnChain("EVM") !== "robinhood") {
    throw new Error("evm chain");
  }
  if (normalizeTokenBurnChain("Solana") !== "solana") {
    throw new Error("solana chain");
  }
  let rejected = false;
  try {
    normalizeTokenBurnChain("");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("missing chain accepted");
});

Deno.test("X burn confirmation preserves full identity within one post", () => {
  const token = "So11111111111111111111111111111111111111112";
  const text = tokenBurnXConfirmationText({
    chain: "solana",
    wallet_id: "wallet",
    wallet_address: token,
    token,
    symbol: "TWENTYCHARACTERSYMB",
    decimals: 0,
    amount:
      "123456789012345678901234567890123456789012345678901234567890123456789012345678",
    amount_raw:
      "123456789012345678901234567890123456789012345678901234567890123456789012345678",
    balance:
      "123456789012345678901234567890123456789012345678901234567890123456789012345678",
    balance_raw:
      "123456789012345678901234567890123456789012345678901234567890123456789012345678",
    burn_all_requested: false,
    token_program: "11111111111111111111111111111111",
    token_accounts: [],
    gas_estimate: null,
  });
  if (text.length > 280) {
    throw new Error(`confirmation is ${text.length} chars`);
  }
  if (!text.includes(token)) throw new Error("full mint omitted");
});

Deno.test("burn command parser requires current explicit chain CA and amount", () => {
  const evm = parseTokenBurnCommand(
    "burn 25.5 tokens on Robinhood Chain CA 0x1111111111111111111111111111111111111111",
  );
  if (evm.chain !== "robinhood" || evm.amount !== "25.5" || evm.errors.length) {
    throw new Error(JSON.stringify(evm));
  }
  const sol = parseTokenBurnCommand(
    "burn all tokens on Solana mint So11111111111111111111111111111111111111112",
  );
  if (sol.chain !== "solana" || sol.amount !== "all" || sol.errors.length) {
    throw new Error(JSON.stringify(sol));
  }
  for (
    const unsafe of [
      "burn 10 $TEST on Solana",
      "burn 10 tokens 0x1111111111111111111111111111111111111111",
      "burn 10 ETH on Robinhood Chain 0x1111111111111111111111111111111111111111",
      "burn 10 tokens on Solana 0x1111111111111111111111111111111111111111",
      "burn 10 tokens on Solana So11111111111111111111111111111111111111112 11111111111111111111111111111111",
    ]
  ) {
    const parsed = parseTokenBurnCommand(unsafe);
    if (parsed.errors.length === 0) {
      throw new Error(`unsafe burn accepted: ${unsafe}`);
    }
  }
});

Deno.test("token amount parsing is exact and rejects excess precision", () => {
  if (parseTokenAmountToRaw("12.3400", 6) !== 12_340_000n) {
    throw new Error("wrong raw");
  }
  if (formatTokenAmount(12_340_000n, 6) !== "12.34") {
    throw new Error("wrong format");
  }
  for (const value of ["0", "-1", "1e3", "1.0000001", "NaN", ""]) {
    let rejected = false;
    try {
      parseTokenAmountToRaw(value, 6);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`unsafe amount accepted: ${value}`);
  }
});

Deno.test("burn confirmation includes exact irreversible details", () => {
  const text = tokenBurnConfirmationText({
    chain: "robinhood",
    wallet_id: "wallet",
    wallet_address: "0x0000000000000000000000000000000000000001",
    token: "0x0000000000000000000000000000000000000002",
    symbol: "TEST",
    decimals: 18,
    amount: "42",
    amount_raw: "42000000000000000000",
    balance: "100",
    balance_raw: "100000000000000000000",
    burn_all_requested: false,
    token_program: null,
    token_accounts: [],
    gas_estimate: "50000",
  });
  for (
    const required of [
      "42 TEST",
      "0x0000000000000000000000000000000000000002",
      "irreversible",
      "cannot be recovered",
      "CONFIRM",
      "CANCEL",
    ]
  ) {
    if (!text.includes(required)) {
      throw new Error(`missing confirmation detail: ${required}`);
    }
  }
});
