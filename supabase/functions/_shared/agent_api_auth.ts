// deno-lint-ignore-file no-explicit-any
import { AgentApiError, forbidden, unauthorized } from "./agent_api_errors.ts";
import {
  type AgentScope,
  parseJsonBody,
  readBoundedBodyText,
} from "./agent_api_core.ts";
import { getActiveBanForAuthUser } from "./x_bans.ts";

export interface AgentAuthContext {
  userId: string;
  agentProfileId: string;
  apiKeyId: string;
  walletId: string | null;
  scopes: string[];
  profile: any;
  agentProfile: any;
  apiKey: any;
  wallet: any;
  bodyText: string;
  body: any;
  requestPath: string;
  idempotencyKey: string | null;
  nonce: string;
  requestHash: string;
  startedAt: number;
}

type AgentPepperVersion = "legacy" | "v2";

async function hashSecret(
  secret: string,
  version: AgentPepperVersion = "legacy",
): Promise<string> {
  // Legacy hashes were computed with WALLET_ENCRYPTION_SECRET as the pepper,
  // so that fallback must stay until every key is on pepper_version v2. The
  // service-role-key fallback is removed: it coupled API-key validity to
  // service-role rotation and widened that secret's blast radius.
  const pepper = version === "v2"
    ? Deno.env.get("AGENT_API_KEY_PEPPER_V2")?.trim() ?? ""
    : Deno.env.get("AGENT_API_KEY_PEPPER")?.trim() ||
      Deno.env.get("WALLET_ENCRYPTION_SECRET")?.trim() || "";
  if (!pepper) {
    throw new Error(
      version === "v2"
        ? "AGENT_API_KEY_PEPPER_V2 missing"
        : "legacy_agent_api_key_pepper_missing",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(secret),
  );
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireAgentApiKey(
  req: Request,
  admin: any,
  requiredScope: AgentScope,
  options: { requireIdempotency?: boolean } = {},
): Promise<AgentAuthContext> {
  const startedAt = Date.now();
  const bodyText = req.method === "GET" || req.method === "HEAD"
    ? ""
    : await readBoundedBodyText(req);
  const bodyHash = await sha256Hex(bodyText);
  const expectedBodyHash = (req.headers.get("X-Linkr-Body-SHA256") ?? "").trim()
    .toLowerCase();
  if (expectedBodyHash !== bodyHash) {
    throw unauthorized(
      "invalid_body_hash",
      "X-Linkr-Body-SHA256 does not match the request body.",
    );
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(linkr_live_([a-f0-9]{10})_[a-f0-9]{64})$/i.exec(
    authorization,
  );
  if (!match) {
    throw unauthorized("invalid_api_key", "Missing or invalid Linkr API key.");
  }
  const plaintextKey = match[1];
  const keyPrefix = match[2].toLowerCase();
  const { data: apiKey, error: keyError } = await admin
    .from("agent_api_keys")
    .select("*")
    .eq("key_prefix", keyPrefix)
    .maybeSingle();
  if (keyError) throw keyError;
  const pepperVersion = apiKey?.pepper_version === "v2" ? "v2" : "legacy";
  const keyHash = await hashSecret(plaintextKey, pepperVersion);
  if (!apiKey || !constantTimeEqual(apiKey.key_hash, keyHash)) {
    throw unauthorized("invalid_api_key", "Missing or invalid Linkr API key.");
  }
  if (apiKey.status !== "active") throw unauthorized("api_key_not_active");
  if (
    apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= Date.now()
  ) {
    await admin.from("agent_api_keys").update({ status: "expired" }).eq(
      "id",
      apiKey.id,
    );
    throw unauthorized("api_key_expired");
  }
  const scopes = Array.isArray(apiKey.scopes) ? apiKey.scopes : [];
  if (!scopes.includes(requiredScope)) {
    throw forbidden(
      "forbidden_scope",
      `Missing required scope: ${requiredScope}`,
    );
  }
  const activeBan = await getActiveBanForAuthUser(admin, apiKey.user_id);
  if (activeBan.ban) {
    throw forbidden(
      "banned_x_user",
      "This X account is banned from Linkr.",
    );
  }

  const timestamp = parseTimestamp(req.headers.get("X-Linkr-Timestamp"));
  const nonce = (req.headers.get("X-Linkr-Nonce") ?? "").trim();
  if (!nonce || nonce.length > 200) throw unauthorized("invalid_nonce");
  const idempotencyKey = (req.headers.get("Idempotency-Key") ?? "").trim() ||
    null;
  if (options.requireIdempotency && !idempotencyKey) {
    throw new AgentApiError(
      "idempotency_required",
      400,
      "Idempotency-Key is required.",
    );
  }

  const requestPath = canonicalPath(req);
  const expectedSignature = await hmacSha256Hex(
    plaintextKey,
    [
      "LINKR-HMAC-SHA256",
      req.method.toUpperCase(),
      requestPath,
      bodyHash,
      req.headers.get("X-Linkr-Timestamp")?.trim() ?? "",
      nonce,
      idempotencyKey ?? "",
    ].join("\n"),
  );
  const signature = (req.headers.get("X-Linkr-Signature") ?? "").trim()
    .toLowerCase();
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw unauthorized("invalid_signature", "X-Linkr-Signature is invalid.");
  }

  const { error: nonceError } = await admin.from("agent_api_nonces").insert({
    api_key_id: apiKey.id,
    nonce,
    timestamp_at: timestamp.toISOString(),
  });
  if (nonceError) {
    if (
      nonceError.code === "23505" ||
      /duplicate|unique/i.test(String(nonceError.message))
    ) {
      throw unauthorized(
        "replay_detected",
        "This request nonce was already used.",
      );
    }
    throw nonceError;
  }

  const [
    { data: agentProfile, error: agentError },
    { data: profile, error: profileError },
    { data: wallet, error: walletError },
  ] = await Promise.all([
    admin.from("agent_profiles").select("*").eq("id", apiKey.agent_profile_id)
      .maybeSingle(),
    admin.from("profiles").select("*").eq("user_id", apiKey.user_id)
      .maybeSingle(),
    apiKey.wallet_id
      ? admin
        .from("wallets")
        .select(
          "id,user_id,public_key,address,chain_id,wallet_type,explorer_url,is_primary",
        )
        .eq("id", apiKey.wallet_id)
        .maybeSingle()
      : admin
        .from("wallets")
        .select(
          "id,user_id,public_key,address,chain_id,wallet_type,explorer_url,is_primary",
        )
        .eq("user_id", apiKey.user_id)
        .eq("wallet_type", "evm")
        .eq("chain_id", 4663)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
  ]);
  if (agentError) throw agentError;
  if (profileError) throw profileError;
  if (walletError) throw walletError;
  if (!agentProfile || agentProfile.status !== "active") {
    throw forbidden("agent_profile_not_active");
  }
  if (!wallet || wallet.user_id !== apiKey.user_id) {
    throw forbidden("wallet_not_bound_to_agent");
  }

  await enforceRequestLimits(admin, apiKey);
  const lastUsedAt = apiKey.last_used_at
    ? new Date(apiKey.last_used_at).getTime()
    : 0;
  if (!Number.isFinite(lastUsedAt) || Date.now() - lastUsedAt > 5 * 60 * 1000) {
    await admin
      .from("agent_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", apiKey.id);
  }

  return {
    userId: apiKey.user_id,
    agentProfileId: apiKey.agent_profile_id,
    apiKeyId: apiKey.id,
    walletId: apiKey.wallet_id,
    scopes,
    profile,
    agentProfile,
    apiKey,
    wallet,
    bodyText,
    body: parseJsonBody(bodyText),
    requestPath,
    idempotencyKey,
    nonce,
    requestHash: bodyHash,
    startedAt,
  };
}

export async function recordAgentRequest(
  admin: any,
  ctx: Partial<AgentAuthContext> & { requestPath?: string; startedAt?: number },
  req: Request,
  statusCode: number,
  error?: unknown,
) {
  const publicError = error instanceof AgentApiError ? error : null;
  await admin.from("agent_api_requests").insert({
    user_id: ctx.userId ?? null,
    agent_profile_id: ctx.agentProfileId ?? null,
    api_key_id: ctx.apiKeyId ?? null,
    wallet_id: ctx.walletId ?? null,
    method: req.method.slice(0, 12),
    path: String(ctx.requestPath ?? canonicalPath(req)).slice(0, 1000),
    idempotency_key: ctx.idempotencyKey?.slice(0, 200) ?? null,
    nonce: ctx.nonce?.slice(0, 200) ?? null,
    status_code: statusCode,
    request_hash: ctx.requestHash ?? null,
    error_code: publicError?.code ?? (error ? "internal_error" : null),
    error_message: publicError?.message.slice(0, 500) ?? null,
    duration_ms: Math.max(0, Date.now() - (ctx.startedAt ?? Date.now())),
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 128) ??
        null,
    user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });
}

async function enforceRequestLimits(admin: any, apiKey: any) {
  const dailyLimit = Number(apiKey.daily_request_limit ?? 0);
  const minuteLimit = positiveIntegerEnv(
    "LINKR_AGENT_API_REQUESTS_PER_MINUTE",
    60,
  );

  const minute = await consumeLimit(
    admin,
    "agent_api_minute",
    apiKey.id,
    60,
    minuteLimit,
  );
  if (!minute) throw new AgentApiError("rate_limit_exceeded", 429);

  if (Number.isFinite(dailyLimit) && dailyLimit > 0) {
    const daily = await consumeLimit(
      admin,
      "agent_api_daily",
      apiKey.id,
      86400,
      dailyLimit,
    );
    if (!daily) throw new AgentApiError("rate_limit_exceeded", 429);
  }
}

async function consumeLimit(
  admin: any,
  subjectType: string,
  subjectId: string,
  windowSeconds: number,
  limit: number,
): Promise<boolean> {
  const result = await admin.rpc("consume_linkr_rate_limit", {
    p_subject_type: subjectType,
    p_subject_id: String(subjectId),
    p_window_seconds: windowSeconds,
    p_limit: limit,
  });
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return Boolean(row?.allowed);
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Math.floor(Number(Deno.env.get(name) ?? fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function canonicalPath(req: Request): string {
  const forwarded = req.headers.get("X-Linkr-Canonical-Path")?.trim();
  if (forwarded) return forwarded;
  const url = new URL(req.url);
  return `${url.pathname}${url.search}`;
}

function parseTimestamp(value: string | null): Date {
  const raw = String(value ?? "").trim();
  if (!raw) throw unauthorized("missing_timestamp");
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw unauthorized("invalid_timestamp");
  if (Math.abs(Date.now() - date.getTime()) > 5 * 60 * 1000) {
    throw unauthorized("stale_timestamp");
  }
  return date;
}

export async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(hash));
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeEqual(a: unknown, b: unknown): boolean {
  const left = String(a ?? "").toLowerCase();
  const right = String(b ?? "").toLowerCase();
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
