import { resolveMarketToken } from "./resolve.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("resolveMarketToken accepts exact extraction token address", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  const result = await resolveMarketToken(null, {
    text: "what is this?",
    thread: {},
    extraction: { token_address: address },
  });

  assert(result.ok, "exact token address should resolve");
  assert(result.mint === address, "token address mismatch");
  assert(result.chain === "robinhood", "EVM address should resolve as Robinhood Chain");
});

Deno.test("resolveMarketToken accepts exact Solana mint", async () => {
  const mint = "So11111111111111111111111111111111111111112";
  const result = await resolveMarketToken(null, {
    text: `analytics for ${mint}`,
    thread: {},
    extraction: { token_mint: mint, token_chain: "solana" },
  });

  assert(result.ok, "exact Solana mint should resolve");
  assert(result.mint === mint, "Solana mint mismatch");
  assert(result.chain === "solana", "Solana mint should resolve as Solana");
});

Deno.test("resolveMarketToken prefers raw tweet CA over truncated model extraction", async () => {
  const fullMint = "0x2222222222222222222222222222222222222222";
  const truncatedMint = "0x222222222222222222222222222222222222";
  const result = await resolveMarketToken(null, {
    text: `how's this coin looking ${fullMint}`,
    thread: {},
    extraction: {
      token_mint: truncatedMint,
      token_candidates: [truncatedMint],
    },
  });

  assert(result.ok, "raw tweet contract should resolve");
  assert(result.mint === fullMint, "raw tweet contract should beat truncated extraction");
  assert(result.chain === "robinhood", "raw EVM contract should resolve as Robinhood Chain");
});

Deno.test("resolveMarketToken returns ambiguity for multiple detected mints", async () => {
  const result = await resolveMarketToken(null, {
    text: "compare these",
    thread: {
      detected_mints: [
        "0x3333333333333333333333333333333333333333",
        "0x4444444444444444444444444444444444444444",
      ],
    },
    extraction: {},
  });

  assert(!result.ok, "multiple token addresses should not auto-resolve");
  assert(result.reason === "ambiguous", "ambiguity reason mismatch");
  assert(result.candidates.length === 2, "candidate count mismatch");
});

Deno.test("resolveMarketToken prioritizes current reply mint over older thread mints", async () => {
  const currentMint = "0x5555555555555555555555555555555555555555";
  const result = await resolveMarketToken(null, {
    text: currentMint,
    thread: {
      detected_mints: [
        "0x6666666666666666666666666666666666666666",
        currentMint,
        "0x7777777777777777777777777777777777777777",
      ],
    },
    extraction: {},
  });

  assert(result.ok, "current reply token address should resolve");
  assert(result.mint === currentMint, "current reply token address should win");
});

Deno.test("resolveMarketToken uses unique token_registry symbol match", async () => {
  const registryAddress = "0x8888888888888888888888888888888888888888";
  const eqCalls: Array<[string, unknown]> = [];
  const fakeAdmin = {
    from(table: string) {
      assert(table === "token_registry", "should query token_registry first");
      return {
        select(_columns: string) {
          return this;
        },
        eq(column: string, value: unknown) {
          eqCalls.push([column, value]);
          return this;
        },
        or(_filter: string) {
          return this;
        },
        in(column: string, value: unknown) {
          eqCalls.push([column, value]);
          return this;
        },
        limit(_count: number) {
          return Promise.resolve({
            data: [
              {
                mint: registryAddress,
                token_address: registryAddress,
                symbol: "REG",
                name: "Registry Token",
              },
            ],
          });
        },
      };
    },
  };

  const result = await resolveMarketToken(fakeAdmin, {
    text: "$REG",
    thread: {},
    extraction: { token_symbol: "REG" },
  });

  assert(result.ok, "registry symbol should resolve");
  assert(result.mint === registryAddress, "registry token address mismatch");
  assert(
    eqCalls.some(
      ([column, value]) =>
        column === "chain" && Array.isArray(value) && value.includes("robinhood"),
    ),
    "registry lookup should filter chain",
  );
});

Deno.test("resolveMarketToken ignores base58-looking token strings", async () => {
  const result = await resolveMarketToken(null, {
    text: "Mint111111111111111111111111111111111111111",
    thread: {},
    extraction: {},
  });

  assert(!result.ok, "base58-looking string should not resolve");
  assert(result.reason === "not_found", "base58-looking string should not become ambiguous");
});
