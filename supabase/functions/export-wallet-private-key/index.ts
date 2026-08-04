// deno-lint-ignore-file no-explicit-any
// Authenticated private key export for the in-app wallet page.

import {
  corsHeaders,
  jsonResponse,
  withSensitiveCors,
} from "../_shared/cors.ts";
import { getCallerAuthContext, serviceClient } from "../_shared/supabase.ts";
import { loadSolanaWalletById } from "../_shared/solana_chain.ts";
import { loadWalletById } from "../_shared/wallet.ts";
import { readJsonBody, requestBodyErrorResponse } from "../_shared/http.ts";

// Keep export availability in code so stale WALLET_EXPORT_DISABLED secrets
// cannot block wallet export after deploy. Re-authentication, the typed
// confirmation phrase, and the challenge TTL still apply on the enabled path.
const WALLET_EXPORT_DISABLED: boolean = false;

const CONFIRMATION_PHRASE = "EXPORT";
const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const RECENT_AUTH_MAX_AGE_MS = 5 * 60 * 1000;
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

Deno.serve(async (req) => withSensitiveCors(req, await handleExport(req)));

async function handleExport(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const requestId = crypto.randomUUID();
  let userId: string | null = null;
  let walletId: string | null = null;
  const admin = serviceClient();
  try {
    if (WALLET_EXPORT_DISABLED) {
      return jsonResponse(
        {
          error: "wallet_export_temporarily_unavailable",
          request_id: requestId,
        },
        { status: 503, headers: PRIVATE_RESPONSE_HEADERS },
      );
    }
    const caller = await getCallerAuthContext(req);
    if (!caller) {
      return jsonResponse({ error: "unauthorized", request_id: requestId }, {
        status: 401,
      });
    }
    userId = caller.userId;

    let body: any;
    try {
      body = await readJsonBody(req, 16 * 1024);
    } catch (error) {
      return (
        requestBodyErrorResponse(error) ??
          jsonResponse({ error: "invalid_request", request_id: requestId }, {
            status: 400,
          })
      );
    }
    const action = String(body.action ?? "export")
      .trim()
      .toLowerCase();
    walletId = String(body.wallet_id ?? body.walletId ?? "").trim() || null;
    const challengeToken = String(body.challenge_token ?? "").trim();
    if (!walletId) {
      return jsonResponse({
        error: "wallet_id_required",
        request_id: requestId,
      }, { status: 400 });
    }
    if (!caller.sessionId || !isRecentAuthentication(caller.authenticatedAt)) {
      await recordSecurityEvent(admin, req, {
        userId,
        walletId,
        eventType: "wallet_export_reauthentication",
        outcome: "required",
        requestId,
      });
      return jsonResponse(
        { error: "reauthentication_required", request_id: requestId },
        { status: 403 },
      );
    }

    if (action === "challenge") {
      if (!walletId) {
        return jsonResponse({
          error: "wallet_id_required",
          request_id: requestId,
        }, { status: 400 });
      }
      const walletExists = await ownedWalletExists(admin, userId, walletId);
      if (!walletExists) {
        return jsonResponse({
          error: "wallet_not_found",
          request_id: requestId,
        }, { status: 404 });
      }
      const challengeLimit = await consumeLimit(
        admin,
        "wallet_export_challenge",
        userId,
        600,
        5,
      );
      if (!challengeLimit.allowed) {
        return rateLimitedResponse(challengeLimit.resetAt, requestId);
      }

      await admin
        .from("wallet_export_challenges")
        .update({ status: "cancelled" })
        .eq("user_id", userId)
        .eq("wallet_id", walletId)
        .eq("status", "pending");

      const challengeToken = randomToken();
      const tokenHash = await sha256Hex(challengeToken);
      const sessionHash = await sha256Hex(caller.sessionId);
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
      const inserted = await admin.from("wallet_export_challenges").insert({
        user_id: userId,
        wallet_id: walletId,
        token_hash: tokenHash,
        session_hash: sessionHash,
        expires_at: expiresAt,
      });
      if (inserted.error) throw inserted.error;
      await recordSecurityEvent(admin, req, {
        userId,
        walletId,
        eventType: "wallet_export_challenge",
        outcome: "issued",
        requestId,
      });
      return jsonResponse({
        challenge_token: challengeToken,
        expires_at: expiresAt,
        request_id: requestId,
      });
    }

    if (action !== "export") {
      return jsonResponse({ error: "invalid_action", request_id: requestId }, {
        status: 400,
      });
    }

    const confirmation = String(body.confirmation ?? "")
      .trim()
      .toUpperCase();
    if (confirmation !== CONFIRMATION_PHRASE) {
      return jsonResponse(
        { error: "confirmation_required", request_id: requestId },
        { status: 400 },
      );
    }

    const exportLimit = await consumeLimit(
      admin,
      "wallet_export",
      userId,
      600,
      3,
    );
    if (!exportLimit.allowed) {
      return rateLimitedResponse(exportLimit.resetAt, requestId);
    }

    if (
      !challengeToken ||
      !(await consumeChallenge(
        admin,
        userId,
        walletId,
        caller.sessionId,
        challengeToken,
      ))
    ) {
      await recordSecurityEvent(admin, req, {
        userId,
        walletId,
        eventType: "wallet_export_challenge",
        outcome: "rejected",
        requestId,
      });
      return jsonResponse(
        { error: "export_challenge_invalid_or_expired", request_id: requestId },
        { status: 403 },
      );
    }

    if (walletId) {
      const evmWallet = await loadWalletById(admin, walletId, userId);
      if (evmWallet) {
        await recordSecurityEvent(admin, req, {
          userId,
          walletId,
          eventType: "wallet_private_key_export",
          outcome: "success",
          requestId,
        });
        return jsonResponse(
          {
            wallet_id: evmWallet.id,
            address: evmWallet.address,
            public_key: evmWallet.public_key,
            chain_id: evmWallet.chain_id,
            wallet_type: evmWallet.wallet_type,
            private_key_hex: evmWallet.private_key_hex,
            private_key_format: "evm-private-key-hex",
            explorer_url: evmWallet.explorer_url,
            exported_at: new Date().toISOString(),
            request_id: requestId,
          },
          {
            headers: PRIVATE_RESPONSE_HEADERS,
          },
        );
      }

      const solanaWallet = await loadSolanaWalletById(admin, walletId, userId);
      if (solanaWallet) {
        await recordSecurityEvent(admin, req, {
          userId,
          walletId,
          eventType: "wallet_private_key_export",
          outcome: "success",
          requestId,
        });
        return jsonResponse(
          {
            wallet_id: solanaWallet.id,
            address: solanaWallet.address,
            public_key: solanaWallet.public_key,
            chain_id: solanaWallet.chain_id,
            wallet_type: solanaWallet.wallet_type,
            private_key_base58: solanaWallet.secret_key_base58,
            private_key_format: "solana-secret-key-base58",
            explorer_url: solanaWallet.explorer_url,
            exported_at: new Date().toISOString(),
            request_id: requestId,
          },
          {
            headers: PRIVATE_RESPONSE_HEADERS,
          },
        );
      }

      return jsonResponse(
        { error: "wallet_not_found", request_id: requestId },
        { status: 404 },
      );
    }

    return jsonResponse({ error: "wallet_not_found", request_id: requestId }, {
      status: 404,
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "wallet_export_failed",
        request_id: requestId,
        user_id: userId,
        wallet_id: walletId,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    await recordSecurityEvent(admin, req, {
      userId,
      walletId,
      eventType: "wallet_private_key_export",
      outcome: "error",
      requestId,
    }).catch(() => {});
    return jsonResponse({
      error: "wallet_export_failed",
      request_id: requestId,
    }, { status: 500 });
  }
}

function isRecentAuthentication(authenticatedAt: Date | null): boolean {
  if (!authenticatedAt || !Number.isFinite(authenticatedAt.getTime())) {
    return false;
  }
  const age = Date.now() - authenticatedAt.getTime();
  return age >= 0 && age <= RECENT_AUTH_MAX_AGE_MS;
}

async function ownedWalletExists(
  admin: any,
  userId: string,
  walletId: string,
): Promise<boolean> {
  const result = await admin
    .from("wallets")
    .select("id")
    .eq("id", walletId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

async function consumeChallenge(
  admin: any,
  userId: string,
  walletId: string,
  sessionId: string,
  challengeToken: string,
): Promise<boolean> {
  const tokenHash = await sha256Hex(challengeToken);
  const sessionHash = await sha256Hex(sessionId);
  const consumed = await admin
    .from("wallet_export_challenges")
    .update({ status: "used", used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("wallet_id", walletId)
    .eq("token_hash", tokenHash)
    .eq("session_hash", sessionHash)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (consumed.error) throw consumed.error;
  return Boolean(consumed.data);
}

async function consumeLimit(
  admin: any,
  subjectType: string,
  subjectId: string,
  windowSeconds: number,
  limit: number,
): Promise<{ allowed: boolean; resetAt: string | null }> {
  const result = await admin.rpc("consume_linkr_rate_limit", {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_window_seconds: windowSeconds,
    p_limit: limit,
  });
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return { allowed: Boolean(row?.allowed), resetAt: row?.reset_at ?? null };
}

function rateLimitedResponse(
  resetAt: string | null,
  requestId: string,
): Response {
  const retryAfter = resetAt
    ? Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000))
    : 60;
  return jsonResponse(
    {
      error: "rate_limit_exceeded",
      retry_after: retryAfter,
      request_id: requestId,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

async function recordSecurityEvent(
  admin: any,
  req: Request,
  event: {
    userId: string | null;
    walletId: string | null;
    eventType: string;
    outcome: string;
    requestId: string;
  },
) {
  const forwardedFor =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await admin.from("wallet_security_events").insert({
    user_id: event.userId,
    wallet_id: event.walletId,
    event_type: event.eventType,
    outcome: event.outcome,
    request_ip: forwardedFor,
    user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    metadata: { request_id: event.requestId },
  });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
