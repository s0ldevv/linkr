import {
  isBareConfirmation,
  isExplicitNftConfirmation,
  nftFieldsToCommand,
  parseXNftIntent,
} from "./x_nft_intent.ts";
import { looksLikeNftIntent, parseXNftCommand } from "./x_nft_command.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("NFT how-to questions are guidance, not executable intents", () => {
  const intent = parseXNftIntent("@linkrcash how can I launch an NFT?");
  assert(intent.intent === "nft_guidance", "how-to should be guidance");
  assert(!intent.executionIntent, "guidance must not execute");
  assert(intent.missingFields.length === 0, "guidance should not ask slots");
});

Deno.test("single NFT launch without chain asks for chain", () => {
  const intent = parseXNftIntent("@linkrcash launch this NFT");
  assert(intent.intent === "mint_nft", "should be a single NFT mint intent");
  assert(intent.executionIntent, "launch this NFT is executable intent");
  assert(intent.chain === null, "chain should be ambiguous");
  assert(
    intent.missingFields.includes("chain"),
    "missing chain should be recorded",
  );
});

Deno.test("single NFT launch on Solana without collection asks for collection", () => {
  const intent = parseXNftIntent("@linkrcash launch this NFT on Solana");
  assert(intent.intent === "mint_nft", "should mint a single NFT");
  assert(intent.chain === "solana", "chain should be Solana");
  assert(
    intent.missingFields.includes("collection"),
    "missing collection should be recorded",
  );
});

Deno.test("Robinhood NFT launch is recognized but unsupported by flow", () => {
  const intent = parseXNftIntent("@linkrcash launch this NFT on Robinhood");
  assert(intent.intent === "mint_nft", "should be a single NFT request");
  assert(intent.chain === "robinhood", "chain should be Robinhood");
});

Deno.test("collection launch parses name and Solana chain", () => {
  const intent = parseXNftIntent(
    '@linkrcash launch nft collection called "Neon Keys" on Solana',
  );
  assert(
    intent.intent === "create_collection",
    "should create a collection",
  );
  assert(intent.chain === "solana", "chain should be Solana");
  assert(intent.name === "Neon Keys", "collection name should parse");
  assert(intent.symbol === "NEONKEYS", "symbol should derive from name");
});

Deno.test("legacy NFT parser accepts launch language for compatibility", () => {
  const command = parseXNftCommand(
    '@linkrcash launch this NFT into my collection "Neon Keys"',
  );
  assert(command?.kind === "mint_nft", "launch should parse as mint_nft");
  assert(
    looksLikeNftIntent("launch this nft"),
    "launch should be an NFT signal",
  );
});

Deno.test("pending NFT command preserves exact selected collection id", () => {
  const command = nftFieldsToCommand({
    kind: "mint_nft",
    chain: "solana",
    collection_id: "4c6099df-0880-4e76-a1e2-44d681f118e6",
    collection_name: "Neon Keys",
    nft_name: "Key #1",
  });
  assert(command?.kind === "mint_nft", "should build mint command");
  assert(
    command.collectionQuery === "4c6099df-0880-4e76-a1e2-44d681f118e6",
    "collection id should be the execution query",
  );
  assert(
    command.collectionId === "4c6099df-0880-4e76-a1e2-44d681f118e6",
    "collection id should be preserved explicitly",
  );
});

Deno.test("NFT confirmations are scoped away from generic launch phrases", () => {
  assert(
    isExplicitNftConfirmation("confirm nft"),
    "explicit NFT confirmation should match",
  );
  assert(isBareConfirmation("confirm"), "bare confirm is detectable");
  assert(
    !isExplicitNftConfirmation("confirm launch"),
    "launch confirmation must not match NFT confirmation",
  );
});
