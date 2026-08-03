// deno-lint-ignore-file no-explicit-any

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const DEFAULT_LINK_TTL_SECONDS = 600;
const DEFAULT_MAX_REPLY_CHARS = 1500;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

export type TwilioMediaItem = {
  index: number;
  url: string;
  content_type: string;
};
export type TwilioInboundMessage = {
  message_sid: string;
  account_sid: string;
  messaging_service_sid: string | null;
  from: string;
  to: string | null;
  body: string;
  num_media: number;
  media: TwilioMediaItem[];
  params: URLSearchParams;
};
export type TwilioOutboundMessageResult = {
  sid: string;
  status: string;
  payload: Record<string, unknown>;
};
export type SmsLinkedAccount = {
  id: string;
  phone_e164: string;
  phone_hash: string;
  user_id: string | null;
  opt_in_status: string;
  opted_out_at?: string | null;
};

export function parseTwilioForm(rawBody: string): URLSearchParams {
  return new URLSearchParams(rawBody);
}

export function normalizeTwilioInbound(
  params: URLSearchParams,
): TwilioInboundMessage {
  const messageSid = first(params, "MessageSid") ||
    first(params, "SmsMessageSid") || first(params, "SmsSid");
  const accountSid = first(params, "AccountSid");
  const from = normalizePhone(first(params, "From"));
  const toValue = first(params, "To");
  const to = toValue ? normalizePhone(toValue) : null;
  const numMedia = Math.min(
    20,
    Math.max(0, parseInteger(first(params, "NumMedia"))),
  );
  if (!/^SM[a-zA-Z0-9]{16,}$/.test(messageSid)) {
    throw new Error("invalid_twilio_message_sid");
  }
  if (!/^AC[a-zA-Z0-9]{16,}$/.test(accountSid)) {
    throw new Error("invalid_twilio_account_sid");
  }
  const media: TwilioMediaItem[] = [];
  for (let index = 0; index < numMedia; index += 1) {
    const url = first(params, `MediaUrl${index}`);
    if (!url) continue;
    media.push({
      index,
      url,
      content_type: first(params, `MediaContentType${index}`) ||
        "application/octet-stream",
    });
  }
  return {
    message_sid: messageSid,
    account_sid: accountSid,
    messaging_service_sid: first(params, "MessagingServiceSid") || null,
    from,
    to,
    body: first(params, "Body").slice(0, 8000),
    num_media: numMedia,
    media,
    params,
  };
}

export async function computeTwilioSignature(
  url: string,
  params: URLSearchParams,
  authToken: string,
): Promise<string> {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    const values = grouped.get(key) ?? [];
    values.push(value);
    grouped.set(key, values);
  }
  let data = url;
  for (const key of [...grouped.keys()].sort()) {
    for (const value of [...(grouped.get(key) ?? [])].sort()) {
      data += key + value;
    }
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyTwilioSignature(args: {
  signature: string | null;
  url: string;
  params: URLSearchParams;
  authToken?: string | null;
}): Promise<boolean> {
  const token = args.authToken?.trim() ||
    Deno.env.get("TWILIO_AUTH_TOKEN")?.trim() || "";
  const supplied = args.signature?.trim() || "";
  if (!token || !supplied || supplied.length > 256) return false;
  const expected = await computeTwilioSignature(args.url, args.params, token);
  return timingSafeEqual(expected, supplied);
}

export function emptyMessagingResponse(): Response {
  return twimlResponse("");
}

export function messageResponse(text: string): Response {
  return twimlResponse(`<Message>${xmlEscape(text)}</Message>`);
}

export function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  )
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function splitSmsText(
  text: string,
  maxChars = configuredMaxReplyChars(),
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const limit = Math.max(160, Math.min(4000, Math.floor(maxChars)));
  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const candidates = [
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf(" "),
    ];
    let cut = Math.max(...candidates);
    if (cut < Math.floor(limit * 0.55)) cut = limit;
    else if (window.slice(cut, cut + 2) === ". ") cut += 1;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function normalizePhone(value: string): string {
  const clean = String(value ?? "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(clean)) throw new Error("invalid_e164_phone");
  return clean;
}

export async function hashPhone(
  phone: string,
  pepper?: string,
): Promise<string> {
  const normalized = normalizePhone(phone);
  const secret = pepper?.trim() ||
    Deno.env.get("LINKR_PHONE_HASH_PEPPER")?.trim() || "";
  if (secret.length < 16) throw new Error("missing_phone_hash_pepper");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:${normalized}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

export function redactPhone(phone: string): string {
  const clean = String(phone ?? "");
  return clean.length >= 4 ? `***${clean.slice(-4)}` : "***";
}

export async function sendTwilioMessage(args: {
  to: string;
  body: string;
  from?: string | null;
  messagingServiceSid?: string | null;
  statusCallback?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<TwilioOutboundMessageResult> {
  const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = args.messagingServiceSid?.trim() ||
    Deno.env.get("TWILIO_MESSAGING_SERVICE_SID")?.trim() || "";
  const from = args.from?.trim() ||
    Deno.env.get("TWILIO_FROM_NUMBER")?.trim() || "";
  if (!messagingServiceSid && !from) throw new Error("missing_twilio_sender");
  const form = new URLSearchParams({
    To: normalizePhone(args.to),
    Body: args.body,
  });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", normalizePhone(from));
  const callback = args.statusCallback?.trim() ||
    Deno.env.get("TWILIO_STATUS_CALLBACK_PUBLIC_URL")?.trim() || "";
  if (callback) form.set("StatusCallback", callback);
  const response = await (args.fetchImpl ?? fetch)(
    `${TWILIO_API_BASE}/Accounts/${
      encodeURIComponent(accountSid)
    }/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${
          bytesToBase64(new TextEncoder().encode(`${accountSid}:${authToken}`))
        }`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );
  const raw = await readBoundedText(response, MAX_PROVIDER_RESPONSE_BYTES);
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw: raw.slice(0, 1000) };
  }
  if (!response.ok) {
    const error: any = new Error(
      `twilio_send_failed_${response.status}:${
        String(payload.message ?? "unknown")
      }`,
    );
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    error.payload = payload;
    throw error;
  }
  const sid = String(payload.sid ?? "");
  if (!sid) throw new Error("twilio_send_missing_sid");
  return { sid, status: String(payload.status ?? "sent"), payload };
}

export async function downloadTwilioMediaForLaunch(admin: any, args: {
  url: string;
  contentType: string;
  phoneHash: string;
  messageSid: string;
  index: number;
}): Promise<
  { publicUrl: string; path: string; contentType: string; byteLength: number }
> {
  const allowed: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const declared = args.contentType.split(";")[0].trim().toLowerCase();
  if (!allowed[declared]) throw new Error("unsupported_twilio_media_type");
  const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
  const mediaUrl = new URL(args.url);
  if (
    mediaUrl.protocol !== "https:" || !/\.twilio\.com$/i.test(mediaUrl.hostname)
  ) throw new Error("untrusted_twilio_media_url");
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${
        bytesToBase64(new TextEncoder().encode(`${accountSid}:${authToken}`))
      }`,
    },
  });
  if (!response.ok) {
    throw new Error(`twilio_media_download_failed_${response.status}`);
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 10 * 1024 * 1024) {
    throw new Error("twilio_media_too_large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error("twilio_media_size_invalid");
  }
  const actual = (response.headers.get("content-type") ?? declared).split(
    ";",
  )[0].trim().toLowerCase();
  if (!allowed[actual]) throw new Error("unsupported_twilio_media_type");
  const path = `sms/${
    args.phoneHash.slice(0, 24)
  }/${args.messageSid}-${args.index}.${allowed[actual]}`;
  const upload = await admin.storage.from("token-logos").upload(path, bytes, {
    contentType: actual,
    cacheControl: "31536000",
    upsert: true,
  });
  if (upload.error) throw upload.error;
  const publicResult = admin.storage.from("token-logos").getPublicUrl(path);
  const publicUrl = publicResult.data?.publicUrl;
  if (!publicUrl) throw new Error("twilio_media_public_url_missing");
  return { publicUrl, path, contentType: actual, byteLength: bytes.byteLength };
}

export async function upsertSmsAccount(
  admin: any,
  phoneE164: string,
  phoneHash: string,
): Promise<SmsLinkedAccount> {
  const result = await admin.from("sms_accounts").upsert({
    phone_e164: phoneE164,
    phone_hash: phoneHash,
    last_inbound_at: new Date().toISOString(),
  }, { onConflict: "phone_e164" }).select("*").single();
  if (result.error) throw result.error;
  return result.data as SmsLinkedAccount;
}

export async function getLinkedSmsAccount(
  admin: any,
  phoneHash: string,
): Promise<SmsLinkedAccount | null> {
  const result = await admin.from("sms_accounts").select("*").eq(
    "phone_hash",
    phoneHash,
  ).maybeSingle();
  if (result.error) throw result.error;
  const account = result.data as SmsLinkedAccount | null;
  return account?.user_id && account.opt_in_status === "linked" &&
      !account.opted_out_at
    ? account
    : null;
}

export async function createSmsLoginLink(
  admin: any,
  args: { phoneE164: string; phoneHash: string; source?: string },
): Promise<{ token: string; url: string; expires_at: string }> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const ttl = positiveIntegerEnv(
    "LINKR_SMS_LOGIN_TOKEN_TTL_SECONDS",
    DEFAULT_LINK_TTL_SECONDS,
    60,
    3600,
  );
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await admin.from("sms_link_tokens").update({ status: "cancelled" }).eq(
    "phone_hash",
    args.phoneHash,
  ).eq("status", "pending");
  const result = await admin.from("sms_link_tokens").insert({
    token_hash: tokenHash,
    phone_hash: args.phoneHash,
    phone_e164: args.phoneE164,
    expires_at: expiresAt,
    metadata: { source: args.source ?? "sms" },
  });
  if (result.error) throw result.error;
  const base = (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL") ||
    "https://linkr.cash").replace(/\/$/, "");
  return {
    token,
    url: `${base}/sms/auth?sms_link=${encodeURIComponent(token)}`,
    expires_at: expiresAt,
  };
}

export async function completeSmsLinkToken(
  admin: any,
  args: { token: string; userId: string },
): Promise<SmsLinkedAccount> {
  const tokenHash = await sha256Hex(args.token);
  const now = new Date().toISOString();
  const pending = await admin.from("sms_link_tokens").select("*").eq(
    "token_hash",
    tokenHash,
  ).eq("status", "pending").maybeSingle();
  if (pending.error) throw pending.error;
  if (!pending.data) throw new Error("sms_link_token_invalid");
  if (Date.parse(pending.data.expires_at) <= Date.now()) {
    await admin.from("sms_link_tokens").update({ status: "expired" }).eq(
      "id",
      pending.data.id,
    ).eq("status", "pending");
    throw new Error("sms_link_token_expired");
  }
  const claimed = await admin.from("sms_link_tokens").update({
    status: "used",
    user_id: args.userId,
    used_at: now,
  })
    .eq("id", pending.data.id).eq("status", "pending").select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) {
    throw claimed.error ?? new Error("sms_link_token_already_used");
  }
  const linked = await admin.from("sms_accounts").update({
    user_id: args.userId,
    linked_at: now,
    unlinked_at: null,
    opted_out_at: null,
    opt_in_status: "linked",
  }).eq("phone_hash", pending.data.phone_hash).select("*").single();
  if (linked.error) throw linked.error;
  return linked.data as SmsLinkedAccount;
}

export async function unlinkSmsAccount(
  admin: any,
  phoneHash: string,
  optedOut = false,
): Promise<void> {
  const now = new Date().toISOString();
  const update = await admin.from("sms_accounts").update({
    user_id: null,
    unlinked_at: now,
    opted_out_at: optedOut ? now : null,
    opt_in_status: optedOut ? "opted_out" : "implicit_inbound",
  }).eq("phone_hash", phoneHash);
  if (update.error) throw update.error;
  const tokens = await admin.from("sms_link_tokens").update({
    status: "cancelled",
  }).eq("phone_hash", phoneHash).eq("status", "pending");
  if (tokens.error) throw tokens.error;
}

export function configuredMaxReplyChars(): number {
  return positiveIntegerEnv(
    "LINKR_SMS_MAX_REPLY_CHARS",
    DEFAULT_MAX_REPLY_CHARS,
    160,
    4000,
  );
}

export function smsWorkAcceptanceInput(args: {
  messageSid: string;
  userId: string;
  surfaceConversationId: string;
}): Record<string, unknown> {
  return {
    p_idempotency_key: `sms-inbound:${args.messageSid}`,
    p_source_surface: "sms",
    p_source_event_id: args.messageSid,
    p_user_id: args.userId,
    p_conversation_id: null,
    p_request_type: "conversation_turn",
    p_route: "sms.turn",
    p_priority: 80,
    p_resource_type: "conversation",
    p_resource_key: `sms:${args.surfaceConversationId}`,
    p_payload: {
      message_sid: args.messageSid,
      surface_conversation_id: args.surfaceConversationId,
    },
    p_payload_ref: null,
    p_consumer_version: "worker-sms-turn-v1",
    p_execution_generation: 0,
  };
}

function twimlResponse(inner: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
    {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function first(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? "";
}
function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}
function positiveIntegerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(Deno.env.get(name) ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, parsed))
    : fallback;
}
function randomToken(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");
}
async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
async function readBoundedText(
  response: Response,
  limit: number,
): Promise<string> {
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > limit) throw new Error("twilio_response_too_large");
  return new TextDecoder().decode(buffer);
}
