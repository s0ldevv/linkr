import {
  classifyFundingSignatureStatus,
  firstLaunchFundingDeficit,
  SOL_FIRST_LAUNCH_FUNDING_LAMPORTS,
  SOL_LAUNCH_FUNDING_CAP_LAMPORTS,
  validateStoredFundingTransaction,
} from "./funding.ts";
import {
  base58Encode,
  Keypair,
  SystemProgram,
  Transaction,
} from "./runtime.ts";
import { sha256Hex } from "../transaction_outbox.ts";

Deno.test("first-launch funding covers only the exact confirmed deficit", () => {
  if (firstLaunchFundingDeficit(0, 20_000_000) !== 20_000_000n) {
    throw new Error("empty wallet deficit was not fully covered");
  }
  if (firstLaunchFundingDeficit(7_500_000, 20_000_000) !== 12_500_000n) {
    throw new Error("partial wallet balance was not deducted from subsidy");
  }
  if (firstLaunchFundingDeficit(25_000_000, 20_000_000) !== 0n) {
    throw new Error("funded wallet produced an unnecessary subsidy");
  }
  if (firstLaunchFundingDeficit(0, 7_690_000) !== 7_690_000n) {
    throw new Error("dynamic launch target was not fully covered");
  }
  if (firstLaunchFundingDeficit(2_000_000, 7_690_000) !== 5_690_000n) {
    throw new Error("partial balance was not deducted from dynamic target");
  }
  // Deliberately raised from 20_000_000 on 2026-07-30 to make room for
  // PUMP_FUN_LAUNCH_RENT_HEADROOM_LAMPORTS (0.009 SOL). The fallback reserve
  // estimate of 0.02 SOL already sat exactly at the old cap, and funding is
  // skipped when the deficit exceeds the cap, so leaving it would have silently
  // stopped funding launches on that path.
  //
  // This assertion is a tripwire on how much platform SOL may be auto-sent per
  // launch. Changing it should always be a conscious decision.
  if (SOL_LAUNCH_FUNDING_CAP_LAMPORTS !== 30_000_000n) {
    throw new Error("launch funding cap changed unexpectedly");
  }
  if (SOL_FIRST_LAUNCH_FUNDING_LAMPORTS !== 30_000_000n) {
    throw new Error("first-launch subsidy cap changed unexpectedly");
  }
});

Deno.test("first-launch funding rejects unsafe numeric inputs", () => {
  for (
    const [balance, required] of [
      [-1, 1],
      [1, -1],
      [Number.MAX_SAFE_INTEGER + 1, 1],
      [1, Number.NaN],
    ]
  ) {
    let rejected = false;
    try {
      firstLaunchFundingDeficit(balance, required);
    } catch (_) {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`unsafe values accepted: ${balance}/${required}`);
    }
  }
});

Deno.test("funding signature status is conservative and deterministic", () => {
  if (classifyFundingSignatureStatus(null).kind !== "unknown") {
    throw new Error("missing signature status was not treated as unknown");
  }
  if (
    classifyFundingSignatureStatus({
      err: null,
      confirmationStatus: "processed",
      slot: 4,
    }).kind !== "pending"
  ) {
    throw new Error("processed transaction was treated as final");
  }
  if (
    classifyFundingSignatureStatus({
      err: { InstructionError: [0, "Custom"] },
      confirmationStatus: "confirmed",
      slot: 5,
    }).kind !== "failed"
  ) {
    throw new Error("failed transaction was treated as confirmed");
  }
  const confirmed = classifyFundingSignatureStatus({
    err: null,
    confirmationStatus: "finalized",
    slot: 6,
  });
  if (confirmed.kind !== "confirmed" || confirmed.slot !== 6) {
    throw new Error("finalized transaction was not confirmed");
  }
});

Deno.test("stored funding bytes must prove the exact source, destination, and amount", async () => {
  const source = Keypair.generate();
  const destination = Keypair.generate().publicKey;
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: source.publicKey,
      toPubkey: destination,
      lamports: 12_345,
    }),
  );
  transaction.feePayer = source.publicKey;
  transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  transaction.sign(source);
  const signedBytes = transaction.serialize();
  const signatureBytes = transaction.signatures[0].signature;
  if (!signatureBytes) throw new Error("fixture signature missing");
  const event = {
    signed_transaction_base64: toBase64(signedBytes),
    signed_transaction_hash: await sha256Hex(signedBytes),
    recent_blockhash: transaction.recentBlockhash,
    tx_hash: base58Encode(signatureBytes),
  };
  const verified = await validateStoredFundingTransaction(
    event,
    source.publicKey.toBase58(),
    destination.toBase58(),
    12_345n,
  );
  if (verified.length !== signedBytes.length) {
    throw new Error("verified transaction bytes changed");
  }
  verified.fill(0);

  let rejected = false;
  try {
    await validateStoredFundingTransaction(
      event,
      source.publicKey.toBase58(),
      Keypair.generate().publicKey.toBase58(),
      12_345n,
    );
  } catch (_) {
    rejected = true;
  }
  if (!rejected) throw new Error("tampered destination was accepted");
  source.secretKey.fill(0);
  signedBytes.fill(0);
});

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
