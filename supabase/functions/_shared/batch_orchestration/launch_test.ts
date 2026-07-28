import {
  childExtractionForLaunchTarget,
  inferLaunchTargets,
} from "./launch.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("inferLaunchTargets rejects ambiguous both-chain launch wording", () => {
  const chains = inferLaunchTargets({
    text: "launch Moon on both Solana and Robinhood",
  });
  assert(chains.length === 0, "ambiguous chain selection must pause");
});

Deno.test("inferLaunchTargets has no platform chain default", () => {
  const chains = inferLaunchTargets({ text: "launch Moon" });
  assert(chains.length === 0, "missing chain must pause");
});

Deno.test("childExtractionForLaunchTarget maps native dev buys per chain", () => {
  const solana = childExtractionForLaunchTarget(
    { dev_buy_original: 0.1, dev_buy_original_unit: "sol" },
    "solana",
  );
  const robinhood = childExtractionForLaunchTarget(
    { dev_buy_original: 0.1, dev_buy_original_unit: "sol" },
    "robinhood",
  );
  assert(solana.dev_buy_original === 0.1, "solana should keep sol dev buy");
  assert(solana.dev_buy_original_unit === "sol", "solana unit should be sol");
  assert(robinhood.dev_buy_original === 0, "robinhood should default to zero");
  assert(
    robinhood.dev_buy_original_unit === "eth",
    "robinhood unit should be eth",
  );
});
