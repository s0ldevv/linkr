// deno-lint-ignore-file no-explicit-any

import { copyLaunchLogoBytesToStorage } from "./robinhood_launch/media.ts";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const LINK_TOKEN_TTL_MS = 10 * 60_000;
const VERIFICATION_TOKEN_TTL_MS = 8 * 60_000;
const MAX_TELEGRAM_MESSAGE_CHARS = 3900;
const CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VERIFICATION_HANDOFF_PREFIX = "verify_";

export type TelegramUser = {
  id: number | string;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  [key: string]: unknown;
};

export type TelegramChat = {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  [key: string]: unknown;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number | string;
  message_thread_id?: number | string;
  from?: TelegramUser;
  chat?: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  new_chat_members?: TelegramUser[];
  reply_to_message?: TelegramMessage;
  [key: string]: unknown;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
  [key: string]: unknown;
};

export type TelegramUpdate = {
  update_id: number | string;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  chat_join_request?: TelegramChatJoinRequest;
  [key: string]: unknown;
};

export type TelegramChatJoinRequest = {
  chat: TelegramChat;
  from: TelegramUser;
  user_chat_id?: number | string;
  date?: number;
  invite_link?: Record<string, unknown>;
  bio?: string;
  [key: string]: unknown;
};

export type TelegramLinkedAccount = {
  id: string;
  telegram_user_id: string;
  user_id: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  linked_at?: string | null;
};

export type TelegramUnlinkResult = {
  unlinked: boolean;
  account: Record<string, unknown> | null;
};

export function telegramId(value: unknown): string {
  return String(value ?? "").trim();
}

export function botUsername(): string {
  return String(Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "LinkrCashBot")
    .replace(/^@/, "")
    .trim();
}

export function botDeepLink(payload?: string | null): string {
  const base = `https://t.me/${botUsername()}`;
  const clean = String(payload ?? "").trim();
  return clean ? `${base}?start=${encodeURIComponent(clean)}` : base;
}

export function verifyTelegramWebhookRequest(req: Request): boolean {
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")?.trim() ?? "";
  const actual = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!expected || !actual || expected.length > 256 || actual.length > 256) {
    return false;
  }
  const expectedBytes = new TextEncoder().encode(expected);
  const actualBytes = new TextEncoder().encode(actual);
  let difference = expectedBytes.length ^ actualBytes.length;
  const length = Math.max(expectedBytes.length, actualBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (actualBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function callTelegramApi<T = any>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = requiredEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      `telegram_${method}_failed_${response.status}:${
        String(payload?.description ?? "unknown")
      }`,
    );
  }
  return payload as T;
}

export async function sendTelegramMessage(args: {
  chat_id: string;
  text: string;
  message_thread_id?: string | null;
  reply_to_message_id?: string | number | null;
  reply_markup?: Record<string, unknown> | null;
  disable_web_page_preview?: boolean;
}) {
  const chunks = splitTelegramText(args.text);
  let last: any = null;
  for (let index = 0; index < chunks.length; index += 1) {
    const isLast = index === chunks.length - 1;
    last = await callTelegramApi("sendMessage", {
      chat_id: args.chat_id,
      text: chunks[index],
      message_thread_id: args.message_thread_id || undefined,
      reply_to_message_id: index === 0
        ? args.reply_to_message_id || undefined
        : undefined,
      allow_sending_without_reply: true,
      disable_web_page_preview: args.disable_web_page_preview ?? true,
      reply_markup: isLast ? args.reply_markup || undefined : undefined,
    });
  }
  return last;
}

export async function deleteTelegramMessage(
  args: { chat_id: string; message_id: string },
) {
  return await callTelegramApi("deleteMessage", {
    chat_id: args.chat_id,
    message_id: args.message_id,
  });
}

export async function sendTelegramChatAction(args: {
  chat_id: string;
  action: "typing";
  message_thread_id?: string | null;
}) {
  return await callTelegramApi("sendChatAction", {
    chat_id: args.chat_id,
    action: args.action,
    message_thread_id: args.message_thread_id || undefined,
  });
}

export async function restrictTelegramChatMember(args: {
  chat_id: string;
  user_id: string;
  permissions: Record<string, boolean>;
  until_date?: number | null;
}) {
  return await callTelegramApi("restrictChatMember", {
    chat_id: args.chat_id,
    user_id: args.user_id,
    permissions: args.permissions,
    until_date: args.until_date || undefined,
    use_independent_chat_permissions: true,
  });
}

export async function approveTelegramChatJoinRequest(
  args: { chat_id: string; user_id: string },
) {
  return await callTelegramApi("approveChatJoinRequest", {
    chat_id: args.chat_id,
    user_id: args.user_id,
  });
}

export async function declineTelegramChatJoinRequest(
  args: { chat_id: string; user_id: string },
) {
  return await callTelegramApi("declineChatJoinRequest", {
    chat_id: args.chat_id,
    user_id: args.user_id,
  });
}

export async function createTelegramChatInviteLink(args: {
  chat_id: string;
  name?: string | null;
  expire_date?: number | null;
  member_limit?: number | null;
  creates_join_request?: boolean | null;
}) {
  const response = await callTelegramApi<{ result?: { invite_link?: string } }>(
    "createChatInviteLink",
    {
      chat_id: args.chat_id,
      name: args.name || undefined,
      expire_date: args.expire_date || undefined,
      member_limit: args.member_limit || undefined,
      creates_join_request: args.creates_join_request ?? undefined,
    },
  );
  const inviteLink = String(response?.result?.invite_link ?? "").trim();
  if (!inviteLink) throw new Error("telegram_invite_link_missing");
  return inviteLink;
}

export async function answerTelegramCallbackQuery(args: {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}) {
  return await callTelegramApi("answerCallbackQuery", {
    callback_query_id: args.callback_query_id,
    text: args.text || undefined,
    show_alert: args.show_alert ?? false,
  });
}

export async function editTelegramMessageReplyMarkup(args: {
  chat_id: string;
  message_id: string | number;
  reply_markup?: Record<string, unknown> | null;
}) {
  return await callTelegramApi("editMessageReplyMarkup", {
    chat_id: args.chat_id,
    message_id: args.message_id,
    reply_markup: args.reply_markup || undefined,
  });
}

export async function setTelegramBotCommands() {
  return await callTelegramApi("setMyCommands", {
    commands: [
      { command: "start", description: "Start Linkr on Telegram" },
      { command: "login", description: "Connect your X account" },
      { command: "logout", description: "Disconnect your X account" },
      { command: "status", description: "Show connection status" },
      { command: "help", description: "Show what Linkr can do" },
    ],
  });
}

export async function upsertTelegramAccount(
  admin: any,
  user: TelegramUser | null | undefined,
) {
  if (!user?.id) return null;
  const row = {
    telegram_user_id: telegramId(user.id),
    username: nullableText(user.username)?.replace(/^@/, "") ?? null,
    first_name: nullableText(user.first_name),
    last_name: nullableText(user.last_name),
    language_code: nullableText(user.language_code),
    is_bot: Boolean(user.is_bot),
    metadata: redactTelegramUser(user),
  };
  const { data, error } = await admin
    .from("telegram_accounts")
    .upsert(row, { onConflict: "telegram_user_id" })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertTelegramChat(
  admin: any,
  chat: TelegramChat | null | undefined,
) {
  if (!chat?.id) return null;
  const row = {
    telegram_chat_id: telegramId(chat.id),
    type: normalizeChatType(chat.type),
    title: nullableText(chat.title),
    username: nullableText(chat.username)?.replace(/^@/, "") ?? null,
    first_name: nullableText(chat.first_name),
    last_name: nullableText(chat.last_name),
    last_message_at: new Date().toISOString(),
    metadata: redactTelegramChat(chat),
  };
  const { data, error } = await admin
    .from("telegram_chats")
    .upsert(row, { onConflict: "telegram_chat_id" })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLinkedTelegramAccount(
  admin: any,
  telegramUserId: string,
): Promise<TelegramLinkedAccount | null> {
  const { data, error } = await admin
    .from("telegram_accounts")
    .select(
      "id,telegram_user_id,user_id,username,first_name,last_name,linked_at",
    )
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.user_id) return null;
  return data;
}

export async function unlinkTelegramAccount(
  admin: any,
  telegramUserId: string,
): Promise<TelegramUnlinkResult> {
  const { data: account, error: accountError } = await admin
    .from("telegram_accounts")
    .select("id,telegram_user_id,user_id,metadata")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account?.user_id) return { unlinked: false, account: account ?? null };

  const now = new Date().toISOString();
  const metadata =
    account.metadata && typeof account.metadata === "object" &&
      !Array.isArray(account.metadata)
      ? account.metadata
      : {};

  const expiredTokens = await admin
    .from("telegram_link_tokens")
    .update({ status: "expired" })
    .eq("telegram_user_id", telegramUserId)
    .eq("status", "pending");
  if (expiredTokens.error) throw expiredTokens.error;

  const { data, error } = await admin
    .from("telegram_accounts")
    .update({
      user_id: null,
      unlinked_at: now,
      metadata: {
        ...metadata,
        last_unlinked_at: now,
        last_unlink_source: "telegram_logout",
      },
    })
    .eq("telegram_user_id", telegramUserId)
    .eq("user_id", account.user_id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return { unlinked: Boolean(data), account: data ?? account };
}

export async function createTelegramLoginLink(
  admin: any,
  args: {
    telegramUserId: string;
    telegramChatId: string;
    messageThreadId?: string | null;
    source?: string | null;
  },
) {
  await admin
    .from("telegram_link_tokens")
    .update({ status: "expired" })
    .eq("telegram_user_id", args.telegramUserId)
    .eq("status", "pending");

  const token = randomBase64Url(24);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("telegram_link_tokens")
    .insert({
      token_hash: tokenHash,
      telegram_user_id: args.telegramUserId,
      telegram_chat_id: args.telegramChatId,
      expires_at: expiresAt,
      metadata: {
        message_thread_id: args.messageThreadId ?? null,
        source: args.source ?? "telegram_login",
      },
    })
    .select("*")
    .single();
  if (error) throw error;
  return {
    token,
    expires_at: expiresAt,
    url: xOAuthTelegramLinkUrl(token),
    row: data,
  };
}

export async function createTelegramVerificationChallenge(
  admin: any,
  args: {
    telegramUserId: string;
    telegramChatId: string;
    messageThreadId?: string | null;
    source?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  await admin
    .from("telegram_verification_challenges")
    .update({ status: "expired" })
    .eq("telegram_user_id", args.telegramUserId)
    .eq("telegram_chat_id", args.telegramChatId)
    .eq("status", "pending");

  const token = randomBase64Url(24);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)
    .toISOString();
  const captchaCode = randomCaptchaCode();
  const sliderTarget = randomInt(72, 93);
  const { data, error } = await admin
    .from("telegram_verification_challenges")
    .insert({
      token_hash: tokenHash,
      telegram_user_id: args.telegramUserId,
      telegram_chat_id: args.telegramChatId,
      captcha_code: captchaCode,
      slider_target: sliderTarget,
      source: args.source ?? "telegram_join",
      expires_at: expiresAt,
      metadata: {
        ...(args.metadata ?? {}),
        message_thread_id: args.messageThreadId ?? null,
      },
    })
    .select("*")
    .single();
  if (error) throw error;
  return {
    token,
    expires_at: expiresAt,
    url: telegramVerificationUrl(token),
    row: data,
  };
}

export async function completeTelegramLinkToken(
  admin: any,
  args: {
    token: string;
    userId: string;
    xUsername?: string | null;
  },
) {
  const tokenHash = await sha256Hex(args.token);
  const { data: link, error } = await admin
    .from("telegram_link_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!link) throw new Error("telegram_link_token_not_found");
  if (link.status !== "pending") {
    throw new Error("telegram_link_token_already_used");
  }
  if (new Date(link.expires_at).getTime() < Date.now()) {
    await admin.from("telegram_link_tokens").update({ status: "expired" }).eq(
      "id",
      link.id,
    );
    throw new Error("telegram_link_token_expired");
  }

  const now = new Date().toISOString();
  const metadata = {
    ...(link.metadata ?? {}),
    x_username: args.xUsername ?? null,
    linked_at: now,
  };
  const account = await admin
    .from("telegram_accounts")
    .update({
      user_id: args.userId,
      linked_at: now,
      unlinked_at: null,
      metadata,
    })
    .eq("telegram_user_id", link.telegram_user_id)
    .select("*")
    .maybeSingle();
  if (account.error) throw account.error;

  const updated = await admin
    .from("telegram_link_tokens")
    .update({
      status: "used",
      user_id: args.userId,
      used_at: now,
      metadata,
    })
    .eq("id", link.id)
    .select("*")
    .maybeSingle();
  if (updated.error) throw updated.error;

  return {
    link: updated.data,
    account: account.data,
    telegram_chat_id: link.telegram_chat_id,
    telegram_user_id: link.telegram_user_id,
    message_thread_id: link.metadata?.message_thread_id ?? null,
  };
}

export async function uploadTelegramPhotoForLaunch(
  admin: any,
  args: {
    photo: TelegramPhotoSize;
    telegramUserId: string;
    telegramMessageId: string;
  },
) {
  const file = await callTelegramApi<{ result?: { file_path?: string } }>(
    "getFile",
    {
      file_id: args.photo.file_id,
    },
  );
  const filePath = String(file?.result?.file_path ?? "").trim();
  if (!filePath) throw new Error("telegram_file_path_missing");

  const token = requiredEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(
    `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`,
  );
  if (!response.ok) {
    throw new Error(`telegram_file_fetch_failed_${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = normalizeImageContentType(
    response.headers.get("content-type"),
    filePath,
  );
  const extension = extensionForContentType(contentType);
  const unique = sanitizePathSegment(
    args.photo.file_unique_id ?? args.photo.file_id,
  );
  const path = `telegram/${sanitizePathSegment(args.telegramUserId)}/${
    sanitizePathSegment(
      args.telegramMessageId,
    )
  }-${unique}.${extension}`;

  return await copyLaunchLogoBytesToStorage(admin, {
    sourceUrl: `telegram:${args.photo.file_id}`,
    bytes,
    contentType,
    byteLength: bytes.byteLength,
    extension,
    filename: `telegram.${extension}`,
    storagePath: path,
  });
}

export function bestTelegramPhoto(
  message: TelegramMessage,
): TelegramPhotoSize | null {
  const photos = Array.isArray(message.photo) ? message.photo : [];
  if (photos.length === 0) return null;
  return [...photos].sort((a, b) =>
    Number(b.file_size ?? 0) - Number(a.file_size ?? 0)
  )[0] ?? null;
}

export function telegramLoginKeyboard(url: string) {
  return {
    inline_keyboard: [[{ text: "Connect X account", url }]],
  };
}

export function telegramLogoutKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Confirm logout", callback_data: "logout:confirm" },
        { text: "Keep connected", callback_data: "logout:cancel" },
      ],
    ],
  };
}

export function telegramVerificationKeyboard(url: string) {
  return {
    inline_keyboard: [[{ text: "Verify with Linkr", url }]],
  };
}

export function telegramVerificationHandoffPayload(
  challengeId: string,
): string {
  const compactId = String(challengeId ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/.test(compactId)) {
    throw new Error("telegram_verification_handoff_id_invalid");
  }
  return `${VERIFICATION_HANDOFF_PREFIX}${compactId}`;
}

export function parseTelegramVerificationHandoffPayload(
  payload: string | null,
): string | null {
  const match = String(payload ?? "")
    .trim()
    .toLowerCase()
    .match(/^verify_([a-f0-9]{32})$/);
  if (!match) return null;
  const compactId = match[1];
  return [
    compactId.slice(0, 8),
    compactId.slice(8, 12),
    compactId.slice(12, 16),
    compactId.slice(16, 20),
    compactId.slice(20),
  ].join("-");
}

export function telegramPendingActionKeyboard(pendingActionId: string) {
  return {
    inline_keyboard: [
      [
        { text: "Confirm", callback_data: `confirm:${pendingActionId}` },
        { text: "Cancel", callback_data: `cancel:${pendingActionId}` },
      ],
    ],
  };
}

export function splitTelegramText(text: string): string[] {
  const clean = String(text || "Done.").trim() || "Done.";
  if (clean.length <= MAX_TELEGRAM_MESSAGE_CHARS) return [clean];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > MAX_TELEGRAM_MESSAGE_CHARS) {
    let cut = rest.lastIndexOf("\n", MAX_TELEGRAM_MESSAGE_CHARS);
    if (cut < 1200) cut = rest.lastIndexOf(" ", MAX_TELEGRAM_MESSAGE_CHARS);
    if (cut < 1200) cut = MAX_TELEGRAM_MESSAGE_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function xOAuthTelegramLinkUrl(token: string): string {
  const url = new URL("/telegram/auth", appOrigin());
  url.searchParams.set("telegram_link", token);
  return url.toString();
}

function telegramVerificationUrl(token: string): string {
  const url = new URL("/telegram/verify", appOrigin());
  url.searchParams.set("verification", token);
  return url.toString();
}

export async function hashTelegramToken(token: string): Promise<string> {
  return await sha256Hex(token);
}

function appOrigin(): string {
  return String(
    Deno.env.get("LINKR_APP_URL") ??
      Deno.env.get("PUBLIC_SITE_URL") ??
      Deno.env.get("APP_ORIGIN") ??
      "https://www.linkr.cash",
  ).replace(/\/+$/g, "");
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 280) : null;
}

function normalizeChatType(value: unknown): string {
  const type = String(value ?? "unknown")
    .trim()
    .toLowerCase();
  return ["private", "group", "supergroup", "channel"].includes(type)
    ? type
    : "unknown";
}

function redactTelegramUser(user: TelegramUser) {
  return {
    id: telegramId(user.id),
    username: nullableText(user.username),
    first_name: nullableText(user.first_name),
    last_name: nullableText(user.last_name),
    language_code: nullableText(user.language_code),
    is_bot: Boolean(user.is_bot),
  };
}

function redactTelegramChat(chat: TelegramChat) {
  return {
    id: telegramId(chat.id),
    type: normalizeChatType(chat.type),
    title: nullableText(chat.title),
    username: nullableText(chat.username),
    first_name: nullableText(chat.first_name),
    last_name: nullableText(chat.last_name),
  };
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomCaptchaCode(): string {
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += CAPTCHA_ALPHABET[randomInt(0, CAPTCHA_ALPHABET.length - 1)];
  }
  return code;
}

function randomInt(min: number, max: number): number {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  const range = upper - lower + 1;
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return lower + (bytes[0] % range);
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

function normalizeImageContentType(
  header: string | null,
  filePath: string,
): string {
  const raw = String(header ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]
      .includes(raw)
  ) {
    return raw === "image/jpg" ? "image/jpeg" : raw;
  }
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function sanitizePathSegment(value: unknown): string {
  const safe = String(value ?? "")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return safe || "telegram";
}
