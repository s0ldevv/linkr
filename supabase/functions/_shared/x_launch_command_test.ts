import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clarificationReply,
  extractLaunchFields,
  isLaunchCancellation,
  isLaunchCommand,
  isLaunchConfirmation,
  isLaunchRetry,
  mergeLaunchFields,
  missingLaunchFields,
} from "./x_launch_command.ts";

Deno.test("funding retry syntax is narrow and explicit", () => {
  assert(isLaunchRetry("retry launch"));
  assert(isLaunchRetry("@linkrbot resume the launch"));
  assertEquals(isLaunchRetry("try launching another token"), false);
});

Deno.test("name-only request asks only for explicit chain", () => {
  const fields = extractLaunchFields("@linkrbot launch a coin called test");
  assertEquals(fields, { name: "test" });
  assertEquals(missingLaunchFields(fields), ["chain"]);
  const reply = clarificationReply(missingLaunchFields(fields));
  assert(reply.includes("Solana or Robinhood"));
  assertEquals(reply.includes("ticker"), false);
  assertEquals(reply.includes("image"), false);
});

Deno.test("incident Solana request does not ask for chain again", () => {
  const fields = extractLaunchFields(
    "@linkrbot launch a coin called test on Solana",
  );
  assertEquals(fields, { name: "test", chain: "solana" });
  assertEquals(missingLaunchFields(fields), []);
});

Deno.test("follow-up fields merge without discarding prior values", () => {
  const existing = extractLaunchFields("launch a coin called Test on Solana");
  const followup = extractLaunchFields(
    "ticker TEST, description is a careful queue test",
    "https://pbs.twimg.com/media/example.jpg",
  );
  const merged = mergeLaunchFields(existing, followup);
  assertEquals(missingLaunchFields(merged), []);
  assertEquals(merged.symbol, "TEST");
  assertEquals(merged.chain, "solana");
});

Deno.test("semantic AI ticker override wins over deterministic filler words", () => {
  const deterministic = extractLaunchFields(
    "@linkrbot launch a coin called testing ticker also test on Solana",
  );
  assertEquals(deterministic.symbol, "ALSO");

  const ai = { name: "testing", symbol: "TEST" };
  const merged = mergeLaunchFields(deterministic, ai);
  assertEquals(merged.name, "testing");
  assertEquals(merged.symbol, "TEST");
  assertEquals(merged.chain, "solana");
});

Deno.test("description extraction removes conversational separators", () => {
  const fields = extractLaunchFields(
    "description is: this is a test token. Go ahead and launch.",
  );
  assertEquals(
    fields.description,
    "this is a test token. Go ahead and launch.",
  );
});

Deno.test("chain is explicit, deterministic, and never guessed when ambiguous", () => {
  assertEquals(
    extractLaunchFields("launch Test on Solana"),
    { name: "Test", chain: "solana" },
  );
  const ambiguous = extractLaunchFields(
    "launch a coin called Test on Solana or Robinhood Chain",
  );
  assertEquals(ambiguous.chain, undefined);
  assertEquals(ambiguous.chain_ambiguous, true);
  assertEquals(missingLaunchFields(ambiguous), ["chain"]);
});

Deno.test("confirmation and cancellation require explicit phrases", () => {
  assert(isLaunchCommand("please create a token called Test"));
  assert(isLaunchConfirmation("@linkrbot confirm launch"));
  assert(isLaunchCancellation("cancel the launch"));
  assertEquals(isLaunchConfirmation("is the launch confirmed?"), false);
});
