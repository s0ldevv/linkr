type RpcEnvelope<T> = {
  jsonrpc?: string;
  result?: T;
  error?: { code?: number; message?: string };
};

const MAX_RPC_RESPONSE_BYTES = 256 * 1024;
const ROBINHOOD_TOKEN_LAUNCHED_TOPIC =
  "0x5cd09150c40d7c6bc0e837fe9b4ce8aacf8aa2a9af5ed0e80341ef8535b7c10d";

export type RobinhoodLaunchEvent = {
  factory: string;
  token: string;
  creator: string;
  pool: string;
};

export async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs = 10_000,
): Promise<T> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1") {
    throw new Error("chain_rpc_url_rejected");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(parsed, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`chain_rpc_http_${response.status}`);
  const text = new TextDecoder().decode(
    await readBoundedBody(response, MAX_RPC_RESPONSE_BYTES),
  );
  let envelope: RpcEnvelope<T>;
  try {
    envelope = JSON.parse(text) as RpcEnvelope<T>;
  } catch {
    throw new Error("chain_rpc_invalid_json");
  }
  if (envelope.error) {
    throw new Error(
      `chain_rpc_${method}_${envelope.error.code ?? "error"}:` +
        String(envelope.error.message ?? "unknown").slice(0, 160),
    );
  }
  return envelope.result as T;
}

export function robinhoodRpcUrl(): string {
  return Deno.env.get("ROBINHOOD_RPC_URL")?.trim() ||
    "https://rpc.mainnet.chain.robinhood.com";
}

export function solanaRpcUrl(): string {
  const url = Deno.env.get("SOLANA_RPC_URL")?.trim();
  if (!url) throw new Error("SOLANA_RPC_URL_missing");
  return url;
}

export async function readRobinhoodReceipt(transactionHash: string): Promise<{
  state: "pending" | "confirmed" | "reverted";
  receipt: Record<string, unknown> | null;
}> {
  const receipt = await rpcCall<Record<string, unknown> | null>(
    robinhoodRpcUrl(),
    "eth_getTransactionReceipt",
    [transactionHash],
  );
  if (!receipt) return { state: "pending", receipt: null };
  const status = String(receipt.status ?? "").toLowerCase();
  return {
    state: status === "0x1" ? "confirmed" : "reverted",
    receipt,
  };
}

/**
 * Proves that a successful receipt is the expected launch, rather than merely
 * proving that some transaction with the persisted hash did not revert.
 */
export function verifyRobinhoodLaunchReceipt(
  receipt: Record<string, unknown>,
  expected: { factory: string; token: string; creator?: string },
): RobinhoodLaunchEvent {
  const factory = normalizeEvmAddress(expected.factory);
  const token = normalizeEvmAddress(expected.token);
  const creator = expected.creator
    ? normalizeEvmAddress(expected.creator)
    : null;
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  for (const candidate of logs) {
    if (!candidate || typeof candidate !== "object") continue;
    const log = candidate as Record<string, unknown>;
    let logAddress: string;
    try {
      logAddress = normalizeEvmAddress(log.address);
    } catch {
      continue;
    }
    const topics = Array.isArray(log.topics)
      ? log.topics.map((value) => String(value).toLowerCase())
      : [];
    if (
      logAddress !== factory ||
      topics.length < 4 ||
      topics[0] !== ROBINHOOD_TOKEN_LAUNCHED_TOPIC
    ) continue;
    const eventToken = topicAddress(topics[1]);
    const eventCreator = topicAddress(topics[2]);
    const eventPool = topicAddress(topics[3]);
    if (eventToken !== token || (creator && eventCreator !== creator)) {
      continue;
    }
    return {
      factory: logAddress,
      token: eventToken,
      creator: eventCreator,
      pool: eventPool,
    };
  }
  throw new Error("robinhood_launch_event_missing_or_mismatched");
}

export async function readRobinhoodTransactionCount(
  address: string,
  tag: "latest" | "pending",
): Promise<bigint> {
  const value = await rpcCall<string>(
    robinhoodRpcUrl(),
    "eth_getTransactionCount",
    [address, tag],
  );
  if (!/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("robinhood_nonce_invalid");
  }
  return BigInt(value);
}

export async function readSolanaSignature(signature: string): Promise<{
  state: "pending" | "confirmed" | "failed";
  status: Record<string, unknown> | null;
}> {
  const result = await rpcCall<
    { value?: Array<Record<string, unknown> | null> }
  >(
    solanaRpcUrl(),
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
  );
  const status = result?.value?.[0] ?? null;
  if (!status) return { state: "pending", status: null };
  if (status.err) return { state: "failed", status };
  const confirmationStatus = String(status.confirmationStatus ?? "");
  return {
    state:
      confirmationStatus === "confirmed" || confirmationStatus === "finalized"
        ? "confirmed"
        : "pending",
    status,
  };
}

export async function readSolanaBlockHeight(): Promise<number> {
  const height = await rpcCall<number>(
    solanaRpcUrl(),
    "getBlockHeight",
    [{ commitment: "confirmed" }],
  );
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new Error("solana_block_height_invalid");
  }
  return height;
}

export async function rebroadcastRobinhoodRaw(
  bytes: Uint8Array,
): Promise<string> {
  return await rpcCall<string>(
    robinhoodRpcUrl(),
    "eth_sendRawTransaction",
    [`0x${bytesToHex(bytes)}`],
  );
}

export async function rebroadcastSolanaRaw(bytes: Uint8Array): Promise<string> {
  return await rpcCall<string>(
    solanaRpcUrl(),
    "sendTransaction",
    [toBase64(bytes), {
      encoding: "base64",
      skipPreflight: true,
      maxRetries: 0,
    }],
  );
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) throw new Error("chain_rpc_empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("chain_rpc_response_too_large").catch(() => {});
        throw new Error("chain_rpc_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function normalizeEvmAddress(value: unknown): string {
  const address = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new Error("robinhood_address_invalid");
  }
  return address;
}

function topicAddress(value: unknown): string {
  const topic = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(topic)) {
    throw new Error("robinhood_event_topic_invalid");
  }
  return normalizeEvmAddress(`0x${topic.slice(-40)}`);
}
