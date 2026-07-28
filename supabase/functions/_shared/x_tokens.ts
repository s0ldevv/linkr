// deno-lint-ignore-file no-explicit-any
import { decryptXToken, encryptXToken } from "./x_token_crypto.ts";

const DEFAULT_ACCOUNT_KEY = "linkrcash";
const DEFAULT_REFRESH_WINDOW_MS = 10 * 60 * 1000;
const REAUTH_RETRY_WINDOW_MS = 15 * 60 * 1000;
const LOCK_TTL_MS = 2 * 60 * 1000;
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

export interface XTokenRow {
  id: string;
  account_key: string;
  bot_handle: string;
  x_user_id: string | null;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_auth_tag: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
  token_type: string;
  scope: string;
  expires_at: string;
  is_active: boolean;
  refresh_lock_owner: string | null;
  refresh_lock_until: string | null;
  last_refreshed_at: string | null;
  last_refresh_attempt_at: string | null;
  last_refresh_status: "ok" | "failed" | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface XAccessTokenResult {
  accessToken: string;
  accountKey: string;
  botHandle: string;
  xUserId: string | null;
  expiresAt: string;
}

export interface XRefreshResult {
  accountKey: string;
  botHandle: string;
  xUserId: string | null;
  expiresAt: string;
  refreshed: boolean;
  skipped?: "not_due" | "locked";
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortMessage(value: unknown, max = 1000): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.length > max ? raw.slice(0, max) : raw;
}

function secondsFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isReauthorizationError(message: string | null | undefined): boolean {
  const value = String(message ?? "").toLowerCase();
  return (
    value.includes("invalid_request") ||
    value.includes("token was invalid") ||
    value.includes("invalid refresh") ||
    value.includes("revoked")
  );
}

function hasRecentReauthorizationFailure(row: XTokenRow): boolean {
  if (row.last_refresh_status !== "failed" || !isReauthorizationError(row.last_error)) {
    return false;
  }

  const attemptMs = Date.parse(row.last_refresh_attempt_at ?? "");
  return Number.isFinite(attemptMs) && attemptMs > Date.now() - REAUTH_RETRY_WINDOW_MS;
}

async function getTokenRow(admin: any, accountKey: string): Promise<XTokenRow | null> {
  const { data, error } = await admin
    .from("x_bot_tokens")
    .select("*")
    .eq("account_key", accountKey)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data as XTokenRow | null;
}

export async function recordXTokenEvent(
  admin: any,
  event: {
    accountKey?: string;
    eventType: string;
    status: "ok" | "failed" | "skipped";
    message?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("x_bot_token_events").insert({
      account_key: event.accountKey ?? DEFAULT_ACCOUNT_KEY,
      event_type: event.eventType,
      status: event.status,
      message: event.message ?? null,
      details: event.details ?? {},
    });
  } catch (_) {
    // Token event logging should never break auth or posting.
  }
}

export async function getXAccessToken(
  admin: any,
  options: { accountKey?: string; refreshWithinMs?: number } = {},
): Promise<XAccessTokenResult> {
  const accountKey = options.accountKey ?? DEFAULT_ACCOUNT_KEY;
  const refreshWithinMs = options.refreshWithinMs ?? DEFAULT_REFRESH_WINDOW_MS;
  let row = await getTokenRow(admin, accountKey);
  if (!row)
    throw new Error(`No X OAuth token found for ${accountKey}. Complete first login first.`);

  const expiresMs = Date.parse(row.expires_at);
  const shouldRefresh = !Number.isFinite(expiresMs) || expiresMs <= Date.now() + refreshWithinMs;

  if (shouldRefresh) {
    if (hasRecentReauthorizationFailure(row)) {
      throw new Error(
        `X OAuth token for ${accountKey} requires reauthorization: ${row.last_error}`,
      );
    }

    try {
      await refreshXToken(admin, { accountKey, force: false, refreshWithinMs });
      row = await getTokenRow(admin, accountKey);
      if (!row) throw new Error(`No X OAuth token found for ${accountKey} after refresh.`);
    } catch (error) {
      const stillUsable = Number.isFinite(expiresMs) && expiresMs > Date.now() + 60_000;
      await recordXTokenEvent(admin, {
        accountKey,
        eventType: "access_token_refresh_before_use",
        status: stillUsable ? "skipped" : "failed",
        message: errorMessage(error),
      });
      if (!stillUsable) throw error;
    }
  }

  if (!row) throw new Error(`No X OAuth token found for ${accountKey} after refresh check.`);

  const latestExpiresMs = Date.parse(row.expires_at);
  if (!Number.isFinite(latestExpiresMs) || latestExpiresMs <= Date.now()) {
    throw new Error(`Stored X access token for ${accountKey} is expired.`);
  }

  const accessToken = await decryptXToken({
    ciphertext: row.access_token_ciphertext,
    iv: row.access_token_iv,
  });

  return {
    accessToken,
    accountKey: row.account_key,
    botHandle: row.bot_handle,
    xUserId: row.x_user_id,
    expiresAt: row.expires_at,
  };
}

export async function refreshXToken(
  admin: any,
  options: { accountKey?: string; force?: boolean; refreshWithinMs?: number } = {},
): Promise<XRefreshResult> {
  const accountKey = options.accountKey ?? DEFAULT_ACCOUNT_KEY;
  const force = options.force ?? false;
  const refreshWithinMs = options.refreshWithinMs ?? DEFAULT_REFRESH_WINDOW_MS;
  const current = await getTokenRow(admin, accountKey);
  if (!current)
    throw new Error(`No X OAuth token found for ${accountKey}. Complete first login first.`);

  const currentExpiresMs = Date.parse(current.expires_at);
  if (
    !force &&
    Number.isFinite(currentExpiresMs) &&
    currentExpiresMs > Date.now() + refreshWithinMs
  ) {
    return {
      accountKey: current.account_key,
      botHandle: current.bot_handle,
      xUserId: current.x_user_id,
      expiresAt: current.expires_at,
      refreshed: false,
      skipped: "not_due",
    };
  }

  const owner = crypto.randomUUID();
  const lockUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const { data: lockedRow, error: lockError } = await admin.rpc("claim_x_bot_token_refresh_lock", {
    p_account_key: accountKey,
    p_owner: owner,
    p_lock_until: lockUntil,
  });

  if (lockError) throw lockError;
  const locked = lockedRow as XTokenRow | null;

  if (!locked) {
    await recordXTokenEvent(admin, {
      accountKey,
      eventType: "refresh",
      status: "skipped",
      message: "Refresh already in progress",
    });

    const latest = await getTokenRow(admin, accountKey);
    if (latest && Date.parse(latest.expires_at) > Date.now() + 60_000) {
      return {
        accountKey: latest.account_key,
        botHandle: latest.bot_handle,
        xUserId: latest.x_user_id,
        expiresAt: latest.expires_at,
        refreshed: false,
        skipped: "locked",
      };
    }
    throw new Error(`X token refresh is already in progress and ${accountKey} token is expired.`);
  }

  let releaseLock = true;
  try {
    const refreshToken = await decryptXToken({
      ciphertext: locked.refresh_token_ciphertext,
      iv: locked.refresh_token_iv,
    });
    const clientId = requiredEnv("X_CLIENT_ID");
    const clientSecret = requiredEnv("X_CLIENT_SECRET");

    const response = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });

    const responseText = await response.text();
    let body: any = {};
    try {
      body = responseText ? JSON.parse(responseText) : {};
    } catch (_) {
      body = { raw: responseText };
    }

    if (!response.ok) {
      throw new Error(`x refresh ${response.status}: ${shortMessage(body)}`);
    }

    if (!body?.access_token) throw new Error("X refresh response did not include access_token");
    const nextRefreshToken = body.refresh_token || refreshToken;
    const expiresIn = Number(body.expires_in ?? 7200);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("X refresh response did not include a valid expires_in");
    }

    const accessToken = await encryptXToken(body.access_token);
    const encryptedRefreshToken = await encryptXToken(nextRefreshToken);
    const expiresAt = secondsFromNow(expiresIn);
    const now = new Date().toISOString();

    const { data: updatedRow, error: updateError } = await admin
      .from("x_bot_tokens")
      .update({
        access_token_ciphertext: accessToken.ciphertext,
        access_token_iv: accessToken.iv,
        access_token_auth_tag: accessToken.authTag,
        refresh_token_ciphertext: encryptedRefreshToken.ciphertext,
        refresh_token_iv: encryptedRefreshToken.iv,
        refresh_token_auth_tag: encryptedRefreshToken.authTag,
        token_type: body.token_type ?? locked.token_type ?? "bearer",
        scope: body.scope ?? locked.scope,
        expires_at: expiresAt,
        last_refreshed_at: now,
        last_refresh_status: "ok",
        last_error: null,
        refresh_lock_owner: null,
        refresh_lock_until: null,
      })
      .eq("id", locked.id)
      .eq("refresh_lock_owner", owner)
      .select("*")
      .single();

    if (updateError) throw updateError;
    releaseLock = false;

    const updated = updatedRow as XTokenRow;
    await recordXTokenEvent(admin, {
      accountKey,
      eventType: "refresh",
      status: "ok",
      message: "X token refreshed",
      details: {
        expires_at: updated.expires_at,
        x_user_id: updated.x_user_id,
        bot_handle: updated.bot_handle,
      },
    });

    return {
      accountKey: updated.account_key,
      botHandle: updated.bot_handle,
      xUserId: updated.x_user_id,
      expiresAt: updated.expires_at,
      refreshed: true,
    };
  } catch (error) {
    const message = shortMessage(errorMessage(error));
    await admin
      .from("x_bot_tokens")
      .update({
        last_refresh_status: "failed",
        last_error: message,
        refresh_lock_owner: null,
        refresh_lock_until: null,
      })
      .eq("id", locked.id)
      .eq("refresh_lock_owner", owner);
    releaseLock = false;

    await recordXTokenEvent(admin, {
      accountKey,
      eventType: "refresh",
      status: "failed",
      message,
    });

    throw error;
  } finally {
    if (releaseLock) {
      await admin.rpc("release_x_bot_token_refresh_lock", {
        p_token_id: locked.id,
        p_owner: owner,
      });
    }
  }
}
