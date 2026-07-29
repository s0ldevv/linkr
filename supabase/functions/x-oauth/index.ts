// deno-lint-ignore-file no-explicit-any
import {
  corsHeaders,
  jsonResponse,
  withSensitiveCors,
} from "../_shared/cors.ts";
import {
  isLinkrPublicOrigin,
  isLoopbackOrigin,
  LINKR_APEX_ORIGIN,
  LINKR_PUBLIC_ORIGINS,
  linkrUrlHostVariants,
} from "../_shared/app_origins.ts";
import { readJsonBody } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { decryptXToken, encryptXToken } from "../_shared/x_token_crypto.ts";
import { recordXTokenEvent } from "../_shared/x_tokens.ts";
import { ensureProvisionedXUser } from "../_shared/provisioning.ts";
import { getActiveXBan } from "../_shared/x_bans.ts";
import { evaluateXUserGating } from "../_shared/admin_settings.ts";
import {
  completeTelegramLinkToken,
  sendTelegramMessage,
} from "../_shared/telegram.ts";

const COOKIE_NAME = "linkr_x_pkce";
const ACCOUNT_KEY = "linkrcash";
const EXPECTED_HANDLE = "linkrcash";
const BOT_SCOPES = "tweet.read tweet.write users.read offline.access";
const USER_SCOPES = "tweet.read users.read";
const X_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_ME_URL =
  "https://api.x.com/2/users/me?user.fields=profile_image_url,public_metrics";
const CANONICAL_APP_ORIGIN = LINKR_APEX_ORIGIN;
const FALLBACK_APP_CALLBACK = `${CANONICAL_APP_ORIGIN}/auth/callback`;
const STATIC_ALLOWED_APP_CALLBACK_ORIGINS = [
  ...LINKR_PUBLIC_ORIGINS,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

interface PkceCookie {
  state: string;
  verifier: string;
  createdAt: number;
  mode?: "bot" | "user";
  redirectTo?: string;
  expectedUserId?: string;
  authPopup?: boolean;
  authFlowId?: string;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function supabaseAuthHeaders(apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: apiKey,
    "Content-Type": "application/json",
  };

  // New Supabase publishable keys are opaque and should not be sent as bearer JWTs.
  if (!apiKey.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function base64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function redirectUri(): string {
  return `${
    requiredEnv("SUPABASE_URL").replace(/\/+$/g, "")
  }/functions/v1/x-oauth/callback`;
}

function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    cookies[trimmed.slice(0, eq)] = decodeURIComponent(trimmed.slice(eq + 1));
  }
  return cookies;
}

function setPkceCookie(payload: PkceCookie): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(payload))}`,
    "Path=/",
    "Max-Age=600",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function clearPkceCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readPkceCookie(req: Request): PkceCookie | null {
  const raw = parseCookies(req.headers.get("Cookie"))[COOKIE_NAME];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PkceCookie;
    if (!parsed.state || !parsed.verifier || !parsed.createdAt) return null;
    if (Date.now() - parsed.createdAt > 10 * 60 * 1000) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function htmlResponse(
  title: string,
  body: string,
  init: ResponseInit = {},
): Response {
  return new Response(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 40px 24px; color: #111827; background: #f9fafb; }
    main { max-width: 720px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 28px; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { line-height: 1.5; }
    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`,
    {
      ...init,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        ...(init.headers ?? {}),
      },
    },
  );
}

function oauthError(message: string, status = 400): Response {
  return htmlResponse(
    "X OAuth Login Failed",
    `<h1>X OAuth Login Failed</h1><p>${escapeHtml(message)}</p>`,
    { status, headers: { "Set-Cookie": clearPkceCookie() } },
  );
}

function oauthErrorRedirectUrl(
  redirectTo: string | undefined,
  code: string,
  message: string,
): string {
  const target = new URL(sanitizeRedirectTo(redirectTo ?? null));
  target.searchParams.set("error", code || "oauth_error");
  target.searchParams.set(
    "error_description",
    message || "X login did not finish.",
  );
  target.hash = "";
  return target.toString();
}

function userOauthError(
  pkce: PkceCookie | null,
  message: string,
  status = 400,
  code = "oauth_error",
) {
  if (!pkce || pkce.mode !== "user") return oauthError(message, status);
  return new Response(null, {
    status: 302,
    headers: {
      Location: oauthErrorRedirectUrl(pkce.redirectTo, code, message),
      "Set-Cookie": clearPkceCookie(),
    },
  });
}

function configuredUrlValues(names: string[]): string[] {
  const values: string[] = [];
  for (const name of names) {
    const raw = Deno.env.get(name);
    if (!raw) continue;
    for (const part of raw.split(/[,\s]+/)) {
      const value = part.trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function originFromConfiguredUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.origin;
  } catch (_) {
    return null;
  }
}

function defaultAppCallback(): string {
  for (
    const value of configuredUrlValues([
      "APP_ORIGIN",
      "PUBLIC_SITE_URL",
      "LINKR_APP_URL",
      "SITE_URL",
    ])
  ) {
    const origin = originFromConfiguredUrl(value);
    if (origin && isAllowedAppCallbackOrigin(origin)) {
      return `${origin}/auth/callback`;
    }
  }
  return FALLBACK_APP_CALLBACK;
}

function allowedAppCallbackOrigins(): Set<string> {
  const origins = new Set(STATIC_ALLOWED_APP_CALLBACK_ORIGINS);
  for (
    const value of configuredUrlValues([
      "APP_ORIGIN",
      "PUBLIC_SITE_URL",
      "LINKR_APP_URL",
      "SITE_URL",
      "LINKR_BROWSER_ORIGINS",
    ])
  ) {
    const origin = originFromConfiguredUrl(value);
    if (origin && isAllowedAppCallbackOrigin(origin)) origins.add(origin);
  }
  return origins;
}

function isAllowedAppCallbackOrigin(origin: string): boolean {
  return isLinkrPublicOrigin(origin) || isLoopbackOrigin(origin);
}

function sanitizeRedirectTo(raw: string | null): string {
  const fallback = defaultAppCallback();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (url.pathname !== "/auth/callback") return fallback;
    if (!allowedAppCallbackOrigins().has(url.origin)) {
      return fallback;
    }
    return url.toString();
  } catch (_) {
    return fallback;
  }
}

function normalizeAuthFlowId(raw: string | null): string | undefined {
  if (!raw || !/^[a-zA-Z0-9_-]{16,128}$/.test(raw)) return undefined;
  return raw;
}

function withAuthPopupMetadata(
  redirectTo: string,
  authPopup: boolean,
  authFlowId?: string,
): string {
  const target = new URL(redirectTo);
  if (authPopup) target.searchParams.set("auth_popup", "1");
  if (authFlowId) target.searchParams.set("auth_flow", authFlowId);
  return target.toString();
}

async function sessionRedirectUrl(
  admin: any,
  userId: string,
  redirectTo: string,
  session: any,
): Promise<string> {
  const target = new URL(redirectTo);
  const code = randomBase64Url(32);
  const [codeHash, accessToken, refreshToken] = await Promise.all([
    sha256Hex(code),
    encryptXToken(String(session?.access_token ?? "")),
    encryptXToken(String(session?.refresh_token ?? "")),
  ]);
  const inserted = await admin.from("auth_handoff_codes").insert({
    code_hash: codeHash,
    user_id: userId,
    redirect_to: target.toString(),
    access_token_ciphertext: accessToken.ciphertext,
    access_token_iv: accessToken.iv,
    refresh_token_ciphertext: refreshToken.ciphertext,
    refresh_token_iv: refreshToken.iv,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  if (inserted.error) throw inserted.error;
  target.searchParams.set("handoff_code", code);
  return target.toString();
}

async function exchangeAuthHandoff(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  const body = (await readJsonBody(req, 64 * 1024)) as any;
  const code = String(body?.handoff_code ?? "").trim();
  const redirectTo = sanitizeRedirectTo(String(body?.redirect_to ?? ""));
  if (!code || code.length > 256) {
    return jsonResponse({ error: "invalid_handoff" }, { status: 400 });
  }
  const admin = serviceClient();
  const consumed = await admin
    .from("auth_handoff_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", await sha256Hex(code))
    // The code is bound to the exact callback URL it was issued for, but an
    // apex/www redirect between issuing and redeeming rewrites only the host.
    // Accept both spellings of the same trusted deployment.
    .in("redirect_to", linkrUrlHostVariants(redirectTo))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select(
      "user_id,access_token_ciphertext,access_token_iv,refresh_token_ciphertext,refresh_token_iv",
    )
    .maybeSingle();
  if (consumed.error) throw consumed.error;
  if (!consumed.data) {
    return jsonResponse(
      { error: "handoff_invalid_or_expired" },
      {
        status: 403,
      },
    );
  }
  const [accessToken, refreshToken] = await Promise.all([
    decryptXToken({
      ciphertext: consumed.data.access_token_ciphertext,
      iv: consumed.data.access_token_iv,
    }),
    decryptXToken({
      ciphertext: consumed.data.refresh_token_ciphertext,
      iv: consumed.data.refresh_token_iv,
    }),
  ]);
  return jsonResponse(
    { access_token: accessToken, refresh_token: refreshToken },
    { headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" } },
  );
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

function telegramLinkTokenFromRedirect(
  redirectTo: string | undefined,
): string | null {
  if (!redirectTo) return null;
  try {
    return new URL(redirectTo).searchParams.get("telegram_link");
  } catch (_) {
    return null;
  }
}

function bannedRedirectUrl(pkce: PkceCookie, username: string): string {
  const base = new URL(sanitizeRedirectTo(pkce.redirectTo ?? null));
  if (pkce.authPopup) {
    const target = new URL("/auth/callback", base.origin);
    target.searchParams.set("auth_popup", "1");
    target.searchParams.set("auth_status", "banned");
    if (pkce.authFlowId) target.searchParams.set("auth_flow", pkce.authFlowId);
    if (username) target.searchParams.set("handle", username);
    return target.toString();
  }
  const target = new URL("/auth/banned", base.origin);
  if (username) target.searchParams.set("handle", username);
  return target.toString();
}

async function createSessionForProvisionedXUser(
  admin: any,
  userId: string,
  email: string,
  userMetadata: Record<string, unknown>,
): Promise<any> {
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: userMetadata,
  });
  if (updateError) {
    throw new Error(`Could not prepare Linkr session: ${updateError.message}`);
  }

  // Issue a one-time passwordless session after X has verified the identity.
  // Rotating a synthetic password here terminated or invalidated the user's
  // existing dashboard session, which caused authenticated wallet calls to
  // start returning 401 while reauthentication was in progress.
  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (generated.error) {
    throw new Error(
      `Could not prepare Linkr session: ${generated.error.message}`,
    );
  }
  if (
    generated.data.user?.id !== userId ||
    !generated.data.properties?.hashed_token
  ) {
    throw new Error("Supabase did not return a valid Linkr session token.");
  }

  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/g, "");
  // This is a server-to-server redemption of a token created by the admin API.
  // Use the service role explicitly: the runtime may inject an opaque
  // publishable key, and omitting Authorization for that key makes /verify
  // reject an otherwise valid one-time token.
  const apiKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: supabaseAuthHeaders(apiKey),
    body: JSON.stringify({
      token_hash: generated.data.properties.hashed_token,
      type: "magiclink",
    }),
  });
  const body = await response.json().catch(() => ({}) as any);

  if (!response.ok) {
    throw new Error(
      `Could not create Linkr session (${response.status}): ${
        JSON.stringify(body).slice(0, 300)
      }`,
    );
  }

  if (!body?.access_token || !body?.refresh_token) {
    throw new Error("Supabase did not return a complete Linkr session.");
  }

  return body;
}

async function ensureStartAuthorized(url: URL): Promise<void> {
  const supplied = url.searchParams.get("oauth_state") ?? "";
  if (!supplied || supplied.length > 256) {
    throw new Error("Unauthorized OAuth start request");
  }
  const admin = serviceClient();
  const consumed = await admin
    .from("admin_oauth_start_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state_hash", await sha256Hex(supplied))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (consumed.error) throw consumed.error;
  if (!consumed.data) throw new Error("Unauthorized OAuth start request");
}

async function authorize(
  req: Request,
  url: URL,
  mode: "bot" | "user",
): Promise<Response> {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  if (mode === "bot") await ensureStartAuthorized(url);

  const verifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const challenge = await pkceChallenge(verifier);
  const redirectTo = mode === "user"
    ? sanitizeRedirectTo(url.searchParams.get("redirect_to"))
    : undefined;
  const redirectUrl = redirectTo ? new URL(redirectTo) : null;
  const authPopup = mode === "user" &&
    (url.searchParams.get("auth_popup") === "1" ||
      redirectUrl?.searchParams.get("auth_popup") === "1");
  const authFlowId = mode === "user"
    ? normalizeAuthFlowId(
      url.searchParams.get("auth_flow") ??
        redirectUrl?.searchParams.get("auth_flow") ?? null,
    )
    : undefined;
  const finalRedirectTo = redirectTo
    ? withAuthPopupMetadata(redirectTo, authPopup, authFlowId)
    : undefined;
  const rawExpectedUserId = mode === "user"
    ? url.searchParams.get("expected_user_id")
    : null;
  const expectedUserId = rawExpectedUserId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(
          rawExpectedUserId,
        )
    ? rawExpectedUserId.toLowerCase()
    : undefined;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requiredEnv("X_CLIENT_ID"),
    redirect_uri: redirectUri(),
    scope: mode === "user" ? USER_SCOPES : BOT_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${X_AUTHORIZE_URL}?${params.toString()}`,
      "Set-Cookie": setPkceCookie({
        state,
        verifier,
        mode,
        redirectTo: finalRedirectTo,
        expectedUserId,
        authPopup,
        authFlowId,
        createdAt: Date.now(),
      }),
    },
  });
}

async function callback(req: Request, url: URL): Promise<Response> {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const pkce = readPkceCookie(req);
  const state = url.searchParams.get("state");

  const providerError = url.searchParams.get("error");
  if (providerError) {
    const description = url.searchParams.get("error_description") ??
      "X rejected the login.";
    if (pkce && (!state || timingSafeEqual(state, pkce.state))) {
      return userOauthError(
        pkce,
        `${providerError}: ${description}`,
        400,
        providerError,
      );
    }
    return oauthError(`${providerError}: ${description}`);
  }

  const code = url.searchParams.get("code");
  if (!code || !state) {
    return oauthError("Missing code or state from X callback.");
  }

  if (!pkce) {
    return oauthError(
      "Missing or expired OAuth cookie. Start the login again.",
    );
  }
  if (!timingSafeEqual(state, pkce.state)) {
    return oauthError("OAuth state mismatch. Start the login again.");
  }
  const mode = pkce.mode ?? "bot";

  const clientId = requiredEnv("X_CLIENT_ID");
  const clientSecret = requiredEnv("X_CLIENT_SECRET");

  const tokenResponse = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: pkce.verifier,
    }),
  });

  const tokenBody = await tokenResponse.json().catch(() => ({}) as any);
  if (!tokenResponse.ok) {
    return userOauthError(
      pkce,
      `X token exchange failed (${tokenResponse.status}). ${
        JSON.stringify(tokenBody).slice(
          0,
          500,
        )
      }`,
      400,
      "token_exchange_failed",
    );
  }
  if (
    !tokenBody?.access_token || (mode === "bot" && !tokenBody?.refresh_token)
  ) {
    return userOauthError(
      pkce,
      mode === "bot"
        ? "X did not return both access_token and refresh_token. Confirm offline.access is enabled."
        : "X did not return an access_token.",
      400,
      "missing_token",
    );
  }

  const meResponse = await fetch(X_ME_URL, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const meBody = await meResponse.json().catch(() => ({}) as any);
  if (!meResponse.ok) {
    return userOauthError(
      pkce,
      `Could not verify X account (${meResponse.status}). ${
        JSON.stringify(meBody).slice(0, 500)
      }`,
      400,
      "profile_lookup_failed",
    );
  }

  const user = meBody?.data;
  const username = String(user?.username ?? "").toLowerCase();
  const admin = serviceClient();

  if (mode === "user") {
    if (!user?.id || !username) {
      return userOauthError(
        pkce,
        "X did not return a valid user profile.",
        400,
        "invalid_profile",
      );
    }

    const activeBan = await getActiveXBan(admin, user.id);
    if (activeBan) {
      await recordXTokenEvent(admin, {
        accountKey: "user-login",
        eventType: "oauth_login_blocked",
        status: "skipped",
        message: "Banned X user blocked from login",
        details: {
          x_user_id: user.id,
          username,
          ban_id: activeBan.id,
        },
      });
      if (pkce.expectedUserId) {
        return userOauthError(
          pkce,
          "This X account is not permitted to authenticate with Linkr.",
          403,
          "banned_x_user",
        );
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: bannedRedirectUrl(pkce, username),
          "Set-Cookie": clearPkceCookie(),
        },
      });
    }

    const gating = await evaluateXUserGating({
      admin,
      xUserId: user.id,
      username,
      publicMetrics: user.public_metrics ?? {},
      source: "x-oauth",
    });
    if (!gating.eligible) {
      await recordXTokenEvent(admin, {
        accountKey: "user-login",
        eventType: "oauth_login_blocked",
        status: "skipped",
        message: "X user blocked from login by gating policy",
        details: {
          x_user_id: user.id,
          username,
          reason: gating.reason,
          policy: gating.policy,
          public_metrics: gating.public_metrics,
        },
      });
      return userOauthError(
        pkce,
        "This X account does not currently meet Linkr access requirements.",
        403,
        gating.reason ?? "x_user_gated",
      );
    }

    const email = `x-${user.id}@x.linkr.cash`;
    const redirectTo = withAuthPopupMetadata(
      sanitizeRedirectTo(pkce.redirectTo ?? null),
      Boolean(pkce.authPopup),
      pkce.authFlowId,
    );
    const userMetadata = {
      provider: "x",
      provider_id: user.id,
      sub: user.id,
      user_name: username,
      preferred_username: username,
      full_name: user.name ?? username,
      name: user.name ?? username,
      avatar_url: user.profile_image_url ?? null,
      picture: user.profile_image_url ?? null,
    };

    if (pkce.expectedUserId) {
      const { data: expectedProfile, error: expectedProfileError } = await admin
        .from("profiles")
        .select("user_id, twitter_id")
        // expected_user_id is auth.users.id. profiles.id is a separate row id.
        .eq("user_id", pkce.expectedUserId)
        .maybeSingle();
      if (expectedProfileError) {
        return userOauthError(
          pkce,
          "Linkr could not verify the account requesting this wallet export.",
          500,
          "account_check_failed",
        );
      }
      if (
        !expectedProfile ||
        String(expectedProfile.twitter_id ?? "") !== String(user.id)
      ) {
        await recordXTokenEvent(admin, {
          accountKey: "user-login",
          eventType: "oauth_reauthentication_mismatch",
          status: "skipped",
          message: "Wallet export reauthentication used a different X account",
          details: {
            expected_user_id: pkce.expectedUserId,
            x_user_id: user.id,
            username,
          },
        });
        return userOauthError(
          pkce,
          "This X account does not match the Linkr account requesting the wallet export.",
          403,
          "account_mismatch",
        );
      }
    }

    const provisioned = await ensureProvisionedXUser(admin, {
      twitterId: user.id,
      username,
      name: user.name ?? username,
      profileImageUrl: user.profile_image_url ?? null,
      source: "x_login",
    });

    if (
      pkce.expectedUserId &&
      provisioned.userId.toLowerCase() !== pkce.expectedUserId
    ) {
      await recordXTokenEvent(admin, {
        accountKey: "user-login",
        eventType: "oauth_reauthentication_mismatch",
        status: "skipped",
        message: "Wallet export reauthentication used a different X account",
        details: {
          expected_user_id: pkce.expectedUserId,
          authenticated_user_id: provisioned.userId,
          x_user_id: user.id,
          username,
        },
      });
      return userOauthError(
        pkce,
        "This X account does not match the Linkr account requesting the wallet export.",
        403,
        "account_mismatch",
      );
    }

    const session = await createSessionForProvisionedXUser(
      admin,
      provisioned.userId,
      email,
      userMetadata,
    );
    const telegramLinkToken = telegramLinkTokenFromRedirect(redirectTo);
    let telegramLink: any = null;
    let telegramLinkError: string | null = null;
    if (telegramLinkToken) {
      try {
        telegramLink = await completeTelegramLinkToken(admin, {
          token: telegramLinkToken,
          userId: provisioned.userId,
          xUsername: username,
        });
        await sendTelegramMessage({
          chat_id: telegramLink.telegram_chat_id,
          message_thread_id: telegramLink.message_thread_id,
          text: `Connected @${username}. You can chat with Linkr here now.`,
        }).catch(() => null);
      } catch (error) {
        telegramLinkError = error instanceof Error
          ? error.message
          : String(error);
      }
    }
    const actionLink = await sessionRedirectUrl(
      admin,
      provisioned.userId,
      redirectTo,
      session,
    );

    await recordXTokenEvent(admin, {
      accountKey: "user-login",
      eventType: "oauth_login",
      status: "ok",
      message: "X user login completed",
      details: {
        x_user_id: user.id,
        username,
        redirect_to: redirectTo,
        telegram_linked: Boolean(telegramLink),
        telegram_link_error: telegramLinkError,
        provisioning: {
          user_id: provisioned.userId,
          wallet_public_key: provisioned.wallet.public_key,
          solana_wallet_public_key: provisioned.solanaWallet.public_key,
          created_auth_user: provisioned.createdAuthUser,
          created_profile: provisioned.createdProfile,
          created_wallet: provisioned.createdWallet,
          created_solana_wallet: provisioned.createdSolanaWallet,
          initialized_default_rules: provisioned.initializedDefaultRules,
        },
      },
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: actionLink,
        "Set-Cookie": clearPkceCookie(),
      },
    });
  }

  if (username !== EXPECTED_HANDLE) {
    return oauthError(
      `Logged in as @${
        username || "unknown"
      }, but this app requires @${EXPECTED_HANDLE}.`,
    );
  }

  const accessToken = await encryptXToken(tokenBody.access_token);
  const refreshToken = await encryptXToken(tokenBody.refresh_token);
  const expiresIn = Number(tokenBody.expires_in ?? 7200);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return oauthError("X did not return a valid token expiry.");
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const now = new Date().toISOString();
  const { error: upsertError } = await admin.from("x_bot_tokens").upsert(
    {
      account_key: ACCOUNT_KEY,
      bot_handle: EXPECTED_HANDLE,
      x_user_id: user.id,
      access_token_ciphertext: accessToken.ciphertext,
      access_token_iv: accessToken.iv,
      access_token_auth_tag: accessToken.authTag,
      refresh_token_ciphertext: refreshToken.ciphertext,
      refresh_token_iv: refreshToken.iv,
      refresh_token_auth_tag: refreshToken.authTag,
      token_type: tokenBody.token_type ?? "bearer",
      scope: tokenBody.scope ?? BOT_SCOPES,
      expires_at: expiresAt,
      is_active: true,
      refresh_lock_owner: null,
      refresh_lock_until: null,
      last_refreshed_at: now,
      last_refresh_status: "ok",
      last_error: null,
    },
    { onConflict: "account_key" },
  );

  if (upsertError) {
    return oauthError(
      `Could not store X token metadata: ${upsertError.message}`,
      500,
    );
  }

  await recordXTokenEvent(admin, {
    accountKey: ACCOUNT_KEY,
    eventType: "oauth_login",
    status: "ok",
    message: "X OAuth login completed",
    details: {
      bot_handle: EXPECTED_HANDLE,
      x_user_id: user.id,
      expires_at: expiresAt,
      scope: tokenBody.scope ?? BOT_SCOPES,
    },
  });

  return htmlResponse(
    "X OAuth Connected",
    `<h1>X OAuth Connected</h1>
<p><code>@${
      escapeHtml(EXPECTED_HANDLE)
    }</code> is connected for Linkr reply posting.</p>
<p>X user id: <code>${escapeHtml(user.id)}</code></p>
<p>Token expires at: <code>${escapeHtml(expiresAt)}</code></p>
<p>You can close this tab.</p>`,
    { headers: { "Set-Cookie": clearPkceCookie() } },
  );
}

Deno.serve(async (req) => withSensitiveCors(req, await handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const url = new URL(req.url);

  try {
    if (url.pathname.endsWith("/handoff")) {
      return await exchangeAuthHandoff(req);
    }
    if (url.pathname.endsWith("/callback")) return await callback(req, url);
    const mode =
      url.pathname.endsWith("/user") || url.searchParams.get("mode") === "user"
        ? "user"
        : "bot";
    return await authorize(req, url, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    if (message === "Unauthorized OAuth start request") {
      return oauthError(message, 401);
    }
    console.error(JSON.stringify({ event: "x_oauth_failed", error: message }));
    // Best-effort persist so we can inspect failures out-of-band.
    try {
      const admin = serviceClient();
      await recordXTokenEvent(admin, {
        accountKey: "user-login",
        eventType: "x_oauth_unhandled_error",
        status: "failed",
        message: message.slice(0, 500),
        details: {
          path: url.pathname,
          stack: stack ? String(stack).slice(0, 1500) : undefined,
        },
      });
    } catch (_) {
      // ignore logging failures
    }
    // If we have a pkce cookie for a user login, redirect back to the app
    // callback with error details instead of showing a dead-end HTML page.
    const pkce = readPkceCookie(req);
    if (pkce && pkce.mode === "user") {
      return userOauthError(pkce, message, 500, "x_oauth_failed");
    }
    // Otherwise surface the real error text so it can be diagnosed.
    return oauthError(`OAuth request failed: ${message}`, 500);
  }
}
