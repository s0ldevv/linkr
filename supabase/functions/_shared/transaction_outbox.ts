// deno-lint-ignore-file no-explicit-any
export interface PersistSignedTransactionInput {
  workItemId: string;
  workerId: string;
  stage: string;
  slotNumber: number;
  slotFencingToken: number;
  resourceFencingToken: number;
  expectedStateVersion: number;
  chain: "solana" | "robinhood";
  walletId?: string | null;
  launchId?: string | null;
  attemptNumber: number;
  signedBytes: Uint8Array;
  encryptedKeyMaterial?: Uint8Array | null;
  transactionHash?: string | null;
  nonce?: string | number | null;
  signature?: string | null;
  blockhash?: string | null;
  lastValidBlockHeight?: number | null;
  predictedAddress?: string | null;
  payloadHash?: string | null;
  gasPolicy?: Record<string, unknown> | null;
}

export async function persistSignedTransaction(
  admin: any,
  input: PersistSignedTransactionInput,
) {
  if (
    input.signedBytes.byteLength < 1 || input.signedBytes.byteLength > 65_536
  ) {
    throw new Error("signed_transaction_size_invalid");
  }
  if (
    input.encryptedKeyMaterial && input.encryptedKeyMaterial.byteLength > 4096
  ) {
    throw new Error("encrypted_key_material_size_invalid");
  }
  const signedHash = await sha256Hex(input.signedBytes);
  const result = await admin.rpc("persist_linkr_signed_transaction", {
    p_work_item_id: input.workItemId,
    p_worker_id: input.workerId,
    p_stage: input.stage,
    p_slot_number: input.slotNumber,
    p_slot_fencing_token: input.slotFencingToken,
    p_resource_fencing_token: input.resourceFencingToken,
    p_expected_state_version: input.expectedStateVersion,
    p_chain: input.chain,
    p_wallet_id: input.walletId ?? null,
    p_launch_id: input.launchId ?? null,
    p_attempt_number: input.attemptNumber,
    p_signed_transaction_base64: toBase64(input.signedBytes),
    p_signed_transaction_hash: signedHash,
    p_encrypted_key_material_base64: input.encryptedKeyMaterial
      ? toBase64(input.encryptedKeyMaterial)
      : null,
    p_transaction_hash: input.transactionHash ?? null,
    p_nonce: input.nonce == null ? null : String(input.nonce),
    p_signature: input.signature ?? null,
    p_blockhash: input.blockhash ?? null,
    p_last_valid_block_height: input.lastValidBlockHeight ?? null,
    p_predicted_address: input.predictedAddress ?? null,
    p_payload_hash: input.payloadHash ?? null,
    p_gas_policy: input.gasPolicy ?? null,
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function markTransactionBroadcast(
  admin: any,
  transactionId: string,
  transactionHash: string,
  fence: {
    workItemId: string;
    workerId: string;
    stage: string;
    slotNumber: number;
    slotFencingToken: number;
    resourceFencingToken: number;
    expectedStateVersion: number;
  },
) {
  return await transitionTransaction(
    admin,
    transactionId,
    transactionHash,
    fence,
    {
      expectedState: "broadcasting",
      newState: "broadcast",
    },
  );
}

export async function transitionTransaction(
  admin: any,
  transactionId: string,
  transactionHash: string | null,
  fence: {
    workItemId: string;
    workerId: string;
    stage: string;
    slotNumber: number;
    slotFencingToken: number;
    resourceFencingToken: number;
    expectedStateVersion: number;
  },
  transition: {
    expectedState: string;
    newState: string;
    errorCode?: string | null;
  },
) {
  const result = await admin.rpc("transition_linkr_chain_transaction", {
    p_transaction_id: transactionId,
    p_work_item_id: fence.workItemId,
    p_worker_id: fence.workerId,
    p_stage: fence.stage,
    p_slot_number: fence.slotNumber,
    p_slot_fencing_token: fence.slotFencingToken,
    p_resource_fencing_token: fence.resourceFencingToken,
    p_expected_state_version: fence.expectedStateVersion,
    p_expected_transaction_state: transition.expectedState,
    p_new_transaction_state: transition.newState,
    p_transaction_hash: transactionHash,
    p_error_code: transition.errorCode ?? null,
  });
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error("transaction_broadcast_transition_rejected");
  }
  return result.data;
}

export function transactionFence(
  claim: {
    work_item: { id: string; state_version: number };
    resource_fencing_token: number | null;
  },
  context: {
    workerId: string;
    stage: string;
    slot: { slot_number: number; fencing_token: number };
  },
) {
  if (claim.resource_fencing_token == null) {
    throw new Error("economic_resource_fence_missing");
  }
  return {
    workItemId: claim.work_item.id,
    workerId: context.workerId,
    stage: context.stage,
    slotNumber: context.slot.slot_number,
    slotFencingToken: context.slot.fencing_token,
    resourceFencingToken: claim.resource_fencing_token,
    expectedStateVersion: claim.work_item.state_version,
  };
}

export async function loadSignedTransaction(
  admin: any,
  transactionId: string,
): Promise<Uint8Array> {
  const result = await admin
    .from("linkr_chain_transactions")
    .select("signed_transaction,signed_transaction_hash")
    .eq("id", transactionId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("signed_transaction_not_found");
  const bytes = fromPostgresBytea(String(result.data.signed_transaction));
  if ((await sha256Hex(bytes)) !== result.data.signed_transaction_hash) {
    throw new Error("signed_transaction_integrity_mismatch");
  }
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into an ArrayBuffer-backed view. Deno's Uint8Array type may be backed
  // by SharedArrayBuffer, which WebCrypto intentionally rejects.
  const digestInput = Uint8Array.from(bytes).buffer;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput),
  );
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function fromPostgresBytea(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error("invalid_signed_transaction_encoding");
  }
  return Uint8Array.from(
    hex.match(/.{2}/g) ?? [],
    (part) => Number.parseInt(part, 16),
  );
}
