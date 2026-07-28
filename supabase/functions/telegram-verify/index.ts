// deno-lint-ignore-file no-explicit-any

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { readJsonBody } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  approveTelegramChatJoinRequest,
  deleteTelegramMessage,
  hashTelegramToken,
  restrictTelegramChatMember,
  sendTelegramMessage,
} from "../_shared/telegram.ts";

const MAX_ATTEMPTS = 5;

type VerifyAction = "load" | "verify";

type VerificationChallenge = {
  id: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  status: string;
  captcha_code: string;
  slider_target: number;
  attempts: number;
  source: string;
  invite_link?: string | null;
  expires_at: string;
  metadata?: Record<string, unknown> | null;
  failed_at?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: any = null;
  try {
    body = await readJsonBody(req, 64 * 1024);
  } catch (_) {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const action = normalizeAction(body?.action);
  const token = String(body?.token ?? "").trim();
  if (!token) return jsonResponse({ error: "missing_token" }, { status: 400 });

  const admin = serviceClient();
  const challenge = await loadChallenge(admin, token);
  if (!challenge) {
    return jsonResponse({ ok: false, error: "challenge_not_found" });
  }

  if (challenge.status === "pending" && isExpired(challenge)) {
    await admin
      .from("telegram_verification_challenges")
      .update({ status: "expired", failed_at: new Date().toISOString() })
      .eq("id", challenge.id)
      .eq("status", "pending");
    return jsonResponse({
      ok: false,
      error: "challenge_expired",
      status: "expired",
    });
  }

  if (action === "load") {
    if (challenge.status !== "pending" && challenge.status !== "verified") {
      return jsonResponse({
        ok: false,
        error: "challenge_not_pending",
        status: challenge.status,
      });
    }
    return jsonResponse({
      ok: true,
      status: challenge.status,
      challenge: publicChallenge(challenge, await loadChat(admin, challenge.telegram_chat_id)),
    });
  }

  if (challenge.status === "verified") {
    return jsonResponse({
      ok: true,
      status: "verified",
      invite_link: challenge.invite_link ?? null,
    });
  }
  if (challenge.status !== "pending") {
    return jsonResponse({
      ok: false,
      error: "challenge_not_pending",
      status: challenge.status,
    });
  }

  const captcha = normalizeCaptcha(body?.captcha);
  const sliderComplete = Boolean(body?.sliderComplete);
  if (!sliderComplete) {
    return jsonResponse({
      ok: false,
      error: "slider_incomplete",
      status: "pending",
    });
  }

  if (captcha !== challenge.captcha_code) {
    const attempts = Number(challenge.attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await admin
      .from("telegram_verification_challenges")
      .update({
        attempts,
        status: failed ? "failed" : "pending",
        failed_at: failed ? new Date().toISOString() : (challenge.failed_at ?? null),
      })
      .eq("id", challenge.id)
      .eq("status", "pending");
    return jsonResponse({
      ok: false,
      error: failed ? "challenge_failed" : "captcha_mismatch",
      status: failed ? "failed" : "pending",
      attempts_remaining: Math.max(0, MAX_ATTEMPTS - attempts),
    });
  }

  let unlockMetadata: Record<string, unknown> = {};
  try {
    unlockMetadata = await unlockTelegramAccess(challenge);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("telegram_unlock_failed", {
      challenge_id: challenge.id,
      chat_id: challenge.telegram_chat_id,
      user_id: challenge.telegram_user_id,
      source: challenge.source,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    await admin
      .from("telegram_verification_challenges")
      .update({
        metadata: {
          ...(challenge.metadata ?? {}),
          unlock_error: message.slice(0, 500),
          unlock_failed_at: new Date().toISOString(),
        },
      })
      .eq("id", challenge.id);
    return jsonResponse({
      ok: false,
      error: "telegram_unlock_failed",
      message: userSafeTelegramError(message),
      status: "pending",
    });
  }

  const now = new Date().toISOString();
  const updated = await admin
    .from("telegram_verification_challenges")
    .update({
      status: "verified",
      verified_at: now,
      metadata: {
        ...(challenge.metadata ?? {}),
        ...unlockMetadata,
        verified_at: now,
      },
    })
    .eq("id", challenge.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (updated.error) throw updated.error;

  if (updated.data) {
    const verifiedChallenge = updated.data as VerificationChallenge;
    await deleteGroupVerificationPrompt(verifiedChallenge).catch(() => null);

    const welcomeDelivery = await sendGroupWelcome(verifiedChallenge)
      .then(() => ({ status: "sent" as const, error: null }))
      .catch((error) => ({
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      }));
    await admin
      .from("telegram_verification_challenges")
      .update({
        metadata: {
          ...(verifiedChallenge.metadata ?? {}),
          group_welcome_delivery: welcomeDelivery.status,
          group_welcome_error: welcomeDelivery.error
            ? welcomeDelivery.error.slice(0, 500)
            : null,
          group_welcome_attempted_at: new Date().toISOString(),
        },
      })
      .eq("id", verifiedChallenge.id)
      .eq("status", "verified");

    await sendVerifiedNotice(admin, verifiedChallenge).catch(() => null);
  }

  return jsonResponse({
    ok: true,
    status: "verified",
    invite_link: updated.data?.invite_link ?? challenge.invite_link ?? null,
  });
});

function normalizeAction(value: unknown): VerifyAction {
  return String(value ?? "load")
    .trim()
    .toLowerCase() === "verify"
    ? "verify"
    : "load";
}

async function loadChallenge(admin: any, token: string): Promise<VerificationChallenge | null> {
  const tokenHash = await hashTelegramToken(token);
  const { data, error } = await admin
    .from("telegram_verification_challenges")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function loadChat(admin: any, telegramChatId: string) {
  const { data, error } = await admin
    .from("telegram_chats")
    .select("title,username,type")
    .eq("telegram_chat_id", telegramChatId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function publicChallenge(challenge: VerificationChallenge, chat: any) {
  return {
    status: challenge.status,
    captcha_code: challenge.captcha_code,
    slider_target: challenge.slider_target,
    attempts_remaining: Math.max(0, MAX_ATTEMPTS - Number(challenge.attempts ?? 0)),
    expires_at: challenge.expires_at,
    chat_title: chat?.title ?? chat?.username ?? "Linkr group",
  };
}

function isExpired(challenge: VerificationChallenge): boolean {
  return new Date(challenge.expires_at).getTime() <= Date.now();
}

function normalizeCaptcha(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function unlockTelegramAccess(
  challenge: VerificationChallenge,
): Promise<Record<string, unknown>> {
  if (challenge.source === "chat_join_request") {
    await approveTelegramChatJoinRequest({
      chat_id: challenge.telegram_chat_id,
      user_id: challenge.telegram_user_id,
    });
    console.log("telegram_unlock_success", {
      action: "approve_join_request",
      chat_id: challenge.telegram_chat_id,
      user_id: challenge.telegram_user_id,
    });
    return { unlock_action: "approve_join_request" };
  }

  await restrictTelegramChatMember({
    chat_id: challenge.telegram_chat_id,
    user_id: challenge.telegram_user_id,
    permissions: unlockedVerificationPermissions(),
  });
  console.log("telegram_unlock_success", {
    action: "restore_member_permissions",
    chat_id: challenge.telegram_chat_id,
    user_id: challenge.telegram_user_id,
  });
  return { unlock_action: "restore_member_permissions" };
}

async function sendVerifiedNotice(admin: any, challenge: VerificationChallenge) {
  const directChatId =
    String(challenge.metadata?.user_chat_id ?? "").trim() || challenge.telegram_user_id;
  const groupUrl = await telegramGroupUrl(admin, challenge).catch(() => null);
  await sendTelegramMessage({
    chat_id: directChatId,
    text:
      challenge.source === "chat_join_request"
        ? "Verified. Your Linkr group request has been approved."
        : "Verified. Your Linkr group access is unlocked.",
    reply_markup: groupUrl
      ? {
        inline_keyboard: [[{ text: "Open group", url: groupUrl }]],
      }
      : null,
  });
}

async function telegramGroupUrl(
  admin: any,
  challenge: VerificationChallenge,
): Promise<string | null> {
  const chat = await loadChat(admin, challenge.telegram_chat_id);
  const username = String(chat?.username ?? challenge.metadata?.chat_username ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 32);
  if (username) return `https://t.me/${username}`;

  return safeTelegramGroupUrl(challenge.invite_link) ??
    safeTelegramGroupUrl(challenge.metadata?.invite_link);
}

function safeTelegramGroupUrl(value: unknown): string | null {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? String((value as Record<string, unknown>).invite_link ?? "").trim()
    : String(value ?? "").trim();
  return /^(?:https:\/\/(?:t\.me|telegram\.me)\/|tg:\/\/)/i.test(candidate)
    ? candidate
    : null;
}

async function sendGroupWelcome(challenge: VerificationChallenge) {
  const username = String(challenge.metadata?.username ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 32);
  const displayName = String(challenge.metadata?.display_name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const memberName = username ? `@${username}` : displayName || "new member";
  const messageThreadId = String(challenge.metadata?.message_thread_id ?? "").trim() || null;

  await sendTelegramMessage({
    chat_id: challenge.telegram_chat_id,
    message_thread_id: messageThreadId,
    text: `Welcome ${memberName} to the group!`,
  });
}

async function deleteGroupVerificationPrompt(challenge: VerificationChallenge) {
  const chatId = String(challenge.metadata?.group_prompt_chat_id ?? "").trim();
  const messageId = String(challenge.metadata?.group_prompt_message_id ?? "").trim();
  if (!chatId || !messageId) return;
  await deleteTelegramMessage({ chat_id: chatId, message_id: messageId });
}

function unlockedVerificationPermissions(): Record<string, boolean> {
  return {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false,
  };
}

function userSafeTelegramError(message: string): string {
  if (/not enough rights|administrator|admin/i.test(message)) {
    return "Linkr needs Telegram admin permission to approve or unlock this group.";
  }
  if (/user not found|chat not found|member/i.test(message)) {
    return "Telegram could not find this pending group member.";
  }
  return "Telegram could not finish the group unlock yet.";
}
