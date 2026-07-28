import { collectMarketTargets } from "./targets.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const evm = "0x020bfC650A365f8BB26819deAAbF3E21291018b4";
const evm2 = "0x1111111111111111111111111111111111111111";
const evm3 = "0x2222222222222222222222222222222222222222";
const evm4 = "0x3333333333333333333333333333333333333333";
const evm5 = "0x4444444444444444444444444444444444444444";
const evm6 = "0x5555555555555555555555555555555555555555";
const sol = "So11111111111111111111111111111111111111112";

Deno.test("collectMarketTargets returns mixed Robinhood and Solana addresses", () => {
  const result = collectMarketTargets({ text: `check ${evm} and ${sol}` });
  assert(result.targets.length === 2, "expected two targets");
  assert(result.targets[0].chain === "robinhood", "evm should be robinhood");
  assert(result.targets[1].chain === "solana", "sol mint should be solana");
});

Deno.test("collectMarketTargets dedupes tweet and extraction addresses", () => {
  const result = collectMarketTargets({
    text: `check ${evm}`,
    extraction: { token_candidates: [evm], token_address: evm },
  });
  assert(result.targets.length === 1, "expected one deduped target");
  assert(result.targets[0].source === "tweet", "tweet source should win");
});

Deno.test("collectMarketTargets caps at max targets and returns overflow count", () => {
  const result = collectMarketTargets({
    text: [evm, evm2, evm3, evm4, evm5, evm6].join(" "),
    maxTargets: 5,
  });
  assert(result.targets.length === 5, "expected five targets");
  assert(result.overflow_count === 1, "expected one overflow");
});
