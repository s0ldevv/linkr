import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseAirdropAmountToRaw,
  parseTokenAmountToRaw,
  parseXAirdropIntent,
  planProRataAirdrop,
} from "./x_airdrop.ts";

Deno.test("airdrop intent preserves ambiguity as a follow-up", () => {
  assertEquals(
    parseXAirdropIntent({ kind: "airdrop", token: "$LINKR", amount: null }),
    {
      kind: "airdrop",
      token: "$LINKR",
      amount: null,
      clarification:
        "What exact amount or percentage of your current token balance should I distribute to holders?",
    },
  );
});

Deno.test("pro-rata plan excludes largest holder and developer and preserves total", () => {
  const plan = planProRataAirdrop({
    total: 10n,
    developerWallet: "dev",
    holders: [
      { owner: "pool", amount: 1000n },
      { owner: "dev", amount: 100n },
      { owner: "alice", amount: 60n },
      { owner: "bob", amount: 40n },
    ],
  });
  assertEquals(plan.excludedTopHolder, "pool");
  assertEquals(plan.allocations, [
    { owner: "alice", amount: 60n, allocation: 6n },
    { owner: "bob", amount: 40n, allocation: 4n },
  ]);
});

Deno.test("holder token accounts aggregate before ranking", () => {
  const plan = planProRataAirdrop({
    total: 3n,
    developerWallet: "dev",
    holders: [
      { owner: "pool", amount: 5n },
      { owner: "pool", amount: 6n },
      { owner: "alice", amount: 10n },
      { owner: "bob", amount: 5n },
    ],
  });
  assertEquals(plan.excludedTopHolder, "pool");
  assertEquals(plan.allocations, [
    { owner: "alice", amount: 10n, allocation: 2n },
    { owner: "bob", amount: 5n, allocation: 1n },
  ]);
});

Deno.test("developer is excluded before selecting largest remaining owner", () => {
  const plan = planProRataAirdrop({
    total: 10n,
    developerWallet: "dev",
    holders: [
      { owner: "dev", amount: 10_000n },
      { owner: "pool", amount: 1_000n },
      { owner: "alice", amount: 6n },
      { owner: "bob", amount: 4n },
    ],
  });
  assertEquals(plan.excludedTopHolder, "pool");
  assertEquals(plan.allocations.map((row) => row.owner), ["alice", "bob"]);
});

Deno.test("pro-rata allocation retains integer dust", () => {
  const plan = planProRataAirdrop({
    total: 10n,
    developerWallet: "dev",
    holders: [
      { owner: "pool", amount: 100n },
      { owner: "alice", amount: 1n },
      { owner: "bob", amount: 1n },
      { owner: "carol", amount: 1n },
    ],
  });
  assertEquals(
    plan.allocations.reduce((sum, row) => sum + row.allocation, 0n),
    9n,
  );
});

Deno.test("token amount parsing is exact", () => {
  assertEquals(parseTokenAmountToRaw("12.345 TOKEN", 6), 12_345_000n);
  assertThrows(() => parseTokenAmountToRaw("0.0000001", 6));
});

Deno.test("airdrop amount parsing supports wallet-balance percentages", () => {
  assertEquals(parseAirdropAmountToRaw("25%", 6, 1_000n), {
    raw: 250n,
    mode: "balance_fraction",
  });
  assertEquals(parseAirdropAmountToRaw("25% of my token supply", 6, 1_000n), {
    raw: 250n,
    mode: "balance_fraction",
  });
  assertEquals(parseAirdropAmountToRaw("100% of my supply", 6, 1_000n), {
    raw: 1_000n,
    mode: "balance_fraction",
  });
  assertEquals(parseAirdropAmountToRaw("all of my wallet balance", 6, 1_000n), {
    raw: 1_000n,
    mode: "balance_fraction",
  });
  assertEquals(parseAirdropAmountToRaw("dev supply", 6, 1_000n), {
    raw: 1_000n,
    mode: "balance_fraction",
  });
  assertThrows(() => parseAirdropAmountToRaw("101%", 6, 1_000n));
});

Deno.test("zero raw allocations are dropped and retained as dust", () => {
  const plan = planProRataAirdrop({
    total: 1n,
    developerWallet: "dev",
    holders: [
      { owner: "pool", amount: 100n },
      { owner: "alice", amount: 2n },
      { owner: "bob", amount: 1n },
    ],
  });
  assertEquals(plan.allocations, []);
});
