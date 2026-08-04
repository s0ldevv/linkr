import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aggregateHolderBalances,
  fetchHeliusHolderSnapshot,
  requestedAirdropRawFromWalletBalance,
  selectAirdropSourceAccount,
} from "./holder_airdrop_snapshot.ts";
import {
  buildHolderAirdropBatchTransaction,
  dryRunHolderAirdropBatch,
  HOLDER_AIRDROP_MAX_RECIPIENTS_PER_BATCH,
  signHolderAirdropBatchTransaction,
  validateStoredHolderAirdropBatchTransaction,
} from "./holder_airdrop_executor.ts";
import {
  Keypair,
  Transaction,
} from "https://esm.sh/@solana/web3.js@1.98.4?target=deno";
import { linkrQueueForRoute } from "./queue_contracts.ts";
import {
  persistedBatchAction,
  shouldProcessPersistedBatchBeforeRevalidation,
} from "./holder_airdrop_worker_state.ts";
import {
  isHolderAirdropStageAdmitted,
  prepareXAirdropXFlow,
  resolveOwnedCompletedSolanaLaunch,
} from "./x_airdrop_prepare.ts";
import { planProRataAirdrop } from "./x_airdrop.ts";

Deno.test("Helius snapshot paginates and records slot provenance", async () => {
  const calls: string[] = [];
  const fakeFetch =
    (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as any;
      calls.push(`${body.method}:${body.params?.cursor ?? "first"}`);
      const result: any = body.params.cursor
        ? { token_accounts: [{ owner: "alice", amount: "3" }] }
        : {
          token_accounts: [
            { owner: "alice", amount: "2" },
            { owner: "zero", amount: "0" },
          ],
          cursor: "page-2",
          last_indexed_slot: 123456,
        };
      if (body.params.cursor) result.last_indexed_slot = 123450;
      return new Response(JSON.stringify({ jsonrpc: "2.0", result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  const snapshot = await fetchHeliusHolderSnapshot({
    mint: "mint",
    rpcUrl: "https://helius.invalid",
    fetchImpl: fakeFetch,
  });
  assertEquals(calls, [
    "getTokenAccounts:first",
    "getTokenAccounts:page-2",
  ]);
  assertEquals(snapshot.slot, 123450);
  assertEquals(snapshot.pageCount, 2);
  assertEquals(snapshot.pageCursors, ["first", "page-2"]);
  assertEquals(snapshot.checksum.length, 64);
  assertEquals(aggregateHolderBalances(snapshot.accounts), [{
    owner: "alice",
    amount: 5n,
  }]);
});

Deno.test("no eligible holders fails closed", () => {
  assertThrows(
    () =>
      planProRataAirdrop({
        total: 10n,
        developerWallet: "dev",
        holders: [
          { owner: "dev", amount: 10n },
          { owner: "pool", amount: 100n },
        ],
      }),
    Error,
    "airdrop_eligible_holders_not_found",
  );
});

Deno.test("dry-run refuses insufficient source tokens before fee work", async () => {
  await assertRejects(
    () =>
      dryRunHolderAirdropBatch({
        connection: {},
        transaction: new Transaction(),
        authority: "11111111111111111111111111111111",
        destinationAccounts: [],
        requiredTokenRaw: 2n,
        currentSourceTokenRaw: 1n,
      }),
    Error,
    "holder_airdrop_insufficient_token_balance",
  );
});

Deno.test("percentage requests use aggregate wallet token balance", () => {
  const sources = [
    { address: "source-a", amount: 60n },
    { address: "source-b", amount: 40n },
  ];
  const requestedRaw = requestedAirdropRawFromWalletBalance({
    requestedAmount: "50%",
    decimals: 0,
    sources,
  });
  assertEquals(requestedRaw, 50n);
  assertEquals(selectAirdropSourceAccount({ requestedRaw, sources }), {
    address: "source-a",
    amount: 60n,
  });
  assertThrows(
    () =>
      selectAirdropSourceAccount({
        requestedRaw: 100n,
        sources,
      }),
    Error,
    "holder_airdrop_source_account_consolidation_required",
  );
});

Deno.test("owned launch resolution rejects ambiguity and noncanonical records", async () => {
  const admin = fakeLaunchAdmin([
    canonicalLaunch("one", "Token"),
    canonicalLaunch("two", "Token"),
    { ...canonicalLaunch("bad", "Bad"), token_address: "different" },
  ]);
  assertEquals(
    (await resolveOwnedCompletedSolanaLaunch(admin, "user", "Token")).kind,
    "ambiguous",
  );
  assertEquals(
    (await resolveOwnedCompletedSolanaLaunch(admin, "user", "Bad")).kind,
    "not_found",
  );
});

Deno.test("owned launch resolution checks exact mint outside latest launch window", async () => {
  const mint = "11111111111111111111111111111111";
  const exact = { ...canonicalLaunch("old", "OLD"), mint, token_address: mint };
  const admin = fakeLaunchAdmin(
    Array.from(
      { length: 100 },
      (_, index) => canonicalLaunch(`new-${index}`, `NEW${index}`),
    ),
    exact,
  );
  assertEquals(
    await resolveOwnedCompletedSolanaLaunch(admin, "user", mint),
    { kind: "resolved", value: exact },
  );
});

Deno.test("holder-airdrop route maps to dedicated stage", () => {
  assertEquals(
    linkrQueueForRoute("holder_airdrop.solana", 50),
    "holder_airdrop_solana",
  );
});

Deno.test("AI action preparation persists one immutable pending snapshot", async () => {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const launch = canonicalLaunch("one", "ONE");
  const admin = {
    from(table: string) {
      if (table === "linkr_holder_airdrops") {
        return fakeBuilder({ data: null, error: null }, "maybeSingle");
      }
      if (table === "coin_launches") {
        return fakeBuilder({ data: [launch], error: null }, "limit");
      }
      if (table === "wallets") {
        return fakeBuilder({
          data: {
            id: "wallet",
            user_id: "user",
            wallet_type: "solana",
            address: "11111111111111111111111111111111",
          },
          error: null,
        }, "maybeSingle");
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name: string, args: any) {
      rpcCalls.push({ name, args });
      return {
        data: { airdrop_id: "airdrop", pending_action_id: "pending" },
        error: null,
      };
    },
  };
  const outcome = await prepareXAirdropXFlow({
    admin,
    userId: "user",
    workItem: { id: "work" },
    tweet: {
      tweet_id: "tweet",
      conversation_id: "thread",
      text: "natural request",
    },
    pendingActions: [],
    classifyIntent: async () => ({
      kind: "airdrop",
      token: "one-mint",
      amount: "10",
      clarification: null,
    }),
    prepareSnapshot: async () => ({
      mint: "one-mint",
      decimals: 6,
      sourceTokenAccount: "source",
      sourceBalanceRaw: 20n,
      requestedRaw: 10n,
      allocatedRaw: 9n,
      dustRaw: 1n,
      excludedLargestOwner: "pool",
      aggregatedHolderCount: 4,
      snapshot: {
        slot: 123,
        provider: "helius_getTokenAccounts",
        fetchedAt: "2026-08-04T00:00:00.000Z",
        pageCount: 1,
        pageCursors: ["first"],
        checksum: "a".repeat(64),
        accounts: [],
      },
      allocations: [{ owner: "holder", amount: 5n, allocation: 9n }],
    }),
    checkAdmission: async () => true,
  });
  assertEquals(outcome?.state, "waiting_user_confirmation");
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].name, "prepare_linkr_holder_airdrop_v1");
  assertEquals(rpcCalls[0].args.p_recipients, [{
    ordinal: 1,
    owner: "holder",
    holder_balance_raw: "5",
    allocation_raw: "9",
  }]);
  assertEquals(rpcCalls[0].args.p_snapshot_provenance.checksum, "a".repeat(64));
});

Deno.test("duplicate preparation reply uses persisted snapshot totals", async () => {
  let snapshotCalled = false;
  const admin = {
    from(table: string) {
      if (table === "linkr_holder_airdrops") {
        return fakeBuilder({
          data: {
            id: "persisted",
            pending_action_id: "pending",
            recipient_count: 9,
            allocated_raw: "777",
            dust_raw: "3",
            requested_raw: "780",
            snapshot_slot: 123,
            snapshot_provider: "helius_getTokenAccounts",
            snapshot_fetched_at: "2026-08-04T00:00:00.000Z",
            snapshot_checksum: "b".repeat(64),
            excluded_largest_owner: "pool",
          },
          error: null,
        }, "maybeSingle");
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc() {
      throw new Error("duplicate prepare should not call RPC");
    },
  };
  const outcome = await prepareXAirdropXFlow({
    admin,
    userId: "user",
    workItem: { id: "work" },
    tweet: { tweet_id: "tweet", conversation_id: "thread", text: "request" },
    pendingActions: [],
    classifyIntent: async () => ({
      kind: "airdrop",
      token: "one-mint",
      amount: "10",
      clarification: null,
    }),
    prepareSnapshot: async () => {
      snapshotCalled = true;
      throw new Error("duplicate prepare should not recompute snapshot");
    },
    checkAdmission: async () => true,
  });
  assertEquals(snapshotCalled, false);
  assertStringIncludes(outcome?.replyText ?? "", "9 eligible holders");
  assertStringIncludes(outcome?.replyText ?? "", "777 raw units");
  assertStringIncludes(outcome?.replyText ?? "", "retained dust: 3");
});

Deno.test("disabled holder-airdrop rollout does not prepare or confirm", async () => {
  const admin = {
    from(table: string) {
      if (table === "linkr_holder_airdrops") {
        return fakeBuilder({ data: null, error: null }, "maybeSingle");
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc() {
      throw new Error("rpc_should_not_be_called");
    },
  };
  const prepare = await prepareXAirdropXFlow({
    admin,
    userId: "user",
    workItem: { id: "work" },
    tweet: { tweet_id: "tweet", conversation_id: "thread", text: "request" },
    pendingActions: [],
    classifyIntent: async () => ({
      kind: "airdrop",
      token: "one-mint",
      amount: "10",
      clarification: null,
    }),
    prepareSnapshot: () => {
      throw new Error("snapshot_should_not_be_called");
    },
    checkAdmission: async () => false,
  });
  assertEquals(prepare?.replyKind, "airdrop_not_enabled");

  const confirm = await prepareXAirdropXFlow({
    admin,
    userId: "user",
    workItem: { id: "work" },
    tweet: { tweet_id: "tweet-2", conversation_id: "thread", text: "confirm" },
    pendingActions: [{ id: "pending", action_type: "holder_airdrop" }],
    classifyIntent: async () => ({
      kind: "confirm",
      token: null,
      amount: null,
      clarification: null,
    }),
    checkAdmission: async () => false,
  });
  assertEquals(confirm?.replyKind, "airdrop_not_enabled");
});

Deno.test("too-small holder-airdrop allocation asks for larger amount", async () => {
  const admin = {
    from(table: string) {
      if (table === "linkr_holder_airdrops") {
        return fakeBuilder({ data: null, error: null }, "maybeSingle");
      }
      if (table === "coin_launches") {
        return fakeBuilder({
          data: [canonicalLaunch("one", "ONE")],
          error: null,
        }, "limit");
      }
      if (table === "wallets") {
        return fakeBuilder({
          data: {
            id: "wallet",
            user_id: "user",
            wallet_type: "solana",
            address: "11111111111111111111111111111111",
          },
          error: null,
        }, "maybeSingle");
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc() {
      throw new Error("too-small prepare should not persist");
    },
  };
  const outcome = await prepareXAirdropXFlow({
    admin,
    userId: "user",
    workItem: { id: "work" },
    tweet: { tweet_id: "tweet", conversation_id: "thread", text: "request" },
    pendingActions: [],
    classifyIntent: async () => ({
      kind: "airdrop",
      token: "one-mint",
      amount: "1",
      clarification: null,
    }),
    prepareSnapshot: async () => {
      throw new Error("airdrop_amount_too_small_for_all_holders");
    },
    checkAdmission: async () => true,
  });
  assertEquals(outcome?.replyKind, "airdrop_amount_too_small");
});

Deno.test("holder-airdrop admission allows explicit canary without public rollout", async () => {
  const canaryUserId = "11111111-1111-4111-8111-111111111111";
  const admin = {
    from(table: string) {
      if (table !== "linkr_queue_runtime_config") {
        throw new Error(`unexpected table ${table}`);
      }
      return fakeBuilder({
        data: {
          enabled: true,
          rollout_percent: 0,
          canary_user_ids: [canaryUserId],
        },
        error: null,
      }, "maybeSingle");
    },
  };
  assertEquals(
    await isHolderAirdropStageAdmitted(admin, canaryUserId, "work"),
    true,
  );
  assertEquals(
    await isHolderAirdropStageAdmitted(
      admin,
      "22222222-2222-4222-8222-222222222222",
      "work",
    ),
    false,
  );
});

Deno.test("stored holder-airdrop transaction proves exact persisted batch", async () => {
  const authority = Keypair.generate();
  const mint = Keypair.generate().publicKey.toBase58();
  const sourceTokenAccount = Keypair.generate().publicKey.toBase58();
  const owner = Keypair.generate().publicKey.toBase58();
  const recipients = [{
    ordinal: 1,
    owner_address: owner,
    allocation_raw: "42",
  }];
  const built = buildHolderAirdropBatchTransaction({
    mint,
    sourceTokenAccount,
    authority: authority.publicKey.toBase58(),
    decimals: 6,
    recipients,
  });
  const signed = await signHolderAirdropBatchTransaction({
    transaction: built.transaction,
    authority,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 123,
  });
  const verified = await validateStoredHolderAirdropBatchTransaction({
    signedTransaction: toPostgresBytea(signed.signedBytes),
    signedTransactionHash: signed.signedTransactionHash,
    signature: signed.signature,
    blockhash: signed.blockhash,
    mint,
    sourceTokenAccount,
    authority: authority.publicKey.toBase58(),
    decimals: 6,
    recipients,
  });
  assertEquals(verified.byteLength, signed.signedBytes.byteLength);
  verified.fill(0);
  signed.signedBytes.fill(0);
  authority.secretKey.fill(0);

  await assertRejects(
    () =>
      validateStoredHolderAirdropBatchTransaction({
        signedTransaction: toPostgresBytea(new Uint8Array([1, 2, 3])),
        signedTransactionHash: signed.signedTransactionHash,
        signature: signed.signature,
        blockhash: signed.blockhash,
        mint,
        sourceTokenAccount,
        authority: authority.publicKey.toBase58(),
        decimals: 6,
        recipients,
      }),
    Error,
    "holder_airdrop_signed_transaction_hash_mismatch",
  );
});

Deno.test("holder-airdrop batch builder accepts the configured efficient cap", () => {
  const authority = Keypair.generate();
  const mint = Keypair.generate().publicKey.toBase58();
  const sourceTokenAccount = Keypair.generate().publicKey.toBase58();
  const recipients = Array.from(
    { length: HOLDER_AIRDROP_MAX_RECIPIENTS_PER_BATCH },
    (_, index) => ({
      ordinal: index + 1,
      owner_address: Keypair.generate().publicKey.toBase58(),
      allocation_raw: "1",
    }),
  );
  const built = buildHolderAirdropBatchTransaction({
    mint,
    sourceTokenAccount,
    authority: authority.publicKey.toBase58(),
    decimals: 6,
    recipients,
  });
  assertEquals(
    built.destinationAccounts.length,
    HOLDER_AIRDROP_MAX_RECIPIENTS_PER_BATCH,
  );
  assertThrows(
    () =>
      buildHolderAirdropBatchTransaction({
        mint,
        sourceTokenAccount,
        authority: authority.publicKey.toBase58(),
        decimals: 6,
        recipients: [
          ...recipients,
          {
            ordinal: HOLDER_AIRDROP_MAX_RECIPIENTS_PER_BATCH + 1,
            owner_address: Keypair.generate().publicKey.toBase58(),
            allocation_raw: "1",
          },
        ],
      }),
    Error,
    "holder_airdrop_batch_size_invalid",
  );
});

Deno.test("holder-airdrop batch cap fits conservative Solana transactions", async () => {
  const authority = Keypair.generate();
  const mint = Keypair.generate().publicKey.toBase58();
  const sourceTokenAccount = Keypair.generate().publicKey.toBase58();
  const recipients = Array.from({ length: 6 }, (_, index) => ({
    ordinal: index + 1,
    owner_address: Keypair.generate().publicKey.toBase58(),
    allocation_raw: "1",
  }));
  const built = buildHolderAirdropBatchTransaction({
    mint,
    sourceTokenAccount,
    authority: authority.publicKey.toBase58(),
    decimals: 6,
    recipients,
  });
  const signed = await signHolderAirdropBatchTransaction({
    transaction: built.transaction,
    authority,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 123,
  });
  assertEquals(built.transaction.instructions.length, 12);
  assertEquals(signed.signedBytes.byteLength < 1232, true);
  signed.signedBytes.fill(0);
  authority.secretKey.fill(0);
  assertThrows(() =>
    buildHolderAirdropBatchTransaction({
      mint,
      sourceTokenAccount,
      authority: Keypair.generate().publicKey.toBase58(),
      decimals: 6,
      recipients: [
        ...recipients,
        {
          ordinal: 7,
          owner_address: Keypair.generate().publicKey.toBase58(),
          allocation_raw: "1",
        },
      ],
    })
  );
});

Deno.test("worker persists signed bytes before the only broadcast path", async () => {
  const source = await Deno.readTextFile(
    new URL("../worker-holder-airdrop-solana/index.ts", import.meta.url),
  );
  assertEquals(source.includes("LIVE_BROADCAST_ENABLED = false"), false);
  assertEquals(source.includes("LIVE_BROADCAST_ENABLED=false"), false);
  assertEquals(source.includes("dry-run-only"), false);
  assertEquals(source.includes("broadcast disabled"), false);
  assertStringIncludes(source, "record_linkr_holder_airdrop_batch_signed_v1");
  assertStringIncludes(
    source,
    "mark_linkr_holder_airdrop_batch_broadcasting_v1",
  );
  assertStringIncludes(
    source,
    "record_linkr_holder_airdrop_batch_broadcast_v1",
  );
  assertStringIncludes(source, "settle_linkr_holder_airdrop_batch_v1");
  assertStringIncludes(source, "notify_linkr_holder_airdrop_terminal_v1");
  assertEquals((source.match(/sendRawTransaction/g) ?? []).length, 1);
  const signed = source.indexOf("record_linkr_holder_airdrop_batch_signed_v1");
  const broadcasting = source.indexOf(
    "mark_linkr_holder_airdrop_batch_broadcasting_v1",
  );
  const send = source.indexOf("sendRawTransaction");
  assertEquals(signed >= 0 && signed < send, true);
  assertEquals(broadcasting >= 0 && broadcasting < send, true);
  assertStringIncludes(source, 'if (action === "broadcast_once")');
  assertStringIncludes(source, "holder_airdrop_broadcast_outcome_ambiguous");
});

Deno.test("worker prioritizes persisted signatures before pre-broadcast failures", async () => {
  const source = await Deno.readTextFile(
    new URL("../worker-holder-airdrop-solana/index.ts", import.meta.url),
  );
  const loadAirdrop = source.indexOf("const airdrop = await loadAirdrop");
  const persisted = source.indexOf("const persistedBatch");
  const terminal = source.indexOf('if (["completed", "failed"]');
  const revalidate = source.indexOf("revalidateLaunchAndWallet");
  const failBeforeBroadcast = source.indexOf("failAirdropBeforeBroadcast");
  assertEquals(loadAirdrop >= 0 && loadAirdrop < persisted, true);
  assertEquals(persisted >= 0 && persisted < terminal, true);
  assertEquals(persisted < revalidate, true);
  assertEquals(persisted < failBeforeBroadcast, true);
  assertStringIncludes(source, "walletAddress: String(airdrop.wallet_address)");
});

Deno.test("worker state rebroadcasts ambiguous signed submissions safely", () => {
  assertEquals(
    shouldProcessPersistedBatchBeforeRevalidation({
      airdropStatus: "failed",
      batch: { status: "broadcasting" },
    }),
    true,
  );
  assertEquals(
    shouldProcessPersistedBatchBeforeRevalidation({
      airdropStatus: "completed",
      batch: { status: "broadcasting" },
    }),
    false,
  );
  assertEquals(persistedBatchAction({ status: "signed" }), "broadcast_once");
  assertEquals(
    persistedBatchAction({ status: "broadcasting" }),
    "broadcast_once",
  );
  assertEquals(persistedBatchAction({ status: "broadcast" }), "reconcile_only");
  assertEquals(
    persistedBatchAction({ status: "reconciling" }),
    "reconcile_only",
  );
  assertEquals(persistedBatchAction({ status: "planned" }), "ignore");
});

Deno.test("worker only sends persisted signed raw transactions", async () => {
  const source = await Deno.readTextFile(
    new URL("../worker-holder-airdrop-solana/index.ts", import.meta.url),
  );
  assertEquals((source.match(/sendRawTransaction/g) ?? []).length, 1);
  const actionBranch = source.indexOf('if (action === "broadcast_once")');
  const send = source.indexOf("sendRawTransaction");
  const statusRead = source.indexOf("const status = await readSignatureState");
  assertEquals(actionBranch >= 0 && actionBranch < send, true);
  assertEquals(send >= 0 && send < statusRead, true);
  assertStringIncludes(source, 'args.batch.status !== "broadcasting"');
  assertStringIncludes(source, "holder_airdrop_broadcast_already_in_progress");
  assertStringIncludes(source, "holder_airdrop_broadcast_outcome_ambiguous");
});

Deno.test("worker final notification follows terminal reconciliation", async () => {
  const worker = await Deno.readTextFile(
    new URL("../worker-holder-airdrop-solana/index.ts", import.meta.url),
  );
  const terminalCheck = worker.indexOf("if (settled.data?.terminal === true)");
  const notifyAfterSettle = worker.indexOf(
    "await notifyTerminal",
    terminalCheck,
  );
  assertEquals(terminalCheck >= 0 && notifyAfterSettle > terminalCheck, true);

  const sql = await Deno.readTextFile(
    new URL(
      "../../migrations/20260804190000_holder_airdrop_durable_flow.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(
    sql,
    "return jsonb_build_object('airdrop_status',v_status,'terminal',v_status in ('completed','failed'))",
  );
  assertStringIncludes(sql, "status='completed'");
  assertStringIncludes(sql, "status='failed'");
});

Deno.test("docs advertise supported holder-airdrop amount modes", async () => {
  const docs = await Deno.readTextFile(
    new URL(
      "../../../src/components/linkr/docs/LinkrDocsPage.tsx",
      import.meta.url,
    ),
  );
  assertStringIncludes(docs, "airdrop 250000 of <token address>");
  assertStringIncludes(docs, "airdrop 100% of my supply");
  assertEquals(docs.includes("own token balance or dev supply"), false);
  assertStringIncludes(docs, "current token balance");
  assertStringIncludes(docs, "exact token amount");
  assertStringIncludes(docs, "percentage of that wallet token balance");
});

Deno.test("migration contains immutable live-capable ledgers and safe rollout seed", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../migrations/20260804190000_holder_airdrop_durable_flow.sql",
      import.meta.url,
    ),
  );
  for (
    const fragment of [
      "create table if not exists public.linkr_holder_airdrops",
      "create table if not exists public.linkr_holder_airdrop_recipients",
      "create table if not exists public.linkr_holder_airdrop_batches",
      "idempotency_key text not null unique",
      "confirm_linkr_holder_airdrop_v1",
      "claim_linkr_holder_airdrop_batch_v1",
      "record_linkr_holder_airdrop_batch_signed_v1",
      "mark_linkr_holder_airdrop_batch_broadcasting_v1",
      "record_linkr_holder_airdrop_batch_broadcast_v1",
      "settle_linkr_holder_airdrop_batch_v1",
      "notify_linkr_holder_airdrop_terminal_v1",
      "holder_airdrop_snapshot_immutable",
      "holder_airdrop_recipient_immutable",
      "worker-holder-airdrop-solana-v1',0,'{}'::uuid[])",
      "enabled=false",
      "rollout_percent=0",
      "Operational enable step after migration validation and canary approval",
    ]
  ) assertStringIncludes(sql.replace(/\s+/g, " "), fragment);
});

Deno.test("follow-up migration and runbook match percentage and batch behavior", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/20260804200000_holder_airdrop_percent_batch_efficiency.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(migration, "recipient_count between 1 and 6");
  assertStringIncludes(migration, "((ordinal - 1) / 6)");
  assertStringIncludes(
    migration,
    "linkr_holder_airdrop_recipients_batch_ordinal_idx",
  );

  const runbook = await Deno.readTextFile(
    new URL("../../../docs/HOLDER_AIRDROP_RUNBOOK.md", import.meta.url),
  );
  assertStringIncludes(runbook, "percentage of the recorded launch wallet");
  assertStringIncludes(runbook, "aggregate token balance");
  assertEquals(runbook.includes("Percentages are not implemented"), false);
});

function canonicalLaunch(id: string, symbol: string) {
  return {
    id,
    user_id: "user",
    name: symbol,
    symbol,
    mint: `${id}-mint`,
    token_address: `${id}-mint`,
    status: "confirmed",
    chain: "solana",
    solana_launch_wallet_id: "wallet",
    launch_signer_wallet_id: null,
  };
}

function fakeLaunchAdmin(rows: unknown[], exactMintRow?: unknown) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    order: () => builder,
    limit: async () => ({ data: rows, error: null }),
    maybeSingle: async () => ({ data: exactMintRow ?? null, error: null }),
  };
  return { from: () => builder };
}

function fakeBuilder(result: unknown, terminal: "limit" | "maybeSingle") {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => terminal === "limit" ? Promise.resolve(result) : builder,
    maybeSingle: () =>
      terminal === "maybeSingle" ? Promise.resolve(result) : builder,
  };
  return builder;
}

function toPostgresBytea(bytes: Uint8Array): string {
  return "\\x" +
    [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
