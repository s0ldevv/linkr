// deno-lint-ignore-file no-explicit-any
import {
  corsHeaders,
  jsonResponse,
  withSensitiveCors,
} from "../_shared/cors.ts";
import { getCallerUserId, serviceClient } from "../_shared/supabase.ts";
import { internalErrorResponse, readJsonBody } from "../_shared/http.ts";
import {
  readAllAdminSettings,
  setAdminSetting,
} from "../_shared/admin_settings.ts";
import {
  getActiveXBan,
  isLinkrAdminUser,
  normalizeXHandle,
} from "../_shared/x_bans.ts";
import { loadExpectedXBotIdentity } from "../_shared/x_bot_identity.ts";
import { loadXBotPostAuthMode } from "../_shared/x_posting_auth.ts";
import {
  verifyXPostingCredentials,
  XPostingVerificationError,
} from "../_shared/x_posting_verifier.ts";
import { recordHealthEvent } from "../_shared/health.ts";

const ACCOUNT_KEY = "linkrbot";
const X_USER_LOOKUP_URL = "https://api.twitter.com/2/users/by/username";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function supabaseUrl(): string {
  return requiredEnv("SUPABASE_URL").replace(/\/+$/g, "");
}

async function oauthLoginUrl(
  admin: any,
  adminUserId: string,
): Promise<string | null> {
  if (!Deno.env.get("X_OAUTH_ADMIN_KEY")) return null;
  const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state),
  );
  const stateHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const inserted = await admin.from("admin_oauth_start_states").insert({
    state_hash: stateHash,
    admin_user_id: adminUserId,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (inserted.error) throw inserted.error;
  const url = new URL(`${supabaseUrl()}/functions/v1/x-oauth`);
  url.searchParams.set("oauth_state", state);
  return url.toString();
}

function shortText(value: unknown, max = 1000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? text.slice(0, max) : text;
}

function sanitizeReason(value: unknown): string | null {
  const reason = String(value ?? "").trim();
  if (!reason) return null;
  return reason.slice(0, 500);
}

async function requireAdmin(req: Request, admin: any) {
  const userId = await getCallerUserId(req);
  if (!userId) {
    return {
      response: jsonResponse({ error: "unauthorized" }, { status: 401 }),
      userId: null,
      identity: null,
    };
  }

  const access = await isLinkrAdminUser(admin, userId);
  if (!access.isAdmin) {
    return {
      response: jsonResponse(
        { error: "forbidden", reason: access.reason ?? "not_linkr_admin" },
        { status: 403 },
      ),
      userId,
      identity: access.identity,
    };
  }

  return { response: null, userId, identity: access.identity };
}

async function loadStatus(admin: any, adminUserId: string) {
  const platformHealth = await admin.rpc("get_linkr_admin_platform_health");
  if (platformHealth.error) throw platformHealth.error;
  let authMode: "oauth1" | "oauth2" | "unknown" = "unknown";
  try {
    authMode = loadXBotPostAuthMode();
  } catch (_) {
    // Report configuration failure to the admin UI instead of hiding the panel.
  }
  let expectedIdentity: { userId: string; handle: string } | null = null;
  try {
    expectedIdentity = loadExpectedXBotIdentity();
  } catch (_) {
    // Missing identity is represented in posting_auth below.
  }
  const [{ data: tokenRow, error: tokenError }, { count: pendingReplies }] =
    await Promise.all([
      admin
        .from("x_bot_tokens")
        .select(
          "account_key,bot_handle,x_user_id,token_type,scope,expires_at,is_active,last_refreshed_at,last_refresh_attempt_at,last_refresh_status,last_error,updated_at",
        )
        .eq("account_key", ACCOUNT_KEY)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("twitter_replies")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);
  if (tokenError) throw tokenError;

  const healthSources = [
    "x-post-auth",
    "x-refresh-token",
    "cron-post-replies",
    "cron-fetch-mentions",
  ];
  const healthResults = await Promise.all(
    healthSources.map((source) =>
      admin
        .from("system_health_events")
        .select("source,status,details,checked_at")
        .eq("source", source)
        .order("checked_at", { ascending: false })
        .limit(3)
    ),
  );
  for (const result of healthResults) {
    if (result.error) throw result.error;
  }
  const healthRows = healthResults
    .flatMap((result) => result.data ?? [])
    .sort((left: any, right: any) =>
      String(right.checked_at).localeCompare(String(left.checked_at))
    );

  const { data: bans, error: bansError } = await admin
    .from("banned_x_users")
    .select(
      "id,x_user_id,username_at_ban,display_name_at_ban,profile_image_url,reason,is_active,banned_at,unbanned_at,updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  if (bansError) throw bansError;

  const expiresMs = Date.parse(tokenRow?.expires_at ?? "");
  const expiresInSeconds = Number.isFinite(expiresMs)
    ? Math.floor((expiresMs - Date.now()) / 1000)
    : null;
  const lastError = String(tokenRow?.last_error ?? "");
  const latestAuthHealth =
    healthRows.find((row: any) => row.source === "x-post-auth") ?? null;
  const oauth1Configured = [
    "X_OAUTH1_CONSUMER_KEY",
    "X_OAUTH1_CONSUMER_SECRET",
    "X_OAUTH1_ACCESS_TOKEN",
    "X_OAUTH1_ACCESS_TOKEN_SECRET",
  ].every((name) => Boolean(Deno.env.get(name)));
  const postingConfigured = authMode === "oauth1"
    ? oauth1Configured && Boolean(expectedIdentity)
    : authMode === "oauth2"
    ? Boolean(tokenRow?.is_active)
    : false;
  const authHealthDetails =
    latestAuthHealth?.details && typeof latestAuthHealth.details === "object"
      ? (latestAuthHealth.details as Record<string, unknown>)
      : {};
  const postingLastError = latestAuthHealth?.status === "ok"
    ? null
    : String(authHealthDetails.message ?? authHealthDetails.error ?? "") ||
      null;

  return {
    oauth_login_url: authMode === "oauth2"
      ? await oauthLoginUrl(admin, adminUserId)
      : null,
    oauth_login_configured: Boolean(Deno.env.get("X_OAUTH_ADMIN_KEY")),
    posting_auth: {
      mode: authMode,
      configured: postingConfigured,
      expected_user_id: expectedIdentity?.userId ?? null,
      expected_handle: expectedIdentity?.handle ?? "linkrbot",
      last_verified_at: latestAuthHealth?.checked_at ?? null,
      last_verification_status: latestAuthHealth?.status ?? null,
      last_error: postingLastError,
      needs_attention: !postingConfigured ||
        (latestAuthHealth != null && latestAuthHealth.status !== "ok"),
    },
    bot_token: tokenRow
      ? {
        account_key: tokenRow.account_key,
        bot_handle: tokenRow.bot_handle,
        x_user_id: tokenRow.x_user_id,
        token_type: tokenRow.token_type,
        scope: tokenRow.scope,
        expires_at: tokenRow.expires_at,
        expires_in_seconds: expiresInSeconds,
        is_active: Boolean(tokenRow.is_active),
        last_refreshed_at: tokenRow.last_refreshed_at,
        last_refresh_attempt_at: tokenRow.last_refresh_attempt_at,
        last_refresh_status: tokenRow.last_refresh_status,
        last_error: tokenRow.last_error,
        updated_at: tokenRow.updated_at,
        needs_reauth: tokenRow.last_refresh_status === "failed" &&
          /invalid_request|token was invalid|invalid refresh|revoked/i.test(
            lastError,
          ),
      }
      : null,
    pending_replies: pendingReplies ?? 0,
    health: healthRows,
    platform: platformHealth.data,
    settings: await readAllAdminSettings(admin),
    bans: bans ?? [],
  };
}

async function lookupXUser(handle: string) {
  const username = normalizeXHandle(handle);
  if (!username) throw new Error("handle_required");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    throw new Error("invalid_x_handle");
  }

  const bearer = Deno.env.get("X_BEARER_TOKEN");
  if (!bearer) throw new Error("X_BEARER_TOKEN is not configured");

  const url = new URL(`${X_USER_LOOKUP_URL}/${encodeURIComponent(username)}`);
  url.searchParams.set("user.fields", "profile_image_url,verified");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `x_user_lookup_failed_${response.status}: ${shortText(body, 500)}`,
    );
  }

  const user = body?.data;
  if (!user?.id) throw new Error("x_user_not_found");
  return {
    id: String(user.id),
    username: normalizeXHandle(user.username),
    name: String(user.name ?? user.username ?? username),
    profileImageUrl: typeof user.profile_image_url === "string"
      ? user.profile_image_url
      : null,
  };
}

async function banHandle(admin: any, adminUserId: string, body: any) {
  const user = await lookupXUser(body.handle);
  const botIdentity = loadExpectedXBotIdentity();
  if (botIdentity.userId === user.id) {
    throw new Error("cannot_ban_linkr_bot_account");
  }

  const existingBan = await getActiveXBan(admin, user.id);
  const payload = {
    x_user_id: user.id,
    username_at_ban: user.username,
    display_name_at_ban: user.name,
    profile_image_url: user.profileImageUrl,
    reason: sanitizeReason(body.reason),
    is_active: true,
    banned_by_user_id: adminUserId,
    banned_at: existingBan?.banned_at ?? new Date().toISOString(),
    unbanned_by_user_id: null,
    unbanned_at: null,
  };

  const { data, error } = await admin
    .from("banned_x_users")
    .upsert(payload, { onConflict: "x_user_id" })
    .select(
      "id,x_user_id,username_at_ban,display_name_at_ban,profile_image_url,reason,is_active,banned_at,unbanned_at,updated_at",
    )
    .single();
  if (error) throw error;

  await admin
    .from("tweets_inbox")
    .update({
      status: "ignored",
      error: "banned_x_user",
      processed_at: new Date().toISOString(),
    })
    .eq("author_twitter_id", user.id)
    .in("status", ["pending", "processing"]);

  await admin
    .from("twitter_replies")
    .update({
      status: "failed",
      error: "banned_x_user",
      next_attempt_at: null,
      error_details: {
        blocked_by_admin_ban: true,
        blocked_at: new Date().toISOString(),
      },
    })
    .eq("author_twitter_id", user.id)
    .in("status", ["pending", "posting"]);

  return data;
}

async function unban(admin: any, adminUserId: string, body: any) {
  const xUserId = String(body.x_user_id ?? "").trim();
  if (!xUserId) throw new Error("x_user_id_required");

  const { data, error } = await admin
    .from("banned_x_users")
    .update({
      is_active: false,
      unbanned_by_user_id: adminUserId,
      unbanned_at: new Date().toISOString(),
    })
    .eq("x_user_id", xUserId)
    .select(
      "id,x_user_id,username_at_ban,display_name_at_ban,profile_image_url,reason,is_active,banned_at,unbanned_at,updated_at",
    )
    .single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => withSensitiveCors(req, await handleSecretPanel(req)));

async function handleSecretPanel(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = serviceClient();
    const access = await requireAdmin(req, admin);
    if (access.response) return access.response;

    if (req.method === "GET") {
      return jsonResponse({
        ok: true,
        admin: { user_id: access.userId, identity: access.identity },
        ...(await loadStatus(admin, access.userId!)),
      });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
    }

    const body = (await readJsonBody(req, 64 * 1024)) as any;
    const action = String(body.action ?? "");
    if (action === "ban_handle") {
      const ban = await banHandle(admin, access.userId!, body);
      return jsonResponse({
        ok: true,
        ban,
        ...(await loadStatus(admin, access.userId!)),
      });
    }
    if (action === "unban") {
      const ban = await unban(admin, access.userId!, body);
      return jsonResponse({
        ok: true,
        ban,
        ...(await loadStatus(admin, access.userId!)),
      });
    }
    if (action === "verify_posting_auth") {
      const startedAt = Date.now();
      try {
        const result = await verifyXPostingCredentials({ admin });
        await recordHealthEvent(admin, "x-post-auth", "ok", startedAt, {
          auth_mode: result.authMode,
          x_user_id: result.xUserId,
          bot_handle: result.botHandle,
          verified_at: result.verifiedAt,
          trigger: "secretpanel",
        });
        return jsonResponse({
          ok: true,
          verification: result,
          ...(await loadStatus(admin, access.userId!)),
        });
      } catch (error) {
        const known = error instanceof XPostingVerificationError;
        const message = error instanceof Error ? error.message : String(error);
        await recordHealthEvent(admin, "x-post-auth", "down", startedAt, {
          error: known ? error.code : "x_auth_check_failed",
          message,
          trigger: "secretpanel",
        });
        return jsonResponse(
          {
            error: known ? error.code : "x_auth_check_failed",
            message,
            ...(await loadStatus(admin, access.userId!)),
          },
          { status: known ? error.status : 500 },
        );
      }
    }
    if (action === "update_admin_setting") {
      const updated = await setAdminSetting({
        admin,
        key: String(body.key ?? ""),
        value: body.value,
        adminUserId: access.userId!,
        reason: sanitizeReason(body.reason),
        requestId: req.headers.get("x-request-id"),
      });
      return jsonResponse({
        ok: true,
        setting: updated,
        ...(await loadStatus(admin, access.userId!)),
      });
    }

    return jsonResponse({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /unauthorized/i.test(message)
      ? 401
      : /forbidden|not_linkr/i.test(message)
      ? 403
      : /^(invalid_[a-z0-9_]+|x_gating_threshold_out_of_range|unknown_admin_setting)$/i
          .test(
            message,
          )
      ? 400
      : 500;
    if (status >= 500) {
      return internalErrorResponse(error, { function: "secretpanel" });
    }
    return jsonResponse({ error: message }, { status });
  }
}
