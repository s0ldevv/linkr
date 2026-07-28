// deno-lint-ignore-file no-explicit-any
import { jsonResponse } from "./cors.ts";

// Double-submit guard for user-initiated transfers. Existing clients need no
// change: without an explicit idempotency_key, an identical send (same chain,
// asset, recipient, amount) within 90 seconds is rejected with 409. Clients
// that pass idempotency_key get full replay semantics.
export interface TransferGuardClaim {
  ok: true;
  requestId: string;
  settle: (
    status: "succeeded" | "failed",
    txHash?: string | null,
    response?: Record<string, unknown> | null,
  ) => Promise<void>;
}

export interface TransferGuardBlocked {
  ok: false;
  response: Response;
}

export async function claimTransferGuard(admin: any, args: {
  userId: string;
  chain: string;
  asset: string;
  recipient: string;
  amountText: string;
  idempotencyKey?: unknown;
}): Promise<TransferGuardClaim | TransferGuardBlocked> {
  const explicitKey = String(args.idempotencyKey ?? "").trim();
  const explicit = explicitKey.length > 0;
  if (explicit && explicitKey.length > 180) {
    return {
      ok: false,
      response: jsonResponse({ error: "idempotency_key_invalid" }, {
        status: 400,
      }),
    };
  }
  const guardKey = explicit
    ? `client:${explicitKey}`
    : `auto:${await sha256Hex(
      [args.chain, args.asset, args.recipient, args.amountText].join("|"),
    )}`;

  const claim = await admin.rpc("claim_user_transfer_request_v1", {
    p_user_id: args.userId,
    p_guard_key: guardKey,
    p_explicit: explicit,
    p_chain: args.chain,
    p_asset: args.asset,
    p_recipient: args.recipient,
    p_amount_text: args.amountText,
  });
  if (claim.error) throw claim.error;
  const data = claim.data ?? {};
  if (data.claimed !== true) {
    if (data.reason === "replayed") {
      return {
        ok: false,
        response: jsonResponse(
          { ...data.response ?? {}, replayed: true },
          { status: 200 },
        ),
      };
    }
    return {
      ok: false,
      response: jsonResponse({
        error: "duplicate_transfer_request",
        message:
          "An identical transfer was just submitted. Wait a moment before sending the same amount again, or pass a unique idempotency_key.",
      }, { status: 409 }),
    };
  }

  const requestId = String(data.request_id);
  return {
    ok: true,
    requestId,
    settle: async (status, txHash = null, response = null) => {
      const settled = await admin.rpc("settle_user_transfer_request_v1", {
        p_request_id: requestId,
        p_status: status,
        p_tx_hash: txHash,
        p_response: response,
      });
      if (settled.error) {
        console.error("transfer_guard_settle_failed", settled.error);
      }
    },
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
