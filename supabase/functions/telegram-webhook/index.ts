// deno-lint-ignore-file no-explicit-any

import {
  readJsonBody,
  requestBodyErrorResponse,
  serializeUnknownError,
} from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { processLinkrAgentTurn } from "../_shared/linkr_agent_runtime.ts";
import type {
  LinkrTurnInput,
  LinkrTurnOutputSink,
} from "../_shared/linkr_agent_runtime_types.ts";
import {
  cancelLinkrPendingAction,
  confirmAndExecuteLinkrPendingAction,
} from "../_shared/linkr_action_runtime.ts";
import {
  answerTelegramCallbackQuery,
  bestTelegramPhoto,
  botDeepLink,
  botUsername,
  createTelegramLoginLink,
  createTelegramVerificationChallenge,
  deleteTelegramMessage,
  editTelegramMessageReplyMarkup,
  getLinkedTelegramAccount,
  parseTelegramVerificationHandoffPayload,
  restrictTelegramChatMember,
  sendTelegramChatAction,
  sendTelegramMessage,
  type TelegramCallbackQuery,
  type TelegramChat,
  type TelegramChatJoinRequest,
  telegramId,
  telegramLoginKeyboard,
  telegramLogoutKeyboard,
  type TelegramMessage,
  telegramPendingActionKeyboard,
  telegramStartMenuKeyboard,
  type TelegramUpdate,
  type TelegramUser,
  telegramVerificationKeyboard,
  unlinkTelegramAccount,
  uploadTelegramPhotoForLaunch,
  upsertTelegramAccount,
  upsertTelegramChat,
  verifyTelegramWebhookRequest,
} from "../_shared/telegram.ts";
import { capabilityPromptSummary } from "../_shared/linkr_capabilities.ts";
import { terminalNaturalFallbackReply } from "../_shared/linkr_terminal_natural.ts";
import { acceptShadowWork } from "../_shared/shadow_queue.ts";
import { getActiveBanForAuthUser } from "../_shared/x_bans.ts";

const PRIVATE_ACTION_RE =
  /\b(wallet|balance|portfolio|history|buy|sell|send|transfer|launch|create coin|make a coin|liquidity|schedule|claim|creator rewards?|cashback|api key|private key|export)\b/i;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!verifyTelegramWebhookRequest(req)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const admin = serviceClient();
  let update: TelegramUpdate;
  try {
    if (
      !req.headers.get("content-type")?.toLowerCase().startsWith(
        "application/json",
      )
    ) {
      return jsonResponse({ error: "content_type_required" }, { status: 415 });
    }
    update = await readJsonBody(req, 1024 * 1024) as TelegramUpdate;
  } catch (error) {
    return requestBodyErrorResponse(error) ??
      jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const updateId = telegramId(update.update_id);
  if (!updateId) return jsonResponse({ ok: true, status: "ignored" });

  const insertUpdate = await insertTelegramUpdate(admin, updateId, update);
  if (insertUpdate !== "accepted") {
    return jsonResponse({ ok: true, status: insertUpdate });
  }

  await acceptTelegramShadow(admin, updateId, update).catch((error) => {
    console.error(
      "telegram_shadow_accept_failed",
      serializeUnknownError(error),
    );
  });

  try {
    const handled = await handleUpdate(admin, update);
    await finishTelegramUpdate(
      admin,
      updateId,
      handled ? "processed" : "ignored",
    );
    return jsonResponse({
      ok: true,
      status: handled ? "processed" : "ignored",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTelegramUpdate(admin, updateId, "failed", message).catch(
      () => {},
    );
    // Telegram retries non-2xx webhook responses. Never acknowledge failed
    // processing as success; the acceptance RPC reacquires failed updates.
    return jsonResponse({ ok: false, status: "failed" }, { status: 503 });
  }
});

async function acceptTelegramShadow(
  admin: any,
  updateId: string,
  update: TelegramUpdate,
) {
  const target = update.callback_query?.message ?? update.message ??
    update.edited_message ?? null;
  const joinRequest = update.chat_join_request ?? null;
  const chatId = telegramId(joinRequest?.chat?.id ?? target?.chat?.id) || null;
  const isControl = Boolean(
    update.callback_query || joinRequest ||
      target?.new_chat_members?.length,
  );
  await acceptShadowWork(admin, {
    p_idempotency_key: `shadow:telegram:${updateId}`,
    p_source_surface: "telegram",
    p_source_event_id: updateId,
    p_user_id: null,
    p_conversation_id: null,
    p_request_type: isControl ? "telegram_control" : "conversation_turn",
    p_route: isControl ? "telegram.control" : "conversation.turn",
    p_priority: isControl ? 90 : 50,
    p_resource_type: chatId ? "conversation" : null,
    p_resource_key: chatId ? `telegram:${chatId}` : null,
    p_payload: { telegram_update_id: updateId },
    p_payload_ref: null,
    p_payload_hash: null,
  });
}

async function handleUpdate(
  admin: any,
  update: TelegramUpdate,
): Promise<boolean> {
  if (update.callback_query) {
    await handleCallbackQuery(admin, update.callback_query);
    return true;
  }

  const message = update.message ?? null;
  if (update.chat_join_request) {
    await handleChatJoinRequest(admin, update.chat_join_request);
    return true;
  }

  if (!message?.chat) return false;

  if (message.from) await upsertTelegramAccount(admin, message.from);
  await upsertTelegramChat(admin, message.chat);

  const chatId = telegramId(message.chat.id);
  const chatType = normalizeChatType(message.chat);
  const newMembers = Array.isArray(message.new_chat_members)
    ? message.new_chat_members.filter((member) => member?.id && !member.is_bot)
    : [];
  if (chatType !== "private" && newMembers.length > 0) {
    await handleNewChatMembers(admin, message, newMembers);
    return true;
  }

  if (!message.from) return false;

  const telegramUserId = telegramId(message.from.id);
  const rawText = messageText(message);
  const text = cleanAddressedText(rawText, chatType);
  if (!text && !bestTelegramPhoto(message)) return false;

  if (chatType !== "private" && !isAddressedInGroup(message, rawText)) {
    return false;
  }

  const command = parseCommand(text);
  if (command === "help") {
    await sendTelegramMessage({
      chat_id: chatId,
      message_thread_id: threadId(message),
      reply_to_message_id: replyMessageId(chatType, message),
      text: helpText(chatType),
    });
    return true;
  }

  if (chatType !== "private") {
    await handleGroupMessage(admin, message, text);
    return true;
  }

  if (command === "start") {
    const payload = startPayload(text);
    if (await sendVerificationHandoffPrompt(admin, message, payload)) {
      return true;
    }
    await sendStartMenu(admin, message);
    return true;
  }

  if (command === "login") {
    await sendLoginPrompt(admin, message);
    return true;
  }

  const linked = await getLinkedTelegramAccount(admin, telegramUserId);
  if (command === "logout") {
    await sendLogoutPrompt(message, linked);
    return true;
  }

  if (command === "status") {
    const activeBan = linked?.user_id
      ? (await getActiveBanForAuthUser(admin, linked.user_id)).ban
      : null;
    await sendTelegramMessage({
      chat_id: chatId,
      text: linked?.user_id
        ? activeBan
          ? `Connected${
            linked.username ? ` as @${linked.username}` : ""
          }, but this X account is currently banned from Linkr. Use /logout to disconnect Telegram.`
          : `Connected${
            linked.username ? ` as @${linked.username}` : ""
          }. You can chat with Linkr here. Use /logout to disconnect Telegram.`
        : "Not connected yet. Use /login to connect your X account.",
    });
    return true;
  }

  if (!linked?.user_id) {
    await sendLoginPrompt(admin, message);
    return true;
  }

  await runPrivateTelegramTurn(admin, message, linked.user_id, text);
  return true;
}

async function handleGroupMessage(
  admin: any,
  message: TelegramMessage,
  text: string,
) {
  const chatId = telegramId(message.chat?.id);
  if (!chatId) return;
  const isVerified = await ensureGroupMemberVerified(admin, message);
  if (!isVerified) {
    return;
  }
  const publicText = stripCommandAddress(text);
  if (
    !publicText || parseCommand(publicText) === "start" ||
    parseCommand(publicText) === "login"
  ) {
    await sendTelegramMessage({
      chat_id: chatId,
      message_thread_id: threadId(message),
      reply_to_message_id: replyMessageId("group", message),
      text:
        `DM me to connect your X account and use the private Linkr terminal: ${
          botDeepLink(
            "login",
          )
        }`,
    });
    return;
  }

  if (PRIVATE_ACTION_RE.test(publicText)) {
    await sendTelegramMessage({
      chat_id: chatId,
      message_thread_id: threadId(message),
      reply_to_message_id: replyMessageId("group", message),
      text:
        "For wallet balances, launches, transfers, trades, irreversible token burns, rewards, schedules, or anything account-specific, DM me. I will not expose private Linkr actions in a group chat.",
    });
    return;
  }

  await sendTelegramMessage({
    chat_id: chatId,
    message_thread_id: threadId(message),
    reply_to_message_id: replyMessageId("group", message),
    text: publicGroupReply(publicText),
  });
}

async function ensureGroupMemberVerified(
  admin: any,
  message: TelegramMessage,
): Promise<boolean> {
  const chatId = telegramId(message.chat?.id);
  const telegramUserId = telegramId(message.from?.id);
  if (!chatId || !telegramUserId || message.from?.is_bot) return false;

  const challenge = await loadLatestGroupVerificationChallenge(admin, {
    telegramChatId: chatId,
    telegramUserId,
  });

  if (challenge?.status === "verified") return true;
  if (
    challenge?.status !== "pending" || isVerificationChallengeExpired(challenge)
  ) {
    const created = await createTelegramVerificationChallenge(admin, {
      telegramUserId,
      telegramChatId: chatId,
      messageThreadId: threadId(message),
      source: "group_message",
      metadata: {
        display_name: message.from
          ? telegramDisplayName(message.from)
          : "Unknown",
        username: message.from?.username ?? null,
        chat_title: message.chat?.title ?? null,
        chat_username: message.chat?.username ?? null,
      },
    });
    const privateDelivery = await sendTelegramMessage({
      chat_id: telegramUserId,
      text: privateVerificationText(message.chat?.title),
      reply_markup: telegramVerificationKeyboard(created.url),
    })
      .then(() => ({ status: "sent" as const, error: null }))
      .catch((error) => ({
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      }));
    if (privateDelivery.status === "failed") {
      await sendTelegramMessage({
        chat_id: chatId,
        message_thread_id: threadId(message),
        text:
          `I could not DM you. Please open a private chat with Linkr first: ${
            botDeepLink("start")
          }`,
        reply_to_message_id: replyMessageId("group", message),
      }).catch(() => null);
    }

    await admin
      .from("telegram_verification_challenges")
      .update({
        metadata: {
          ...(created.row.metadata ?? {}),
          private_delivery: privateDelivery.status,
          private_delivery_error: privateDelivery.error
            ? privateDelivery.error.slice(0, 500)
            : null,
          private_delivery_attempted_at: new Date().toISOString(),
          group_prompt_source: "group_message",
        },
      })
      .eq("id", created.row.id)
      .eq("status", "pending");
  }

  await restrictTelegramChatMember({
    chat_id: chatId,
    user_id: telegramUserId,
    permissions: mutedVerificationPermissions(),
  }).catch((restrictError) => {
    console.error("telegram_group_message_restriction_failed", {
      chat_id: chatId,
      user_id: telegramUserId,
      from_username: message.from?.username,
      error: restrictError instanceof Error
        ? restrictError.message
        : String(restrictError),
      stack: restrictError instanceof Error ? restrictError.stack : undefined,
    });
  });
  return false;
}

async function loadLatestGroupVerificationChallenge(
  admin: any,
  options: { telegramChatId: string; telegramUserId: string },
): Promise<TelegramVerificationChallenge | null> {
  const { data, error } = await admin
    .from("telegram_verification_challenges")
    .select("id,status,expires_at,source,metadata")
    .eq("telegram_chat_id", options.telegramChatId)
    .eq("telegram_user_id", options.telegramUserId)
    .in("status", ["verified", "pending"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: String(data.id ?? ""),
    status: String(data.status ?? ""),
    expires_at: String(data.expires_at ?? ""),
    source: String(data.source ?? ""),
    metadata: data.metadata ?? null,
  };
}

function isVerificationChallengeExpired(
  challenge: TelegramVerificationChallenge,
) {
  return new Date(challenge.expires_at).getTime() <= Date.now();
}

async function handleChatJoinRequest(
  admin: any,
  joinRequest: TelegramChatJoinRequest,
) {
  const chatId = telegramId(joinRequest.chat?.id);
  const telegramUserId = telegramId(joinRequest.from?.id);
  if (!chatId || !telegramUserId || joinRequest.from?.is_bot) return;

  await upsertTelegramAccount(admin, joinRequest.from);
  await upsertTelegramChat(admin, joinRequest.chat);

  const challenge = await createTelegramVerificationChallenge(admin, {
    telegramUserId,
    telegramChatId: chatId,
    source: "chat_join_request",
    metadata: {
      user_chat_id: telegramId(joinRequest.user_chat_id) || null,
      display_name: telegramDisplayName(joinRequest.from),
      username: joinRequest.from.username ?? null,
      chat_title: joinRequest.chat.title ?? null,
      chat_username: joinRequest.chat.username ?? null,
      invite_link: joinRequest.invite_link ?? null,
    },
  });

  const directChatId = telegramId(joinRequest.user_chat_id) || telegramUserId;
  await sendTelegramMessage({
    chat_id: directChatId,
    text: privateVerificationText(joinRequest.chat.title),
    reply_markup: telegramVerificationKeyboard(challenge.url),
  });
}

async function handleNewChatMembers(
  admin: any,
  message: TelegramMessage,
  members: TelegramUser[],
) {
  const chatId = telegramId(message.chat?.id);
  if (!chatId) return;

  const serviceMessageId = telegramId(message.message_id);
  const serviceMessageDeletionAttemptedAt = new Date().toISOString();
  const serviceMessageDeletion = serviceMessageId
    ? await deleteTelegramMessage({
      chat_id: chatId,
      message_id: serviceMessageId,
    })
      .then(() => ({ status: "deleted" as const, error: null }))
      .catch((error) => ({
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      }))
    : { status: "skipped" as const, error: null };

  for (const member of members) {
    const telegramUserId = telegramId(member.id);
    if (!telegramUserId) continue;

    await upsertTelegramAccount(admin, member);
    await restrictTelegramChatMember({
      chat_id: chatId,
      user_id: telegramUserId,
      permissions: mutedVerificationPermissions(),
    }).catch((restrictError) => {
      console.error("telegram_new_member_restriction_failed", {
        chat_id: chatId,
        user_id: telegramUserId,
        username: member.username,
        error: restrictError instanceof Error
          ? restrictError.message
          : String(restrictError),
        stack: restrictError instanceof Error ? restrictError.stack : undefined,
      });
    });

    const name = telegramDisplayName(member);
    const challenge = await createTelegramVerificationChallenge(admin, {
      telegramUserId,
      telegramChatId: chatId,
      messageThreadId: threadId(message),
      source: "new_chat_member",
      metadata: {
        display_name: name,
        username: member.username ?? null,
        chat_title: message.chat?.title ?? null,
        chat_username: message.chat?.username ?? null,
        service_message_id: serviceMessageId,
        service_message_deletion: serviceMessageDeletion.status,
        service_message_deletion_error: serviceMessageDeletion.error
          ? serviceMessageDeletion.error.slice(0, 500)
          : null,
        service_message_deletion_attempted_at:
          serviceMessageDeletionAttemptedAt,
      },
    });

    const privateDelivery = await sendTelegramMessage({
      chat_id: telegramUserId,
      text: privateVerificationText(message.chat?.title),
      reply_markup: telegramVerificationKeyboard(challenge.url),
    })
      .then(() => ({ status: "sent" as const, error: null }))
      .catch((error) => ({
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      }));

    await admin
      .from("telegram_verification_challenges")
      .update({
        metadata: {
          ...(challenge.row.metadata ?? {}),
          private_delivery: privateDelivery.status,
          private_delivery_error: privateDelivery.error
            ? privateDelivery.error.slice(0, 500)
            : null,
          private_delivery_attempted_at: new Date().toISOString(),
        },
      })
      .eq("id", challenge.row.id);
  }
}

async function sendVerificationHandoffPrompt(
  admin: any,
  message: TelegramMessage,
  payload: string | null,
): Promise<boolean> {
  const challengeId = parseTelegramVerificationHandoffPayload(payload);
  if (!challengeId) return false;

  const telegramUserId = telegramId(message.from?.id);
  const chatId = telegramId(message.chat?.id);
  if (!telegramUserId || !chatId) return true;

  const pending = await admin
    .from("telegram_verification_challenges")
    .select("*")
    .eq("id", challengeId)
    .eq("telegram_user_id", telegramUserId)
    .eq("status", "pending")
    .maybeSingle();
  if (pending.error) throw pending.error;
  const challenge = pending.data;
  if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
    await sendTelegramMessage({
      chat_id: chatId,
      text:
        "This verification request has expired. Return to the group and try joining again.",
    });
    return true;
  }

  const metadata = recordMetadata(challenge.metadata);
  const replacement = await createTelegramVerificationChallenge(admin, {
    telegramUserId,
    telegramChatId: telegramId(challenge.telegram_chat_id),
    messageThreadId: telegramId(metadata.message_thread_id) || null,
    source: telegramId(challenge.source) || "new_chat_member",
    metadata: {
      ...metadata,
      private_delivery: "deep_link_handoff",
    },
  });
  await sendTelegramMessage({
    chat_id: chatId,
    text: privateVerificationText(metadata.chat_title),
    reply_markup: telegramVerificationKeyboard(replacement.url),
  });
  await deleteGroupVerificationPrompt(metadata);
  return true;
}

async function deleteGroupVerificationPrompt(
  metadata: Record<string, unknown>,
) {
  const chatId = telegramId(metadata.group_prompt_chat_id);
  const messageId = telegramId(metadata.group_prompt_message_id);
  if (!chatId || !messageId) return;
  await deleteTelegramMessage({ chat_id: chatId, message_id: messageId }).catch(
    () => null,
  );
}

function privateVerificationText(chatTitle: unknown): string {
  const groupName = String(chatTitle ?? "").trim() || "the Linkr group";
  return [
    `Verify to unlock ${groupName}.`,
    "Slide the control and solve the Linkr check. Your verification stays in this private chat.",
  ].join("\n\n");
}

function recordMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function createTelegramCommandLoginUrl(
  admin: any,
  message: TelegramMessage,
): Promise<string | null> {
  const chatId = telegramId(message.chat?.id);
  const telegramUserId = telegramId(message.from?.id);
  if (!chatId || !telegramUserId) return null;
  const login = await createTelegramLoginLink(admin, {
    telegramUserId,
    telegramChatId: chatId,
    messageThreadId: threadId(message),
    source: "telegram_command",
  });
  return login.url;
}

async function sendStartMenu(admin: any, message: TelegramMessage) {
  const chatId = telegramId(message.chat?.id);
  const loginUrl = await createTelegramCommandLoginUrl(admin, message);
  if (!chatId || !loginUrl) return;

  await sendTelegramMessage({
    chat_id: chatId,
    message_thread_id: threadId(message),
    text: startMenuText(),
    reply_markup: telegramStartMenuKeyboard(loginUrl),
  });
}

function startMenuText(): string {
  return [
    "Welcome to Linkr on Telegram.",
    "",
    "What Linkr can do:",
    "- Research tokens, explain charts, liquidity, volume, activity, and public X posts.",
    "- Read your Linkr wallet, portfolio, launches, transactions, pending actions, and history.",
    "- Prepare buys, sells, ETH/SOL transfers, token launches, Solana NFT collections/mints, liquidity actions, creator-reward claims, and schedules.",
    "- Work on Robinhood Chain and Solana/Pump.fun/PumpSwap.",
    "",
    "How to use it:",
    "- Tap the login button below and connect your X account.",
    '- Then send a normal message, like "what is my SOL balance?", "research this token", or "launch a Solana coin called ...".',
    "- Linkr will ask for missing details. Anything that moves value requires an explicit confirmation before it runs.",
    "",
    "Slash commands:",
    "/start - show this menu",
    "/login - connect your X account",
    "/logout - disconnect Telegram from your Linkr account",
    "/status - show whether Telegram is connected",
    "/help - show a quick command and capability summary",
  ].join("\n");
}

async function sendLoginPrompt(admin: any, message: TelegramMessage) {
  const chatId = telegramId(message.chat?.id);
  const loginUrl = await createTelegramCommandLoginUrl(admin, message);
  if (!chatId || !loginUrl) return;

  await sendTelegramMessage({
    chat_id: chatId,
    message_thread_id: threadId(message),
    text: [
      "Connect your X account to unlock Linkr on Telegram.",
      "After that you can chat privately, prepare launches, transfers, swaps, irreversible token burns, liquidity actions, schedules, and creator-reward claims.",
      "Anything that moves value still requires an explicit confirmation.",
    ].join("\n\n"),
    reply_markup: telegramLoginKeyboard(loginUrl),
  });
}

async function sendLogoutPrompt(
  message: TelegramMessage,
  linked: { user_id?: string | null; username?: string | null } | null,
) {
  const chatId = telegramId(message.chat?.id);
  if (!chatId) return;
  if (!linked?.user_id) {
    await sendTelegramMessage({
      chat_id: chatId,
      text:
        "Telegram is not connected to a Linkr account right now. Use /login to connect.",
    });
    return;
  }

  await sendTelegramMessage({
    chat_id: chatId,
    text: [
      "Log out of Linkr on Telegram?",
      "This disconnects this Telegram chat from your Linkr account. Your Linkr account, wallets, history, and settings stay intact.",
      "You can reconnect later with /login.",
    ].join("\n\n"),
    reply_markup: telegramLogoutKeyboard(),
  });
}

async function runPrivateTelegramTurn(
  admin: any,
  message: TelegramMessage,
  userId: string,
  text: string,
) {
  const chatId = telegramId(message.chat?.id);
  const telegramUserId = telegramId(message.from?.id);
  if (!chatId || !telegramUserId) return;

  const activeBan = (await getActiveBanForAuthUser(admin, userId)).ban;
  if (activeBan) {
    await sendTelegramMessage({
      chat_id: chatId,
      text: "This connected X account is currently banned from Linkr.",
    }).catch(() => null);
    return;
  }

  await sendTelegramChatAction({ chat_id: chatId, action: "typing" }).catch(
    () => null,
  );

  const photo = bestTelegramPhoto(message);
  let imageUrl: string | null = null;
  if (photo) {
    const uploaded = await uploadTelegramPhotoForLaunch(admin, {
      photo,
      telegramUserId,
      telegramMessageId: telegramId(message.message_id),
    }).catch(() => null);
    imageUrl = uploaded?.publicUrl ?? null;
  }

  const runtimeText = [text, imageUrl].filter(Boolean).join("\n").trim();
  const turnText = runtimeText || "Image attached.";
  let sink: TelegramSink | null = null;
  try {
    const prepared = await prepareTurn(admin, userId, message, turnText);
    sink = createTelegramSink(admin, prepared);
    const result = await processLinkrAgentTurn(
      admin,
      buildTurnInput(userId, message, turnText, prepared, imageUrl),
      sink,
    );
    await sink.finalize(result);
    const replyMarkup = sink.pendingActionId
      ? telegramPendingActionKeyboard(sink.pendingActionId)
      : null;
    await sendTelegramMessage({
      chat_id: chatId,
      text: sink.assistantText || "Done.",
      reply_markup: replyMarkup,
    });
  } catch (error) {
    const messageText = userSafeError(
      error instanceof Error ? error.message : String(error),
    );
    if (sink) {
      await sink
        .setAssistantMessage({
          content: messageText,
          parts: [{ type: "error", text: messageText }],
          status: "failed",
        })
        .catch(() => null);
    }
    await sendTelegramMessage({ chat_id: chatId, text: messageText }).catch(
      () => null,
    );
  }
}

async function handleCallbackQuery(
  admin: any,
  callback: TelegramCallbackQuery,
) {
  const callbackData = String(callback.data ?? "");
  const [rawAction, rawArgument] = callbackData.split(":");
  const action = rawAction?.toLowerCase() ?? "";
  const argument = rawArgument ?? "";
  const chat = callback.message?.chat;
  const chatId = telegramId(chat?.id);
  const telegramUserId = telegramId(callback.from.id);
  if (action === "logout") {
    await handleLogoutCallback(
      admin,
      callback,
      argument,
      chatId,
      telegramUserId,
    );
    return;
  }

  const pendingActionId = argument;
  if (
    !chatId || !telegramUserId || !["confirm", "cancel"].includes(action) ||
    !pendingActionId
  ) {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: "That action button is invalid.",
      show_alert: true,
    }).catch(() => null);
    return;
  }

  await upsertTelegramAccount(admin, callback.from);
  if (chat) await upsertTelegramChat(admin, chat);

  const linked = await getLinkedTelegramAccount(admin, telegramUserId);
  if (!linked?.user_id) {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: "Connect your X account in DM first.",
      show_alert: true,
    }).catch(() => null);
    return;
  }
  const activeBan = (await getActiveBanForAuthUser(admin, linked.user_id)).ban;
  if (activeBan) {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: "This X account is banned from Linkr.",
      show_alert: true,
    }).catch(() => null);
    await sendTelegramMessage({
      chat_id: chatId,
      text: "This connected X account is currently banned from Linkr.",
    }).catch(() => null);
    return;
  }

  const pending = await loadPending(admin, linked.user_id, pendingActionId);
  if (!pending) {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: "I could not find that pending action.",
      show_alert: true,
    }).catch(() => null);
    return;
  }
  if (pending.surface !== "telegram") {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: "Use the original Linkr surface to confirm that action.",
      show_alert: true,
    }).catch(() => null);
    return;
  }

  await answerTelegramCallbackQuery({
    callback_query_id: callback.id,
    text: action === "confirm" ? "Running action..." : "Cancelling...",
  }).catch(() => null);
  await sendTelegramChatAction({ chat_id: chatId, action: "typing" }).catch(
    () => null,
  );

  const run = await createActionRun(
    admin,
    linked.user_id,
    pending,
    callback,
    action,
  );
  try {
    if (action === "cancel") {
      const cancelled = await cancelLinkrPendingAction({
        admin,
        userId: linked.user_id,
        pendingActionId,
      });
      const text = cancelled.cancelled
        ? "Cancelled. I will not run that action."
        : "That action was already handled.";
      await completeActionRun(
        admin,
        run,
        linked.user_id,
        text,
        [{ type: "system_notice", text }],
        "cancelled",
        { cancelled },
      );
      await refreshPendingCount(
        admin,
        linked.user_id,
        pending.terminal_conversation_id,
      );
      await sendTelegramMessage({ chat_id: chatId, text });
    } else {
      const execution = await confirmAndExecuteLinkrPendingAction({
        admin,
        userId: linked.user_id,
        pendingActionId,
        runId: run.run.id,
      });
      const text = execution.result?.summary ??
        "Confirmed. The action has been handled.";
      await completeActionRun(
        admin,
        run,
        linked.user_id,
        text,
        [
          {
            type: "transaction_receipt",
            receipt: execution.receipt,
            result: execution.result,
          },
        ],
        "completed",
        execution,
      );
      await refreshPendingCount(
        admin,
        linked.user_id,
        pending.terminal_conversation_id,
      );
      await sendTelegramMessage({ chat_id: chatId, text });
    }
    if (callback.message?.message_id) {
      await editTelegramMessageReplyMarkup({
        chat_id: chatId,
        message_id: callback.message.message_id,
        reply_markup: null,
      }).catch(() => null);
    }
  } catch (error) {
    const message = userSafeActionError(
      error instanceof Error ? error.message : String(error),
    );
    await completeActionRun(
      admin,
      run,
      linked.user_id,
      message,
      [{ type: "error", text: message }],
      "failed",
      { error: message },
    );
    await sendTelegramMessage({ chat_id: chatId, text: message }).catch(() =>
      null
    );
  }
}

async function handleLogoutCallback(
  admin: any,
  callback: TelegramCallbackQuery,
  action: string,
  chatId: string,
  telegramUserId: string,
) {
  if (
    !chatId || !telegramUserId || !["confirm", "cancel"].includes(action) ||
    normalizeChatType(callback.message?.chat) !== "private"
  ) {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: "That logout button is invalid.",
      show_alert: true,
    }).catch(() => null);
    return;
  }

  await upsertTelegramAccount(admin, callback.from);
  if (callback.message?.chat) {
    await upsertTelegramChat(admin, callback.message.chat);
  }

  const linked = await getLinkedTelegramAccount(admin, telegramUserId);
  if (action === "cancel") {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: linked?.user_id ? "Still connected." : "Already disconnected.",
    }).catch(() => null);
    await removeCallbackButtons(callback, chatId);
    await sendTelegramMessage({
      chat_id: chatId,
      text: linked?.user_id
        ? "Kept connected. You can keep using Linkr here."
        : "Telegram is already disconnected. Use /login to connect again.",
    }).catch(() => null);
    return;
  }

  if (!linked?.user_id) {
    await answerTelegramCallbackQuery({
      callback_query_id: callback.id,
      text: "Already disconnected.",
    }).catch(() => null);
    await removeCallbackButtons(callback, chatId);
    await sendTelegramMessage({
      chat_id: chatId,
      text: "Telegram is already disconnected. Use /login to connect again.",
    }).catch(() => null);
    return;
  }

  const result = await unlinkTelegramAccount(admin, telegramUserId);
  await answerTelegramCallbackQuery({
    callback_query_id: callback.id,
    text: result.unlinked ? "Logged out." : "Already disconnected.",
  }).catch(() => null);
  await removeCallbackButtons(callback, chatId);
  await sendTelegramMessage({
    chat_id: chatId,
    text: result.unlinked
      ? "Logged out of Linkr on Telegram. Use /login to connect again."
      : "Telegram is already disconnected. Use /login to connect again.",
  }).catch(() => null);
}

async function removeCallbackButtons(
  callback: TelegramCallbackQuery,
  chatId: string,
) {
  if (!callback.message?.message_id) return;
  await editTelegramMessageReplyMarkup({
    chat_id: chatId,
    message_id: callback.message.message_id,
    reply_markup: null,
  }).catch(() => null);
}

type PreparedTurn = {
  conversation: any;
  telegramConversation: any;
  userMessage: any;
  assistantMessage: any;
  run: any;
};

async function prepareTurn(
  admin: any,
  userId: string,
  message: TelegramMessage,
  text: string,
): Promise<PreparedTurn> {
  const conversationBundle = await loadOrCreateConversation(
    admin,
    userId,
    message,
    text,
  );
  const clientMessageId = `telegram:${telegramId(message.chat?.id)}:${
    threadId(message) || "main"
  }:${telegramId(message.message_id)}`;
  const userMessage = await insertOrSelect(
    admin,
    "linkr_terminal_messages",
    {
      conversation_id: conversationBundle.conversation.id,
      user_id: userId,
      role: "user",
      content: text,
      parts: [],
      status: "completed",
      client_message_id: clientMessageId,
      source_refs: [],
      metadata: {
        telegram_chat_id: telegramId(message.chat?.id),
        telegram_message_id: telegramId(message.message_id),
        telegram_user_id: telegramId(message.from?.id),
        message_thread_id: threadId(message),
      },
      idempotency_key: `telegram-user:${userId}:${clientMessageId}`,
    },
    "idempotency_key",
    `telegram-user:${userId}:${clientMessageId}`,
  );
  if (userMessage.error) throw userMessage.error;

  const assistantMessage = await insertOrSelect(
    admin,
    "linkr_terminal_messages",
    {
      conversation_id: conversationBundle.conversation.id,
      user_id: userId,
      role: "assistant",
      content: "",
      parts: [],
      status: "typing",
      metadata: { telegram_chat_id: telegramId(message.chat?.id) },
      idempotency_key: `telegram-assistant:${userMessage.data.id}`,
    },
    "idempotency_key",
    `telegram-assistant:${userMessage.data.id}`,
  );
  if (assistantMessage.error) throw assistantMessage.error;

  const run = await insertOrSelect(
    admin,
    "linkr_agent_runs",
    {
      user_id: userId,
      surface: "telegram",
      source_surface: "telegram",
      surface_conversation_id: conversationBundle.surfaceConversationId,
      terminal_conversation_id: conversationBundle.conversation.id,
      user_message_id: userMessage.data.id,
      assistant_message_id: assistantMessage.data.id,
      status: "running",
      started_at: new Date().toISOString(),
      idempotency_key: `telegram-run:${userMessage.data.id}`,
    },
    "idempotency_key",
    `telegram-run:${userMessage.data.id}`,
  );
  if (run.error || !run.data?.id) {
    const error = run.error ?? new Error("telegram run insert returned no id");
    await failPreparedTurn(
      admin,
      userId,
      assistantMessage.data.id,
      null,
      error,
    );
    throw error;
  }

  const conversationUpdate = await admin
    .from("linkr_terminal_conversations")
    .update({
      last_message_preview: text.slice(0, 180),
      last_message_role: "user",
      last_message_at: new Date().toISOString(),
      message_count: (conversationBundle.conversation.message_count ?? 0) + 1,
      title: conversationBundle.conversation.title || titleFromText(text),
    })
    .eq("id", conversationBundle.conversation.id)
    .eq("user_id", userId);
  if (conversationUpdate.error) {
    await failPreparedTurn(
      admin,
      userId,
      assistantMessage.data.id,
      run.data.id,
      conversationUpdate.error,
    );
    throw conversationUpdate.error;
  }

  const telegramUpdate = await admin
    .from("telegram_conversations")
    .update({ last_telegram_message_id: telegramId(message.message_id) })
    .eq("id", conversationBundle.telegramConversation.id);
  if (telegramUpdate.error) {
    await failPreparedTurn(
      admin,
      userId,
      assistantMessage.data.id,
      run.data.id,
      telegramUpdate.error,
    );
    throw telegramUpdate.error;
  }

  return {
    conversation: conversationBundle.conversation,
    telegramConversation: conversationBundle.telegramConversation,
    userMessage: userMessage.data,
    assistantMessage: assistantMessage.data,
    run: run.data,
  };
}

async function failPreparedTurn(
  admin: any,
  userId: string,
  assistantMessageId: string,
  runId: string | null,
  error: unknown,
) {
  const diagnostic = serializeUnknownError(error);
  await admin
    .from("linkr_terminal_messages")
    .update({
      content: "I couldn't start that request. Please try again.",
      status: "failed",
      metadata: { failure_phase: "prepare", error: diagnostic },
    })
    .eq("id", assistantMessageId)
    .eq("user_id", userId);
  if (runId) {
    await admin
      .from("linkr_agent_runs")
      .update({
        status: "failed",
        error: JSON.stringify(diagnostic),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);
  }
}

function buildTurnInput(
  userId: string,
  message: TelegramMessage,
  text: string,
  prepared: PreparedTurn,
  imageUrl: string | null,
): LinkrTurnInput {
  return {
    surface: "telegram",
    surface_conversation_id:
      prepared.telegramConversation.surface_conversation_id,
    source_message_id: telegramId(message.message_id),
    user_id: userId,
    text,
    actor: {
      kind: "telegram_user",
      user_id: userId,
      display_name:
        [message.from?.first_name, message.from?.last_name].filter(Boolean)
          .join(" ") ||
        message.from?.username ||
        null,
    },
    transport: {
      kind: "telegram_reply",
      public_output: false,
      supports_streaming: false,
      max_response_chars: 3900,
    },
    conversation: {
      terminal_conversation_id: prepared.conversation.id,
      user_message_id: prepared.userMessage.id,
      assistant_message_id: prepared.assistantMessage.id,
      run_id: prepared.run.id,
    },
    attachments: imageUrl ? [{ kind: "image", source_url: imageUrl }] : [],
    source_refs: [],
    client_context: {
      route: "telegram",
      selected_chain: "all",
    },
  };
}

type TelegramSink = LinkrTurnOutputSink & {
  assistantText: string;
  pendingActionId: string | null;
};

type TelegramVerificationChallenge = {
  id: string;
  status: string;
  expires_at: string;
  source: string;
  metadata?: Record<string, unknown> | null;
};

function createTelegramSink(admin: any, prepared: PreparedTurn): TelegramSink {
  let assistantText = "";
  let parts: unknown[] = [];
  let pendingActionId: string | null = null;
  return {
    get assistantText() {
      return assistantText;
    },
    get pendingActionId() {
      return pendingActionId;
    },
    async setStatus(status, metadata = {}) {
      await admin.from("linkr_terminal_events").insert({
        run_id: prepared.run.id,
        conversation_id: prepared.conversation.id,
        user_id: prepared.conversation.user_id,
        type: status,
        payload: metadata,
      });
    },
    async emit(event, payload) {
      if (event === "action_required") {
        const pending = (payload as any)?.pending_action;
        if (pending?.id) pendingActionId = pending.id;
      }
      if (!["delta", "ack"].includes(String(event))) {
        await admin.from("linkr_terminal_events").insert({
          run_id: prepared.run.id,
          conversation_id: prepared.conversation.id,
          user_id: prepared.conversation.user_id,
          type: String(event),
          payload,
        });
      }
    },
    appendAssistantDelta(delta) {
      assistantText += delta;
      return Promise.resolve();
    },
    async setAssistantMessage(args) {
      assistantText = args.content;
      parts = args.parts ?? parts;
      await admin
        .from("linkr_terminal_messages")
        .update({
          content: args.content,
          parts,
          status: args.status,
          metadata: args.metadata ?? {},
        })
        .eq("id", prepared.assistantMessage.id)
        .eq("user_id", prepared.conversation.user_id);
      await admin
        .from("linkr_terminal_conversations")
        .update({
          last_message_preview: args.content.slice(0, 180),
          last_message_role: "assistant",
          last_message_at: new Date().toISOString(),
          message_count: (prepared.conversation.message_count ?? 0) + 2,
        })
        .eq("id", prepared.conversation.id)
        .eq("user_id", prepared.conversation.user_id);
    },
    async addMessagePart(part) {
      parts = [...parts, part];
      await admin
        .from("linkr_terminal_messages")
        .update({ parts })
        .eq("id", prepared.assistantMessage.id)
        .eq("user_id", prepared.conversation.user_id);
    },
    addSourceRef(_sourceRef) {
      return Promise.resolve();
    },
    createPendingActionCard(payload) {
      pendingActionId = String(
        payload.pending_action_id ?? pendingActionId ?? "",
      );
      parts = [...parts, { type: "confirmation_card", ...payload }];
      return Promise.resolve();
    },
    async finalize(result) {
      await admin
        .from("linkr_agent_runs")
        .update({ outcome: result, completed_at: new Date().toISOString() })
        .eq("id", prepared.run.id)
        .eq("user_id", prepared.conversation.user_id);
    },
  };
}

async function loadOrCreateConversation(
  admin: any,
  userId: string,
  message: TelegramMessage,
  text: string,
) {
  const telegramChatId = telegramId(message.chat?.id);
  const telegramUserId = telegramId(message.from?.id);
  const messageThreadId = threadId(message) ?? "";
  const surfaceConversationId = `telegram:${telegramChatId}:${
    messageThreadId || "main"
  }:${telegramUserId}`;

  const existing = await admin
    .from("telegram_conversations")
    .select("*")
    .eq("telegram_chat_id", telegramChatId)
    .eq("telegram_user_id", telegramUserId)
    .eq("message_thread_id", messageThreadId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const conversation = await admin
      .from("linkr_terminal_conversations")
      .select("*")
      .eq("id", existing.data.terminal_conversation_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (conversation.error) throw conversation.error;
    if (conversation.data) {
      return {
        conversation: conversation.data,
        telegramConversation: existing.data,
        surfaceConversationId,
      };
    }
  }

  const conversation = await admin
    .from("linkr_terminal_conversations")
    .insert({
      user_id: userId,
      title: titleFromText(text),
      status: "active",
      source: "telegram",
      pinned_context: {
        telegram_chat_id: telegramChatId,
        telegram_user_id: telegramUserId,
        message_thread_id: messageThreadId || null,
      },
    })
    .select("*")
    .single();
  if (conversation.error) throw conversation.error;

  const telegramConversationRow = {
    telegram_chat_id: telegramChatId,
    telegram_user_id: telegramUserId,
    user_id: userId,
    message_thread_id: messageThreadId,
    chat_type: normalizeChatType(message.chat),
    terminal_conversation_id: conversation.data.id,
    surface_conversation_id: surfaceConversationId,
  };
  const telegramConversation = existing.data
    ? await admin
      .from("telegram_conversations")
      .update(telegramConversationRow)
      .eq("id", existing.data.id)
      .select("*")
      .single()
    : await admin
      .from("telegram_conversations")
      .insert(telegramConversationRow)
      .select("*")
      .single();
  if (telegramConversation.error) throw telegramConversation.error;
  return {
    conversation: conversation.data,
    telegramConversation: telegramConversation.data,
    surfaceConversationId,
  };
}

async function createActionRun(
  admin: any,
  userId: string,
  pending: any,
  callback: TelegramCallbackQuery,
  action: string,
) {
  const conversationId = pending.terminal_conversation_id ?? null;
  const content = action === "confirm" ? pending.confirmation_phrase : "cancel";
  const userMessage = conversationId
    ? await insertOrSelect(
      admin,
      "linkr_terminal_messages",
      {
        conversation_id: conversationId,
        user_id: userId,
        role: "user",
        content,
        status: "completed",
        parts: [],
        metadata: {
          pending_action_id: pending.id,
          telegram_callback_id: callback.id,
          action,
        },
        idempotency_key: `telegram-callback-user:${callback.id}:${action}`,
      },
      "idempotency_key",
      `telegram-callback-user:${callback.id}:${action}`,
    )
    : { data: null, error: null };
  if (userMessage.error) throw userMessage.error;

  const assistantMessage = conversationId
    ? await insertOrSelect(
      admin,
      "linkr_terminal_messages",
      {
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: action === "confirm"
          ? "Running confirmed action..."
          : "Cancelling action...",
        status: "typing",
        parts: [
          {
            type: "tool_status",
            label: action === "confirm" ? "Executing" : "Cancelling",
            status: "running",
          },
        ],
        metadata: {
          pending_action_id: pending.id,
          telegram_callback_id: callback.id,
          action,
        },
        idempotency_key: `telegram-callback-assistant:${callback.id}:${action}`,
      },
      "idempotency_key",
      `telegram-callback-assistant:${callback.id}:${action}`,
    )
    : { data: null, error: null };
  if (assistantMessage.error) throw assistantMessage.error;

  const run = await insertOrSelect(
    admin,
    "linkr_agent_runs",
    {
      user_id: userId,
      surface: "telegram",
      source_surface: "telegram",
      surface_conversation_id: pending.surface_conversation_id,
      terminal_conversation_id: conversationId,
      user_message_id: userMessage.data?.id ?? null,
      assistant_message_id: assistantMessage.data?.id ?? null,
      status: "running",
      started_at: new Date().toISOString(),
      idempotency_key: `telegram-action:${action}:${callback.id}`,
    },
    "idempotency_key",
    `telegram-action:${action}:${callback.id}`,
  );
  if (run.error) throw run.error;
  return {
    userMessage: userMessage.data,
    assistantMessage: assistantMessage.data,
    run: run.data,
  };
}

async function completeActionRun(
  admin: any,
  bundle: any,
  userId: string,
  content: string,
  parts: any[],
  status: string,
  outcome: any,
) {
  if (bundle.assistantMessage?.id) {
    await admin
      .from("linkr_terminal_messages")
      .update({
        content,
        parts,
        status: status === "failed" ? "failed" : "completed",
      })
      .eq("id", bundle.assistantMessage.id)
      .eq("user_id", userId);
  }
  await admin
    .from("linkr_agent_runs")
    .update({ status, outcome, completed_at: new Date().toISOString() })
    .eq("id", bundle.run.id)
    .eq("user_id", userId);
}

async function refreshPendingCount(
  admin: any,
  userId: string,
  conversationId: string | null | undefined,
) {
  if (!conversationId) return;
  const { count } = await admin
    .from("linkr_pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("terminal_conversation_id", conversationId)
    .eq("status", "pending");
  await admin
    .from("linkr_terminal_conversations")
    .update({
      pending_action_count: count ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("user_id", userId);
}

async function loadPending(admin: any, userId: string, id: string) {
  const { data, error } = await admin
    .from("linkr_pending_actions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function insertTelegramUpdate(
  admin: any,
  updateId: string,
  update: TelegramUpdate,
): Promise<"accepted" | "duplicate_terminal" | "duplicate_active"> {
  const target = update.callback_query?.message ?? update.message ??
    update.edited_message ?? null;
  const joinRequest = update.chat_join_request ?? null;
  const accepted = await admin.rpc("accept_legacy_telegram_update", {
    p_update_id: updateId,
    p_telegram_user_id: telegramId(
      update.callback_query?.from?.id ?? joinRequest?.from?.id ??
        target?.from?.id,
    ) || null,
    p_telegram_chat_id: telegramId(joinRequest?.chat?.id ?? target?.chat?.id) ||
      null,
    p_payload: update,
    p_lease_seconds: 600,
  });
  if (accepted.error) throw accepted.error;
  const disposition = String(accepted.data?.disposition ?? "");
  if (
    disposition !== "accepted" && disposition !== "duplicate_terminal" &&
    disposition !== "duplicate_active"
  ) throw new Error("invalid_telegram_acceptance_disposition");
  return disposition;
}

async function finishTelegramUpdate(
  admin: any,
  updateId: string,
  status: "processed" | "ignored" | "failed",
  error?: string,
) {
  const result = await admin
    .from("telegram_updates")
    .update({
      status,
      error: error ? error.slice(0, 1000) : null,
      processed_at: new Date().toISOString(),
      lease_expires_at: null,
    })
    .eq("update_id", updateId);
  if (result.error) throw result.error;
}

async function insertOrSelect(
  admin: any,
  table: string,
  row: Record<string, unknown>,
  keyColumn: string,
  keyValue: string,
) {
  const inserted = await admin.from(table).insert(row).select("*")
    .maybeSingle();
  if (!inserted.error) return inserted;
  const code = String(inserted.error?.code ?? "");
  const message = String(inserted.error?.message ?? "");
  if (code !== "23505" && !/duplicate key|unique/i.test(message)) {
    return inserted;
  }
  return await admin.from(table).select("*").eq(keyColumn, keyValue)
    .maybeSingle();
}

function normalizeChatType(chat: TelegramChat | null | undefined): string {
  const type = String(chat?.type ?? "unknown").toLowerCase();
  return type === "group" || type === "supergroup" || type === "channel"
    ? type
    : "private";
}

function messageText(message: TelegramMessage): string {
  return String(message.text ?? message.caption ?? "").trim();
}

function threadId(message: TelegramMessage): string | null {
  const value = telegramId(message.message_thread_id);
  return value || null;
}

function replyMessageId(
  chatType: string,
  message: TelegramMessage,
): string | number | null {
  return chatType === "private" ? null : message.message_id;
}

function parseCommand(text: string): string | null {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[\w_]+)?(?:\s|$)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function startPayload(text: string): string | null {
  const stripped = text.replace(/^\/start(?:@[\w_]+)?/i, "").trim();
  return stripped || null;
}

function cleanAddressedText(text: string, chatType: string): string {
  const username = botUsername().toLowerCase();
  let clean = text.trim();
  clean = clean.replace(new RegExp(`@${escapeRegExp(username)}\\b`, "ig"), "")
    .trim();
  if (chatType !== "private") clean = stripCommandAddress(clean);
  return clean;
}

function stripCommandAddress(text: string): string {
  return text.replace(/^\/([a-z0-9_]+)@[\w_]+/i, "/$1").trim();
}

function isAddressedInGroup(
  message: TelegramMessage,
  rawText: string,
): boolean {
  const username = botUsername().toLowerCase();
  if (new RegExp(`@${escapeRegExp(username)}\\b`, "i").test(rawText)) {
    return true;
  }
  const command = rawText.trim().match(/^\/[a-z0-9_]+(?:@([\w_]+))?/i);
  if (command) {
    const addressedTo = String(command[1] ?? "")
      .replace(/^@/, "")
      .toLowerCase();
    return !addressedTo || addressedTo === username;
  }
  const repliedToBot = String(message.reply_to_message?.from?.username ?? "")
    .replace(/^@/, "")
    .toLowerCase() === username;
  return repliedToBot;
}

function telegramDisplayName(user: TelegramUser): string {
  const username = String(user.username ?? "")
    .replace(/^@/, "")
    .trim();
  if (username) return `@${username}`;
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    "New member";
}

function mutedVerificationPermissions(): Record<string, boolean> {
  return {
    can_send_messages: false,
    can_send_basic_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_manage_topics: false,
  };
}

function publicGroupReply(text: string): string {
  const command = parseCommand(text);
  if (command === "help") return helpText("group");
  if (/\b(what can you do|help|commands|capabilities)\b/i.test(text)) {
    return capabilityPromptSummary();
  }
  if (/\b(can|could|how do i|how can i|what do you need)\b/i.test(text)) {
    return terminalNaturalFallbackReply(text);
  }
  return "I can answer Linkr capability questions here. For token research, wallet context, launches, transfers, swaps, irreversible token burns, schedules, and confirmations, DM me so the conversation stays private.";
}

function helpText(chatType: string): string {
  if (chatType !== "private") {
    return [
      "Linkr works in groups for lightweight public questions when you mention me.",
      "DM me for private terminal chat, wallet context, launches, transfers, swaps, irreversible token burns, liquidity, schedules, and confirmations.",
      `Start here: ${botDeepLink("login")}`,
    ].join("\n");
  }
  return [
    "Linkr Telegram commands:",
    "/start - show the welcome menu and login button",
    "/login - connect your X account",
    "/logout - disconnect Telegram from your Linkr account",
    "/status - show connection status",
    "/help - show this help",
    "",
    "After login, message me like the Linkr terminal. I can research tokens, read your Linkr context, prepare launches, transfers, swaps, irreversible token burns, liquidity actions, schedules, and creator-reward claims.",
    "Anything that moves value requires a Confirm button before it runs.",
  ].join("\n");
}

function titleFromText(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 54
    ? clean.slice(0, 51) + "..."
    : clean || "Telegram chat";
}

function userSafeError(message: string) {
  if (/conversation_run_locked/.test(message)) {
    return "I am still finishing the previous turn. Try again in a moment.";
  }
  if (/telegram_file|launch_image/.test(message)) {
    return "I could not read that Telegram image. Send a public image URL or try another image.";
  }
  return "Linkr hit an error before finishing this turn.";
}

function userSafeActionError(message: string) {
  if (/insufficient/i.test(message)) {
    return "The action could not run because the wallet balance is too low.";
  }
  if (/expired/i.test(message)) {
    return "That pending action expired. Prepare it again if you still want to do it.";
  }
  if (/wallet/i.test(message)) {
    return "I could not find the required Linkr wallet for that action.";
  }
  return "The action failed before completion.";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
